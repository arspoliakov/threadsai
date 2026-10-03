import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from aiogram.exceptions import TelegramRetryAfter
from aiogram.methods import SendMessage
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.models import User, Project, RetentionDelivery, RetentionSettings
from app.services import retention as service


class FakeBot:
    def __init__(self, failure=None):
        self.sent = []
        self.failure = failure

    async def send_message(self, *args, **kwargs):
        self.sent.append((args, kwargs))
        if self.failure:
            raise self.failure
        return SimpleNamespace(message_id=100)


class RetentionTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.now = datetime.now(UTC).replace(hour=12, minute=0, second=0, microsecond=0)

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def customer(self, db, *, consent=True, contact=True):
        user = User(first_name="Test", telegram_id=123, marketing_consent=consent, onboarding_consent=consent,
            created_at=self.now - timedelta(days=4))
        db.add(user)
        await db.commit()
        if contact:
            await service.note_bot_contact(db, user.telegram_id)
        return user

    async def enable(self, db):
        config = await service.get_settings(db)
        config.sending_enabled = config.automated_enabled = True
        await db.commit()

    async def campaign(self, db, key="unique-request-1"):
        campaign = await service.create_campaign(db, title="Test", message="Help", segment="all", kind="marketing", request_key=key)
        await db.execute(update(RetentionDelivery).where(RetentionDelivery.campaign_id == campaign.id).values(due_at=self.now))
        await db.commit()
        return campaign

    async def test_default_disabled_and_explicit_consent_contact_required(self):
        async with self.sessions() as db:
            user = await self.customer(db, consent=False, contact=False)
            self.assertFalse(await service.eligible(db, user, "marketing"))
            user.marketing_consent = True
            await db.commit()
            self.assertFalse(await service.eligible(db, user, "marketing"))
            await service.note_bot_contact(db, 123)
            self.assertTrue(await service.eligible(db, user, "marketing"))
            await self.campaign(db)
            bot = FakeBot()
            self.assertEqual(await service.process_deliveries(db, bot, self.now), 0)
            self.assertEqual(bot.sent, [])

    async def test_campaign_idempotent_and_unsubscribe_cancels_queued(self):
        async with self.sessions() as db:
            await self.customer(db)
            a = await self.campaign(db)
            b = await self.campaign(db)
            self.assertEqual(a.id, b.id)
            self.assertEqual(await db.scalar(select(func.count()).select_from(RetentionDelivery)), 1)
            await service.unsubscribe_user(db, 123)
            await self.enable(db)
            bot = FakeBot()
            await service.process_deliveries(db, bot, self.now)
            self.assertEqual(bot.sent, [])
            self.assertEqual(await db.scalar(select(RetentionDelivery.status)), "cancelled")

    async def test_automatic_once_and_rechecks_project_creation(self):
        async with self.sessions() as db:
            user = await self.customer(db)
            await self.enable(db)
            self.assertEqual(await service.plan_automatic(db, self.now), 1)
            self.assertEqual(await service.plan_automatic(db, self.now), 0)
            db.add(Project(name="Started", slug="started", owner_id=user.id))
            await db.commit()
            bot = FakeBot()
            await service.process_deliveries(db, bot, self.now)
            self.assertEqual(bot.sent, [])
            self.assertEqual(await db.scalar(select(RetentionDelivery.status)), "cancelled")

    async def test_uncertain_send_is_never_retried_and_counts_against_caps(self):
        async with self.sessions() as db:
            user = await self.customer(db)
            await self.enable(db)
            await self.campaign(db)
            bot = FakeBot(TimeoutError("ambiguous"))
            await service.process_deliveries(db, bot, self.now)
            await service.process_deliveries(db, bot, self.now + timedelta(minutes=5))
            self.assertEqual(len(bot.sent), 1)
            self.assertEqual(await db.scalar(select(RetentionDelivery.status)), "uncertain")
            self.assertFalse(await service.eligible(db, user, "marketing", now=self.now + timedelta(hours=1)))

    async def test_retry_after_delays_and_success_sends_opt_out(self):
        async with self.sessions() as db:
            await self.customer(db)
            await self.enable(db)
            await self.campaign(db)
            limited = FakeBot(TelegramRetryAfter(method=SendMessage(chat_id=123, text="Help"), message="limited", retry_after=60))
            await service.process_deliveries(db, limited, self.now)
            delivery = await db.scalar(select(RetentionDelivery))
            self.assertEqual(delivery.status, "queued")
            bot = FakeBot()
            await service.process_deliveries(db, bot, self.now + timedelta(seconds=30))
            self.assertEqual(bot.sent, [])
            await service.process_deliveries(db, bot, self.now + timedelta(seconds=70))
            self.assertEqual(len(bot.sent), 1)
            self.assertEqual(bot.sent[0][1]["reply_markup"].inline_keyboard[0][0].callback_data, "retention:unsubscribe")

    async def test_second_rule_and_weekly_cap(self):
        async with self.sessions() as db:
            user = await self.customer(db)
            db.add(Project(name="Dormant", slug="dormant", owner_id=user.id, created_at=self.now - timedelta(days=8)))
            await db.commit()
            await self.enable(db)
            self.assertEqual(await service.plan_automatic(db, self.now), 1)
            self.assertEqual(await db.scalar(select(RetentionDelivery.rule_key)), "no_first_post_7d")
            for i, days in enumerate((4, 6)):
                db.add(RetentionDelivery(user_id=user.id, dedupe_key=f"previous:{i}", kind="marketing", message="Old", status="sent",
                    due_at=self.now - timedelta(days=days), attempted_at=self.now - timedelta(days=days), sent_at=self.now - timedelta(days=days)))
            await db.commit()
            self.assertFalse(await service.eligible(db, user, "onboarding", now=self.now))


if __name__ == "__main__":
    unittest.main()

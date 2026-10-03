import unittest
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.models import User, TributeWebhookEvent
from app.services import subscriptions as service
from tests.test_subscription_login_sync import FakeBot


class TributeReliabilityTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.now = datetime.now(UTC)

    async def asyncTearDown(self):
        await self.engine.dispose()

    def event(self, name="new_subscription", offset=0, expiry=3):
        return {"name": name, "created_at": (self.now + timedelta(seconds=offset)).isoformat(),
                "sent_at": self.now.isoformat(), "payload": {
                    "subscription_name": "ThreadsGO! Basic", "telegram_user_id": 777,
                    "expires_at": (self.now + timedelta(days=expiry)).isoformat(), "type": "regular"}}

    async def customer(self, db):
        user = User(telegram_id=777, first_name="Customer")
        db.add(user)
        await db.commit()
        return user

    async def test_paid_access_survives_refresh_leave_and_reconciliation_without_channel(self):
        async with self.sessions() as db:
            user = await self.customer(db)
            await service.apply_tribute_webhook_payload(payload=self.event(), session=db)
            self.assertTrue(await service.refresh_user_subscription(bot=FakeBot(None), user=user, session=db))
            chat = next(iter(service.get_tariff_chats()))
            await service.handle_user_left_tariff_chat(bot=FakeBot(None), telegram_id=777, left_chat_id=chat, session=db)
            await service.reconcile_known_user_subscriptions(bot=FakeBot(None), session=db)
            self.assertTrue(user.subscription_status)
            self.assertEqual(user.tariff_plan, "basic")

    async def test_payment_before_registration_is_replayed(self):
        async with self.sessions() as db:
            self.assertFalse(await service.apply_tribute_webhook_payload(payload=self.event(), session=db))
            user = await self.customer(db)
            await service.replay_pending_tribute_events(user=user, session=db)
            self.assertTrue(user.subscription_status)
            self.assertEqual(await db.scalar(select(TributeWebhookEvent.status)), "applied")

    async def test_retry_and_delayed_cancellation_cannot_shorten_renewal(self):
        async with self.sessions() as db:
            user = await self.customer(db)
            event = self.event("renewed_subscription", offset=2, expiry=30)
            await service.apply_tribute_webhook_payload(payload=event, session=db)
            event["sent_at"] = (self.now + timedelta(hours=1)).isoformat()
            self.assertFalse(await service.apply_tribute_webhook_payload(payload=event, session=db))
            self.assertEqual(await db.scalar(select(func.count()).select_from(TributeWebhookEvent)), 1)
            await service.apply_tribute_webhook_payload(payload=self.event("cancelled_subscription", expiry=-1), session=db)
            self.assertTrue(user.subscription_status)
            self.assertEqual(user.subscription_expires_at.replace(tzinfo=UTC), self.now + timedelta(days=30))
            self.assertEqual(user.tribute_last_event_type, "renewed_subscription")

    async def test_cancel_preserves_paid_period_then_channel_does_not_revive_expired_access(self):
        async with self.sessions() as db:
            user = await self.customer(db)
            await service.apply_tribute_webhook_payload(payload=self.event(), session=db)
            await service.apply_tribute_webhook_payload(payload=self.event("cancelled_subscription", offset=2), session=db)
            self.assertTrue(user.subscription_status)
            self.assertEqual(user.subscription_phase, "cancelled")
            expired = self.event("cancelled_subscription", offset=3, expiry=-1)
            await service.apply_tribute_webhook_payload(payload=expired, session=db)
            chat = next(iter(service.get_tariff_chats()))
            self.assertFalse(await service.refresh_user_subscription(bot=FakeBot(chat), user=user, session=db))
            self.assertFalse(user.subscription_status)
            ignored = self.event("new_donation", offset=4)
            self.assertFalse(await service.apply_tribute_webhook_payload(payload=ignored, session=db))

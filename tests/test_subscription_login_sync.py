from __future__ import annotations

import unittest
import hashlib
import hmac
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.api import auth
from app.db.base import Base
from app.db.models import User
from app.services import subscriptions


class FakeBot:
    def __init__(self, active_chat_id: int | None) -> None:
        self.active_chat_id = active_chat_id

    async def get_chat_member(self, *, chat_id: int, user_id: int) -> object:
        del user_id
        status = "member" if chat_id == self.active_chat_id else "left"
        return SimpleNamespace(status=status)


class SubscriptionLoginSyncTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            poolclass=StaticPool,
        )
        self.session_factory = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()

    async def test_paid_membership_is_recovered_during_first_login(self) -> None:
        tariff_chat_id, tariff = next(iter(subscriptions.get_tariff_chats().items()))
        async with self.session_factory() as session:
            user = User(telegram_id=123456, first_name="New customer")
            session.add(user)
            await session.commit()
            await session.refresh(user)

            activated = await subscriptions.sync_user_subscription_after_login(
                bot=FakeBot(tariff_chat_id),
                user=user,
                session=session,
            )

            self.assertTrue(activated)
            self.assertTrue(user.subscription_status)
            self.assertEqual(user.tariff_plan, tariff.name)
            self.assertEqual(user.tariff_accounts_limit, tariff.accounts)

    async def test_unpaid_user_remains_authenticated_but_inactive(self) -> None:
        async with self.session_factory() as session:
            user = User(telegram_id=654321, first_name="Visitor")
            session.add(user)
            await session.commit()
            await session.refresh(user)

            activated = await subscriptions.sync_user_subscription_after_login(
                bot=FakeBot(None),
                user=user,
                session=session,
            )

            self.assertFalse(activated)
            self.assertFalse(user.subscription_status)

    async def test_manual_refresh_disables_expired_subscription(self) -> None:
        async with self.session_factory() as session:
            user = User(
                telegram_id=777,
                first_name="Former customer",
                subscription_status=True,
                tariff_plan="pro",
                tariff_accounts_limit=7,
                tariff_posts_per_day=5,
                tariff_projects_limit=5,
                tariff_queue_days=3,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)

            active = await subscriptions.refresh_user_subscription(
                bot=FakeBot(None),
                user=user,
                session=session,
            )

            self.assertFalse(active)
            self.assertFalse(user.subscription_status)
            self.assertEqual(user.tariff_plan, "none")
            self.assertEqual(user.tariff_accounts_limit, 0)

    def test_allowlist_is_optional_after_billing_launch(self) -> None:
        open_settings = Settings(
            _env_file=None,
            APPROVED_TELEGRAM_IDS="1",
            ENFORCE_TELEGRAM_ALLOWLIST=False,
        )
        closed_settings = Settings(
            _env_file=None,
            APPROVED_TELEGRAM_IDS="1",
            ENFORCE_TELEGRAM_ALLOWLIST=True,
        )

        self.assertTrue(open_settings.is_telegram_id_approved(999))
        self.assertFalse(closed_settings.is_telegram_id_approved(999))
        self.assertTrue(closed_settings.is_telegram_id_approved(1))

    def test_telegram_widget_auth_ignores_local_attribution_for_signature(self) -> None:
        previous_token = auth.settings.telegram_bot_token
        previous_max_age = auth.settings.telegram_auth_max_age_seconds
        auth.settings.telegram_bot_token = "test-bot-token"
        auth.settings.telegram_auth_max_age_seconds = 60 * 60 * 24 * 365 * 10

        try:
            auth_date = 1780000000
            signed_payload = {
                "auth_date": auth_date,
                "first_name": "Ilya",
                "id": 123456789,
                "username": "ilya",
            }
            data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(signed_payload.items()))
            secret_key = hashlib.sha256(auth.settings.telegram_bot_token.encode("utf-8")).digest()
            payload_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()

            payload = auth.TelegramAuthPayload(
                **signed_payload,
                hash=payload_hash,
                attribution=auth.AuthAttributionPayload(
                    first_landing="/direct/ai-post-generator/",
                    referrer="https://yandex.ru/",
                    utm={"utm_source": "yandex"},
                    analytics={"client_id": "123.456"},
                ),
            )

            try:
                auth._validate_telegram_auth(payload)
            except HTTPException as exc:  # pragma: no cover - assertion gives a cleaner failure.
                self.fail(f"Telegram auth should ignore attribution during signature validation, got {exc.detail!r}")
        finally:
            auth.settings.telegram_bot_token = previous_token
            auth.settings.telegram_auth_max_age_seconds = previous_max_age


if __name__ == "__main__":
    unittest.main()

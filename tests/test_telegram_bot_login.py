from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.api import auth
from app.api.deps import get_db
from app.api.main import app
from app.db.models import TelegramLoginChallenge
from app.services import telegram_login


class TelegramBotLoginChallengeTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        self.sessions = async_sessionmaker(self.engine, class_=AsyncSession, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()

    async def test_confirmation_requires_browser_secret_and_explicit_approval(self) -> None:
        async with self.sessions() as session:
            created = await telegram_login.create_challenge(session=session, attribution={"utm": {"source": "test"}})
            self.assertEqual(telegram_login.browser_status(created.challenge), "pending")
            with self.assertRaises(telegram_login.ChallengeError):
                await telegram_login.get_browser_challenge(
                    session=session,
                    challenge_id=created.challenge.id,
                    browser_secret="wrong",
                )
            bound = await telegram_login.bind_bot_challenge(
                session=session,
                bot_secret=created.bot_secret,
                telegram_id=42,
                profile={"first_name": "Tester", "username": "tester"},
            )
            self.assertEqual(telegram_login.browser_status(bound), "pending")
            await telegram_login.decide_challenge(
                session=session,
                challenge_id=created.challenge.id,
                telegram_id=42,
                approve=True,
            )
            await session.refresh(bound)
            self.assertEqual(telegram_login.browser_status(bound), "approved")

    async def test_challenge_is_bound_to_first_telegram_user(self) -> None:
        async with self.sessions() as session:
            created = await telegram_login.create_challenge(session=session, attribution=None)
            await telegram_login.bind_bot_challenge(
                session=session,
                bot_secret=created.bot_secret,
                telegram_id=42,
                profile={"first_name": "First"},
            )
            with self.assertRaises(telegram_login.ChallengeError):
                await telegram_login.bind_bot_challenge(
                    session=session,
                    bot_secret=created.bot_secret,
                    telegram_id=43,
                    profile={"first_name": "Other"},
                )
            with self.assertRaises(telegram_login.ChallengeError):
                await telegram_login.decide_challenge(
                    session=session,
                    challenge_id=created.challenge.id,
                    telegram_id=43,
                    approve=True,
                )

    async def test_consumption_is_idempotent_for_retry_window(self) -> None:
        async with self.sessions() as session:
            created = await telegram_login.create_challenge(session=session, attribution=None)
            challenge = await telegram_login.bind_bot_challenge(
                session=session,
                bot_secret=created.bot_secret,
                telegram_id=42,
                profile={"first_name": "Tester"},
            )
            await telegram_login.decide_challenge(
                session=session,
                challenge_id=challenge.id,
                telegram_id=42,
                approve=True,
            )
            await session.refresh(challenge)
            first = await telegram_login.consume_challenge(
                session=session,
                challenge=challenge,
                user_id=7,
                token="signed.jwt.value",
            )
            await session.refresh(challenge)
            self.assertEqual(first, "signed.jwt.value")
            self.assertEqual(telegram_login.get_retry_token(challenge), "signed.jwt.value")
            self.assertEqual(telegram_login.browser_status(challenge), "consumed")

    async def test_cancel_is_terminal(self) -> None:
        async with self.sessions() as session:
            created = await telegram_login.create_challenge(session=session, attribution=None)
            status = await telegram_login.cancel_challenge(session=session, challenge=created.challenge)
            self.assertEqual(status, "cancelled")
            with self.assertRaises(telegram_login.ChallengeError):
                await telegram_login.bind_bot_challenge(
                    session=session,
                    bot_secret=created.bot_secret,
                    telegram_id=42,
                    profile={"first_name": "Tester"},
                )

    async def test_http_flow_returns_session_only_after_bot_approval(self) -> None:
        old_token = auth.settings.telegram_bot_token
        old_username = auth.settings.telegram_bot_username
        old_enabled = auth.settings.telegram_bot_login_enabled
        auth.settings.telegram_bot_token = "test-bot-token"
        auth.settings.telegram_bot_username = "threadsgo_test_bot"
        auth.settings.telegram_bot_login_enabled = True

        async def override_db():
            async with self.sessions() as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        client = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
        try:
            started = await client.post("/api/v1/auth/telegram-bot/start", json={})
            self.assertEqual(started.status_code, 201)
            data = started.json()
            self.assertNotIn(data["browser_secret"], data["bot_url"])

            pending = await client.post(
                "/api/v1/auth/telegram-bot/complete",
                json={"challenge_id": data["challenge_id"], "browser_secret": data["browser_secret"]},
            )
            self.assertEqual(pending.status_code, 409)
            self.assertEqual(pending.json()["detail"]["code"], "challenge_pending")

            async with self.sessions() as session:
                challenge = await session.get(TelegramLoginChallenge, data["challenge_id"])
                assert challenge is not None
                # The clear bot secret is intentionally available only in the Telegram URL.
                bot_secret = data["bot_url"].split("login_", 1)[1]
                await telegram_login.bind_bot_challenge(
                    session=session,
                    bot_secret=bot_secret,
                    telegram_id=4242,
                    profile={"first_name": "HTTP Tester", "username": "http_tester"},
                )
                await telegram_login.decide_challenge(
                    session=session,
                    challenge_id=challenge.id,
                    telegram_id=4242,
                    approve=True,
                )

            with patch.object(auth, "_sync_subscription_after_login", new=AsyncMock()):
                completed = await client.post(
                    "/api/v1/auth/telegram-bot/complete",
                    json={"challenge_id": data["challenge_id"], "browser_secret": data["browser_secret"]},
                )
                repeated = await client.post(
                    "/api/v1/auth/telegram-bot/complete",
                    json={"challenge_id": data["challenge_id"], "browser_secret": data["browser_secret"]},
                )
            self.assertEqual(completed.status_code, 200)
            self.assertEqual(repeated.status_code, 200)
            self.assertEqual(completed.json()["access_token"], repeated.json()["access_token"])
        finally:
            await client.aclose()
            app.dependency_overrides.pop(get_db, None)
            auth.settings.telegram_bot_token = old_token
            auth.settings.telegram_bot_username = old_username
            auth.settings.telegram_bot_login_enabled = old_enabled


if __name__ == "__main__":
    unittest.main()

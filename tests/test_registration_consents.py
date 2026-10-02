from __future__ import annotations

import unittest

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api import auth
from app.db.base import Base
from app.db.models import User


class RegistrationConsentTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        self.sessions = async_sessionmaker(self.engine, class_=AsyncSession, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def create_user(self, db, registration=None):
        return await auth._get_or_create_verified_telegram_user(
            telegram_id=8765, first_name="Consent Tester", username=None,
            photo_url=None, attribution=None, db=db, registration=registration,
        )

    async def test_new_user_requires_all_consents_and_does_not_create_partial_record(self):
        async with self.sessions() as db:
            for registration in (None, {"version": "2026-10-02", "terms": True, "privacy": False, "risks": True}):
                with self.assertRaises(HTTPException) as raised:
                    await self.create_user(db, registration)
                self.assertEqual(raised.exception.detail["code"], "registration_required")
                self.assertEqual(await db.scalar(select(func.count(User.id))), 0)

    async def test_registration_records_consents_but_login_does_not_rewrite_them(self):
        async with self.sessions() as db:
            user = await self.create_user(db, {"version": "2026-10-02", "terms": True, "privacy": True, "risks": True})
            self.assertTrue(user._registration_is_new)
            records = user.registration_consents_json
            self.assertEqual({r["purpose"] for r in records}, {"terms", "personal_data", "platform_risks"})
            self.assertTrue(all(r["accepted_at"] and r["version"] == "2026-10-02" for r in records))
            returning = await self.create_user(db)
            self.assertFalse(returning._registration_is_new)
            self.assertEqual(returning.registration_consents_json, records)

    async def test_existing_user_without_historical_consent_can_login_without_fabricated_consent(self):
        async with self.sessions() as db:
            db.add(User(telegram_id=8765, first_name="Existing"))
            await db.commit()
            user = await self.create_user(db)
            self.assertFalse(user._registration_is_new)
            self.assertIsNone(user.registration_consents_json)

    def test_boolean_coercion_and_unknown_document_version_are_rejected(self):
        for override in ({"privacy": "false"}, {"terms": 1}, {"version": "old"}):
            payload = {"version": "2026-10-02", "terms": True, "privacy": True, "risks": True, **override}
            with self.assertRaises(ValidationError):
                auth.RegistrationConsentPayload.model_validate(payload)

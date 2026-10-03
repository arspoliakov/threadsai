from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from sqlalchemy import func, select

from app.api.auth import limiter
from app.db.models import PostingTask, StudioDraft, StudioRequest, User
from tests import test_api_smoke


class StudioReliabilityTest(IsolatedAsyncioTestCase):
    asyncSetUp = test_api_smoke.ApiSmokeTest.asyncSetUp
    asyncTearDown = test_api_smoke.ApiSmokeTest.asyncTearDown

    async def test_trial_replay_survives_retry_without_consuming_credit_or_ai(self):
        limiter.reset()
        payload = {"topic": "Реальная тема", "context": "Реальные факты автора для конкретного текста"}
        headers = {"Idempotency-Key": "trial-request-123"}
        with patch("app.api.routes.studio.content_preview", new=AsyncMock(return_value=[{"text": "Готовый текст"}])) as ai:
            first = await self.client.post("/api/v1/studio/trial", json=payload, headers=headers)
            replay = await self.client.post("/api/v1/studio/trial", json=payload, headers=headers)
            mismatch = await self.client.post("/api/v1/studio/trial", json={**payload, "topic": "Другая тема"}, headers=headers)
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(first.json(), replay.json())
        self.assertEqual(replay.headers["Idempotency-Replayed"], "true")
        self.assertEqual(mismatch.status_code, 409)
        self.assertEqual(ai.await_count, 1)
        self.assertEqual((await self.client.get("/api/v1/studio/trial")).json()["remaining"], 2)

    async def test_week_replay_bypasses_generation_rate_limit_and_has_no_duplicates(self):
        limiter.reset()
        payload = {"rubrics": ["Совет"], "goal": "Рассказать о реальном продукте"}
        path = "/api/v1/studio/projects/1/week-plan"
        headers = {"Idempotency-Key": "week-request-123"}
        with patch("app.api.routes.studio.content_preview", new=AsyncMock(return_value=[
            {"text": f"Текст {i}", "rubric": "Совет", "topic": f"Тема {i}"} for i in range(7)
        ])) as ai:
            first = await self.client.post(path, json=payload, headers=headers)
            replay = await self.client.post(path, json=payload, headers=headers)
            limited = await self.client.post(path, json=payload, headers={"Idempotency-Key": "week-request-new"})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(first.json(), replay.json())
        self.assertEqual(limited.status_code, 429, limited.text)
        self.assertEqual(ai.await_count, 1)
        async with self.session_factory() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(PostingTask)), 7)

    async def test_expired_reservation_restores_only_reserved_credit_and_active_blocks_retry(self):
        limiter.reset()
        payload = {"topic": "Реальная тема", "context": "Реальные факты автора для конкретного текста", "tone": "friendly"}
        import hashlib
        import json
        fingerprint = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        async with self.session_factory() as db:
            user = await db.get(User, 1)
            user.studio_trial_used = 3  # Two legacy successful credits plus one expired reservation.
            db.add(StudioRequest(id="expired", owner_id=1, kind="trial", request_key="expired-request",
                                 payload_hash=fingerprint, status="running", reserved_at=datetime.now(UTC) - timedelta(minutes=3)))
            await db.commit()
        self.assertEqual((await self.client.get("/api/v1/studio/trial")).json()["remaining"], 1)
        async with self.session_factory() as db:
            expired = await db.get(StudioRequest, "expired")
            self.assertEqual(expired.status, "expired")
            user = await db.get(User, 1)
            user.studio_trial_used = 3
            db.add(StudioRequest(id="active", owner_id=1, kind="trial", request_key="active-request",
                                 payload_hash=fingerprint, status="running", reserved_at=datetime.now(UTC)))
            await db.commit()
        with patch("app.api.routes.studio.content_preview", new=AsyncMock()) as ai:
            active = await self.client.post("/api/v1/studio/trial", json=payload, headers={"Idempotency-Key": "active-request"})
        self.assertEqual(active.status_code, 409, active.text)
        self.assertEqual(active.headers["Retry-After"], "5")
        ai.assert_not_awaited()
        self.assertEqual((await self.client.get("/api/v1/studio/trial")).json()["remaining"], 0)

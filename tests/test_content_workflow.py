from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from sqlalchemy import select
from app.api.auth import limiter
from app.db.models import Account, PostingTask, PostingTaskStatus, Platform, User
from tests import test_api_smoke


class ContentWorkflowTest(IsolatedAsyncioTestCase):
    asyncSetUp = test_api_smoke.ApiSmokeTest.asyncSetUp
    asyncTearDown = test_api_smoke.ApiSmokeTest.asyncTearDown

    async def unpaid(self):
        limiter.reset()
        async with self.session_factory() as db:
            user = await db.get(User, 1)
            user.subscription_status = False
            await db.commit()

    async def draft(self, task_id=50):
        async with self.session_factory() as db:
            db.add(PostingTask(id=task_id, project_id=1, platform=Platform.THREADS,
                               content_text="Исходный текст", posts_chain=["Исходный текст"], status=PostingTaskStatus.DRAFT))
            account = await db.get(Account, 1)
            account.cookies_encrypted = "encrypted-fixture"
            account.assigned_port = 20001
            await db.commit()

    async def test_three_trial_drafts_without_subscription_and_failed_ai_restores_credit(self):
        await self.unpaid()
        payload = {"topic": "Реальная тема", "context": "Реальные факты автора для конкретного текста"}
        with patch("app.api.routes.studio.content_preview", new=AsyncMock(side_effect=ValueError("bad json"))):
            self.assertEqual((await self.client.post("/api/v1/studio/trial", json=payload)).status_code, 502)
        self.assertEqual((await self.client.get("/api/v1/studio/trial")).json()["remaining"], 3)
        limiter.reset()
        with patch("app.api.routes.studio.content_preview", new=AsyncMock(return_value=[{"text": "Готовый текст", "topic": "Тема", "rubric": "Совет"}])) as ai:
            for _ in range(3):
                self.assertEqual((await self.client.post("/api/v1/studio/trial", json=payload)).status_code, 201)
            limiter.reset()
            self.assertEqual((await self.client.post("/api/v1/studio/trial", json=payload)).status_code, 409)
            self.assertEqual(ai.await_count, 3)
        data = (await self.client.get("/api/v1/studio/trial")).json()
        self.assertEqual(data["remaining"], 0)
        self.assertEqual(len(data["drafts"]), 3)
        async with self.session_factory() as db:
            self.assertIsNone(await db.scalar(select(PostingTask.id)))

    async def test_import_is_owned_and_cannot_create_duplicate_tasks(self):
        limiter.reset()
        with patch("app.api.routes.studio.content_preview", new=AsyncMock(return_value=[{"text": "Готовый текст"}])):
            draft = (await self.client.post("/api/v1/studio/trial", json={"topic": "Тема текста", "context": "Реальные факты о продукте и его аудитории"})).json()
        self.assertEqual((await self.client.post(f"/api/v1/studio/trial/{draft['id']}/import", json={"project_id": 2})).status_code, 404)
        result = await self.client.post(f"/api/v1/studio/trial/{draft['id']}/import", json={"project_id": 1})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((await self.client.post(f"/api/v1/studio/trial/{draft['id']}/import", json={"project_id": 1})).status_code, 409)
        async with self.session_factory() as db:
            task = await db.get(PostingTask, result.json()["task_id"])
            self.assertEqual(task.status, PostingTaskStatus.DRAFT)
            self.assertIsNone(task.account_id)
            self.assertIsNone(task.scheduled_at)
        self.assertEqual((await self.client.delete("/api/v1/projects/1")).status_code, 204)
        self.assertIsNone((await self.client.get("/api/v1/studio/trial")).json()["drafts"][0]["imported_task_id"])

    async def test_week_plan_creates_only_drafts_and_respects_project_ownership(self):
        limiter.reset()
        payload = {"rubrics": ["Совет", "Разбор"], "goal": "Рассказать о реальном продукте и его пользе"}
        with patch("app.api.routes.studio.content_preview", new=AsyncMock(return_value=[{"text": f"Текст {i}", "rubric": "Совет", "topic": f"Тема {i}"} for i in range(7)])) as ai:
            self.assertEqual((await self.client.post("/api/v1/studio/projects/2/week-plan", json=payload)).status_code, 404)
            limiter.reset()
            result = await self.client.post("/api/v1/studio/projects/1/week-plan", json=payload)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(ai.await_count, 1)
        async with self.session_factory() as db:
            tasks = list((await db.scalars(select(PostingTask))).all())
            self.assertEqual(len(tasks), 7)
            self.assertTrue(all(t.status == PostingTaskStatus.DRAFT and t.scheduled_at is None and t.account_id is None for t in tasks))

    async def test_rewrite_preview_never_overwrites_and_stale_apply_is_rejected(self):
        limiter.reset()
        await self.draft()
        with patch("app.api.routes.studio.content_preview", new=AsyncMock(return_value=[{"text": "Новый текст"}])):
            result = await self.client.post("/api/v1/tasks/50/rewrite-preview", json={"mode": "shorter"})
            self.assertEqual(result.status_code, 200, result.text)
        tasks = (await self.client.get("/api/v1/tasks/", params={"project_id": 1})).json()
        self.assertEqual(tasks[0]["content_text"], "Исходный текст")
        self.assertEqual((await self.client.put("/api/v1/tasks/50", json={"posts_chain": ["Ручная правка"]})).status_code, 200)
        stale = await self.client.put("/api/v1/tasks/50", json={"posts_chain": result.json()["posts_chain"], "expected_posts_chain": result.json()["source_posts_chain"]})
        self.assertEqual(stale.status_code, 409)
        accepted = await self.client.put("/api/v1/tasks/50", json={"posts_chain": ["Новый текст"], "expected_posts_chain": ["Ручная правка"]})
        self.assertEqual(accepted.status_code, 200)

    async def test_schedule_validates_profile_time_limits_and_can_return_to_draft(self):
        await self.draft()
        when = (datetime.now(UTC) + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
        path = "/api/v1/tasks/50/schedule"
        self.assertEqual((await self.client.post(path, json={"scheduled_at": when.isoformat(), "account_id": 2})).status_code, 409)
        self.assertEqual((await self.client.post(path, json={"scheduled_at": datetime.now(UTC).isoformat(), "account_id": 1})).status_code, 422)
        result = await self.client.post(path, json={"scheduled_at": when.isoformat(), "account_id": 1})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["status"], "queued")
        self.assertEqual(result.json()["account_username"], "owner_account")
        await self.draft(51)
        self.assertEqual((await self.client.post("/api/v1/tasks/51/schedule", json={"scheduled_at": (when + timedelta(minutes=5)).isoformat(), "account_id": 1})).status_code, 409)
        paused = await self.client.post("/api/v1/tasks/50/to-draft")
        self.assertEqual(paused.status_code, 200, paused.text)
        self.assertEqual(paused.json()["status"], "draft")
        self.assertIsNone(paused.json()["scheduled_at"])

    async def test_manual_generation_no_profile_needed_and_new_project_defaults_to_approval(self):
        fake = PostingTask(project_id=1, platform=Platform.THREADS, content_text="Текст", posts_chain=["Текст"], status=PostingTaskStatus.QUEUED)
        with patch("app.api.routes.projects.generate_post", new=AsyncMock(return_value=fake)):
            result = await self.client.post("/api/v1/projects/1/trigger-generation")
        self.assertEqual(result.status_code, 202, result.text)
        self.assertEqual(result.json()["status"], "draft")
        self.assertIsNone(result.json()["scheduled_at"])
        created = await self.client.post("/api/v1/projects/", json={"name": "Согласование", "description": "Тестовый проект"})
        self.assertEqual(created.status_code, 201)
        self.assertFalse(created.json()["auto_generate"])
        from app.posting.scheduler import ensure_project_queue
        with patch("app.posting.scheduler.AsyncSessionLocal", self.session_factory), patch("app.posting.scheduler.generate_post", new=AsyncMock()) as ai:
            self.assertEqual(await ensure_project_queue(created.json()["id"]), 0)
            ai.assert_not_awaited()

    async def test_unknown_publication_cannot_be_rewritten_or_rescheduled(self):
        await self.draft()
        async with self.session_factory() as db:
            task = await db.get(PostingTask, 50)
            task.generation_metadata = {"publication_confirmation_pending": True}
            await db.commit()
        limiter.reset()
        self.assertEqual((await self.client.post("/api/v1/tasks/50/rewrite-preview", json={"mode": "shorter"})).status_code, 409)
        self.assertEqual((await self.client.post("/api/v1/tasks/50/schedule", json={"scheduled_at": (datetime.now(UTC) + timedelta(days=2)).isoformat(), "account_id": 1})).status_code, 409)

from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from app.core.config import settings
from app.db.models import Account, Platform, PostingTask, PostingTaskStatus, ProjectOperation, ProjectOperationStatus
from sqlalchemy import select
from tests import test_api_smoke


class ScheduleReliabilityTest(IsolatedAsyncioTestCase):
    asyncSetUp = test_api_smoke.ApiSmokeTest.asyncSetUp
    asyncTearDown = test_api_smoke.ApiSmokeTest.asyncTearDown

    async def prepare(self):
        async with self.session_factory() as db:
            account = await db.get(Account, 1)
            account.cookies_encrypted = "fixture"
            account.assigned_port = 20001
            db.add(PostingTask(id=50, project_id=1, account_id=1, platform=Platform.THREADS,
                content_text="Текст", posts_chain=["Текст"], status=PostingTaskStatus.QUEUED,
                scheduled_at=datetime.now(UTC), generation_metadata={"publish_now_requested": True,
                "approved_by_owner": True}))
            await db.commit()
        return (datetime.now(UTC) + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)

    async def test_return_and_reschedule_remove_immediate_publish_intent(self):
        when = await self.prepare()
        returned = await self.client.post("/api/v1/tasks/50/to-draft")
        self.assertEqual(returned.status_code, 200, returned.text)
        self.assertNotIn("publish_now_requested", returned.json()["generation_metadata"])
        self.assertNotIn("approved_by_owner", returned.json()["generation_metadata"])
        async with self.session_factory() as db:
            task = await db.get(PostingTask, 50)
            task.generation_metadata = {"publish_now_requested": True}
            await db.commit()
        scheduled = await self.client.post("/api/v1/tasks/50/schedule", json={"account_id": 1, "scheduled_at": when.isoformat()})
        self.assertEqual(scheduled.status_code, 200, scheduled.text)
        self.assertNotIn("publish_now_requested", scheduled.json()["generation_metadata"])
        self.assertTrue(scheduled.json()["generation_metadata"]["approved_by_owner"])

    async def test_manual_edit_revokes_approval_before_publication(self):
        await self.prepare()
        edited = await self.client.put("/api/v1/tasks/50", json={"posts_chain": ["Правка"], "expected_posts_chain": ["Текст"]})
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()["status"], "draft")
        self.assertIsNone(edited.json()["scheduled_at"])
        self.assertNotIn("approved_by_owner", edited.json()["generation_metadata"])
        self.assertNotIn("publish_now_requested", edited.json()["generation_metadata"])

    async def test_schedule_matches_worker_interval_and_chain_limit(self):
        when = await self.prepare()
        async with self.session_factory() as db:
            db.add(PostingTask(id=51, project_id=1, account_id=1, platform=Platform.THREADS,
                content_text="Другой", posts_chain=["Другой"], status=PostingTaskStatus.QUEUED, scheduled_at=when))
            await db.commit()
        with patch.object(settings, "posting_min_interval_minutes", 60):
            result = await self.client.post("/api/v1/tasks/50/schedule", json={"account_id": 1, "scheduled_at": (when + timedelta(minutes=30)).isoformat()})
        self.assertEqual(result.status_code, 409, result.text)
        self.assertIn("60", result.json()["detail"])
        async with self.session_factory() as db:
            task = await db.get(PostingTask, 50)
            task.posts_chain = [f"Часть {i}" for i in range(6)]
            await db.commit()
        result = await self.client.post("/api/v1/tasks/50/schedule", json={"account_id": 1, "scheduled_at": (when + timedelta(days=1)).isoformat()})
        self.assertEqual(result.status_code, 409, result.text)
        self.assertIn("Цепочка", result.json()["detail"])

    async def test_schedule_checks_rolling_action_budget_across_midnight(self):
        when = await self.prepare()
        async with self.session_factory() as db:
            db.add(PostingTask(id=51, project_id=1, account_id=1, platform=Platform.THREADS,
                content_text="Цепочка", posts_chain=[f"Часть {i}" for i in range(5)],
                status=PostingTaskStatus.SUCCESS, finished_at=when - timedelta(hours=20)))
            await db.commit()
        result = await self.client.post("/api/v1/tasks/50/schedule", json={"account_id": 1, "scheduled_at": when.isoformat()})
        self.assertEqual(result.status_code, 409, result.text)
        self.assertIn("24", result.json()["detail"])

    async def test_manual_generation_reserves_without_holding_write_transaction_and_recovers_failure(self):
        async def generate(**kwargs):
            async with self.session_factory() as db:
                operation = await db.scalar(select(ProjectOperation).where(ProjectOperation.project_id == 1))
                self.assertEqual(operation.status, ProjectOperationStatus.RUNNING)
            duplicate = await self.client.post("/api/v1/projects/1/trigger-generation")
            self.assertEqual(duplicate.status_code, 409, duplicate.text)
            raise ValueError("synthetic provider failure")
        with patch("app.api.routes.projects.generate_post", new=AsyncMock(side_effect=generate)):
            result = await self.client.post("/api/v1/projects/1/trigger-generation")
        self.assertEqual(result.status_code, 502, result.text)
        async with self.session_factory() as db:
            operation = await db.scalar(select(ProjectOperation).where(ProjectOperation.project_id == 1))
            self.assertEqual(operation.status, ProjectOperationStatus.FAILED)
            self.assertIsNotNone(operation.finished_at)
            self.assertIsNone(await db.scalar(select(PostingTask.id)))
        fake = PostingTask(project_id=1, platform=Platform.THREADS, content_text="Черновик", posts_chain=["Черновик"])
        with patch("app.api.routes.projects.generate_post", new=AsyncMock(return_value=fake)):
            result = await self.client.post("/api/v1/projects/1/trigger-generation")
        self.assertEqual(result.status_code, 202, result.text)
        self.assertEqual(result.json()["status"], "draft")

    async def test_project_deleted_during_ai_cannot_create_orphan_draft(self):
        async def generate(**kwargs):
            deleted = await self.client.delete("/api/v1/projects/1")
            self.assertEqual(deleted.status_code, 204, deleted.text)
            return PostingTask(project_id=1, platform=Platform.THREADS,
                               content_text="Черновик", posts_chain=["Черновик"])
        with patch("app.api.routes.projects.generate_post", new=AsyncMock(side_effect=generate)):
            result = await self.client.post("/api/v1/projects/1/trigger-generation")
        self.assertEqual(result.status_code, 404, result.text)
        async with self.session_factory() as db:
            self.assertIsNone(await db.scalar(select(PostingTask.id)))
            self.assertIsNone(await db.scalar(select(ProjectOperation.id)))

    async def test_schedule_rejects_text_changed_in_another_tab(self):
        when = await self.prepare()
        edited = await self.client.put("/api/v1/tasks/50", json={"posts_chain": ["Другая версия"]})
        self.assertEqual(edited.status_code, 200, edited.text)
        scheduled = await self.client.post("/api/v1/tasks/50/schedule", json={
            "account_id": 1, "scheduled_at": when.isoformat(), "expected_posts_chain": ["Текст"]})
        self.assertEqual(scheduled.status_code, 409, scheduled.text)
        async with self.session_factory() as db:
            task = await db.get(PostingTask, 50)
            self.assertEqual(task.status, PostingTaskStatus.DRAFT)
            self.assertIsNone(task.scheduled_at)

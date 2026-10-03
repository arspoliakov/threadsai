from datetime import UTC, datetime, timedelta
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from sqlalchemy import select
from app.db.models import Account, Platform, PostingTask, PostingTaskStatus, Project, User
from app.posting.scheduler import _ensure_account_queue_for_project, _build_account_topic
from tests import test_api_smoke


class PublicationModeTest(IsolatedAsyncioTestCase):
    asyncSetUp = test_api_smoke.ApiSmokeTest.asyncSetUp
    asyncTearDown = test_api_smoke.ApiSmokeTest.asyncTearDown

    async def test_switch_to_approval_preserves_explicit_unknown_running_and_legacy_posts(self):
        async with self.session_factory() as db:
            for task_id, metadata, state in [
                (50, {"auto_generated": True}, PostingTaskStatus.QUEUED),
                (51, {"auto_generated": True, "approved_by_owner": True}, PostingTaskStatus.QUEUED),
                (52, {"auto_generated": True, "publication_confirmation_pending": True}, PostingTaskStatus.QUEUED),
                (53, {"auto_generated": True}, PostingTaskStatus.RUNNING),
                (54, {}, PostingTaskStatus.QUEUED),
            ]:
                db.add(PostingTask(id=task_id, project_id=1, platform=Platform.THREADS,
                    content_text="Текст", posts_chain=["Текст"], status=state,
                    scheduled_at=datetime.now(UTC), generation_metadata=metadata))
            await db.commit()
        with patch("app.api.routes.projects.schedule_project_queue_refill"):
            result = await self.client.patch("/api/v1/projects/1", json={"auto_generate": False})
        self.assertEqual(result.status_code, 200, result.text)
        async with self.session_factory() as db:
            tasks = {task.id: task for task in (await db.scalars(select(PostingTask))).all()}
            self.assertEqual(tasks[50].status, PostingTaskStatus.DRAFT)
            self.assertIsNone(tasks[50].scheduled_at)
            self.assertEqual(tasks[51].status, PostingTaskStatus.QUEUED)
            self.assertEqual(tasks[52].status, PostingTaskStatus.QUEUED)
            self.assertEqual(tasks[53].status, PostingTaskStatus.RUNNING)
            self.assertEqual(tasks[54].status, PostingTaskStatus.QUEUED)

    async def test_auto_generation_rechecks_mode_after_ai_and_keeps_draft(self):
        async with self.session_factory() as db:
            account = await db.get(Account, 1)
            account.cookies_encrypted = "fixture"
            account.assigned_port = 20001
            await db.commit()
        async def generate(**kwargs):
            self.assertFalse(kwargs["persist"])
            async with self.session_factory() as other:
                project = await other.get(Project, 1)
                project.auto_generate = False
                await other.commit()
            return PostingTask(project_id=1, account_id=1, platform=Platform.THREADS,
                content_text="Текст", posts_chain=["Текст"], status=PostingTaskStatus.QUEUED,
                scheduled_at=kwargs["scheduled_at"], generation_metadata={"fact": "preserved"})
        async with self.session_factory() as db:
            project, account = await db.get(Project, 1), await db.get(Account, 1)
            with patch("app.posting.scheduler.generate_post", new=AsyncMock(side_effect=generate)), patch(
                "app.posting.scheduler._calculate_next_account_slot", new=AsyncMock(return_value=datetime.now(UTC)+timedelta(hours=1))):
                self.assertEqual(await _ensure_account_queue_for_project(project=project, account=account, session=db, remaining_generation_budget=1), 1)
        async with self.session_factory() as db:
            task = await db.scalar(select(PostingTask))
            self.assertEqual(task.status, PostingTaskStatus.DRAFT)
            self.assertIsNone(task.scheduled_at)
            self.assertTrue(task.generation_metadata["auto_generated"])
            self.assertEqual(task.generation_metadata["fact"], "preserved")

    async def test_auto_generation_queues_without_approval_and_rejects_expired_switch(self):
        async with self.session_factory() as db:
            account = await db.get(Account, 1)
            account.cookies_encrypted = "fixture"
            account.assigned_port = 20001
            await db.commit()
            project = await db.get(Project, 1)
            fake = PostingTask(project_id=1, account_id=1, platform=Platform.THREADS,
                content_text="Текст", posts_chain=["Текст"], status=PostingTaskStatus.QUEUED,
                scheduled_at=datetime.now(UTC)+timedelta(hours=1))
            with patch("app.posting.scheduler.generate_post", new=AsyncMock(return_value=fake)), patch(
                "app.posting.scheduler._calculate_next_account_slot", new=AsyncMock(return_value=fake.scheduled_at)):
                self.assertEqual(await _ensure_account_queue_for_project(project=project, account=account, session=db, remaining_generation_budget=1), 1)
            self.assertEqual(fake.status, PostingTaskStatus.QUEUED)
            self.assertNotIn("publish_now_requested", fake.generation_metadata)
            user = await db.get(User, 1)
            user.subscription_expires_at = datetime.now(UTC)-timedelta(hours=1)
            await db.commit()
        with patch("app.api.routes.projects.schedule_project_queue_refill"):
            expired = await self.client.patch("/api/v1/projects/1", json={"auto_generate": True})
        self.assertEqual(expired.status_code, 402, expired.text)
        async with self.session_factory() as db:
            user = await db.get(User, 1)
            user.complimentary_access_expires_at = datetime.now(UTC)+timedelta(days=3)
            await db.commit()
        with patch("app.api.routes.projects.schedule_project_queue_refill"):
            gifted = await self.client.patch("/api/v1/projects/1", json={"auto_generate": True})
        self.assertEqual(gifted.status_code, 200, gifted.text)

    async def test_topics_follow_the_project_niche_instead_of_tutor_template(self):
        project = Project(id=1, name="Страхование", niche="Страхование", target_audience="Владельцы автомобилей")
        account = Account(id=1, username="insurance")
        for index in range(6):
            topic = _build_account_topic(project, account, index)
            self.assertIn("Страхование", topic)
            self.assertIn("Владельцы автомобилей", topic)
            self.assertNotIn("tutor", topic)

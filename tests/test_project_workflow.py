from datetime import UTC, datetime, timedelta
import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import select
from app.ai_engine.prompt_builder import build_system_prompt
from app.db.models import Account, GlobalPrompt, Platform, PostingTask, PostingTaskStatus, Project, PromptType, User
from app.posting.scheduler import _ensure_account_queue_for_project
from app.services.project_workflow import build_project_workflow
from tests import test_api_smoke as fixtures


class ProjectWorkflowTest(unittest.IsolatedAsyncioTestCase):
    asyncTearDown = fixtures.ApiSmokeTest.asyncTearDown

    async def asyncSetUp(self):
        await fixtures.ApiSmokeTest.asyncSetUp(self)
        self.refill_patch = patch("app.api.routes.projects.schedule_project_queue_refill")
        self.refill_patch.start()
        self.addCleanup(self.refill_patch.stop)

    async def test_onboarding_retry_is_one_durable_project(self):
        payload = {"name": "Wizard", "onboarding_request_key": "wizard-request-1"}
        first = await self.client.post("/api/v1/projects/", json=payload)
        self.assertEqual(first.status_code, 201, first.text)
        second = await self.client.post("/api/v1/projects/", json=payload)
        self.assertEqual(second.status_code, 201, second.text)
        self.assertEqual(first.json()["id"], second.json()["id"])
        another = await self.client.post("/api/v1/projects/", json={"name": "Another", "onboarding_request_key": "wizard-request-2"})
        self.assertEqual(another.status_code, 201, another.text)
        reset = await self.client.put("/api/v1/onboarding", json={"reset": True})
        self.assertEqual(reset.status_code, 200, reset.text)
        self.assertNotIn("creation_requests", reset.json())
        replay = await self.client.post("/api/v1/projects/", json=payload)
        self.assertEqual(replay.status_code, 201, replay.text)
        self.assertEqual(replay.json()["id"], first.json()["id"])
        changed = await self.client.post("/api/v1/projects/", json={**payload, "name": "Changed"})
        self.assertEqual(changed.status_code, 409, changed.text)
        async with self.session_factory() as db:
            owner = await db.get(User, 1)
            self.assertEqual(owner.onboarding_state["creation_requests"]["wizard-request-1"]["project_id"], first.json()["id"])
            self.assertEqual(len((await db.scalars(select(Project).where(Project.owner_id == 1))).all()), 3)

    async def test_style_and_modes_are_individual_and_legacy_boolean_compatible(self):
        async with self.session_factory() as db:
            db.add(GlobalPrompt(owner_id=1, prompt_type=PromptType.VIRALITY, title="Original", body="Old style", version="1"))
            db.add(GlobalPrompt(owner_id=1, prompt_type=PromptType.FORMATTING, title="Format", body="Keep formatting", version="1"))
            await db.commit()
        first = await self.client.post("/api/v1/projects/", json={"name": "First", "global_style_body": "Only the first project style"})
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(first.json()["publication_mode"], "review")
        second = await self.client.post("/api/v1/projects/", json={"name": "Second", "auto_generate": False})
        self.assertEqual(second.status_code, 201, second.text)
        self.assertEqual(second.json()["publication_mode"], "manual")
        async with self.session_factory() as db:
            self.assertEqual(await db.scalar(select(GlobalPrompt.body).where(GlobalPrompt.prompt_type == PromptType.VIRALITY)), "Old style")
            prompt = await build_system_prompt(first.json()["id"], db)
            self.assertIn("Keep formatting", prompt)
            self.assertNotIn("Old style", prompt)
            self.assertEqual(prompt.count("Only the first project style"), 1)
        edited = await self.client.patch(f"/api/v1/projects/{first.json()['id']}", json={"publication_mode": "auto"})
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertTrue(edited.json()["auto_generate"])
        other = (await self.client.get(f"/api/v1/projects/{second.json()['id']}")).json()
        self.assertEqual(other["publication_mode"], "manual")
        self.assertIn("Old style", other["style_body"])

    async def prepare_generation(self, db, mode="review"):
        project = await db.get(Project, 1)
        project.global_context = "Практические заметки о разработке"
        project.publication_mode = mode
        project.posts_per_day = 1
        project.auto_generate = True
        account = await db.get(Account, 1)
        account.cookies_encrypted = "fixture"
        account.assigned_port = 20001
        await db.commit()
        return project, account

    async def test_review_prepares_bounded_drafts_without_publishing(self):
        async with self.session_factory() as db:
            project, account = await self.prepare_generation(db)
            async def generate(**kw):
                return PostingTask(project_id=1, account_id=1, platform=Platform.THREADS,
                    status=PostingTaskStatus.QUEUED, scheduled_at=kw["scheduled_at"], content_text="AI", posts_chain=["AI"])
            with patch("app.posting.scheduler.generate_post", new=AsyncMock(side_effect=generate)) as generator, patch(
                "app.posting.scheduler._calculate_next_account_slot", new=AsyncMock(return_value=datetime.now(UTC) + timedelta(hours=1))):
                count = await _ensure_account_queue_for_project(project=project, account=account, session=db, remaining_generation_budget=5)
                self.assertEqual(count, 2)
                self.assertEqual(await _ensure_account_queue_for_project(project=project, account=account, session=db, remaining_generation_budget=5), 0)
                self.assertEqual(generator.await_count, 2)
            tasks = (await db.scalars(select(PostingTask))).all()
            self.assertTrue(all(t.status == PostingTaskStatus.DRAFT and t.scheduled_at is None for t in tasks))
            self.assertTrue(all(t.account_id == 1 for t in tasks))

    async def test_review_switch_removes_only_unapproved_automatic_queue(self):
        async with self.session_factory() as db:
            await self.prepare_generation(db, "auto")
            examples = [
                {"auto_generated": True},
                {"auto_generated": True, "approved_by_owner": True},
                {"auto_generated": True, "publication_confirmation_pending": True},
                {"applied_angle": "Legacy AI"},
                {"hook_mechanic": "Legacy hook"},
                {"applied_angle": "Legacy AI", "approved_by_owner": True},
                {"hook_mechanic": "Legacy hook", "publish_now_requested": True},
                {"applied_angle": "Legacy AI", "publication_confirmation_pending": True},
                {"source": "manual"},
                {"auto_generated": True, "publish_now_requested": True},
            ]
            for i, metadata in enumerate(examples, 40):
                db.add(PostingTask(id=i, project_id=1, account_id=1, platform=Platform.THREADS,
                    content_text="Text", posts_chain=["Text"], status=PostingTaskStatus.QUEUED,
                    scheduled_at=datetime.now(UTC) + timedelta(hours=1), generation_metadata=metadata))
            db.add(PostingTask(id=50, project_id=1, account_id=1, platform=Platform.THREADS,
                content_text="Running", posts_chain=["Running"], status=PostingTaskStatus.RUNNING,
                generation_metadata={"applied_angle": "Legacy AI"}))
            await db.commit()
        with patch("app.api.routes.projects.schedule_project_queue_refill"):
            result = await self.client.patch("/api/v1/projects/1", json={"publication_mode": "review"})
        self.assertEqual(result.status_code, 200, result.text)
        async with self.session_factory() as db:
            self.assertEqual((await db.get(PostingTask, 40)).status, PostingTaskStatus.DRAFT)
            self.assertEqual((await db.get(PostingTask, 41)).status, PostingTaskStatus.QUEUED)
            self.assertEqual((await db.get(PostingTask, 42)).status, PostingTaskStatus.QUEUED)
            for task_id in (43, 44):
                task = await db.get(PostingTask, task_id)
                self.assertEqual(task.status, PostingTaskStatus.DRAFT)
                self.assertIsNone(task.scheduled_at)
            for task_id in (45, 46, 47, 48, 49):
                self.assertEqual((await db.get(PostingTask, task_id)).status, PostingTaskStatus.QUEUED)
            self.assertEqual((await db.get(PostingTask, 50)).status, PostingTaskStatus.RUNNING)

    async def test_workflow_expiry_and_pause_are_authoritative_and_private(self):
        async with self.session_factory() as db:
            project = await db.get(Project, 1)
            project.is_active = False
            owner = await db.get(User, 1)
            owner.subscription_expires_at = datetime.now(UTC) - timedelta(hours=1)
            await db.commit()
            workflow = await build_project_workflow(project, db)
            self.assertFalse(workflow.ready)
            self.assertEqual(workflow.next_action.code, "subscription_expired")
            self.assertIn("project_paused", [b.code for b in workflow.blockers])
            self.assertNotIn("cookies", workflow.model_dump_json())
        self.assertEqual((await self.client.get("/api/v1/projects/2/dashboard")).status_code, 404)

    async def test_expiry_during_generation_never_schedules_post(self):
        async with self.session_factory() as db:
            project, account = await self.prepare_generation(db, "auto")
            async def generate(**kw):
                owner = await db.get(User, 1)
                owner.subscription_status = False
                await db.commit()
                return PostingTask(project_id=1, account_id=1, platform=Platform.THREADS,
                    status=PostingTaskStatus.QUEUED, scheduled_at=kw["scheduled_at"], content_text="AI", posts_chain=["AI"])
            with patch("app.posting.scheduler.generate_post", new=AsyncMock(side_effect=generate)), patch(
                "app.posting.scheduler._calculate_next_account_slot", new=AsyncMock(return_value=datetime.now(UTC) + timedelta(hours=1))):
                await _ensure_account_queue_for_project(project=project, account=account, session=db, remaining_generation_budget=1)
            task = await db.scalar(select(PostingTask))
            self.assertEqual(task.status, PostingTaskStatus.DRAFT)
            self.assertIsNone(task.scheduled_at)


if __name__ == "__main__":
    unittest.main()

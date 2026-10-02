import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import func, select

from app.db.models import Platform, PostingTask, PostingTaskStatus
from tests import test_api_smoke as fixtures


class TaskEditingSafetyTest(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixtures.ApiSmokeTest.asyncSetUp
    asyncTearDown = fixtures.ApiSmokeTest.asyncTearDown

    async def add_task(self, state, *, pending=False):
        async with self.session_factory() as db:
            task = PostingTask(project_id=1, platform=Platform.THREADS,
                               content_text="Original", posts_chain=["Original"], status=state,
                               generation_metadata={"publication_confirmation_pending":pending})
            db.add(task)
            await db.commit()
            return task.id

    async def test_edit_preserves_state_and_entire_chain(self):
        for state in (PostingTaskStatus.DRAFT, PostingTaskStatus.QUEUED, PostingTaskStatus.FAILED, PostingTaskStatus.CANCELLED):
            task_id = await self.add_task(state)
            response = await self.client.put(f"/api/v1/tasks/{task_id}", json={"posts_chain":["One","Two"]})
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()["status"],state.value)
            self.assertEqual(response.json()["posts_chain"],["One","Two"])

    async def test_pending_result_cannot_be_edited_or_regenerated(self):
        task_id = await self.add_task(PostingTaskStatus.FAILED,pending=True)
        response = await self.client.put(f"/api/v1/tasks/{task_id}",json={"content_text":"Changed"})
        self.assertEqual(response.status_code,409)
        with patch("app.api.routes.tasks.generate_post",new_callable=AsyncMock) as generate:
            response = await self.client.post(f"/api/v1/tasks/{task_id}/regenerate")
            self.assertEqual(response.status_code,409)
            generate.assert_not_called()

    async def test_regeneration_preserves_draft_without_queued_intermediate(self):
        task_id = await self.add_task(PostingTaskStatus.DRAFT)
        generated = PostingTask(content_text="New",posts_chain=["New"],generation_metadata={})
        with patch("app.api.routes.tasks.generate_post",new_callable=AsyncMock,return_value=generated) as generate:
            response = await self.client.post(f"/api/v1/tasks/{task_id}/regenerate")
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()["status"],"draft")
            self.assertFalse(generate.call_args.kwargs["persist"])
        async with self.session_factory() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(PostingTask)),1)

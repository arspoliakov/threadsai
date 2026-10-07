import unittest
from tests import test_api_smoke as fixtures
from app.db.models import PostingTask, StudioDraft, User


class SaasProgressTest(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixtures.ApiSmokeTest.asyncSetUp
    asyncTearDown = fixtures.ApiSmokeTest.asyncTearDown

    async def test_trial_import_retry_returns_same_draft_without_publication(self):
        async with self.session_factory() as db:
            draft = StudioDraft(owner_id=1, topic="Моя тема", content_text="Сохранённый пробный текст")
            db.add(draft)
            await db.commit()
            draft_id = draft.id
        path = f'/api/v1/studio/trial/{draft_id}/import'
        first = await self.client.post(path, json={"project_id": 1})
        replay = await self.client.post(path, json={"project_id": 1})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(replay.json(), first.json())
        async with self.session_factory() as db:
            task = await db.get(PostingTask, first.json()['task_id'])
            self.assertEqual(task.status.value, 'draft')
            self.assertIsNone(task.scheduled_at)

    async def test_setup_merges_answers_and_preserves_atomic_creation_metadata(self):
        async with self.session_factory() as db:
            user = await db.get(User, 1)
            user.onboarding_state = {"creation_request_key": "private-replay-key", "creation_payload_hash": "hash", "project_id": 1}
            await db.commit()
        for answers in [{"topic": "Моя тема"}, {"audience": "Мои читатели"}]:
            result = await self.client.put('/api/v1/onboarding', json={"step": 1, "answers": answers})
            self.assertEqual(result.status_code, 200, result.text)
        data = (await self.client.get('/api/v1/onboarding')).json()
        self.assertEqual(data['answers'], {"topic": "Моя тема", "audience": "Мои читатели"})
        self.assertNotIn('creation_request_key', data)
        async with self.session_factory() as db:
            self.assertEqual((await db.get(User, 1)).onboarding_state['creation_request_key'], 'private-replay-key')
        result = await self.client.put('/api/v1/onboarding', json={"reset": True, "step": 0, "answers": {}, "preview": None, "project_id": None, "completed": False})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['answers'], {})

    async def test_setup_rejects_foreign_project_secrets_and_premature_completion(self):
        for body, status in [({"project_id": 2}, 404), ({"answers": {"cookies": []}}, 422), ({"project_id": 1, "completed": True}, 409)]:
            result = await self.client.put('/api/v1/onboarding', json=body)
            self.assertEqual(result.status_code, status, result.text)

    async def test_revision_persists_and_restore_is_draft_with_stale_guard(self):
        created = await self.client.post('/api/v1/tasks/manual', json={"project_id": 1, "content_text": "Первый текст"})
        task_id = created.json()['id']
        edited = await self.client.put(f'/api/v1/tasks/{task_id}', json={"posts_chain": ["Второй текст"], "expected_posts_chain": ["Первый текст"]})
        self.assertEqual(edited.status_code, 200, edited.text)
        versions = (await self.client.get(f'/api/v1/tasks/{task_id}/revisions')).json()
        self.assertEqual(len(versions), 2)
        initial = next(v for v in versions if v['posts_chain'] == ["Первый текст"])
        stale = await self.client.post(f'/api/v1/tasks/{task_id}/revisions/{initial["id"]}/restore', json={"expected_posts_chain": ["Устаревший текст"]})
        self.assertEqual(stale.status_code, 409)
        restored = await self.client.post(f'/api/v1/tasks/{task_id}/revisions/{initial["id"]}/restore', json={"expected_posts_chain": ["Второй текст"]})
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(restored.json()['posts_chain'], ["Первый текст"])
        self.assertEqual(restored.json()['status'], 'draft')
        self.assertIsNone(restored.json()['scheduled_at'])

    async def test_uncertain_revision_and_foreign_history_are_blocked(self):
        created = await self.client.post('/api/v1/tasks/manual', json={"project_id": 1, "content_text": "Исходный"})
        task_id = created.json()['id']
        await self.client.put(f'/api/v1/tasks/{task_id}', json={"posts_chain": ["Изменённый"]})
        version = (await self.client.get(f'/api/v1/tasks/{task_id}/revisions')).json()[0]
        async with self.session_factory() as db:
            task = await db.get(PostingTask, task_id)
            task.generation_metadata = {"publication_confirmation_pending": True}
            await db.commit()
        result = await self.client.post(f'/api/v1/tasks/{task_id}/revisions/{version["id"]}/restore', json={"expected_posts_chain": ["Изменённый"]})
        self.assertEqual(result.status_code, 409, result.text)
        async def second_owner(): return 2
        from app.api.main import app
        from app.api.deps import get_current_user_id
        app.dependency_overrides[get_current_user_id] = second_owner
        self.assertEqual((await self.client.get(f'/api/v1/tasks/{task_id}/revisions')).status_code, 404)

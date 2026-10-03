import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import func, select

from app.api.auth import limiter
from app.api.deps import get_current_user_id
from app.api.main import app
from app.db.models import GlobalPrompt, Project
from app.services.project_context_assistant import ContextPreview
from tests import test_style_assistant as fixtures


class ProjectContextTest(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixtures.StyleAssistantTest.asyncSetUp
    asyncTearDown = fixtures.StyleAssistantTest.asyncTearDown

    async def test_preview_is_paid_bounded_private_and_never_saves(self):
        answers = {"offer": "Помогаю планировать семейный бюджет", "audience": "Семьи с детьми", "problems": "Неожиданные расходы и отсутствие плана"}
        preview = ContextPreview(description="Пишем о планировании семейного бюджета.",
                                 target_audience="Семьи с детьми", product_context="Помощь в планировании бюджета")
        with patch("app.api.routes.project_context.generate_context_preview", new_callable=AsyncMock, return_value=preview) as generate:
            self.owner = 72
            denied = await self.client.post("/api/v1/project-context/preview", json=answers)
            self.assertEqual(denied.status_code, 402, denied.text)
            generate.assert_not_awaited()
            self.owner = 71
            invalid = await self.client.post("/api/v1/project-context/preview", json={**answers, "offer": " "})
            self.assertEqual(invalid.status_code, 422)
            limiter.reset()
            for _ in range(3):
                response = await self.client.post("/api/v1/project-context/preview", json=answers)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), preview.model_dump())
                self.assertEqual(response.headers["cache-control"], "no-store")
            limited = await self.client.post("/api/v1/project-context/preview", json=answers)
            self.assertEqual(limited.status_code, 429, limited.text)
            self.assertEqual(generate.await_count, 3)
        async with self.sessions() as session:
            self.assertEqual(await session.scalar(select(func.count()).select_from(Project)), 0)
            self.assertEqual(set((await session.scalars(select(GlobalPrompt.body))).all()), {"original", "foreign", "format rules"})
        limiter.reset()
        with patch("app.api.routes.project_context.generate_context_preview", new_callable=AsyncMock, side_effect=RuntimeError("provider secret")):
            failed = await self.client.post("/api/v1/project-context/preview", json=answers)
            self.assertEqual(failed.status_code, 502)
            self.assertNotIn("provider secret", failed.text)
        with patch("app.api.routes.project_context.generate_context_preview", new_callable=AsyncMock, return_value=preview):
            recovered = await self.client.post("/api/v1/project-context/preview", json=answers)
            self.assertEqual(recovered.status_code, 200, recovered.text)
        app.dependency_overrides.pop(get_current_user_id)
        anonymous = await self.client.post("/api/v1/project-context/preview", json=answers)
        self.assertEqual(anonymous.status_code, 401)

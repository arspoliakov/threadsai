from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.main import app
from app.api.auth import limiter
from app.api.deps import get_current_user_id, get_db
from app.db.base import Base
from app.db.models import GlobalPrompt, PromptType, User, Project
from app.services.style_assistant import stage_global_style


class StyleAssistantTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with self.sessions() as session:
            session.add_all([User(id=71, first_name="Owner", subscription_status=True,
                                 tariff_projects_limit=3, tariff_posts_per_day=3),
                             User(id=72, first_name="Other", subscription_status=False)])
            session.add_all([GlobalPrompt(owner_id=71, prompt_type=PromptType.VIRALITY, title="old", body="original", version="1"),
                             GlobalPrompt(owner_id=72, prompt_type=PromptType.VIRALITY, title="other", body="foreign", version="1"),
                             GlobalPrompt(owner_id=71, prompt_type=PromptType.FORMATTING, title="format", body="format rules", version="1")])
            await session.commit()
        async def database():
            async with self.sessions() as session:
                yield session
        self.owner = 71
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user_id] = lambda: self.owner
        limiter.reset()
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        app.dependency_overrides.clear()
        limiter.reset()
        await self.client.aclose()
        await self.engine.dispose()

    async def test_preview_access_errors_and_per_user_limits(self):
        self.owner = 72
        with patch("app.api.routes.prompts.generate_style_preview", new_callable=AsyncMock) as generate:
            response = await self.client.post("/api/v1/prompts/global/assist", json={})
            self.assertEqual(response.status_code, 402)
            generate.assert_not_awaited()
        self.owner = 71
        with patch("app.api.routes.prompts.generate_style_preview", new_callable=AsyncMock, return_value="Generated style") as generate:
            for _ in range(3):
                response = await self.client.post("/api/v1/prompts/global/assist", json={"tone": "expert"})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.headers["cache-control"], "no-store")
            response = await self.client.post("/api/v1/prompts/global/assist", json={})
            self.assertEqual(response.status_code, 429, response.text)
            self.assertEqual(generate.await_count, 3)
        async with self.sessions() as session:
            self.assertEqual(len(list((await session.scalars(select(GlobalPrompt))).all())), 3)
            other = await session.get(User, 72)
            other.subscription_status = True
            await session.commit()
        self.owner = 72
        with patch("app.api.routes.prompts.generate_style_preview", new_callable=AsyncMock, side_effect=RuntimeError("secret provider data")):
            response = await self.client.post("/api/v1/prompts/global/assist", json={})
            self.assertEqual(response.status_code, 502, response.text)
            self.assertNotIn("secret", response.text)
        app.dependency_overrides.pop(get_current_user_id)
        response = await self.client.post("/api/v1/prompts/global/assist", json={})
        self.assertEqual(response.status_code, 401)

    async def test_project_and_style_saved_together_for_the_owner(self):
        invalid = await self.client.post("/api/v1/projects/", json={"name": "Invalid", "global_style_body": "          "})
        self.assertEqual(invalid.status_code, 422)
        response = await self.client.post("/api/v1/projects/", json={"name": "New", "slug": "new", "global_style_body": "New accepted author style"})
        self.assertEqual(response.status_code, 201, response.text)
        async with self.sessions() as session:
            project = await session.get(Project, response.json()["id"])
            self.assertEqual(project.owner_id, 71)
            self.assertEqual(project.style_body, "New accepted author style")
            prompts = list((await session.scalars(select(GlobalPrompt).where(GlobalPrompt.is_active.is_(True)))).all())
            self.assertEqual({(p.owner_id, p.body) for p in prompts}, {(71, "original"), (72, "foreign"), (71, "format rules")})
        response = await self.client.post("/api/v1/projects/", json={"name": "No style", "slug": "no-style"})
        self.assertEqual(response.status_code, 201)
        async with self.sessions() as session:
            body = await session.scalar(select(GlobalPrompt.body).where(GlobalPrompt.owner_id == 71, GlobalPrompt.prompt_type == PromptType.VIRALITY, GlobalPrompt.is_active.is_(True)))
            self.assertEqual(body, "original")
            project = await session.get(Project, response.json()["id"])
            self.assertIn("original", project.style_body)

    async def test_abandoned_transaction_preserves_style(self):
        response = await self.client.put("/api/v1/prompts/global/style", json={"body": "Explicitly saved style"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["owner_id"], 71)
        async with self.sessions() as session:
            await stage_global_style(session, 71, "Uncommitted replacement")
            await session.rollback()
        async with self.sessions() as session:
            body = await session.scalar(select(GlobalPrompt.body).where(GlobalPrompt.owner_id == 71, GlobalPrompt.prompt_type == PromptType.VIRALITY, GlobalPrompt.is_active.is_(True)))
            self.assertEqual(body, "Explicitly saved style")

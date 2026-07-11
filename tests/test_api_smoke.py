from __future__ import annotations

import unittest
from collections.abc import AsyncGenerator

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user_id, get_db
from app.api.main import app
from app.db.base import Base
from app.db.models import Account, AccountStatus, Platform, Project, User


class ApiSmokeTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            poolclass=StaticPool,
        )
        self.session_factory = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async with self.session_factory() as session:
            session.add_all(
                [
                    User(
                        id=1,
                        telegram_id=1001,
                        first_name="Owner One",
                        subscription_status=True,
                        tariff_plan="pro",
                        tariff_accounts_limit=7,
                        tariff_posts_per_day=5,
                        tariff_projects_limit=5,
                        tariff_queue_days=3,
                    ),
                    User(
                        id=2,
                        telegram_id=1002,
                        first_name="Owner Two",
                        subscription_status=True,
                        tariff_plan="basic",
                        tariff_accounts_limit=1,
                        tariff_posts_per_day=3,
                        tariff_projects_limit=1,
                        tariff_queue_days=2,
                    ),
                    Project(id=1, owner_id=1, name="Owner project", slug="owner-project"),
                    Project(id=2, owner_id=2, name="Foreign project", slug="foreign-project"),
                    Account(
                        id=1,
                        owner_id=1,
                        project_id=1,
                        platform=Platform.THREADS,
                        username="owner_account",
                        status=AccountStatus.ACTIVE,
                    ),
                    Account(
                        id=2,
                        owner_id=2,
                        project_id=2,
                        platform=Platform.THREADS,
                        username="foreign_account",
                        status=AccountStatus.ACTIVE,
                    ),
                ]
            )
            await session.commit()

        async def override_db() -> AsyncGenerator[AsyncSession, None]:
            async with self.session_factory() as session:
                yield session

        async def override_user_id() -> int:
            return 1

        self.override_user_id = override_user_id
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user_id] = override_user_id
        self.client = AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        app.dependency_overrides.clear()
        await self.engine.dispose()

    async def test_health_is_public(self) -> None:
        response = await self.client.get("/api/v1/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    async def test_projects_are_tenant_scoped(self) -> None:
        response = await self.client.get("/api/v1/projects/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([project["id"] for project in response.json()], [1])

        foreign_response = await self.client.get("/api/v1/projects/2")
        self.assertEqual(foreign_response.status_code, 404)

    async def test_accounts_are_tenant_scoped(self) -> None:
        response = await self.client.get("/api/v1/accounts/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([account["id"] for account in response.json()], [1])

    async def test_dashboard_reports_only_owned_project_health(self) -> None:
        response = await self.client.get("/api/v1/dashboard/summary")
        self.assertEqual(response.status_code, 200, response.text)
        projects = response.json()["projects"]
        self.assertEqual([project["id"] for project in projects], [1])
        self.assertEqual(projects[0]["active_accounts_count"], 1)
        self.assertEqual(projects[0]["paused_accounts_count"], 0)

    async def test_active_subscriber_can_create_project(self) -> None:
        response = await self.client.post(
            "/api/v1/projects/",
            json={
                "name": "Новый проект",
                "description": "Тестовый контекст",
                "posts_per_day": 3,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        payload = response.json()
        self.assertEqual(payload["owner_id"], 1)
        self.assertEqual(payload["name"], "Новый проект")
        self.assertRegex(payload["slug"], r"^project-[0-9]+$")

    async def test_protected_route_rejects_missing_token(self) -> None:
        app.dependency_overrides.pop(get_current_user_id, None)
        try:
            response = await self.client.get("/api/v1/projects/")
        finally:
            app.dependency_overrides[get_current_user_id] = self.override_user_id

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()

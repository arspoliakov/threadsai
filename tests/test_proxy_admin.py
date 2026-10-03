from __future__ import annotations

import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from cryptography.fernet import Fernet
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.auth import create_access_token
from app.api.deps import get_db
from app.api.routes.proxy_admin import router
from app.core.config import settings
from app.core.secrets import _get_fernet
from app.db.base import Base
from app.db.models import Account, Platform, PostingTask, PostingTaskStatus, Project, ProxyProviderConfig, ProxyUsageEvent, User


class ProxyAdminTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.original = (settings.web_admin_token, settings.jwt_secret_key, settings.data_encryption_key, settings.chrome_profiles_dir, settings.admin_tg_id)
        self.temp = tempfile.TemporaryDirectory()
        settings.web_admin_token = "synthetic-operator"
        settings.jwt_secret_key = "synthetic-test-signing-key-at-least-thirty-two"
        settings.admin_tg_id = 777
        async with self.sessions() as db:
            db.add(User(id=1, telegram_id=777, first_name="Operator"))
            await db.commit()
        self.operator_sessions = patch("app.api.deps.AsyncSessionLocal", self.sessions)
        self.operator_sessions.start()
        settings.data_encryption_key = Fernet.generate_key().decode()
        settings.chrome_profiles_dir = self.temp.name
        _get_fernet.cache_clear()
        app = FastAPI()
        app.include_router(router)
        async def override_db():
            async with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = override_db
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture")
        self.headers = {"Authorization": "Bearer " + create_access_token({"sub": "1", "telegram_id": 777})}

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.engine.dispose()
        self.operator_sessions.stop()
        settings.web_admin_token, settings.jwt_secret_key, settings.data_encryption_key, settings.chrome_profiles_dir, settings.admin_tg_id = self.original
        _get_fernet.cache_clear()
        self.temp.cleanup()

    async def configure(self):
        response = await self.client.put("/admin/proxies/config", headers=self.headers,
            json={"access_login": "synthetic_access", "password": "synthetic-password"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("synthetic", response.text)

    async def test_operator_gate_and_write_only_config(self):
        self.assertEqual((await self.client.get("/admin/proxies")).status_code, 401)
        tenant = create_access_token({"sub": "999", "telegram_id": 123123123})
        for endpoint in ("/admin/proxies", "/admin/proxies/probe"):
            method = self.client.post if endpoint.endswith("probe") else self.client.get
            response = await method(endpoint, headers={"Authorization": f"Bearer {tenant}"})
            self.assertEqual(response.status_code, 403)
        await self.configure()
        summary = await self.client.get("/admin/proxies", headers=self.headers)
        self.assertNotIn("synthetic", summary.text)
        self.assertIsNone(summary.json()["provider_balance_gb"])
        async with self.sessions() as db:
            self.assertNotIn("synthetic-password", (await db.get(ProxyProviderConfig, "proxly")).credentials_encrypted)

    async def test_busy_account_rejected_then_opt_in_pauses_without_old_status_carryover(self):
        await self.configure()
        async with self.sessions() as db:
            project = Project(name="Fixture project", slug="fixture-project")
            db.add(project)
            await db.flush()
            account = Account(project_id=project.id, username="fixture", platform=Platform.THREADS, assigned_port=10001)
            db.add(account)
            await db.flush()
            task = PostingTask(project_id=project.id, account_id=account.id, platform=Platform.THREADS,
                               content_text="Fixture", status=PostingTaskStatus.RUNNING)
            db.add(task)
            db.add(ProxyUsageEvent(account_id=account.id, service="threadsgo", provider="proxymarket",
                                  operation="connection_check", source="http_response_body", status="connected"))
            await db.commit()
            account_id, task_id = account.id, task.id
        response = await self.client.put(f"/admin/proxies/accounts/{account_id}", headers=self.headers, json={"provider": "proxly"})
        self.assertEqual(response.status_code, 409)
        async with self.sessions() as db:
            self.assertEqual((await db.get(Account, account_id)).proxy_provider, "proxymarket")
            (await db.get(PostingTask, task_id)).status = PostingTaskStatus.CANCELLED
            await db.commit()
        response = await self.client.put(f"/admin/proxies/accounts/{account_id}", headers=self.headers, json={"provider": "proxly"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["paused"])
        summary = (await self.client.get("/admin/proxies", headers=self.headers)).json()
        self.assertEqual(summary["accounts"][0]["check_status"], "not_checked")
        self.assertFalse(summary["accounts"][0]["usage_measured"])

    async def test_probe_reserves_ids_without_accounts_and_returns_no_credentials(self):
        await self.configure()
        result = {"sessions": {k: {"samples": [{"application_response_bytes": 12}], "complete": True}
                               for k in ("A", "B")}, "same_exit_ip_observed": False}
        with patch("scripts.proxy_trial_probe.probe", new=AsyncMock(return_value=result)) as probe:
            response = await self.client.post("/admin/proxies/probe", headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["session_ids"], [11, 12])
            self.assertNotIn("synthetic", response.text)
            self.assertFalse(response.json()["threads_compatibility_verified"])
            self.assertEqual(len(probe.await_args.args[1]), 2)
        async with self.sessions() as db:
            self.assertEqual((await db.get(ProxyProviderConfig, "proxly")).next_session_id, 13)


if __name__ == "__main__":
    unittest.main()

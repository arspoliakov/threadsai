from __future__ import annotations

import unittest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.secrets import _get_fernet, is_encrypted_secret
from app.db.base import Base
from app.db.models import Account, Platform, ProxyProviderConfig
from app.services.proxly_config import assign_proxly_account, read_proxly_config, restore_legacy_proxy, save_proxly_config
from app.services.proxy_pool import build_threads_proxy_url_for_account


class ProxlyAssignmentsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.original_key = settings.data_encryption_key
        settings.data_encryption_key = Fernet.generate_key().decode()
        _get_fernet.cache_clear()

    async def asyncTearDown(self):
        settings.data_encryption_key = self.original_key
        _get_fernet.cache_clear()
        await self.engine.dispose()

    async def configure(self, db):
        await save_proxly_config(db, access_login="synthetic_access", password="synthetic-secret:/@")

    async def test_opt_in_encrypted_stable_binding_and_reserved_ids(self):
        async with self.sessions() as db:
            one = Account(platform=Platform.THREADS, username="one", assigned_port=10001)
            two = Account(platform=Platform.THREADS, username="two", assigned_port=10002)
            db.add_all([one, two])
            await db.flush()
            await self.configure(db)
            self.assertEqual(one.proxy_provider, "proxymarket")
            self.assertIsNone(one.proxy_session_id)
            await assign_proxly_account(db, one)
            await assign_proxly_account(db, two)
            self.assertEqual((one.proxy_session_id, two.proxy_session_id), (11, 12))
            self.assertTrue(is_encrypted_secret(one.proxy_credentials_encrypted))
            self.assertNotIn("synthetic-secret", one.proxy_credentials_encrypted)
            url = build_threads_proxy_url_for_account(one)
            self.assertIn("country-nl-session-11-time-30", url)
            self.assertIn("synthetic-secret%3A%2F%40", url)
            await restore_legacy_proxy(db, one)
            self.assertEqual(one.assigned_port, 10001)
            await assign_proxly_account(db, one)
            self.assertEqual(one.proxy_session_id, 11)
            safe = await read_proxly_config(db)
            self.assertNotIn("synthetic", str(safe))
            await db.commit()

    async def test_deleted_binding_is_not_reused_and_config_changes_are_explicit(self):
        async with self.sessions() as db:
            await self.configure(db)
            one = Account(platform=Platform.THREADS, username="one")
            db.add(one)
            await db.flush()
            await assign_proxly_account(db, one)
            await db.delete(one)
            await db.flush()
            two = Account(platform=Platform.THREADS, username="two")
            db.add(two)
            await db.flush()
            await assign_proxly_account(db, two)
            original = build_threads_proxy_url_for_account(two)
            await save_proxly_config(db, access_login="new_access", password="new-secret")
            self.assertEqual(build_threads_proxy_url_for_account(two), original)
            await assign_proxly_account(db, two)
            self.assertEqual(two.proxy_session_id, 12)
            self.assertIn("new_access-country", build_threads_proxy_url_for_account(two))

    async def test_misconfigured_proxly_fails_closed_and_arbitrary_hosts_rejected(self):
        account = Account(platform=Platform.THREADS, username="one", assigned_port=10001,
                          proxy_provider="proxly", proxy_session_id=11)
        with self.assertRaises(HTTPException):
            build_threads_proxy_url_for_account(account)
        async with self.sessions() as db:
            with self.assertRaises(HTTPException):
                await save_proxly_config(db, access_login="access", password="secret", host="127.0.0.1")
            self.assertIsNone(await db.get(ProxyProviderConfig, "proxly"))


if __name__ == "__main__":
    unittest.main()

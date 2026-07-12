from __future__ import annotations

import unittest

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.db.models import Account, Platform
from app.services.proxy_pool import assign_threads_proxy_port


class ProxyPoolTest(unittest.IsolatedAsyncioTestCase):
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

        self.original_proxy_config = (
            settings.proxy_host,
            settings.proxy_login,
            settings.proxy_password,
            settings.proxy_port_start,
            settings.proxy_port_end,
        )
        settings.proxy_host = "proxy.test"
        settings.proxy_login = "login"
        settings.proxy_password = "password"
        settings.proxy_port_start = 10000
        settings.proxy_port_end = 10003

    async def asyncTearDown(self) -> None:
        (
            settings.proxy_host,
            settings.proxy_login,
            settings.proxy_password,
            settings.proxy_port_start,
            settings.proxy_port_end,
        ) = self.original_proxy_config
        await self.engine.dispose()

    async def test_deleted_port_gap_is_reused(self) -> None:
        async with self.session_factory() as session:
            session.add_all(
                [
                    Account(platform=Platform.THREADS, username="one", assigned_port=10000),
                    Account(platform=Platform.THREADS, username="three", assigned_port=10002),
                ]
            )
            await session.commit()

            assigned_port = await assign_threads_proxy_port(session)

        self.assertEqual(assigned_port, 10001)


if __name__ == "__main__":
    unittest.main()

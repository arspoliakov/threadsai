from pathlib import Path
import asyncio
from types import SimpleNamespace
from tempfile import TemporaryDirectory
import json
import queue
import threading
import time
import unittest
from unittest.mock import Mock, patch, AsyncMock

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from app.db.base import Base
from app.db.models import Account, User
from app.services.threads_login_window import LoginWindow
from app.api.routes import threads_login


class ProfileHandoffTest(unittest.TestCase):
    def test_full_profile_moves_only_after_chrome_quit(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, destination = root / "ephemeral_1_2", root / "account_17"
            (source / "Default").mkdir(parents=True)
            (source / "Default" / "local_storage_fixture").write_text("state", encoding="utf-8")
            window = LoginWindow()
            room = dict(owner=1, token="token", username="owner", port=20001,
                ready=threading.Event(), stop=threading.Event(), commands=queue.Queue(4),
                expires=time.monotonic()+30)
            window.room = room
            driver = Mock()
            driver._threadsai_user_data_dir = source
            driver.current_url = "https://www.threads.com/"
            driver.window_handles = ["one"]
            driver.execute_script.return_value = "owner"
            driver.execute_cdp_cmd.return_value = {"cookies": [{"domain":".threads.com", "name":"sessionid", "value":"fixture"}]}
            driver.quit.side_effect = lambda: self.assertFalse(destination.exists())
            adapter = Mock()
            adapter._create_driver.return_value = driver
            adapter._get_user_data_dir.return_value = destination
            lock = Mock()
            lock.acquire.return_value = True
            with patch("app.services.threads_login_window.ThreadsAdapter", return_value=adapter), patch("app.services.threads_login_window.build_threads_proxy_url", return_value="proxy"), patch("app.services.threads_login_window._get_profile_lock", return_value=lock), patch("app.services.threads_login_window.ensure_profile_capacity"), patch("app.services.threads_login_window.cleanup_closed_profile"):
                worker = threading.Thread(target=window._worker, args=(room,))
                worker.start()
                self.assertTrue(room["ready"].wait(2))
                window.command(1, "token", "finish")
                self.assertEqual(window.command(1, "token", "adopt", {"account_id":17}), {"ok":True})
                worker.join(2)
                self.assertFalse(worker.is_alive())
            driver.quit.assert_called_once()
            self.assertFalse(source.exists())
            self.assertEqual((destination/"Default"/"local_storage_fixture").read_text(), "state")
            self.assertEqual(json.loads((destination/"browser_settings.json").read_text())["viewport_width"], 1024)
            self.assertIn("snapshot_hash", json.loads((destination/"threadsai-session.json").read_text()))

    def test_existing_destination_is_never_overwritten(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, destination = root/"ephemeral_1_2", root/"account_17"
            source.mkdir()
            destination.mkdir()
            protected = destination/"existing"
            protected.write_text("preserve", encoding="utf-8")
            room = {"verified_cookies": [{"name":"fixture"}], "stop": threading.Event()}
            adapter = Mock()
            adapter._get_user_data_dir.return_value = destination
            lock = Mock()
            lock.acquire.return_value = True
            with patch("app.services.threads_login_window._get_profile_lock", return_value=lock), patch("app.services.threads_login_window.ensure_profile_capacity"), patch("app.services.threads_login_window.cleanup_closed_profile"):
                with self.assertRaises(ValueError):
                    LoginWindow()._adopt_closed_profile(room, adapter, source, 17, threading.Event(), time.monotonic()+30)
            self.assertEqual(protected.read_text(), "preserve")
            self.assertTrue(source.exists())
            lock.release.assert_called_once()


class HandoffDatabaseTest(unittest.IsolatedAsyncioTestCase):
    async def test_failed_handoff_rolls_back_new_account(self):
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        login = Mock()
        login.access.return_value = {"port":20001, "username":"owner"}
        def command(owner, token, kind, *args):
            if kind == "finish":
                return [{"domain":".threads.com", "name":"sessionid", "value":"fixture"}]
            raise HTTPException(409, "handoff failed")
        login.command.side_effect = command
        try:
            async with sessions() as db:
                user = User(id=1, telegram_id=999, first_name="Fixture", tariff_accounts_limit=1, subscription_status=True)
                db.add(user)
                await db.commit()
                with patch.object(threads_login, "login_window", login), patch.object(threads_login, "encrypt_secret", return_value="encrypted-fixture"):
                    with self.assertRaises(HTTPException):
                        await threads_login.finish(token="token", db=db, user=user)
                self.assertEqual(await db.scalar(select(func.count(Account.id))), 0)
                login.discard_adopted_profile.assert_called_once_with(1, "token", 1)
        finally:
            await engine.dispose()


class PopupCapacityTest(unittest.IsolatedAsyncioTestCase):
    async def test_capacity_is_held_until_worker_closes_and_released_once(self):
        slot = asyncio.Semaphore(1)
        login = Mock()
        callbacks = []
        def start(owner, username, port, release, claimed):
            claimed.set()
            callbacks.append(release)
            return {"token":"fixture"}
        login.start.side_effect = start
        with patch.object(threads_login, "browser_semaphore", slot), patch.object(threads_login, "login_window", login), patch.object(threads_login, "check_capacity", new=AsyncMock()), patch.object(threads_login, "assign_threads_proxy_port", new=AsyncMock(return_value=20001)):
            await threads_login.start(threads_login.Start(username="owner"), db=Mock(), user=SimpleNamespace(id=1))
            self.assertTrue(slot.locked())
            callbacks[0]()
            callbacks[0]()
            await asyncio.sleep(0)
            self.assertEqual(slot._value, 1)
            login.start.side_effect = HTTPException(409, "busy")
            with self.assertRaises(HTTPException):
                await threads_login.start(threads_login.Start(username="owner"), db=Mock(), user=SimpleNamespace(id=1))
            await asyncio.sleep(0)
            self.assertEqual(slot._value, 1)

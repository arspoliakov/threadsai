from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from tempfile import TemporaryDirectory
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from selenium.common.exceptions import WebDriverException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.routes.accounts import _require_session_check_for_resume
from app.core.config import settings
from app.db.base import Base
from app.db.models import Account, AccountStatus, Platform, PostingTask, PostingTaskStatus, Project, User
from app.posting.adapters.threads import ThreadsAdapter
from app.posting.profile_lock import ProfileLock
from app.posting import proxy_manager
from app.posting.safety import as_utc, next_safe_publish_at
from app.posting.service import _mark_retryable, _should_quarantine_account


class PostingSafetyTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.now = datetime.now(UTC)
        async with self.sessions() as session:
            session.add_all([
                User(id=1, first_name="Owner", subscription_status=True, tariff_posts_per_day=3),
                Project(id=1, owner_id=1, name="Test", slug="test", posts_per_day=3,
                        timezone="UTC", active_hours_start="00:00", active_hours_end="23:59"),
                Account(id=1, owner_id=1, project_id=1, platform=Platform.THREADS,
                        username="owner", status=AccountStatus.ACTIVE, assigned_port=10000),
            ])
            await session.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    def task(self, task_id, *, status=PostingTaskStatus.QUEUED, hours_ago=None, chain=None, manual=False):
        return PostingTask(id=task_id, project_id=1, account_id=1, platform=Platform.THREADS,
                           content_text="Example", posts_chain=chain or ["Example"], status=status,
                           scheduled_at=self.now - timedelta(minutes=2),
                           finished_at=self.now - timedelta(hours=hours_ago) if hours_ago is not None else None,
                           generation_metadata={"publish_now_requested": manual})

    async def test_manual_request_cannot_bypass_rolling_limit(self):
        async with self.sessions() as session:
            for i in range(3):
                session.add(self.task(i + 1, status=PostingTaskStatus.SUCCESS, hours_ago=4 + i))
            session.add(self.task(4, manual=True))
            await session.commit()
        with patch.object(proxy_manager, "AsyncSessionLocal", self.sessions):
            self.assertIsNone(await proxy_manager.claim_oldest_due_task_for_account(1))
        async with self.sessions() as session:
            task = await session.get(PostingTask, 4)
            self.assertEqual(task.status, PostingTaskStatus.QUEUED)
            self.assertGreater(as_utc(task.scheduled_at), self.now)

    async def test_cooldown_blocks_all_due_tasks(self):
        async with self.sessions() as session:
            account = await session.get(Account, 1)
            account.cooldown_until = self.now + timedelta(hours=2)
            session.add_all([self.task(1), self.task(2, manual=True)])
            await session.commit()
        with patch.object(proxy_manager, "AsyncSessionLocal", self.sessions):
            self.assertIsNone(await proxy_manager.claim_oldest_due_task_for_account(1))

    async def test_overdue_queue_does_not_publish_in_a_burst(self):
        async with self.sessions() as session:
            session.add_all([self.task(1), self.task(2, manual=True)])
            await session.commit()
        with patch.object(proxy_manager, "AsyncSessionLocal", self.sessions):
            self.assertEqual(await proxy_manager.claim_oldest_due_task_for_account(1), 1)
            self.assertIsNone(await proxy_manager.claim_oldest_due_task_for_account(1))

    async def test_recent_success_enforces_interval_even_without_stored_cooldown(self):
        async with self.sessions() as session:
            session.add(self.task(1, status=PostingTaskStatus.SUCCESS, hours_ago=0.1))
            await session.commit()
            account = await session.get(Account, 1)
            safe_at = await next_safe_publish_at(account, 3, session, self.now)
            self.assertEqual(safe_at, self.now - timedelta(hours=0.1) + timedelta(minutes=settings.posting_min_interval_minutes))

    async def test_chain_and_uncertain_publications_consume_budget(self):
        async with self.sessions() as session:
            session.add(self.task(1, status=PostingTaskStatus.PARTIAL_SUCCESS, hours_ago=2, chain=["a", "b", "c"]))
            await session.commit()
            account = await session.get(Account, 1)
            self.assertEqual(await next_safe_publish_at(account, 3, session, self.now), self.now + timedelta(hours=22))

    async def test_chain_cannot_overflow_remaining_budget(self):
        async with self.sessions() as session:
            session.add(self.task(1, status=PostingTaskStatus.SUCCESS, hours_ago=2, chain=["a", "b"]))
            await session.commit()
            account = await session.get(Account, 1)
            self.assertEqual(await next_safe_publish_at(account, 3, session, self.now, incoming_actions=2), self.now + timedelta(hours=22))

    async def test_retry_backoff_persists_account_wide(self):
        async with self.sessions() as session:
            task = self.task(1)
            task.retry_count = 1
            session.add(task)
            await session.commit()
            account = await session.get(Account, 1)
            await _mark_retryable(session, task, account, "Proxy transport failure")
            self.assertGreaterEqual(as_utc(account.cooldown_until), self.now + timedelta(minutes=60))
            self.assertEqual(task.retry_count, 2)
            self.assertEqual(task.status, PostingTaskStatus.QUEUED)

    async def test_expired_window_allows_next_task(self):
        async with self.sessions() as session:
            session.add(self.task(1, status=PostingTaskStatus.SUCCESS, hours_ago=25))
            account = await session.get(Account, 1)
            account.cooldown_until = self.now - timedelta(minutes=1)
            await session.commit()
            self.assertEqual(await next_safe_publish_at(account, 3, session, self.now), self.now)

    async def test_rebinding_account_does_not_publish_old_project_queue(self):
        async with self.sessions() as session:
            session.add(Project(id=2, owner_id=1, name="Other", slug="other"))
            session.add(self.task(1, manual=True))
            account = await session.get(Account, 1)
            account.project_id = 2
            await session.commit()
        with patch.object(proxy_manager, "AsyncSessionLocal", self.sessions):
            self.assertIsNone(await proxy_manager.claim_oldest_due_task_for_account(1))


class PostingFailureSafetyTest(unittest.TestCase):
    def test_os_lock_serializes_independent_profile_users(self):
        with TemporaryDirectory() as directory:
            first = ProfileLock(Path(directory) / "account.lock")
            second = ProfileLock(Path(directory) / "account.lock")
            self.assertTrue(first.acquire(timeout=0.1))
            self.assertFalse(second.acquire(timeout=0.1))
            first.release()
            self.assertTrue(second.acquire(timeout=0.1))
            second.release()

    def test_restriction_has_priority_over_proxy_markers(self):
        self.assertTrue(_should_quarantine_account("Proxy transport: checkpoint requires manual confirmation"))
        self.assertTrue(_should_quarantine_account("Try again later", 0))

    def test_proxy_retries_are_bounded(self):
        self.assertFalse(_should_quarantine_account("Proxy network failure", 0))
        self.assertTrue(_should_quarantine_account("Proxy network failure", settings.posting_max_retries - 1))

    def test_paused_account_cannot_be_reactivated_without_check(self):
        account = Account(status=AccountStatus.BLOCKED)
        with self.assertRaises(HTTPException):
            _require_session_check_for_resume(account, AccountStatus.ACTIVE)
        _require_session_check_for_resume(account, AccountStatus.DISABLED)

    def test_failed_submit_never_falls_back_to_second_submission(self):
        adapter = ThreadsAdapter()
        driver = SimpleNamespace(_threadsai_expected_editor_text="Example")
        with patch("app.posting.adapters.threads.time.sleep"), \
             patch.object(adapter, "_wait_until_editor_contains_text"), \
             patch.object(adapter, "_assert_no_blocking_challenge"), \
             patch.object(adapter, "_click_submit_button", side_effect=WebDriverException("lost response")) as click, \
             patch.object(adapter, "_submit_thread_with_hotkey") as hotkey:
            with self.assertRaises(WebDriverException):
                adapter._submit_thread(driver)
            click.assert_called_once()
            hotkey.assert_not_called()

    def test_uncertain_click_is_marked_before_dispatch(self):
        adapter = ThreadsAdapter()
        driver = SimpleNamespace(_threadsai_expected_editor_text="Example")
        button = Mock()
        button.click.side_effect = WebDriverException("disconnected")
        with patch("app.posting.adapters.threads.WebDriverWait") as wait, \
             patch.object(adapter, "_wait_until_editor_contains_text"), \
             patch.object(adapter, "_scroll_to_element"):
            wait.return_value.until.return_value = button
            with self.assertRaises(WebDriverException):
                adapter._click_submit_button(driver)
        self.assertTrue(driver._threadsai_submission_attempted)
        button.click.assert_called_once()

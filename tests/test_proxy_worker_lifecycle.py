import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock, AsyncMock

from app.services.subscriptions import has_current_subscription_access
from app.posting.adapters.threads import ThreadsAdapter
from app.posting.exceptions import ProxyNetworkException
from app.posting.proxy_telemetry import collect_browser_estimate, _events


class ProxyLifecycleTests(unittest.TestCase):
    def test_known_expiry_and_gift_legacy_boundaries(self):
        now = datetime.now(UTC)
        user = SimpleNamespace(subscription_status=True, subscription_phase="regular",
            subscription_expires_at=None, complimentary_access_expires_at=None,
            complimentary_access_plan=None)
        self.assertTrue(has_current_subscription_access(user, now=now))
        user.subscription_expires_at = now - timedelta(seconds=1)
        self.assertFalse(has_current_subscription_access(user, now=now))
        user.complimentary_access_expires_at = now + timedelta(days=3)
        user.complimentary_access_plan = "basic"
        with patch("app.services.subscriptions.get_tariff_by_name", return_value=object()):
            self.assertTrue(has_current_subscription_access(user, now=now))
        user.subscription_phase = "gift"
        user.complimentary_access_expires_at = now - timedelta(seconds=1)
        user.subscription_expires_at = None
        self.assertFalse(has_current_subscription_access(user, now=now))

    def test_missing_proxy_stops_before_browser_start(self):
        adapter = ThreadsAdapter()
        with patch("app.posting.adapters.threads.build_threads_proxy_url_for_account", return_value=None), patch.object(adapter, "_create_driver") as browser:
            with self.assertRaises(ProxyNetworkException):
                adapter._check_session_sync(SimpleNamespace(id=123))
            browser.assert_not_called()

    def test_estimate_counts_only_encoded_completed_response_bytes(self):
        driver = Mock()
        driver.get_log.return_value = [
            {"message": '{"message":{"method":"Network.loadingFinished","params":{"encodedDataLength":123}}}'},
            {"message": '{"message":{"method":"Network.requestWillBeSent","params":{"url":"private"}}}'},
        ]
        collect_browser_estimate(driver, 123)
        self.assertEqual(_events.get_nowait(), (123, 123, "partial"))


class ProxyWorkerOrderingTests(unittest.IsolatedAsyncioTestCase):
    async def test_ip_check_waits_for_capacity_and_reads_fresh_proxy(self):
        from app.posting import proxy_manager as worker
        from app.db.models import AccountStatus
        stop = asyncio.Event()
        slot = asyncio.Semaphore(1)
        account = SimpleNamespace(id=123, owner_id=1, status=AccountStatus.ACTIVE)
        user = SimpleNamespace(subscription_status=True, subscription_phase="regular",
            subscription_expires_at=None, complimentary_access_expires_at=None)
        db = AsyncMock()
        db.get.side_effect = [account, user]
        session_context = AsyncMock()
        session_context.__aenter__.return_value = db
        async def ip_check(url):
            self.assertTrue(slot.locked())
            self.assertEqual(url, "http://fresh.example:8080")
            return "192.0.2.1"
        async def execute(task, proxy, ip):
            self.assertEqual(proxy, "http://fresh.example:8080")
            stop.set()
        claim = worker.BrowserTaskClaim(kind="posting", task_id=456, account_id=123)
        with patch.object(worker, "browser_semaphore", slot), patch.object(worker, "AsyncSessionLocal", return_value=session_context), patch.object(worker, "claim_next_browser_task_for_account", new=AsyncMock(return_value=claim)), patch.object(worker, "_account_proxy_url", return_value="http://fresh.example:8080"), patch.object(worker, "get_current_ip", new=ip_check), patch.object(worker, "_run_claimed_task", new=execute), patch.object(worker, "reset_proxy_failure_count", new=AsyncMock()), patch("app.posting.proxy_telemetry.flush_browser_estimates", new=AsyncMock()):
            await worker.run_account_worker(123, "http://old.example:8080", stop)

    async def test_failed_ip_check_releases_capacity_before_backoff(self):
        from app.posting import proxy_manager as worker
        from app.db.models import AccountStatus
        stop = asyncio.Event()
        slot = asyncio.Semaphore(1)
        account = SimpleNamespace(id=123, owner_id=1, status=AccountStatus.ACTIVE)
        user = SimpleNamespace(subscription_status=True, subscription_phase="regular",
            subscription_expires_at=None, complimentary_access_expires_at=None)
        db = AsyncMock()
        db.get.side_effect = [account, user]
        session_context = AsyncMock()
        session_context.__aenter__.return_value = db
        async def backoff(event, delay):
            self.assertFalse(slot.locked())
            self.assertEqual(delay, worker.PROXY_FAILURE_RETRY_DELAY_SECONDS)
            stop.set()
        claim = worker.BrowserTaskClaim(kind="posting", task_id=456, account_id=123)
        with patch.object(worker, "browser_semaphore", slot), patch.object(worker, "AsyncSessionLocal", return_value=session_context), patch.object(worker, "claim_next_browser_task_for_account", new=AsyncMock(return_value=claim)), patch.object(worker, "_account_proxy_url", return_value="http://fresh.example:8080"), patch.object(worker, "get_current_ip", new=AsyncMock(side_effect=RuntimeError("HTTP://login:secret@example.test:8080"))), patch.object(worker, "record_proxy_failure", new=AsyncMock()) as failure, patch.object(worker, "release_claimed_task", new=AsyncMock()), patch.object(worker, "_sleep_or_stop", new=backoff), patch("app.posting.proxy_telemetry.flush_browser_estimates", new=AsyncMock()):
            await worker.run_account_worker(123, "http://old.example:8080", stop)
            self.assertNotIn("secret", failure.call_args.args[1])

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.db.models import (
    Account,
    AccountStatus,
    Platform,
    PostingTask,
    PostingTaskStatus,
    Project,
    ProjectOperation,
    ProjectOperationStatus,
    ProjectOperationType,
)
from app.db.session import AsyncSessionLocal
from app.parsers.scraper import scrape_trends
from app.parsers.trend_analyzer import analyze_and_save_trends
from app.posting.exceptions import RetryablePostingException
from app.posting.service import execute_posting_task
from app.posting.scheduler import (
    _count_account_success_today,
    _is_project_in_active_window,
    _next_project_active_start,
    _project_posts_per_day,
)
from app.services.admin_notifier import send_admin_alert
from app.services.proxy_pool import build_threads_proxy_url_for_account


IP_CHECK_URL = "https://api.ipify.org"
ACCOUNT_POLL_SECONDS = 5
ACCOUNT_DISCOVERY_INTERVAL_SECONDS = 30
PROXY_FAILURE_RETRY_DELAY_SECONDS = 3 * 60
SELENIUM_DEADLINE_SECONDS = settings.selenium_deadline_seconds
MAX_CONCURRENT_BROWSERS = max(1, settings.max_concurrent_browsers)
PROXY_FAILURE_THRESHOLD = max(1, settings.proxy_failure_threshold)
PROXY_FAILURE_MARKERS = (
    "proxy",
    "timeout",
    "timed out",
    "403",
    "502",
    "err_tunnel",
    "err_proxy",
    "err_connection",
    "tunnel_connection_failed",
    "connection refused",
    "connection reset",
    "empty ipify",
)

logger = logging.getLogger(__name__)
browser_semaphore = asyncio.Semaphore(MAX_CONCURRENT_BROWSERS)


@dataclass(slots=True)
class AccountWorkerState:
    account_id: int
    proxy_url: str
    active_task_id: int | None = None


@dataclass(slots=True)
class BrowserTaskClaim:
    kind: str
    task_id: int
    account_id: int


class ProxyManager:
    def __init__(self) -> None:
        self._manager_task: asyncio.Task[None] | None = None
        self._worker_tasks: dict[int, asyncio.Task[None]] = {}
        self._stop_event = asyncio.Event()

    def start(self) -> None:
        if self._manager_task is not None and not self._manager_task.done():
            return

        self._stop_event = asyncio.Event()
        self._manager_task = asyncio.create_task(self._run(), name="proxy-manager")

    async def stop(self) -> None:
        self._stop_event.set()

        tasks = [task for task in [self._manager_task, *self._worker_tasks.values()] if task is not None]
        for task in tasks:
            task.cancel()

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        self._manager_task = None
        self._worker_tasks.clear()

    async def _run(self) -> None:
        logger.info(
            "Account proxy manager started. max_concurrent_browsers=%s, proxy_failure_threshold=%s.",
            MAX_CONCURRENT_BROWSERS,
            PROXY_FAILURE_THRESHOLD,
        )

        while not self._stop_event.is_set():
            try:
                active_accounts = await discover_active_proxy_accounts()
                active_account_ids = {account_id for account_id, _proxy_url in active_accounts}

                for account_id, proxy_url in active_accounts:
                    task = self._worker_tasks.get(account_id)
                    if task is None or task.done():
                        self._worker_tasks[account_id] = asyncio.create_task(
                            run_account_worker(account_id, proxy_url, self._stop_event),
                            name=f"account-worker:{account_id}",
                        )

                for account_id, task in list(self._worker_tasks.items()):
                    if account_id not in active_account_ids:
                        task.cancel()
                        self._worker_tasks.pop(account_id, None)

                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=ACCOUNT_DISCOVERY_INTERVAL_SECONDS,
                )
            except TimeoutError:
                continue
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Account proxy manager discovery loop failed.")
                await asyncio.sleep(ACCOUNT_POLL_SECONDS)


async def discover_active_proxy_accounts() -> list[tuple[int, str]]:
    async with AsyncSessionLocal() as session:
        accounts = list(
            (
                await session.scalars(
                    select(Account)
                    .where(
                        Account.platform == Platform.THREADS,
                        Account.status == AccountStatus.ACTIVE,
                        Account.assigned_port.is_not(None),
                    )
                    .order_by(Account.id.asc())
                )
            ).all()
        )

    active_accounts: list[tuple[int, str]] = []
    for account in accounts:
        try:
            proxy_url = _account_proxy_url(account)
        except HTTPException as exc:
            logger.warning("Account proxy manager is waiting for base proxy config: %s", exc.detail)
            return []
        if proxy_url:
            active_accounts.append((account.id, proxy_url))

    return active_accounts


async def run_account_worker(account_id: int, proxy_url: str, stop_event: asyncio.Event) -> None:
    state = AccountWorkerState(account_id=account_id, proxy_url=proxy_url)
    logger.info("Account proxy worker started: account #%s via %s.", account_id, _safe_proxy_label(proxy_url))

    while not stop_event.is_set():
        task = await claim_next_browser_task_for_account(account_id)
        if task is None:
            await _sleep_or_stop(stop_event, ACCOUNT_POLL_SECONDS)
            continue

        try:
            current_ip = await get_current_ip(proxy_url)
        except Exception as exc:
            logger.warning("Proxy IP polling failed for account #%s via %s: %s", account_id, _safe_proxy_label(proxy_url), exc)
            await record_proxy_failure(account_id, f"Proxy IP polling failed: {exc}")
            await release_claimed_task(task, f"Proxy IP polling failed before browser start: {exc}")
            await _sleep_or_stop(stop_event, PROXY_FAILURE_RETRY_DELAY_SECONDS)
            continue

        state.active_task_id = task.task_id
        async with browser_semaphore:
            try:
                await _run_claimed_task(task, state.proxy_url, current_ip)
                await reset_proxy_failure_count(account_id)
            except RetryablePostingException as exc:
                if _is_proxy_ip_changed_message(str(exc)):
                    logger.warning(
                        "Account #%s browser window was interrupted by proxy IP rotation; task will retry without opening circuit breaker: %s",
                        account_id,
                        exc,
                    )
                else:
                    await record_proxy_failure(account_id, str(exc))
                await _sleep_or_stop(stop_event, PROXY_FAILURE_RETRY_DELAY_SECONDS)
            except Exception:
                logger.exception("Account worker failed while executing %s task #%s.", task.kind, task.task_id)
            finally:
                state.active_task_id = None


async def get_current_ip(proxy_url: str) -> str:
    async with httpx.AsyncClient(proxy=proxy_url, timeout=10.0) as client:
        response = await client.get(IP_CHECK_URL)
        response.raise_for_status()
        current_ip = response.text.strip()

    if not current_ip:
        raise RetryablePostingException("Empty ipify response from account proxy.")

    return current_ip


async def _run_claimed_task(task: BrowserTaskClaim, proxy_url: str, expected_ip: str) -> None:
    deadline_at = time.monotonic() + SELENIUM_DEADLINE_SECONDS

    if task.kind == "posting":
        async with AsyncSessionLocal() as session:
            posting_task = await execute_posting_task(
                task_id=task.task_id,
                session=session,
                deadline_at=deadline_at,
                ip_guard_proxy_url=proxy_url,
                expected_proxy_ip=expected_ip,
            )

        if _is_proxy_failure_message(posting_task.error_message):
            raise RetryablePostingException(posting_task.error_message or "Posting proxy failure.")
        return

    if task.kind == "scraping":
        proxy_error = await execute_scraping_operation(
            operation_id=task.task_id,
            deadline_at=deadline_at,
            account_id=task.account_id,
            ip_guard_proxy_url=proxy_url,
            expected_proxy_ip=expected_ip,
        )
        if proxy_error:
            raise RetryablePostingException(proxy_error)


async def claim_next_browser_task_for_account(account_id: int) -> BrowserTaskClaim | None:
    posting_task_id = await claim_oldest_due_task_for_account(account_id)
    if posting_task_id is not None:
        return BrowserTaskClaim(kind="posting", task_id=posting_task_id, account_id=account_id)

    scraping_operation_id = await claim_oldest_scraping_operation_for_account(account_id)
    if scraping_operation_id is not None:
        return BrowserTaskClaim(kind="scraping", task_id=scraping_operation_id, account_id=account_id)

    return None


async def claim_oldest_due_task_for_account(account_id: int) -> int | None:
    now = datetime.now(UTC)

    async with AsyncSessionLocal() as session:
        candidate_rows = list(
            (
                await session.execute(
                    select(PostingTask, Account, Project)
                    .join(Account, PostingTask.account_id == Account.id)
                    .join(Project, PostingTask.project_id == Project.id)
                    .where(
                        PostingTask.status == PostingTaskStatus.QUEUED,
                        PostingTask.account_id == account_id,
                        PostingTask.scheduled_at.is_not(None),
                        PostingTask.scheduled_at <= now,
                        Account.status == AccountStatus.ACTIVE,
                        Account.platform == Platform.THREADS,
                        Account.assigned_port.is_not(None),
                        Project.is_active.is_(True),
                    )
                    .order_by(PostingTask.scheduled_at.asc(), PostingTask.id.asc())
                    .limit(20)
                )
            ).all()
        )

        for task, account, project in candidate_rows:
            publish_now_requested = _is_publish_now_requested(task)

            if not publish_now_requested and not _is_project_in_active_window(project, now):
                task.scheduled_at = _next_project_active_start(project, now)
                continue

            if (
                not publish_now_requested
                and await _count_account_success_today(project, account.id, session) >= _project_posts_per_day(project)
            ):
                task.scheduled_at = _next_project_active_start(project, now + timedelta(days=1))
                continue

            task.status = PostingTaskStatus.RUNNING
            task.started_at = now
            task.finished_at = None
            task.error_message = None
            if publish_now_requested:
                task.generation_metadata = {
                    key: value
                    for key, value in (task.generation_metadata or {}).items()
                    if key != "publish_now_requested"
                }
            await session.commit()
            return task.id

        await session.commit()
        return None


async def claim_oldest_scraping_operation_for_account(account_id: int) -> int | None:
    async with AsyncSessionLocal() as session:
        candidate_rows = list(
            (
                await session.execute(
                    select(ProjectOperation, Account, Project)
                    .join(Project, ProjectOperation.project_id == Project.id)
                    .join(Account, Account.project_id == Project.id)
                    .where(
                        Account.id == account_id,
                        ProjectOperation.action_type == ProjectOperationType.SCRAPING,
                        ProjectOperation.status == ProjectOperationStatus.QUEUED,
                        Account.status == AccountStatus.ACTIVE,
                        Account.platform == Platform.THREADS,
                        Account.cookies_encrypted.is_not(None),
                        Account.assigned_port.is_not(None),
                        Project.is_active.is_(True),
                    )
                    .order_by(ProjectOperation.started_at.asc(), ProjectOperation.id.asc())
                    .limit(20)
                )
            ).all()
        )

        for operation, account, _project in candidate_rows:
            if operation.status != ProjectOperationStatus.QUEUED:
                continue

            operation.status = ProjectOperationStatus.RUNNING
            operation.message = f"Trend scraping is running on account #{account.id}."
            operation.finished_at = None
            account.last_used_at = datetime.now(UTC)
            await session.commit()
            return operation.id

        return None


async def release_claimed_task(task: BrowserTaskClaim, error_message: str) -> None:
    async with AsyncSessionLocal() as session:
        if task.kind == "posting":
            posting_task = await session.get(PostingTask, task.task_id)
            if posting_task is not None and posting_task.status == PostingTaskStatus.RUNNING:
                posting_task.status = PostingTaskStatus.QUEUED
                posting_task.started_at = None
                posting_task.finished_at = None
                posting_task.error_message = error_message
                await session.commit()
            return

        if task.kind == "scraping":
            operation = await session.get(ProjectOperation, task.task_id)
            if operation is not None and operation.status == ProjectOperationStatus.RUNNING:
                operation.status = ProjectOperationStatus.QUEUED
                operation.finished_at = None
                operation.message = error_message
                await session.commit()


async def execute_scraping_operation(
    operation_id: int,
    deadline_at: float | None = None,
    account_id: int | None = None,
    ip_guard_proxy_url: str | None = None,
    expected_proxy_ip: str | None = None,
) -> str | None:
    async with AsyncSessionLocal() as session:
        operation = await session.get(ProjectOperation, operation_id)

        if operation is None:
            logger.warning("Project scraping operation %s not found.", operation_id)
            return None

        try:
            logger.info("Project scraping operation %s started for project %s.", operation.id, operation.project_id)
            scrape_result = await scrape_trends(
                project_id=operation.project_id,
                session=session,
                deadline_at=deadline_at,
                account_id=account_id,
                ip_guard_proxy_url=ip_guard_proxy_url,
                expected_proxy_ip=expected_proxy_ip,
            )
            saved_trends = await analyze_and_save_trends(
                project_id=operation.project_id,
                raw_posts=scrape_result.raw_posts,
                session=session,
            )
            operation.status = ProjectOperationStatus.SUCCESS
            operation.message = (
                f"Trend analysis completed: collected {len(scrape_result.raw_posts)}, "
                f"saved {len(saved_trends)}."
            )
            operation.result_json = {
                "collected_posts_count": len(scrape_result.raw_posts),
                "saved_trends_count": len(saved_trends),
            }
            operation.finished_at = datetime.now(UTC)
            await session.commit()
            logger.info("Project scraping operation %s completed.", operation.id)
            return None
        except RetryablePostingException as exc:
            await session.rollback()
            retry_operation = await session.get(ProjectOperation, operation_id)
            if retry_operation is not None:
                retry_operation.status = ProjectOperationStatus.QUEUED
                retry_operation.message = f"Retryable browser/proxy error during trend scraping: {exc}"
                retry_operation.result_json = {"error": str(exc), "retryable": True}
                retry_operation.finished_at = None
                await session.commit()
            logger.warning("Project scraping operation %s returned to queue: %s", operation_id, exc)
            return str(exc) if _is_proxy_failure_message(str(exc)) else None
        except Exception as exc:
            await session.rollback()
            failed_operation = await session.get(ProjectOperation, operation_id)

            if failed_operation is not None:
                failed_operation.status = ProjectOperationStatus.FAILED
                failed_operation.message = f"Trend analysis failed: {exc}"
                failed_operation.result_json = {"error": str(exc)}
                failed_operation.finished_at = datetime.now(UTC)
                await session.commit()

            logger.exception("Project scraping operation %s failed.", operation_id)
            return str(exc) if _is_proxy_failure_message(str(exc)) else None


async def record_proxy_failure(account_id: int, error_message: str) -> None:
    async with AsyncSessionLocal() as session:
        account = await session.get(Account, account_id)
        if account is None or account.status != AccountStatus.ACTIVE:
            return

        account.proxy_error_count += 1
        account.last_error = error_message[:2000]

        if account.proxy_error_count >= PROXY_FAILURE_THRESHOLD:
            account.status = AccountStatus.PROXY_ERROR
            await session.commit()
            await send_admin_alert(
                "Proxy circuit breaker opened.\n\n"
                f"Account: #{account.id} @{account.username}\n"
                f"Proxy: {_safe_proxy_label(_account_proxy_url(account) or '')}\n"
                f"Consecutive failures: {account.proxy_error_count}\n"
                f"Last error: {error_message[:1000]}"
            )
            logger.error("Proxy circuit breaker opened for account #%s.", account.id)
            return

        await session.commit()
        logger.warning(
            "Proxy failure recorded for account #%s (%s/%s): %s",
            account.id,
            account.proxy_error_count,
            PROXY_FAILURE_THRESHOLD,
            error_message,
        )


async def reset_proxy_failure_count(account_id: int) -> None:
    async with AsyncSessionLocal() as session:
        account = await session.get(Account, account_id)
        if account is None or account.proxy_error_count == 0:
            return

        account.proxy_error_count = 0
        await session.commit()


def _account_proxy_url(account: Account) -> str | None:
    return build_threads_proxy_url_for_account(account)


async def _sleep_or_stop(stop_event: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=seconds)
    except TimeoutError:
        return


def _is_proxy_failure_message(message: str | None) -> bool:
    if not message:
        return False

    normalized = message.casefold()
    return any(marker in normalized for marker in PROXY_FAILURE_MARKERS)


def _is_proxy_ip_changed_message(message: str | None) -> bool:
    if not message:
        return False

    return "proxy ip changed during selenium session" in message.casefold()


def _is_publish_now_requested(task: PostingTask) -> bool:
    metadata = task.generation_metadata if isinstance(task.generation_metadata, dict) else {}
    return bool(metadata.get("publish_now_requested"))


def _safe_proxy_label(proxy_url: str) -> str:
    if "@" not in proxy_url:
        return proxy_url

    scheme, _, tail = proxy_url.partition("://")
    _, _, host = tail.rpartition("@")
    return f"{scheme}://***@{host}" if scheme else f"***@{host}"

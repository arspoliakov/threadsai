from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
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
    _count_project_success_today,
    _is_project_in_active_window,
    _next_project_active_start,
    _project_posts_per_day,
)


IP_CHECK_URL = "https://api.ipify.org"
PROXY_POLL_MIN_SECONDS = 5
PROXY_POLL_MAX_SECONDS = 10
PROXY_DISCOVERY_INTERVAL_SECONDS = 60
PROXY_ROTATION_SECONDS = settings.proxy_rotation_seconds
SELENIUM_DEADLINE_SECONDS = settings.selenium_deadline_seconds

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ProxyWorkerState:
    proxy_url: str
    last_ip: str | None = None
    active_task_id: int | None = None


@dataclass(slots=True)
class BrowserTaskClaim:
    kind: str
    task_id: int
    account_id: int | None = None


class ProxyManager:
    def __init__(self) -> None:
        self._manager_task: asyncio.Task[None] | None = None
        self._worker_tasks: dict[str, asyncio.Task[None]] = {}
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
        logger.info("Proxy manager started.")

        while not self._stop_event.is_set():
            try:
                proxy_urls = await discover_active_proxy_urls()
                for proxy_url in proxy_urls:
                    task = self._worker_tasks.get(proxy_url)
                    if task is None or task.done():
                        self._worker_tasks[proxy_url] = asyncio.create_task(
                            run_proxy_worker(proxy_url, self._stop_event),
                            name=f"proxy-worker:{_safe_proxy_label(proxy_url)}",
                        )

                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=PROXY_DISCOVERY_INTERVAL_SECONDS,
                )
            except TimeoutError:
                continue
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Proxy manager discovery loop failed.")
                await asyncio.sleep(PROXY_POLL_MAX_SECONDS)


async def discover_active_proxy_urls() -> set[str]:
    proxy_urls: set[str] = set(settings.threads_proxy_pool_urls())

    async with AsyncSessionLocal() as session:
        accounts = list(
            (
                await session.scalars(
                    select(Account).where(
                        Account.platform == Platform.THREADS,
                        Account.status == AccountStatus.ACTIVE,
                    )
                )
            ).all()
        )

    for account in accounts:
        proxy_url = _account_proxy_url(account)
        if proxy_url:
            proxy_urls.add(proxy_url)

    return proxy_urls


async def run_proxy_worker(proxy_url: str, stop_event: asyncio.Event) -> None:
    state = ProxyWorkerState(proxy_url=proxy_url)
    logger.info("Proxy worker started for %s.", _safe_proxy_label(proxy_url))

    while not stop_event.is_set():
        try:
            current_ip = await get_current_ip(proxy_url)
        except Exception as exc:
            logger.warning("Proxy IP polling failed for %s: %s", _safe_proxy_label(proxy_url), exc)
            await _sleep_or_stop(stop_event, PROXY_POLL_MAX_SECONDS)
            continue

        if state.last_ip is None:
            state.last_ip = current_ip
            logger.info("Proxy %s baseline IP fixed: %s. Waiting for next rotation.", _safe_proxy_label(proxy_url), current_ip)
            await _sleep_or_stop(stop_event, PROXY_POLL_MAX_SECONDS)
            continue

        if current_ip != state.last_ip:
            previous_ip = state.last_ip
            state.last_ip = current_ip
            rotation_started_at = time.monotonic()
            logger.info(
                "Proxy %s rotated: %s -> %s. Safe window opened for %s seconds.",
                _safe_proxy_label(proxy_url),
                previous_ip,
                current_ip,
                PROXY_ROTATION_SECONDS,
            )
            await _run_one_task_for_rotation(state, rotation_started_at)

        await _sleep_or_stop(stop_event, PROXY_POLL_MIN_SECONDS)


async def get_current_ip(proxy_url: str) -> str:
    async with httpx.AsyncClient(proxy=proxy_url, timeout=10.0) as client:
        response = await client.get(IP_CHECK_URL)
        response.raise_for_status()
        return response.text.strip()


async def _run_one_task_for_rotation(state: ProxyWorkerState, rotation_started_at: float) -> None:
    deadline_at = rotation_started_at + SELENIUM_DEADLINE_SECONDS
    task = await claim_next_browser_task_for_proxy(state.proxy_url)

    if task is None:
        logger.info("Proxy %s has no due browser tasks for this rotation.", _safe_proxy_label(state.proxy_url))
        return

    state.active_task_id = task.task_id
    try:
        if task.kind == "posting":
            async with AsyncSessionLocal() as session:
                await execute_posting_task(task_id=task.task_id, session=session, deadline_at=deadline_at)
            return

        if task.kind == "scraping":
            await execute_scraping_operation(
                operation_id=task.task_id,
                deadline_at=deadline_at,
                account_id=task.account_id,
            )
    finally:
        state.active_task_id = None


async def claim_next_browser_task_for_proxy(proxy_url: str) -> BrowserTaskClaim | None:
    posting_task_id = await claim_oldest_due_task_for_proxy(proxy_url)
    if posting_task_id is not None:
        return BrowserTaskClaim(kind="posting", task_id=posting_task_id)

    scraping_operation_id = await claim_oldest_scraping_operation_for_proxy(proxy_url)
    if scraping_operation_id is not None:
        operation_id, account_id = scraping_operation_id
        return BrowserTaskClaim(kind="scraping", task_id=operation_id, account_id=account_id)

    return None


async def claim_oldest_due_task_for_proxy(proxy_url: str) -> int | None:
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
                        PostingTask.account_id.is_not(None),
                        PostingTask.scheduled_at.is_not(None),
                        PostingTask.scheduled_at <= now,
                        Account.status == AccountStatus.ACTIVE,
                        Account.platform == Platform.THREADS,
                        Project.is_active.is_(True),
                    )
                    .order_by(PostingTask.scheduled_at.asc(), PostingTask.id.asc())
                    .limit(50)
                )
            ).all()
        )

        for task, account, project in candidate_rows:
            if _account_proxy_url(account) != proxy_url:
                continue

            if not _is_project_in_active_window(project, now):
                task.scheduled_at = _next_project_active_start(project, now)
                continue

            if await _count_project_success_today(project, session) >= _project_posts_per_day(project):
                task.scheduled_at = _next_project_active_start(project, now + timedelta(days=1))
                continue

            task.status = PostingTaskStatus.RUNNING
            task.started_at = now
            task.finished_at = None
            task.error_message = None
            await session.commit()
            return task.id

        await session.commit()
        return None


async def claim_oldest_scraping_operation_for_proxy(proxy_url: str) -> tuple[int, int] | None:
    async with AsyncSessionLocal() as session:
        candidate_rows = list(
            (
                await session.execute(
                    select(ProjectOperation, Account, Project)
                    .join(Project, ProjectOperation.project_id == Project.id)
                    .join(Account, Account.project_id == Project.id)
                    .where(
                        ProjectOperation.action_type == ProjectOperationType.SCRAPING,
                        ProjectOperation.status == ProjectOperationStatus.QUEUED,
                        Account.status == AccountStatus.ACTIVE,
                        Account.platform == Platform.THREADS,
                        Account.cookies_encrypted.is_not(None),
                        Project.is_active.is_(True),
                    )
                    .order_by(ProjectOperation.started_at.asc(), ProjectOperation.id.asc())
                    .limit(50)
                )
            ).all()
        )

        for operation, account, _project in candidate_rows:
            if _account_proxy_url(account) != proxy_url:
                continue

            operation.status = ProjectOperationStatus.RUNNING
            operation.message = "Trend scraping is running in a safe proxy window."
            operation.finished_at = None
            await session.commit()
            return operation.id, account.id

        return None


async def execute_scraping_operation(
    operation_id: int,
    deadline_at: float | None = None,
    account_id: int | None = None,
) -> None:
    async with AsyncSessionLocal() as session:
        operation = await session.get(ProjectOperation, operation_id)

        if operation is None:
            logger.warning("Project scraping operation %s not found.", operation_id)
            return

        try:
            logger.info("Project scraping operation %s started for project %s.", operation.id, operation.project_id)
            scrape_result = await scrape_trends(
                project_id=operation.project_id,
                session=session,
                deadline_at=deadline_at,
                account_id=account_id,
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


def _account_proxy_url(account: Account) -> str | None:
    session_payload = _load_json_safely(account.session_data_encrypted)
    proxy_url = session_payload.get("proxy") if isinstance(session_payload, dict) else None
    return proxy_url or account.proxy_url


def _load_json_safely(raw_value: str | None) -> Any:
    if not raw_value:
        return {}

    try:
        return json.loads(raw_value)
    except json.JSONDecodeError:
        return {}


async def _sleep_or_stop(stop_event: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=seconds)
    except TimeoutError:
        return


def _safe_proxy_label(proxy_url: str) -> str:
    if "@" not in proxy_url:
        return proxy_url

    scheme, _, tail = proxy_url.partition("://")
    _, _, host = tail.rpartition("@")
    return f"{scheme}://***@{host}" if scheme else f"***@{host}"

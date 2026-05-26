from __future__ import annotations

import asyncio
import logging
import random
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_engine.generators import generate_post
from app.db.models import Account, AccountStatus, Platform, PostingTask, PostingTaskStatus, Project
from app.db.session import AsyncSessionLocal
from app.parsers.scraper import scrape_trends
from app.parsers.trend_analyzer import analyze_and_save_trends
from app.posting.service import execute_posting_task
from app.telegram.notifications import send_admin_notification


JITTER_MIN_SECONDS = 60
JITTER_MAX_SECONDS = 600
TASK_CHECK_INTERVAL_SECONDS = 90
MAX_TASKS_PER_TICK = 5
MAX_GENERATIONS_PER_SCHEDULER_RUN = 50
FIRST_POST_DELAY_MINUTES = 15
TREND_ANALYSIS_INTERVAL_DAYS = 3

scheduler = AsyncIOScheduler()
logger = logging.getLogger(__name__)


def setup_posting_scheduler() -> AsyncIOScheduler:
    if not scheduler.get_job("check_and_run_posting_tasks"):
        scheduler.add_job(
            check_and_run_tasks,
            trigger="interval",
            seconds=TASK_CHECK_INTERVAL_SECONDS,
            id="check_and_run_posting_tasks",
            max_instances=1,
            coalesce=True,
        )

    if not scheduler.get_job("analyze_daily_trends"):
        scheduler.add_job(
            analyze_daily_trends,
            trigger="cron",
            day=f"*/{TREND_ANALYSIS_INTERVAL_DAYS}",
            hour=3,
            minute=0,
            id="analyze_daily_trends",
            max_instances=1,
            coalesce=True,
        )

    return scheduler


async def analyze_daily_trends() -> None:
    async with AsyncSessionLocal() as session:
        project_ids = list(
            (
                await session.scalars(
                    select(Project.id).where(Project.is_active.is_(True)).order_by(Project.id.asc())
                )
            ).all()
        )

        if not project_ids:
            logger.info("Daily trend analysis skipped: no active projects found.")
            return

        for project_id in project_ids:
            try:
                scrape_result = await scrape_trends(project_id=project_id, session=session)
                saved_trends = await analyze_and_save_trends(
                    project_id=project_id,
                    raw_posts=scrape_result.raw_posts,
                    session=session,
                )
                logger.info(
                    "Daily trend analysis completed for project #%s. Scraped=%s raw=%s analyzed=%s",
                    project_id,
                    len(scrape_result.raw_posts),
                    scrape_result.saved_raw_count,
                    len(saved_trends),
                )
            except Exception as exc:
                await session.rollback()
                await send_admin_notification(
                    f"Daily trend analysis failed for project #{project_id}.\n\nError: {exc}"
                )


async def check_and_run_tasks() -> None:
    await ensure_account_based_queue()
    task_ids = await _claim_due_tasks()

    for task_id in task_ids:
        asyncio.create_task(_run_task_with_jitter(task_id))


async def ensure_account_based_queue() -> None:
    generated_count = 0

    async with AsyncSessionLocal() as session:
        projects = list(
            (
                await session.scalars(
                    select(Project).where(Project.is_active.is_(True)).order_by(Project.id.asc())
                )
            ).all()
        )

        for project in projects:
            if not _is_project_in_active_window(project):
                continue

            project_posts_limit = _project_posts_per_day(project)
            project_tasks_today = await _count_project_tasks_today(project, session)
            if project_tasks_today >= project_posts_limit:
                continue

            accounts = await _get_project_posting_accounts(project.id, session)
            if not accounts:
                continue

            missing_count = min(
                project_posts_limit - project_tasks_today,
                MAX_GENERATIONS_PER_SCHEDULER_RUN - generated_count,
            )

            for offset in range(missing_count):
                if generated_count >= MAX_GENERATIONS_PER_SCHEDULER_RUN:
                    return

                account = accounts[offset % len(accounts)]
                try:
                    post_number = project_tasks_today + offset
                    scheduled_at = await _calculate_next_project_slot(project, session)
                    task = await generate_post(
                        project_id=project.id,
                        topic_or_context=_build_account_topic(project, account, post_number),
                        session=session,
                        platform=account.platform,
                        account_id=account.id,
                        scheduled_at=scheduled_at,
                        use_trends=True,
                    )
                    generated_count += 1
                    logger.info(
                        "Generated scheduled task #%s for project #%s, account @%s. Scheduled at: %s.",
                        task.id,
                        project.id,
                        account.username,
                        task.scheduled_at,
                    )
                except Exception as exc:
                    await session.rollback()
                    logger.exception(
                        "Account-based generation failed for project #%s, account #%s.",
                        project.id,
                        account.id,
                    )


async def _get_project_posting_accounts(project_id: int, session: AsyncSession) -> list[Account]:
    stmt = (
        select(Account)
        .where(
            Account.project_id == project_id,
            Account.status == AccountStatus.ACTIVE,
            Account.platform == Platform.THREADS,
        )
        .order_by(Account.last_used_at.asc().nulls_first(), Account.id.asc())
    )
    return list((await session.scalars(stmt)).all())


async def _count_project_tasks_today(project: Project, session: AsyncSession) -> int:
    start_at, end_at = _project_day_bounds(project)
    count = await session.scalar(
        select(func.count(PostingTask.id)).where(
            PostingTask.project_id == project.id,
            PostingTask.scheduled_at >= start_at,
            PostingTask.scheduled_at < end_at,
            PostingTask.status.not_in([PostingTaskStatus.FAILED, PostingTaskStatus.CANCELLED]),
        )
    )
    return count or 0


async def _count_project_success_today(project: Project, session: AsyncSession) -> int:
    start_at, end_at = _project_day_bounds(project)
    count = await session.scalar(
        select(func.count(PostingTask.id)).where(
            PostingTask.project_id == project.id,
            PostingTask.status == PostingTaskStatus.SUCCESS,
            PostingTask.finished_at >= start_at,
            PostingTask.finished_at < end_at,
        )
    )
    return count or 0


async def _calculate_next_project_slot(project: Project, session: AsyncSession) -> datetime:
    start_at, end_at = _project_active_window_bounds(project)
    last_scheduled_at = await session.scalar(
        select(func.max(PostingTask.scheduled_at)).where(
            PostingTask.project_id == project.id,
            PostingTask.scheduled_at >= start_at,
            PostingTask.scheduled_at < end_at,
            PostingTask.status.not_in([PostingTaskStatus.FAILED, PostingTaskStatus.CANCELLED]),
        )
    )
    now = datetime.now(UTC)
    interval = _project_interval(project)
    minimum_slot = max(now + timedelta(minutes=FIRST_POST_DELAY_MINUTES), start_at)

    if last_scheduled_at is None:
        candidate = minimum_slot + timedelta(minutes=random.randint(0, min(30, max(1, int(interval.total_seconds() // 60)))))
        return min(candidate, end_at - timedelta(minutes=1))

    if last_scheduled_at.tzinfo is None:
        last_scheduled_at = last_scheduled_at.replace(tzinfo=UTC)

    jitter_minutes = random.randint(0, max(1, int(interval.total_seconds() // 300)))
    next_slot = last_scheduled_at + interval + timedelta(minutes=jitter_minutes)
    candidate = max(next_slot, minimum_slot)

    if candidate >= end_at:
        return _next_project_active_start(project, now + timedelta(days=1))

    return candidate


def _project_day_bounds(project: Project, reference_utc: datetime | None = None) -> tuple[datetime, datetime]:
    timezone = _project_timezone(project)
    reference = reference_utc or datetime.now(UTC)
    local_reference = reference.astimezone(timezone)
    local_start = datetime.combine(local_reference.date(), time.min, tzinfo=timezone)
    local_end = local_start + timedelta(days=1)
    return local_start.astimezone(UTC), local_end.astimezone(UTC)


def _project_active_window_bounds(project: Project, reference_utc: datetime | None = None) -> tuple[datetime, datetime]:
    timezone = _project_timezone(project)
    reference = reference_utc or datetime.now(UTC)
    local_reference = reference.astimezone(timezone)
    start_time = _parse_project_time(project.active_hours_start, fallback=time(9, 0))
    end_time = _parse_project_time(project.active_hours_end, fallback=time(21, 0))
    local_start = datetime.combine(local_reference.date(), start_time, tzinfo=timezone)
    local_end = datetime.combine(local_reference.date(), end_time, tzinfo=timezone)

    if local_end <= local_start:
        local_end += timedelta(days=1)

    return local_start.astimezone(UTC), local_end.astimezone(UTC)


def _is_project_in_active_window(project: Project, reference_utc: datetime | None = None) -> bool:
    reference = reference_utc or datetime.now(UTC)
    start_at, end_at = _project_active_window_bounds(project, reference)
    return start_at <= reference <= end_at


def _next_project_active_start(project: Project, reference_utc: datetime | None = None) -> datetime:
    reference = reference_utc or datetime.now(UTC)
    start_at, end_at = _project_active_window_bounds(project, reference)

    if reference < start_at:
        return start_at

    if reference <= end_at:
        return reference + timedelta(minutes=FIRST_POST_DELAY_MINUTES)

    return _project_active_window_bounds(project, reference + timedelta(days=1))[0]


def _project_interval(project: Project) -> timedelta:
    start_at, end_at = _project_active_window_bounds(project)
    window_minutes = max(60, int((end_at - start_at).total_seconds() // 60))
    posts_per_day = _project_posts_per_day(project)
    interval_minutes = max(15, window_minutes // max(1, posts_per_day))
    return timedelta(minutes=interval_minutes)


def _project_posts_per_day(project: Project) -> int:
    return min(20, max(1, int(project.posts_per_day or 3)))


def _project_timezone(project: Project) -> ZoneInfo:
    try:
        return ZoneInfo(project.timezone or "Europe/Moscow")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _parse_project_time(value: str | None, *, fallback: time) -> time:
    if not value:
        return fallback

    try:
        hours, minutes = value.split(":", maxsplit=1)
        return time(hour=int(hours), minute=int(minutes))
    except (ValueError, TypeError):
        return fallback


def _build_account_topic(project: Project, account: Account, todays_count: int) -> str:
    project_context = project.global_context or project.description or "не указан"
    target_actions = ", ".join(project.target_actions or []) or "не заданы"
    parts = [
        f"Проект: {project.name}",
        f"Глобальный контекст проекта: {project_context}",
        f"Целевые действия проекта: {target_actions}",
        f"Ниша: {project.niche or 'не указана'}",
        f"Аудитория: {project.target_audience or 'не указана'}",
        f"Tone of Voice: {project.tone_of_voice or 'не указан'}",
        f"Аккаунт публикации: @{account.username}",
        f"Это пост #{todays_count + 1} из {project.posts_per_day} на сегодня для этого проекта.",
        (
            "Сгенерируй самостоятельный Threads-пост для ближайшей публикации. "
            "Не повторяй предыдущие формулировки, опирайся на свежие тренды и описание проекта."
        ),
    ]
    return "\n".join(parts)


async def _claim_due_tasks() -> list[int]:
    now = datetime.now(UTC)

    async with AsyncSessionLocal() as session:
        candidate_stmt = (
            select(PostingTask)
            .join(Account, PostingTask.account_id == Account.id)
            .join(Project, PostingTask.project_id == Project.id)
            .where(
                PostingTask.status == PostingTaskStatus.QUEUED,
                PostingTask.account_id.is_not(None),
                PostingTask.scheduled_at.is_not(None),
                PostingTask.scheduled_at <= now,
                Account.status == AccountStatus.ACTIVE,
                Project.is_active.is_(True),
            )
            .order_by(PostingTask.scheduled_at.asc(), PostingTask.id.asc())
            .limit(MAX_TASKS_PER_TICK * 3)
        )
        candidate_tasks = list((await session.scalars(candidate_stmt)).all())
        tasks: list[PostingTask] = []

        for task in candidate_tasks:
            project = await session.get(Project, task.project_id)
            if project is None:
                continue

            if not _is_project_in_active_window(project, now):
                task.scheduled_at = _next_project_active_start(project, now)
                continue

            if await _count_project_success_today(project, session) >= _project_posts_per_day(project):
                task.scheduled_at = _next_project_active_start(project, now + timedelta(days=1))
                continue

            task.status = PostingTaskStatus.RUNNING
            task.started_at = now
            task.error_message = None
            tasks.append(task)

            if len(tasks) >= MAX_TASKS_PER_TICK:
                break

        await session.commit()
        return [task.id for task in tasks]


async def _run_task_with_jitter(task_id: int) -> None:
    delay_seconds = random.randint(JITTER_MIN_SECONDS, JITTER_MAX_SECONDS)
    await asyncio.sleep(delay_seconds)

    try:
        async with AsyncSessionLocal() as session:
            await execute_posting_task(task_id=task_id, session=session)
    except Exception as exc:
        await _mark_scheduler_task_failed(task_id=task_id, error_message=str(exc))
        await send_admin_notification(
            f"Фоновая публикация #{task_id} упала до запуска Selenium.\n\nОшибка: {exc}"
        )


async def _mark_scheduler_task_failed(task_id: int, error_message: str) -> None:
    async with AsyncSessionLocal() as session:
        task = await session.get(PostingTask, task_id)
        if task is None:
            return

        task.status = PostingTaskStatus.FAILED
        task.finished_at = datetime.now(UTC)
        task.error_message = error_message
        task.retry_count += 1
        await session.commit()

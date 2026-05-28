from __future__ import annotations

import logging
import random
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_engine.generators import generate_post
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
from app.services.admin_notifier import send_admin_alert
from app.telegram.notifications import send_admin_notification


TASK_CHECK_INTERVAL_SECONDS = 90
QUEUE_HEALTH_CHECK_INTERVAL_SECONDS = 15 * 60
MAX_GENERATIONS_PER_SCHEDULER_RUN = 50
FIRST_POST_DELAY_MINUTES = 15
TREND_ANALYSIS_INTERVAL_DAYS = 3

scheduler = AsyncIOScheduler()
logger = logging.getLogger(__name__)
last_queue_alert_sent_at: datetime | None = None


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

    if not scheduler.get_job("check_queue_health"):
        scheduler.add_job(
            check_queue_health,
            trigger="interval",
            seconds=QUEUE_HEALTH_CHECK_INTERVAL_SECONDS,
            id="check_queue_health",
            max_instances=1,
            coalesce=True,
        )

    return scheduler


async def check_queue_health() -> None:
    global last_queue_alert_sent_at

    now = datetime.now(UTC)
    async with AsyncSessionLocal() as session:
        oldest_task = await session.scalar(
            select(PostingTask)
            .where(
                PostingTask.status == PostingTaskStatus.QUEUED,
                PostingTask.scheduled_at.is_not(None),
                PostingTask.scheduled_at <= now,
            )
            .order_by(PostingTask.scheduled_at.asc(), PostingTask.id.asc())
            .limit(1)
        )

    if oldest_task is None or oldest_task.scheduled_at is None:
        return

    scheduled_at = oldest_task.scheduled_at
    if scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=UTC)

    delay_minutes = int((now - scheduled_at).total_seconds() / 60)
    if delay_minutes < settings.queue_alert_delay_minutes:
        return

    if last_queue_alert_sent_at is not None:
        cooldown_until = last_queue_alert_sent_at + timedelta(minutes=settings.alert_cooldown_minutes)
        if now < cooldown_until:
            return

    text = (
        "⚠️ Внимание: Очередь прокси перегружена! "
        f"Самый старый пост задерживается на {delay_minutes} минут. "
        "Пора добавить новые порты."
    )
    await send_admin_alert(text)
    last_queue_alert_sent_at = now


async def analyze_daily_trends() -> None:
    async with AsyncSessionLocal() as session:
        projects = list(
            (
                await session.scalars(select(Project).where(Project.is_active.is_(True)).order_by(Project.id.asc()))
            ).all()
        )

        if not projects:
            logger.info("Daily trend analysis skipped: no active projects found.")
            return

        for project in projects:
            if project.owner_id is None:
                logger.info("Daily trend analysis skipped for project #%s: no owner.", project.id)
                continue

            try:
                existing_operation_id = await session.scalar(
                    select(ProjectOperation.id)
                    .where(
                        ProjectOperation.project_id == project.id,
                        ProjectOperation.action_type == ProjectOperationType.SCRAPING,
                        ProjectOperation.status.in_(
                            [ProjectOperationStatus.QUEUED, ProjectOperationStatus.RUNNING]
                        ),
                    )
                    .limit(1)
                )

                if existing_operation_id is not None:
                    logger.info("Daily trend analysis already queued/running for project #%s.", project.id)
                    continue

                session.add(
                    ProjectOperation(
                        project_id=project.id,
                        owner_id=project.owner_id,
                        action_type=ProjectOperationType.SCRAPING,
                        status=ProjectOperationStatus.QUEUED,
                        message="Scheduled trend scraping queued for the next safe proxy window.",
                    )
                )
                await session.commit()
                logger.info("Daily trend analysis queued for project #%s.", project.id)
            except Exception as exc:
                await session.rollback()
                await send_admin_notification(
                    f"Daily trend analysis queueing failed for project #{project.id}.\n\nError: {exc}"
                )


async def check_and_run_tasks() -> None:
    await ensure_account_based_queue()


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
            PostingTask.status.in_([PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS]),
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

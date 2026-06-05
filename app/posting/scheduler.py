from __future__ import annotations

import asyncio
import logging
import hashlib
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import HTTPException
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
    User,
)
from app.db.session import AsyncSessionLocal
from app.services.admin_notifier import send_admin_alert
from app.services.proxy_pool import build_threads_proxy_url_for_account
from app.telegram.notifications import send_admin_notification


TASK_CHECK_INTERVAL_SECONDS = 30 * 60
QUEUE_HEALTH_CHECK_INTERVAL_SECONDS = 15 * 60
PROXY_RECOVERY_INTERVAL_SECONDS = 5 * 60
SUBSCRIPTION_RECONCILE_INTERVAL_SECONDS = 15 * 60
MAX_GENERATIONS_PER_SCHEDULER_RUN = 50
FIRST_POST_DELAY_MINUTES = 15
TREND_ANALYSIS_INTERVAL_DAYS = 3
QUEUE_LOOKAHEAD_DAYS = 2
IP_CHECK_URL = "https://api.ipify.org"

scheduler = AsyncIOScheduler()
logger = logging.getLogger(__name__)
last_queue_alert_sent_at: datetime | None = None
account_queue_locks: dict[int, asyncio.Lock] = {}


def schedule_account_queue_refill(project_id: int, account_id: int) -> None:
    task = asyncio.create_task(ensure_account_queue(project_id, account_id))
    task.add_done_callback(_log_queue_refill_result)


def schedule_project_queue_refill(project_id: int) -> None:
    task = asyncio.create_task(ensure_project_queue(project_id))
    task.add_done_callback(_log_queue_refill_result)


def _log_queue_refill_result(task: asyncio.Task[int]) -> None:
    try:
        generated_count = task.result()
    except Exception:
        logger.exception("Event-driven queue refill failed.")
        return

    if generated_count:
        logger.info("Event-driven queue refill generated %s task(s).", generated_count)


def _get_account_queue_lock(account_id: int) -> asyncio.Lock:
    lock = account_queue_locks.get(account_id)
    if lock is None:
        lock = asyncio.Lock()
        account_queue_locks[account_id] = lock
    return lock


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

    if not scheduler.get_job("recover_proxy_error_accounts"):
        scheduler.add_job(
            recover_proxy_error_accounts,
            trigger="interval",
            seconds=PROXY_RECOVERY_INTERVAL_SECONDS,
            id="recover_proxy_error_accounts",
            max_instances=1,
            coalesce=True,
        )

    if not scheduler.get_job("reconcile_subscriptions"):
        scheduler.add_job(
            reconcile_subscriptions,
            trigger="interval",
            seconds=SUBSCRIPTION_RECONCILE_INTERVAL_SECONDS,
            id="reconcile_subscriptions",
            max_instances=1,
            coalesce=True,
        )

    return scheduler


async def reconcile_subscriptions() -> None:
    from app.services.subscriptions import reconcile_known_user_subscriptions
    from app.telegram.bot import get_bot

    bot = get_bot()
    if bot is None:
        logger.info("Subscription reconciliation skipped: Telegram bot is not configured.")
        return

    async with AsyncSessionLocal() as session:
        await reconcile_known_user_subscriptions(bot=bot, session=session)


async def recover_proxy_error_accounts() -> None:
    async with AsyncSessionLocal() as session:
        accounts = list(
            (
                await session.scalars(
                    select(Account)
                    .where(
                        Account.platform == Platform.THREADS,
                        Account.status == AccountStatus.PROXY_ERROR,
                        Account.assigned_port.is_not(None),
                    )
                    .order_by(Account.id.asc())
                )
            ).all()
        )

        for account in accounts:
            try:
                proxy_url = build_threads_proxy_url_for_account(account)
            except HTTPException as exc:
                logger.warning("Proxy auto-recovery skipped: base proxy config is invalid: %s", exc.detail)
                return

            if not proxy_url:
                continue

            try:
                recovered_ip = await _ping_proxy_ip(proxy_url)
            except Exception as exc:
                logger.info("Proxy for account %s is still unavailable: %s", account.id, exc)
                continue

            account.status = AccountStatus.ACTIVE
            account.proxy_error_count = 0
            account.last_error = None
            await session.commit()
            logger.info("Proxy for account %s recovered automatically. Current IP: %s", account.id, recovered_ip)


async def _ping_proxy_ip(proxy_url: str) -> str:
    async with httpx.AsyncClient(proxy=proxy_url, timeout=10.0) as client:
        response = await client.get(IP_CHECK_URL)
        response.raise_for_status()
        current_ip = response.text.strip()

    if not current_ip:
        raise RuntimeError("Empty ipify response from account proxy.")

    return current_ip


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
                await session.scalars(
                    select(Project)
                    .join(User, Project.owner_id == User.id)
                    .where(
                        Project.is_active.is_(True),
                        User.subscription_status.is_(True),
                    )
                    .order_by(Project.id.asc())
                )
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
                        message="Scheduled trend scraping queued for the next safe browser window.",
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
                    select(Project)
                    .join(User, Project.owner_id == User.id)
                    .where(
                        Project.is_active.is_(True),
                        User.subscription_status.is_(True),
                    )
                    .order_by(Project.id.asc())
                )
            ).all()
        )

        for project in projects:
            if not _is_project_in_active_window(project):
                continue

            accounts = await _get_project_posting_accounts(project.id, session)
            if not accounts:
                continue

            for account in accounts:
                async with _get_account_queue_lock(account.id):
                    generated_count += await _ensure_account_queue_for_project(
                        project=project,
                        account=account,
                        session=session,
                        remaining_generation_budget=MAX_GENERATIONS_PER_SCHEDULER_RUN - generated_count,
                    )
                if generated_count >= MAX_GENERATIONS_PER_SCHEDULER_RUN:
                    return


async def ensure_project_queue(project_id: int, *, generation_budget: int = MAX_GENERATIONS_PER_SCHEDULER_RUN) -> int:
    generated_count = 0

    async with AsyncSessionLocal() as session:
        project = await session.get(Project, project_id)
        if project is None or not project.is_active:
            return 0

        owner = await session.get(User, project.owner_id) if project.owner_id is not None else None
        if owner is None or not owner.subscription_status:
            return 0

        accounts = await _get_project_posting_accounts(project.id, session)
        for account in accounts:
            async with _get_account_queue_lock(account.id):
                generated_count += await _ensure_account_queue_for_project(
                    project=project,
                    account=account,
                    session=session,
                    remaining_generation_budget=generation_budget - generated_count,
                )
            if generated_count >= generation_budget:
                break

    return generated_count


async def ensure_account_queue(
    project_id: int,
    account_id: int,
    *,
    generation_budget: int | None = None,
) -> int:
    async with AsyncSessionLocal() as session:
        project = await session.get(Project, project_id)
        account = await session.get(Account, account_id)
        if project is None or account is None:
            return 0

        owner = await session.get(User, project.owner_id) if project.owner_id is not None else None
        if owner is None or not owner.subscription_status:
            return 0

        async with _get_account_queue_lock(account.id):
            return await _ensure_account_queue_for_project(
                project=project,
                account=account,
                session=session,
                remaining_generation_budget=generation_budget
                or _project_posts_per_day(project, owner.tariff_posts_per_day)
                * _user_queue_days(owner),
            )


async def _ensure_account_queue_for_project(
    *,
    project: Project,
    account: Account,
    session: AsyncSession,
    remaining_generation_budget: int,
) -> int:
    if remaining_generation_budget <= 0:
        return 0

    owner = await session.get(User, project.owner_id) if project.owner_id is not None else None
    if owner is None or not owner.subscription_status:
        return 0

    if (
        not project.is_active
        or account.project_id != project.id
        or account.status != AccountStatus.ACTIVE
        or account.platform != Platform.THREADS
        or account.assigned_port is None
    ):
        return 0

    queue_days = _user_queue_days(owner)
    account_posts_limit = _project_posts_per_day(project, owner.tariff_posts_per_day)
    account_queue_limit = account_posts_limit * queue_days
    account_upcoming_tasks = await _count_account_upcoming_tasks(project, account.id, session, queue_days=queue_days)
    if account_upcoming_tasks >= account_queue_limit:
        return 0

    generated_count = 0
    reserved_slots: list[datetime] = []
    missing_count = min(
        account_queue_limit - account_upcoming_tasks,
        remaining_generation_budget,
    )

    for offset in range(missing_count):
        scheduled_at = await _calculate_next_account_slot(
            project,
            account.id,
            session,
            reserved_slots=reserved_slots,
        )
        if scheduled_at is None:
            break

        try:
            post_number = account_upcoming_tasks + offset
            reserved_slots.append(scheduled_at)
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
        except Exception:
            await session.rollback()
            logger.exception(
                "Account-based generation failed for project #%s, account #%s.",
                project.id,
                account.id,
            )

    return generated_count


async def _calculate_next_account_slot_today(
    project: Project,
    account_id: int,
    session: AsyncSession,
    *,
    reserved_slots: list[datetime] | None = None,
    reference_utc: datetime | None = None,
) -> datetime | None:
    now = datetime.now(UTC)
    reference = reference_utc or now
    start_at, end_at = _project_active_window_bounds(project, reference)
    if end_at <= now:
        return None

    minimum_slot = max(now + timedelta(minutes=FIRST_POST_DELAY_MINUTES), start_at)
    posts_per_day = _project_posts_per_day(project)
    window_seconds = max(60, int((end_at - start_at).total_seconds()))
    slot_seconds = window_seconds / posts_per_day
    reserved = reserved_slots or []

    existing_slots = list(
        (
            await session.scalars(
                select(PostingTask.scheduled_at).where(
                    PostingTask.project_id == project.id,
                    PostingTask.account_id == account_id,
                    PostingTask.scheduled_at >= start_at,
                    PostingTask.scheduled_at < end_at,
                    PostingTask.status.not_in([PostingTaskStatus.FAILED, PostingTaskStatus.CANCELLED]),
                )
            )
        ).all()
    )

    for slot_index in range(posts_per_day):
        base_slot = start_at + timedelta(seconds=slot_seconds * (slot_index + 0.5))
        jitter_minutes = _stable_slot_jitter_minutes(project.id, account_id, start_at, slot_index)
        candidate = base_slot + timedelta(minutes=jitter_minutes)
        candidate = max(start_at + timedelta(minutes=1), min(candidate, end_at - timedelta(minutes=1)))

        if candidate < minimum_slot:
            continue

        if _is_slot_taken(candidate, [*existing_slots, *reserved]):
            continue

        return candidate

    return None


async def calculate_next_account_slot(
    project: Project,
    account_id: int,
    session: AsyncSession,
    *,
    days_ahead: int = 30,
) -> datetime:
    scheduled_at = await _calculate_next_account_slot(
        project,
        account_id,
        session,
        reserved_slots=[],
        days_ahead=days_ahead,
    )
    if scheduled_at is not None:
        return scheduled_at

    return _next_project_active_start(project, datetime.now(UTC) + timedelta(days=1))


async def _calculate_next_account_slot(
    project: Project,
    account_id: int,
    session: AsyncSession,
    *,
    reserved_slots: list[datetime],
    days_ahead: int = QUEUE_LOOKAHEAD_DAYS,
) -> datetime | None:
    now = datetime.now(UTC)
    for day_offset in range(days_ahead):
        scheduled_at = await _calculate_next_account_slot_today(
            project,
            account_id,
            session,
            reserved_slots=reserved_slots,
            reference_utc=now + timedelta(days=day_offset),
        )
        if scheduled_at is not None:
            return scheduled_at

    return None


def _stable_slot_jitter_minutes(project_id: int, account_id: int, day_start: datetime, slot_index: int) -> int:
    seed = f"{project_id}:{account_id}:{day_start.date().isoformat()}:{slot_index}".encode("utf-8")
    digest = hashlib.sha256(seed).digest()
    return int(digest[0] % 31) - 15


def _is_slot_taken(candidate: datetime, slots: list[datetime | None]) -> bool:
    min_gap = timedelta(minutes=20)
    for slot in slots:
        if slot is None:
            continue
        if slot.tzinfo is None:
            slot = slot.replace(tzinfo=UTC)
        if abs(candidate - slot) < min_gap:
            return True

    return False


async def _get_project_posting_accounts(project_id: int, session: AsyncSession) -> list[Account]:
    stmt = (
        select(Account)
        .join(User, Account.owner_id == User.id)
        .where(
            Account.project_id == project_id,
            Account.status == AccountStatus.ACTIVE,
            Account.platform == Platform.THREADS,
            Account.assigned_port.is_not(None),
            User.subscription_status.is_(True),
        )
        .order_by(Account.last_used_at.asc().nulls_first(), Account.id.asc())
    )
    return list((await session.scalars(stmt)).all())


async def _count_account_upcoming_tasks(
    project: Project,
    account_id: int,
    session: AsyncSession,
    *,
    queue_days: int = QUEUE_LOOKAHEAD_DAYS,
) -> int:
    start_at, _ = _project_day_bounds(project)
    _, end_at = _project_day_bounds(project, datetime.now(UTC) + timedelta(days=queue_days - 1))
    lower_bound = max(datetime.now(UTC), start_at)
    count = await session.scalar(
        select(func.count(PostingTask.id)).where(
            PostingTask.project_id == project.id,
            PostingTask.account_id == account_id,
            PostingTask.scheduled_at >= lower_bound,
            PostingTask.scheduled_at < end_at,
            PostingTask.status.not_in([PostingTaskStatus.FAILED, PostingTaskStatus.CANCELLED]),
        )
    )
    return count or 0


async def _count_account_success_today(project: Project, account_id: int, session: AsyncSession) -> int:
    start_at, end_at = _project_day_bounds(project)
    count = await session.scalar(
        select(func.count(PostingTask.id)).where(
            PostingTask.project_id == project.id,
            PostingTask.account_id == account_id,
            PostingTask.status.in_([PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS]),
            PostingTask.finished_at >= start_at,
            PostingTask.finished_at < end_at,
        )
    )
    return count or 0


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


def _project_posts_per_day(project: Project, tariff_limit: int | None = None) -> int:
    project_limit = min(20, max(1, int(project.posts_per_day or 3)))
    if tariff_limit is None or tariff_limit <= 0:
        return project_limit

    return min(project_limit, max(1, int(tariff_limit)))


def _user_queue_days(user: User) -> int:
    return max(1, int(user.tariff_queue_days or QUEUE_LOOKAHEAD_DAYS))


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
    engagement_mode = _build_engagement_mode(project, account, todays_count)
    parts = [
        f"Проект: {project.name}",
        f"Глобальный контекст проекта: {project_context}",
        f"Целевые действия проекта: {target_actions}",
        f"Ниша: {project.niche or 'не указана'}",
        f"Аудитория: {project.target_audience or 'не указана'}",
        f"Tone of Voice: {project.tone_of_voice or 'не указан'}",
        f"Аккаунт публикации: @{account.username}",
        f"Это пост #{todays_count + 1} из {project.posts_per_day} на сегодня для этого проекта.",
        f"Engagement mode for this exact post: {engagement_mode}",
        (
            "Сгенерируй самостоятельный Threads-пост для ближайшей публикации. "
            "Не повторяй предыдущие формулировки, опирайся на свежие тренды и описание проекта."
        ),
    ]
    parts.append(
        "Live-feed instruction: make this feel like a native Russian Threads post, not a product case study. "
        "Do not default to colleague/yesterday/pinned/profile/base/system/automation endings. "
        "Use a fresh micro-observation, tension, question, or quiet punchline. "
        "Do not blame the audience, customers, or users, and do not end with vague magic like 'now I just know'."
    )
    return "\n".join(parts)


def _build_engagement_mode(project: Project, account: Account, todays_count: int) -> str:
    modes = [
        (
            "discussion question: finish with a native question a tutor can answer from experience. "
            "No generic 'agree?' bait. The question must be about a concrete daily situation."
        ),
        (
            "tiny disagreement: make one slightly arguable statement about tutor admin work, "
            "then leave room for people to push back."
        ),
        (
            "useful micro-rule: give one small operational rule or boundary from tutor life. "
            "It must be practical, not motivational."
        ),
        (
            "relatable scene: show a small moment from the day and end with an unfinished thought "
            "that invites 'same' replies."
        ),
        (
            "anti-advice: start from something tutors are usually told to do, then gently question it "
            "through a concrete example."
        ),
        (
            "poll-like dilemma without poll UI: present two imperfect choices and ask how others handle it."
        ),
    ]
    seed = (project.id * 17 + account.id * 7 + todays_count) % len(modes)
    return modes[seed]

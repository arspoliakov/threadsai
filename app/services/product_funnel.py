"""Server-backed cumulative cohort milestones, without inferred revenue."""
from collections import Counter
from datetime import UTC, datetime, timedelta
from statistics import median
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings

from app.db.models import Account, PostingTask, PostingTaskStatus, Project, StudioDraft, TributeWebhookEvent, User
from app.services.project_workflow import account_connection_ready, build_project_workflow


STAGES = [
    ("registered", "Зарегистрировались"),
    ("trial_text", "Получили пробный текст"),
    ("project_created", "Создали проект"),
    ("account_connected", "Аккаунт готов сейчас"),
    ("confirmed_paid", "Есть подтверждённая оплата"),
    ("first_publication", "Опубликовали первый пост"),
    ("repeated_publication", "Публиковали в разные дни"),
]


def utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def excluded_analytics_user(user: User) -> bool:
    return bool((settings.admin_tg_id is not None and user.telegram_id == settings.admin_tg_id)
                or user.id in set(getattr(settings, "analytics_excluded_user_ids", [])))


def confirmed_payment_at(event: TributeWebhookEvent) -> datetime | None:
    payload = event.payload or {}
    nested = payload.get("payload")
    if event.status != "applied" or payload.get("name") not in {"new_subscription", "renewed_subscription"}:
        return None
    if not isinstance(nested, dict) or nested.get("type") != "regular":
        return None
    try:
        return utc(datetime.fromisoformat(str(payload["created_at"]).replace("Z", "+00:00")))
    except (KeyError, TypeError, ValueError):
        return utc(event.created_at)


def elapsed_median_hours(users: dict[int, User], dates: dict[int, datetime]) -> float | None:
    durations = [(utc(value) - utc(users[user_id].created_at)).total_seconds() / 3600
        for user_id, value in dates.items() if user_id in users and utc(value) >= utc(users[user_id].created_at)]
    return round(median(durations), 2) if durations else None


async def build_product_funnel(session: AsyncSession, *, days: int = 30, now: datetime | None = None) -> dict:
    reference = utc(now) or datetime.now(UTC)
    since = reference - timedelta(days=days) if days else None
    query = select(User).where(User.created_at <= reference)
    if since is not None:
        query = query.where(User.created_at >= since)
    candidates = list((await session.scalars(query)).all())
    users = {u.id: u for u in candidates if not excluded_analytics_user(u)}
    ids = list(users)
    telegram_users = {u.telegram_id: u.id for u in users.values() if u.telegram_id is not None}
    trials = list((await session.scalars(select(StudioDraft).where(StudioDraft.owner_id.in_(ids)))).all())
    projects = list((await session.scalars(select(Project).where(Project.owner_id.in_(ids)))).all())
    project_owners = {p.id: p.owner_id for p in projects}
    accounts = list((await session.scalars(select(Account).where(Account.owner_id.in_(ids)))).all())
    events = list((await session.scalars(select(TributeWebhookEvent).where(
        TributeWebhookEvent.telegram_id.in_(list(telegram_users)), TributeWebhookEvent.status == "applied"))).all())
    posts = list((await session.scalars(select(PostingTask).where(
        PostingTask.project_id.in_(list(project_owners)),
        PostingTask.status.in_([PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS]),
        PostingTask.finished_at.is_not(None)))).all())
    trial_dates = {}
    for draft in trials:
        at = utc(draft.created_at)
        if at <= reference:
            trial_dates[draft.owner_id] = min(trial_dates.get(draft.owner_id, at), at)
    paid_dates = {}
    for event in events:
        at = confirmed_payment_at(event)
        if at is not None and at <= reference:
            uid = telegram_users[event.telegram_id]
            paid_dates[uid] = min(paid_dates.get(uid, at), at)
    first_published = {}
    published_days = {}
    for post in posts:
        if (post.generation_metadata or {}).get("publication_confirmation_pending"):
            continue
        at = utc(post.finished_at)
        if at > reference:
            continue
        uid = project_owners[post.project_id]
        first_published[uid] = min(first_published.get(uid, at), at)
        published_days.setdefault(uid, set()).add(at.astimezone(ZoneInfo("Europe/Moscow")).date())
    reached = {
        "registered": set(ids), "trial_text": set(trial_dates),
        "project_created": {p.owner_id for p in projects if utc(p.created_at) <= reference},
        "account_connected": {a.owner_id for a in accounts if account_connection_ready(a)},
        "confirmed_paid": set(paid_dates), "first_publication": set(first_published),
        "repeated_publication": {uid for uid, dates in published_days.items() if len(dates) >= 2},
    }
    blocker_counts = Counter()
    blocker_messages = {}
    for project in projects:
        if not project.is_active:
            continue
        workflow = await build_project_workflow(project, session)
        for blocker in workflow.blockers:
            blocker_counts[blocker.code] += 1
            blocker_messages[blocker.code] = blocker.message
    denominator = len(users)
    return {
        "checked_at": reference,
        "cohort": {"days": days, "registered_since": since, "users": denominator,
                   "excluded_users": len(candidates) - denominator},
        "stages": [{"key": key, "label": label, "users": len(reached[key]),
                    "percent_of_cohort": round(len(reached[key]) * 100 / denominator, 1) if denominator else 0}
                   for key, label in STAGES],
        "timings": {"registration_to_trial_median_hours": elapsed_median_hours(users, trial_dates),
                    "registration_to_publication_median_hours": elapsed_median_hours(users, first_published)},
        "paid_without_publication": len(set(paid_dates) - set(first_published)),
        "blockers": [{"code": code, "message": blocker_messages[code], "projects": count}
                     for code, count in blocker_counts.most_common()],
        "notes": [
            "Владелец сервиса и тестовые ID из настройки исключены из этой когорты.",
            "Этапы накопительные: все доли считаются от зарегистрированных пользователей выбранной когорты, порядок действий может различаться.",
            "Для когорты 7 или 30 дней учитываются пользователи, зарегистрированные в этот период, и их действия до момента проверки.",
            "Подключение показывает текущее состояние сохранённых настроек, без сетевой проверки Threads или прокси.",
            "Оплаты учитываются только по применённым regular-событиям Tribute; старые оплаты до подключения webhook могут отсутствовать. Это не отчёт о выручке.",
            "Удалённые проекты, тексты и посты могут отсутствовать в истории. Повторное использование означает подтверждённые публикации в два разных дня по Москве.",
            "Причины остановки считаются по активным проектам этой когорты; один проект может иметь несколько причин.",
        ],
    }

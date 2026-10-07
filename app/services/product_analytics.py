"""Observed activation and publication activity; no inferred financial amounts."""
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
import re
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PostingTask, PostingTaskStatus, Project, TributeWebhookEvent, User
from app.services.product_funnel import confirmed_payment_at, excluded_analytics_user, utc


def attribution_source(user: User) -> tuple[str, str]:
    # Only the acquisition source is returned. Never expose referrer paths,
    # query strings, campaign content, visitor IDs or analytics identifiers.
    values = user.first_utm_json if isinstance(user.first_utm_json, dict) else {}
    source = str(values.get("utm_source") or "").strip().lower()
    if source and len(source) <= 80 and source[0].isalnum() and all(
            character.isalnum() or character in "_. -" for character in source):
        return "utm:" + source, source
    try:
        raw = user.first_referrer or ""
        parsed = urlsplit(raw)
        host = (parsed.hostname or "").lower().removeprefix("www.")
        if parsed.scheme in {"https", "http"} and re.fullmatch(r"[a-z0-9.-]{1,253}", host):
            if host != "threadsgo.ru" and not host.endswith(".threadsgo.ru") and host not in {
                    "oauth.yandex.ru", "passport.yandex.ru", "login.yandex.ru", "oauth.telegram.org", "accounts.google.com"}:
                return "referrer:" + host, host
    except ValueError:
        pass
    return "unknown", "Источник не записан"


def publication_retention(users: list[User], published_at: dict[int, list[datetime]], *, day: int,
                          reference: datetime, history_available: bool) -> dict:
    eligible = [u for u in users if utc(u.created_at) + timedelta(days=day + 1) <= reference]
    retained = sum(any(utc(u.created_at) + timedelta(days=day) <= at < utc(u.created_at) + timedelta(days=day + 1)
                       for at in published_at.get(u.id, [])) for u in eligible)
    denominator = len(eligible)
    return {"day": day, "eligible_users": denominator, "retained_users": retained,
        "rate_percent": round(retained * 100 / denominator, 1) if denominator and history_available else None,
        "status": "window_not_elapsed" if not denominator else "observed" if history_available else "no_publication_history",
        "window": f"registration+{day}d <= publication < registration+{day + 1}d"}


async def build_product_analytics(session: AsyncSession, *, days: int = 30,
                                  now: datetime | None = None) -> dict:
    reference = utc(now) or datetime.now(UTC)
    since = reference - timedelta(days=days) if days else None
    query = select(User).where(User.created_at <= reference)
    if since is not None:
        query = query.where(User.created_at >= since)
    candidate_users = list((await session.scalars(query)).all())
    users = [u for u in candidate_users if not excluded_analytics_user(u)]
    ids = [u.id for u in users]
    by_telegram = {u.telegram_id: u.id for u in users if u.telegram_id is not None}
    projects = dict((await session.execute(select(Project.id, Project.owner_id).where(Project.owner_id.in_(ids)))).all())
    events = list((await session.scalars(select(TributeWebhookEvent).where(
        TributeWebhookEvent.telegram_id.in_(list(by_telegram))))).all())
    publications = list((await session.scalars(select(PostingTask).where(
        PostingTask.project_id.in_(list(projects)),
        PostingTask.status.in_([PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS]),
        PostingTask.finished_at.is_not(None)))).all())
    published_at = defaultdict(list)
    for post in publications:
        at = utc(post.finished_at)
        if at <= reference and not (post.generation_metadata or {}).get("publication_confirmation_pending"):
            published_at[projects[post.project_id]].append(at)
    payment_counts = Counter()
    renewal_users = set()
    payment_dates = []
    amount_currency_present = 0
    for event in events:
        at = confirmed_payment_at(event)
        if at is None or at > reference:
            continue
        uid = by_telegram[event.telegram_id]
        payment_counts[uid] += 1
        payment_dates.append(at)
        if event.payload.get("name") == "renewed_subscription":
            renewal_users.add(uid)
        nested = event.payload.get("payload") or {}
        if nested.get("amount") is not None and nested.get("currency"):
            amount_currency_present += 1
    grouped = {}
    for user in users:
        key, label = attribution_source(user)
        bucket = grouped.setdefault(key, {"key": key, "label": label, "registered": 0,
            "confirmed_paid_users": 0, "confirmed_payment_events": 0,
            "repeat_paid_users": 0, "published_users": 0})
        bucket["registered"] += 1
        bucket["confirmed_paid_users"] += int(payment_counts[user.id] > 0)
        bucket["confirmed_payment_events"] += payment_counts[user.id]
        bucket["repeat_paid_users"] += int(payment_counts[user.id] >= 2)
        bucket["published_users"] += int(bool(published_at.get(user.id)))
    sources = sorted(grouped.values(), key=lambda row: (-row["registered"], row["key"]))
    unknown = grouped.get("unknown", {}).get("registered", 0)
    all_published_dates = [at for dates in published_at.values() for at in dates]
    retention = [publication_retention(users, published_at, day=day, reference=reference,
                                      history_available=bool(all_published_dates)) for day in (7, 30)]
    return {
        "checked_at": reference,
        "cohort": {"days": days, "registered_since": since, "users": len(users),
                   "excluded_users": len(candidate_users) - len(users)},
        "sources": sources,
        "payments": {"confirmed_events": sum(payment_counts.values()), "paying_users": len(payment_counts),
            "repeat_paid_users": sum(count >= 2 for count in payment_counts.values()),
            "users_with_renewal_event": len(renewal_users),
            "revenue": None, "revenue_status": "amount_units_unconfirmed" if amount_currency_present else "no_verified_amounts",
            "events_with_amount_currency": amount_currency_present,
            "history_status": "partial_event_history" if payment_dates else "no_confirmed_payment_events"},
        "retention": retention,
        "economics": {"cac": None, "cac_status": "advertising_costs_not_recorded",
                      "ltv": None, "ltv_status": "verified_revenue_and_complete_history_required"},
        "coverage": {"attributed_users": len(users) - unknown, "unknown_source_users": unknown,
            "payment_history_started_at": min(payment_dates) if payment_dates else None,
            "publication_history_started_at": min(all_published_dates) if all_published_dates else None},
        "notes": [
            "Владелец сервиса и тестовые ID из настройки исключены. Период выбирает дату регистрации, действия учитываются до момента проверки.",
            "Источники берутся из сохранённого utm_source или домена первой внешней ссылки. Отсутствие источника не означает прямой заход; это не атрибуция Яндекс Метрики.",
            "Оплаты — наблюдаемые применённые regular-события Tribute. Trial, gift, отмены и необработанные события исключены. Пустая история не означает отсутствие реальных оплат.",
            "Событие renewed_subscription после пробного периода может быть первой оплатой. Повторная оплата требует как минимум двух regular-событий одного пользователя.",
            "Сумма платежа не выводится без проверенных amount/currency и документированных единиц. Размер тарифа не используется как выручка; возвраты и комиссии здесь не учитываются.",
            "D7/D30 показывают подтверждённые публикации в 24-часовом окне после 7/30 суток от регистрации, а не личное возвращение пользователя на сайт. Учитываются только пользователи, у которых окно полностью закончилось.",
            "Удалённые проекты и публикации, а также данные до начала записи могут отсутствовать. Автоматическая публикация отражает работу сервиса, а не активность человека.",
        ],
    }

"""Opt-in only campaigns. Ambiguous Telegram sends are never retried blindly."""
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo
import re

from sqlalchemy import func, select, update
from sqlalchemy.dialects.sqlite import insert

from app.db.models import (User, Project, Account, Platform, PostingTask, PostingTaskStatus, RetentionBotContact,
                           RetentionSettings, RetentionCampaign, RetentionDelivery, RetentionConsentEvent)
from app.services.subscriptions import has_current_subscription_access

CONSENT_VERSION = "2026-10-03"
RULES = [
    {"key": "no_project_3d", "segment": "no_project", "days": 3, "message": "Привет! Хотите начать с ThreadsGo, но пока не знаете, что указать в проекте?\n\nСоздайте проект и коротко опишите, о чём хотите писать и для кого. Помощник в кабинете поможет сформулировать глобальный промпт — готовить его самостоятельно необязательно.\n\nНачать: https://threadsgo.ru/app/\nЕсли нужна помощь: https://t.me/cuartenlol"},
    {"key": "no_account_2d", "segment": "no_account", "days": 2, "message": "Проект в ThreadsGo уже создан — следующий шаг: подключить свой аккаунт Threads.\n\nОткройте проект → «Аккаунты» и выберите подключение. Если появляется проверка входа, пройдите её в окне подключения. Пароль или код подтверждения в переписку присылать не нужно.\n\nКабинет: https://threadsgo.ru/app/\nЕсли подключение не получается, поможем: https://t.me/cuartenlol"},
    {"key": "no_first_post_7d", "segment": "connected_no_first_post", "days": 7, "message": "Готовы попробовать первый пост в ThreadsGo? У вас уже есть проект и подключённый аккаунт, но первой публикации пока нет.\n\nОткройте проект, проверьте статус аккаунта и подготовьте один черновик. Прочитайте текст, при необходимости поправьте его и выберите время публикации. Начать можно с одного поста.\n\nКабинет: https://threadsgo.ru/app/\nЕсли что-то мешает старту: https://t.me/cuartenlol"},
]


def utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


async def get_settings(db):
    setting = await db.get(RetentionSettings, 1)
    if setting is None:
        await db.execute(insert(RetentionSettings).values(id=1, sending_enabled=False, automated_enabled=False).on_conflict_do_nothing())
        await db.flush()
        setting = await db.get(RetentionSettings, 1)
    return setting


async def note_bot_contact(session, telegram_id):
    await session.execute(insert(RetentionBotContact).values(telegram_id=telegram_id, reachable=True, blocked=False)
        .on_conflict_do_update(index_elements=["telegram_id"], set_={"reachable": True, "blocked": False, "updated_at": datetime.now(UTC)}))
    await session.commit()


async def note_bot_blocked(session, telegram_id):
    await session.execute(insert(RetentionBotContact).values(telegram_id=telegram_id, reachable=False, blocked=True)
        .on_conflict_do_update(index_elements=["telegram_id"], set_={"reachable": False, "blocked": True, "updated_at": datetime.now(UTC)}))
    await session.commit()


async def unsubscribe_user(session, telegram_id):
    user = await session.scalar(select(User).where(User.telegram_id == telegram_id))
    if user:
        user.marketing_consent = False
        user.onboarding_consent = False
        user.retention_consent_updated_at = datetime.now(UTC)
        session.add(RetentionConsentEvent(user_id=user.id, marketing_consent=False, onboarding_consent=False,
            version=CONSENT_VERSION, source="telegram_unsubscribe"))
        await session.execute(update(RetentionDelivery).where(RetentionDelivery.user_id == user.id,
            RetentionDelivery.status == "queued").values(status="cancelled", error_code="opt_out"))
    await session.commit()


async def preferences(db, user):
    from app.core.config import settings
    contact = await db.get(RetentionBotContact, user.telegram_id, populate_existing=True) if user.telegram_id else None
    consent = await db.scalar(select(RetentionConsentEvent).where(RetentionConsentEvent.user_id == user.id)
        .order_by(RetentionConsentEvent.id.desc()).limit(1))
    username = settings.telegram_bot_username.strip().lstrip("@")
    return {"marketing_consent": user.marketing_consent, "onboarding_consent": user.onboarding_consent,
            "bot_reachable": bool(contact and contact.reachable and not contact.blocked),
            "bot_blocked": bool(contact and contact.blocked), "consent_version": consent.version if consent else None,
            "consent_updated_at": user.retention_consent_updated_at,
            "bot_url": f"https://t.me/{username}?start=retention" if re.fullmatch(r"[A-Za-z0-9_]+", username) else None}


async def in_segment(db, user, segment, now):
    projects = list((await db.scalars(select(Project).where(Project.owner_id == user.id))).all())
    if segment == "all":
        return True
    if segment == "active_subscribers":
        return has_current_subscription_access(user)
    if segment == "no_project":
        return not projects
    if segment in {"no_account", "connected_no_first_post"}:
        if not projects:
            return False
        connected = await db.scalar(select(Account.id).where(Account.project_id.in_([p.id for p in projects]), Account.platform == Platform.THREADS).limit(1))
        if segment == "no_account":
            published = await db.scalar(select(PostingTask.id).where(PostingTask.project_id.in_([p.id for p in projects]),
                PostingTask.status.in_([PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS])).limit(1))
            return connected is None and published is None
        if connected is None:
            return False
    if segment in {"no_first_post", "connected_no_first_post"}:
        if not projects:
            return False
        posted = await db.scalar(select(PostingTask.id).where(PostingTask.project_id.in_([p.id for p in projects]),
            PostingTask.status.in_([PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS])).limit(1))
        return posted is None
    return False


async def eligible(db, user, kind, segment="all", now=None, check_caps=True):
    now = now or datetime.now(UTC)
    if not user.telegram_id or not (user.marketing_consent if kind == "marketing" else user.onboarding_consent):
        return False
    contact = await db.get(RetentionBotContact, user.telegram_id, populate_existing=True)
    if not contact or not contact.reachable or contact.blocked or not await in_segment(db, user, segment, now):
        return False
    if check_caps:
        # Uncertain sends count as delivered for caps; they might have reached Telegram.
        recent = list((await db.scalars(select(RetentionDelivery).where(RetentionDelivery.user_id == user.id,
            RetentionDelivery.status.in_(["sent", "sending", "uncertain"]),
            RetentionDelivery.attempted_at >= now - timedelta(days=30)))).all())
        if len(recent) >= 3 or sum(utc(d.attempted_at) > now - timedelta(days=7) for d in recent) >= 2 or any(utc(d.attempted_at) > now - timedelta(hours=72) for d in recent):
            return False
    return True


async def preview(db, segment, kind, now=None):
    users = list((await db.scalars(select(User))).all())
    ids = [u.id for u in users if await eligible(db, u, kind, segment, now)]
    return ids, len(users) - len(ids)


async def create_campaign(db, *, title, message, segment, kind, request_key):
    existing = await db.scalar(select(RetentionCampaign).where(RetentionCampaign.request_key == request_key))
    if existing:
        return existing
    ids, _ = await preview(db, segment, kind)
    result = await db.execute(insert(RetentionCampaign).values(title=title, message=message, segment=segment, kind=kind,
        request_key=request_key, recipient_count=len(ids), status="queued" if ids else "completed")
        .on_conflict_do_nothing(index_elements=["request_key"]))
    campaign = await db.scalar(select(RetentionCampaign).where(RetentionCampaign.request_key == request_key))
    if not result.rowcount:
        return campaign
    now = datetime.now(UTC)
    for user_id in ids:
        await db.execute(insert(RetentionDelivery).values(user_id=user_id, campaign_id=campaign.id, dedupe_key=f"campaign:{campaign.id}:{user_id}",
            kind=kind, message=message, status="queued", due_at=now).on_conflict_do_nothing(index_elements=["dedupe_key"]))
    await db.commit()
    return campaign


async def plan_automatic(db, now=None):
    config = await get_settings(db)
    if not config.sending_enabled or not config.automated_enabled:
        return 0
    now = now or datetime.now(UTC)
    added = 0
    users = list((await db.scalars(select(User).where(User.onboarding_consent.is_(True)))).all())
    for user in users:
        for rule in RULES:
            segment = rule["segment"]
            if not await eligible(db, user, "onboarding", segment, now):
                continue
            origin = utc(user.created_at)
            if segment != "no_project":
                origin = utc(await db.scalar(select(func.min(Project.created_at)).where(Project.owner_id == user.id)))
            # Do not mass-message a years-old dormant database on first activation.
            if not (timedelta(days=rule["days"]) <= now - origin <= timedelta(days=30)):
                continue
            result = await db.execute(insert(RetentionDelivery).values(user_id=user.id, rule_key=rule["key"],
                dedupe_key=f"auto:{rule['key']}:{user.id}", kind="onboarding", message=rule["message"], status="queued", due_at=now)
                .on_conflict_do_nothing(index_elements=["dedupe_key"]))
            added += result.rowcount
    await db.commit()
    return added


async def process_deliveries(db, bot, now=None):
    from aiogram.exceptions import TelegramForbiddenError, TelegramRetryAfter, TelegramBadRequest
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
    config = await get_settings(db)
    if not config.sending_enabled or bot is None:
        return 0
    now = now or datetime.now(UTC)
    # Crash recovery cannot determine whether an API request reached Telegram.
    await db.execute(update(RetentionDelivery).where(RetentionDelivery.status == "sending",
        RetentionDelivery.attempted_at < now - timedelta(minutes=10)).values(status="uncertain", error_code="interrupted"))
    await db.commit()
    # Fixed Moscow quiet hours, disclosed in admin interface.
    if not 10 <= now.astimezone(ZoneInfo("Europe/Moscow")).hour < 20:
        return 0
    deliveries = list((await db.scalars(select(RetentionDelivery).where(RetentionDelivery.status == "queued",
        RetentionDelivery.due_at <= now).order_by(RetentionDelivery.id).limit(20))).all())
    sent = 0
    for delivery in deliveries:
        config = await db.get(RetentionSettings, 1, populate_existing=True)
        if not config.sending_enabled:
            break
        user = await db.get(User, delivery.user_id, populate_existing=True)
        campaign = await db.get(RetentionCampaign, delivery.campaign_id, populate_existing=True) if delivery.campaign_id else None
        rule = next((r for r in RULES if r["key"] == delivery.rule_key), None)
        segment = campaign.segment if campaign else (rule["segment"] if rule else "unknown_rule")
        if (campaign and campaign.status == "cancelled") or now - utc(delivery.created_at) > timedelta(days=7) or (delivery.rule_key and not config.automated_enabled) or not user or not await eligible(db, user, delivery.kind, segment, now, check_caps=False):
            delivery.status, delivery.error_code = "cancelled", "no_longer_eligible"
            await db.commit()
            continue
        if not await eligible(db, user, delivery.kind, segment, now):
            delivery.due_at = now + timedelta(hours=24)
            await db.commit()
            continue
        claim = await db.execute(update(RetentionDelivery).where(RetentionDelivery.id == delivery.id,
            RetentionDelivery.status == "queued").values(status="sending", attempted_at=now))
        await db.commit()
        if not claim.rowcount:
            continue
        user = await db.get(User, delivery.user_id, populate_existing=True)
        if not user or not await eligible(db, user, delivery.kind, segment, now, check_caps=False):
            delivery.status, delivery.error_code = "cancelled", "opt_out_before_send"
            await db.commit()
            continue
        try:
            result = await bot.send_message(user.telegram_id, delivery.message, parse_mode=None,
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Отключить рассылки", callback_data="retention:unsubscribe")]]))
            delivery.status, delivery.sent_at, delivery.telegram_message_id = "sent", now, result.message_id
            sent += 1
        except TelegramForbiddenError:
            delivery.status, delivery.error_code = "failed", "bot_blocked"
            await note_bot_blocked(db, user.telegram_id)
        except TelegramRetryAfter as exc:
            delivery.status, delivery.error_code = "queued", "rate_limited"
            delivery.due_at = now + timedelta(seconds=exc.retry_after + 5)
            delivery.attempted_at = None
            await db.commit()
            break
        except TelegramBadRequest:
            delivery.status, delivery.error_code = "failed", "telegram_bad_request"
        except Exception:
            delivery.status, delivery.error_code = "uncertain", "send_outcome_unknown"
        await db.commit()
    campaigns = list((await db.scalars(select(RetentionCampaign).where(RetentionCampaign.status == "queued"))).all())
    for campaign in campaigns:
        pending = await db.scalar(select(RetentionDelivery.id).where(RetentionDelivery.campaign_id == campaign.id,
            RetentionDelivery.status.in_(["queued", "sending"])).limit(1))
        if pending is None:
            campaign.status = "completed"
    await db.commit()
    return sent


async def retention_tick():
    from app.db.session import AsyncSessionLocal
    from app.telegram.bot import get_bot
    async with AsyncSessionLocal() as db:
        config = await get_settings(db)
        if not config.sending_enabled:
            return
        await plan_automatic(db)
        await process_deliveries(db, get_bot())

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import (
    Project,
    ProjectOperation,
    ProjectOperationStatus,
    PostingTask,
    PostingTaskStatus,
    User,
)


logger = logging.getLogger(__name__)


ACTIVE_CHAT_MEMBER_STATUSES = {"creator", "administrator", "member"}


@dataclass(frozen=True, slots=True)
class TariffLimits:
    name: str
    accounts: int
    posts: int
    projects: int
    queue_days: int


@dataclass(frozen=True, slots=True)
class TariffMembershipCheck:
    active_tariff: TariffLimits | None
    checked_chats_count: int


def get_tariff_chats() -> dict[int, TariffLimits]:
    tariff_chats: dict[int, TariffLimits] = {}

    for raw_chat_id, raw_limits in settings.tariff_chats.items():
        chat_id = int(raw_chat_id)
        limits: dict[str, Any] = dict(raw_limits)
        tariff_chats[chat_id] = TariffLimits(
            name=str(limits.get("name") or "none"),
            accounts=int(limits.get("accounts") or 0),
            posts=int(limits.get("posts") or 0),
            projects=int(limits.get("projects") or 0),
            queue_days=int(limits.get("queue_days") or 0),
        )

    return tariff_chats


def get_tariff_for_chat(chat_id: int) -> TariffLimits | None:
    return get_tariff_chats().get(int(chat_id))


async def activate_user_subscription(
    *,
    telegram_id: int,
    chat_id: int,
    session: AsyncSession,
) -> bool:
    tariff = get_tariff_for_chat(chat_id)
    if tariff is None:
        logger.info("Ignoring subscription join from untracked chat_id=%s.", chat_id)
        return False

    user = await session.scalar(select(User).where(User.telegram_id == telegram_id).limit(1))
    if user is None:
        logger.info("Tribute join ignored because telegram_id=%s is not registered yet.", telegram_id)
        return False

    _apply_tariff(user, tariff)
    await session.commit()
    logger.info("Subscription activated for user_id=%s telegram_id=%s plan=%s.", user.id, telegram_id, tariff.name)
    return True


async def handle_user_left_tariff_chat(
    *,
    bot: Bot,
    telegram_id: int,
    left_chat_id: int,
    session: AsyncSession,
) -> bool:
    if get_tariff_for_chat(left_chat_id) is None:
        logger.info("Ignoring subscription leave from untracked chat_id=%s.", left_chat_id)
        return False

    user = await session.scalar(select(User).where(User.telegram_id == telegram_id).limit(1))
    if user is None:
        logger.info("Tribute leave ignored because telegram_id=%s is not registered yet.", telegram_id)
        return False

    membership_check = await check_tariff_membership_for_user(bot=bot, telegram_id=telegram_id)
    active_tariff = membership_check.active_tariff
    if active_tariff is not None:
        _apply_tariff(user, active_tariff)
        await session.commit()
        logger.info(
            "Subscription leave ignored for user_id=%s telegram_id=%s because another tariff is active: %s.",
            user.id,
            telegram_id,
            active_tariff.name,
        )
        return False

    if membership_check.checked_chats_count == 0:
        logger.warning(
            "Subscription leave for user_id=%s telegram_id=%s was not applied: no tariff chats could be checked.",
            user.id,
            telegram_id,
        )
        return False

    await disable_user_subscription(user=user, session=session)
    logger.info("Subscription disabled for user_id=%s telegram_id=%s.", user.id, telegram_id)
    return True


async def find_active_tariff_for_user(*, bot: Bot, telegram_id: int) -> TariffLimits | None:
    return (await check_tariff_membership_for_user(bot=bot, telegram_id=telegram_id)).active_tariff


async def sync_user_subscription_after_login(
    *,
    bot: Bot,
    user: User,
    session: AsyncSession,
) -> bool:
    """Immediately recover a Tribute subscription whose join event arrived before registration."""
    if user.telegram_id is None or user.subscription_status:
        return user.subscription_status

    membership_check = await check_tariff_membership_for_user(
        bot=bot,
        telegram_id=user.telegram_id,
    )
    if membership_check.active_tariff is None:
        return False

    _apply_tariff(user, membership_check.active_tariff)
    await session.commit()
    await session.refresh(user)
    logger.info(
        "Subscription synchronized during login for user_id=%s telegram_id=%s plan=%s.",
        user.id,
        user.telegram_id,
        user.tariff_plan,
    )
    return True


async def refresh_user_subscription(
    *,
    bot: Bot,
    user: User,
    session: AsyncSession,
) -> bool:
    if user.telegram_id is None:
        return False

    membership_check = await check_tariff_membership_for_user(
        bot=bot,
        telegram_id=user.telegram_id,
    )
    if membership_check.active_tariff is not None:
        _apply_tariff(user, membership_check.active_tariff)
        await session.commit()
        await session.refresh(user)
        return True

    if membership_check.checked_chats_count == 0:
        logger.warning(
            "Manual subscription refresh skipped user_id=%s: no tariff chats could be checked.",
            user.id,
        )
        return user.subscription_status

    if user.subscription_status:
        await disable_user_subscription(user=user, session=session)
        await session.refresh(user)
    return False


async def check_tariff_membership_for_user(*, bot: Bot, telegram_id: int) -> TariffMembershipCheck:
    active_tariffs: list[TariffLimits] = []
    checked_chats_count = 0

    for chat_id, tariff in get_tariff_chats().items():
        try:
            member = await bot.get_chat_member(chat_id=chat_id, user_id=telegram_id)
        except TelegramAPIError as exc:
            logger.warning(
                "Could not check membership for telegram_id=%s in tariff chat %s: %s",
                telegram_id,
                chat_id,
                exc,
            )
            continue

        checked_chats_count += 1
        if _is_active_member(member):
            active_tariffs.append(tariff)

    if not active_tariffs:
        return TariffMembershipCheck(active_tariff=None, checked_chats_count=checked_chats_count)

    return TariffMembershipCheck(
        active_tariff=max(active_tariffs, key=_tariff_priority),
        checked_chats_count=checked_chats_count,
    )


async def reconcile_known_user_subscriptions(*, bot: Bot, session: AsyncSession) -> int:
    users = list(
        (
            await session.scalars(
                select(User)
                .where(User.telegram_id.is_not(None))
                .order_by(User.id.asc())
            )
        ).all()
    )
    changed_count = 0

    for user in users:
        if user.telegram_id is None:
            continue

        membership_check = await check_tariff_membership_for_user(bot=bot, telegram_id=user.telegram_id)
        active_tariff = membership_check.active_tariff
        if active_tariff is not None:
            previous_state = _user_subscription_snapshot(user)
            _apply_tariff(user, active_tariff)
            if previous_state != _user_subscription_snapshot(user):
                changed_count += 1
            continue

        if membership_check.checked_chats_count == 0:
            logger.warning(
                "Subscription reconciliation skipped user_id=%s telegram_id=%s: no tariff chats could be checked.",
                user.id,
                user.telegram_id,
            )
            continue

        if user.subscription_status:
            await disable_user_subscription(user=user, session=session)
            changed_count += 1

    await session.commit()
    if changed_count:
        logger.info("Subscription reconciliation changed %s user(s).", changed_count)

    return changed_count


async def disable_user_subscription(*, user: User, session: AsyncSession) -> None:
    user.subscription_status = False
    user.tariff_plan = "none"
    user.tariff_accounts_limit = 0
    user.tariff_posts_per_day = 0
    user.tariff_projects_limit = 0
    user.tariff_queue_days = 0

    project_ids = list(
        (
            await session.scalars(
                select(Project.id).where(Project.owner_id == user.id)
            )
        ).all()
    )

    if project_ids:
        await session.execute(
            update(PostingTask)
            .where(
                PostingTask.project_id.in_(project_ids),
                PostingTask.status.in_([PostingTaskStatus.QUEUED, PostingTaskStatus.RUNNING]),
            )
            .values(
                status=PostingTaskStatus.CANCELLED,
                started_at=None,
                finished_at=None,
                error_message="Subscription is inactive. Posting paused.",
            )
        )
        await session.execute(
            update(ProjectOperation)
            .where(
                ProjectOperation.project_id.in_(project_ids),
                ProjectOperation.status.in_([ProjectOperationStatus.QUEUED, ProjectOperationStatus.RUNNING]),
            )
            .values(
                status=ProjectOperationStatus.FAILED,
                message="Subscription is inactive. Operation paused.",
            )
        )

    await session.commit()


def _apply_tariff(user: User, tariff: TariffLimits) -> None:
    user.subscription_status = True
    user.tariff_plan = tariff.name
    user.tariff_accounts_limit = tariff.accounts
    user.tariff_posts_per_day = tariff.posts
    user.tariff_projects_limit = tariff.projects
    user.tariff_queue_days = tariff.queue_days


def _user_subscription_snapshot(user: User) -> tuple[bool, str, int, int, int, int]:
    return (
        user.subscription_status,
        user.tariff_plan,
        user.tariff_accounts_limit,
        user.tariff_posts_per_day,
        user.tariff_projects_limit,
        user.tariff_queue_days,
    )


def _is_active_member(member: Any) -> bool:
    raw_status = getattr(member, "status", "")
    status = str(getattr(raw_status, "value", raw_status))
    if status in ACTIVE_CHAT_MEMBER_STATUSES:
        return True

    if status == "restricted":
        return bool(getattr(member, "is_member", False))

    return False


def _tariff_priority(tariff: TariffLimits) -> tuple[int, int, int, int]:
    return (tariff.accounts, tariff.projects, tariff.posts, tariff.queue_days)

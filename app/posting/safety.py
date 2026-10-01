"""Conservative scheduling limits; these are not guarantees against Meta restrictions."""
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Account, PostingTask, PostingTaskStatus


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def extend_cooldown(account: Account, until: datetime) -> None:
    if account.cooldown_until is None or as_utc(account.cooldown_until) < until:
        account.cooldown_until = until


async def next_safe_publish_at(account: Account, daily_limit: int, session: AsyncSession, now: datetime, *, incoming_actions: int = 1) -> datetime:
    safe_at = now
    if account.cooldown_until is not None:
        safe_at = max(safe_at, as_utc(account.cooldown_until))
    recent = list((await session.scalars(
        select(PostingTask).where(
            PostingTask.account_id == account.id,
            PostingTask.status.in_([PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS]),
            PostingTask.finished_at > now - timedelta(days=1),
        ).order_by(PostingTask.finished_at.asc())
    )).all())
    if recent:
        safe_at = max(safe_at, as_utc(recent[-1].finished_at) + timedelta(minutes=settings.posting_min_interval_minutes))
    # A chain consumes one action for every submitted item. Unknown results also
    # consume budget conservatively, so lack of confirmation never permits a burst.
    actions = []
    for task in recent:
        metadata = task.generation_metadata or {}
        count = len(task.posts_chain or []) or 1
        if task.status == PostingTaskStatus.PARTIAL_SUCCESS:
            count = int(metadata.get("published_chain_items") or count)
        actions.extend([as_utc(task.finished_at)] * count)
    limit = max(1, daily_limit)
    permitted_existing = max(0, limit - incoming_actions)
    if len(actions) > permitted_existing:
        safe_at = max(safe_at, actions[-permitted_existing - 1] + timedelta(days=1))
    return safe_at

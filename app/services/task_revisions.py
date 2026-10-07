"""Version saved content in the same transaction as the edit, without publishing."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import PostingTaskRevision


async def record_content_revision(db: AsyncSession, task_id: int, owner_id: int,
                                  before: list[str], after: list[str], reason: str) -> None:
    latest = await db.scalar(select(PostingTaskRevision).where(
        PostingTaskRevision.task_id == task_id, PostingTaskRevision.owner_id == owner_id)
        .order_by(PostingTaskRevision.id.desc()).limit(1))
    if latest is None or latest.posts_chain != before:
        db.add(PostingTaskRevision(task_id=task_id, owner_id=owner_id,
                                  posts_chain=list(before), reason="before_edit"))
        await db.flush()
    if before != after:
        db.add(PostingTaskRevision(task_id=task_id, owner_id=owner_id,
                                  posts_chain=list(after), reason=reason))

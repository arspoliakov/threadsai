from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user_id, get_db, require_active_subscription
from app.ai_engine.generators import generate_post
from app.db.models import AccountStatus, Platform, PostingTask, PostingTaskStatus, Project, User
from app.posting.scheduler import schedule_account_queue_refill


router = APIRouter(prefix="/tasks", tags=["tasks"])


class PostingTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    account_id: int | None
    account_username: str | None = None
    source_trend_id: int | None
    platform: Platform
    content_text: str
    posts_chain: list[str]
    media_url: str | None
    status: PostingTaskStatus
    scheduled_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    retry_count: int
    error_message: str | None
    external_post_url: str | None
    generation_metadata: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class PublishNowRead(BaseModel):
    task_id: int
    status: str


class PostingTaskUpdate(BaseModel):
    content_text: str | None = None
    content: str | None = None
    posts_chain: list[str] | None = None

    @property
    def resolved_posts_chain(self) -> list[str]:
        if self.posts_chain is not None:
            return [str(item).strip() for item in self.posts_chain if str(item).strip()]

        content = (self.content_text or self.content or "").strip()
        return [content] if content else []


THREADS_POST_CHAR_LIMIT = 500


@router.get("/", response_model=list[PostingTaskRead], status_code=status.HTTP_200_OK)
async def get_tasks(
    project_id: int | None = Query(default=None),
    status_filter: PostingTaskStatus | None = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> list[PostingTaskRead]:
    stmt = (
        select(PostingTask)
        .options(selectinload(PostingTask.account))
        .join(Project, PostingTask.project_id == Project.id)
        .where(Project.owner_id == current_user_id)
    )

    if project_id is not None:
        stmt = stmt.where(PostingTask.project_id == project_id)

    if status_filter is not None:
        stmt = stmt.where(PostingTask.status == status_filter)

    terminal_rank = case(
        (
            PostingTask.status.in_(
                [
                    PostingTaskStatus.SUCCESS,
                    PostingTaskStatus.PARTIAL_SUCCESS,
                    PostingTaskStatus.FAILED,
                    PostingTaskStatus.CANCELLED,
                ]
            ),
            1,
        ),
        else_=0,
    )
    stmt = stmt.order_by(terminal_rank.asc(), PostingTask.scheduled_at.desc().nullslast(), PostingTask.created_at.desc())
    return list((await db.scalars(stmt)).all())


@router.put(
    "/{task_id}",
    response_model=PostingTaskRead,
    status_code=status.HTTP_200_OK,
)
async def update_task(
    task_id: int,
    payload: PostingTaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
    _subscription: User = Depends(require_active_subscription),
) -> PostingTaskRead:
    task = await _get_owned_task(task_id, current_user_id, db)

    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Posting task not found",
        )

    if task.status in {PostingTaskStatus.RUNNING, PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Task cannot be edited in status: {task.status.value}",
        )

    posts_chain = payload.resolved_posts_chain
    if not posts_chain:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="content_text is required",
        )
    oversized_items = [index + 1 for index, item in enumerate(posts_chain) if len(item) > THREADS_POST_CHAR_LIMIT]
    if oversized_items:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "threads_post_too_long",
                "message": "Each Threads post must contain no more than 500 characters.",
                "items": oversized_items,
            },
        )

    task.posts_chain = posts_chain
    task.content_text = posts_chain[0]
    task.status = PostingTaskStatus.QUEUED
    task.error_message = None
    await db.commit()
    await db.refresh(task)
    return task


@router.post(
    "/{task_id}/regenerate",
    response_model=PostingTaskRead,
    status_code=status.HTTP_200_OK,
)
async def regenerate_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
    _subscription: User = Depends(require_active_subscription),
) -> PostingTaskRead:
    task = await _get_owned_task(task_id, current_user_id, db)

    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Posting task not found",
        )

    if task.status in {
        PostingTaskStatus.RUNNING,
        PostingTaskStatus.SUCCESS,
        PostingTaskStatus.PARTIAL_SUCCESS,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Task cannot be regenerated in status: {task.status.value}",
        )

    regenerated_task = await generate_post(
        project_id=task.project_id,
        topic_or_context=task.content_text,
        session=db,
        platform=task.platform,
        account_id=task.account_id,
        scheduled_at=task.scheduled_at,
        media_url=task.media_url,
        use_trends=True,
    )

    task.content_text = regenerated_task.content_text
    task.posts_chain = regenerated_task.posts_chain
    task.generation_metadata = regenerated_task.generation_metadata
    task.source_trend_id = regenerated_task.source_trend_id
    task.status = PostingTaskStatus.QUEUED
    task.error_message = None
    task.started_at = None
    task.finished_at = None

    await db.delete(regenerated_task)
    await db.commit()
    await db.refresh(task)
    return task


@router.patch(
    "/{task_id}/cancel",
    response_model=PostingTaskRead,
    status_code=status.HTTP_200_OK,
)
async def cancel_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> PostingTaskRead:
    task = await _get_owned_task(task_id, current_user_id, db)

    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Posting task not found",
        )

    if task.status in {
        PostingTaskStatus.RUNNING,
        PostingTaskStatus.SUCCESS,
        PostingTaskStatus.PARTIAL_SUCCESS,
        PostingTaskStatus.FAILED,
        PostingTaskStatus.CANCELLED,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Task is already terminal: {task.status.value}",
        )

    task.status = PostingTaskStatus.CANCELLED
    task.error_message = "Cancelled manually from web API."
    await db.commit()
    await db.refresh(task)
    if task.account_id is not None:
        schedule_account_queue_refill(task.project_id, task.account_id)
    return task


@router.post(
    "/{task_id}/publish-now",
    response_model=PublishNowRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def publish_task_now(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
    _subscription: User = Depends(require_active_subscription),
) -> PublishNowRead:
    task = await _get_owned_task(task_id, current_user_id, db)

    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Posting task not found",
        )

    if task.status != PostingTaskStatus.QUEUED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Task must be queued, current status: {task.status.value}",
        )

    if task.account_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Posting task has no assigned account.",
        )

    if task.account is None or task.account.status != AccountStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Posting account is paused or unavailable.",
        )

    task.scheduled_at = datetime.now(UTC)
    task.started_at = None
    task.finished_at = None
    task.error_message = None
    task.generation_metadata = {
        **(task.generation_metadata or {}),
        "publish_now_requested": True,
    }
    await db.commit()
    return PublishNowRead(task_id=task_id, status="queued_for_browser_window")


async def _get_owned_task(task_id: int, owner_id: int, db: AsyncSession) -> PostingTask | None:
    return await db.scalar(
        select(PostingTask)
        .options(selectinload(PostingTask.account))
        .join(Project, PostingTask.project_id == Project.id)
        .where(
            PostingTask.id == task_id,
            Project.owner_id == owner_id,
        )
        .limit(1)
    )

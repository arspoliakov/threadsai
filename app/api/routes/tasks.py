from datetime import UTC, datetime, timedelta
from typing import Literal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import JSON, case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user_id, get_db, require_active_subscription
from app.ai_engine.generators import generate_post
from app.db.models import Account, AccountStatus, Platform, PostingTask, PostingTaskStatus, Project, User, PostingTaskRevision
from app.services.task_revisions import record_content_revision
from app.posting.scheduler import schedule_account_queue_refill, _project_day_bounds, _is_project_in_active_window, _project_posts_per_day
from app.ai_engine.prompt_builder import build_system_prompt
from app.api.auth import limiter
from app.core.config import settings
from app.api.routes.studio import studio_user, studio_limit_key, preview_or_error


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

    @field_validator("scheduled_at", "started_at", "finished_at", "created_at", "updated_at", mode="after")
    @classmethod
    def utc_timestamp(cls, value: datetime | None) -> datetime | None:
        # SQLite drops timezone information; task timestamps are stored as UTC.
        # Restore the offset so browsers cannot interpret UTC as their local time.
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class PublishNowRead(BaseModel):
    task_id: int
    status: str


class PostingTaskUpdate(BaseModel):
    content_text: str | None = None
    content: str | None = None
    posts_chain: list[str] | None = None
    expected_posts_chain: list[str] | None = None

    @property
    def resolved_posts_chain(self) -> list[str]:
        if self.posts_chain is not None:
            return [str(item).strip() for item in self.posts_chain if str(item).strip()]

        content = (self.content_text or self.content or "").strip()
        return [content] if content else []


THREADS_POST_CHAR_LIMIT = 500


class ManualTaskCreate(BaseModel):
    project_id: int = Field(gt=0)
    content_text: str = Field(min_length=1, max_length=THREADS_POST_CHAR_LIMIT)

    @field_validator("content_text")
    @classmethod
    def meaningful_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Напишите текст поста")
        return value.strip()


@router.post("/manual", response_model=PostingTaskRead, status_code=status.HTTP_201_CREATED)
async def create_manual_task(
    payload: ManualTaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
    _subscription: User = Depends(require_active_subscription),
) -> PostingTaskRead:
    project = await db.scalar(select(Project).where(Project.id == payload.project_id, Project.owner_id == current_user_id))
    if project is None:
        raise HTTPException(404, "Проект не найден")
    task = PostingTask(project_id=project.id, platform=Platform.THREADS,
        content_text=payload.content_text, posts_chain=[payload.content_text], status=PostingTaskStatus.DRAFT,
        account_id=None, scheduled_at=None, generation_metadata={"source": "manual"})
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return PostingTaskRead.model_validate(task)


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
    _require_confirmed_publication_state(task)

    if payload.expected_posts_chain is not None and payload.expected_posts_chain != (task.posts_chain or [task.content_text]):
        raise HTTPException(409, "Текст изменился после предпросмотра. Обновите список и повторите правку.")

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

    changes = {"posts_chain": posts_chain, "content_text": posts_chain[0]}
    original_chain = list(task.posts_chain or [task.content_text])
    if task.status == PostingTaskStatus.QUEUED:
        changes.update(status=PostingTaskStatus.DRAFT, scheduled_at=None,
                       generation_metadata=_unapproved_metadata(task.generation_metadata))
    changed = await db.execute(update(PostingTask).where(
        PostingTask.id == task.id, PostingTask.status == task.status,
        PostingTask.content_text == task.content_text,
        PostingTask.posts_chain == task.posts_chain,
        PostingTask.scheduled_at == task.scheduled_at, PostingTask.account_id == task.account_id,
        _metadata_matches(task.generation_metadata),
    ).values(**changes))
    if changed.rowcount != 1:
        raise HTTPException(409, "Пост уже изменился или начал публиковаться. Обновите список.")
    await record_content_revision(db, task.id, current_user_id, original_chain, posts_chain, "edited")
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
    _require_confirmed_publication_state(task)

    source_status, source_content, source_chain = task.status, task.content_text, task.posts_chain
    source_metadata = _metadata_matches(task.generation_metadata)
    source_schedule, source_account = task.scheduled_at, task.account_id
    regenerated_task = await generate_post(
        project_id=task.project_id,
        topic_or_context=task.content_text,
        session=db,
        platform=task.platform,
        account_id=task.account_id,
        scheduled_at=task.scheduled_at,
        media_url=task.media_url,
        use_trends=True,
        persist=False,
    )

    regenerated_values = dict(content_text=regenerated_task.content_text, posts_chain=regenerated_task.posts_chain,
                              generation_metadata=regenerated_task.generation_metadata,
                              source_trend_id=regenerated_task.source_trend_id)
    if source_status == PostingTaskStatus.QUEUED:
        regenerated_values.update(status=PostingTaskStatus.DRAFT, scheduled_at=None,
                                  generation_metadata=_unapproved_metadata(regenerated_task.generation_metadata))
    changed = await db.execute(update(PostingTask).where(
        PostingTask.id == task.id, PostingTask.status == source_status,
        PostingTask.content_text == source_content, PostingTask.posts_chain == source_chain,
        PostingTask.scheduled_at == source_schedule, PostingTask.account_id == source_account,
        source_metadata,
    ).values(**regenerated_values))
    if changed.rowcount != 1:
        raise HTTPException(409, "Пост изменился во время генерации. Обновите список и проверьте его состояние.")
    await record_content_revision(db, task.id, current_user_id, list(source_chain or [source_content]),
                                  list(regenerated_task.posts_chain or [regenerated_task.content_text]), "regenerated")
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

    changed = await db.execute(update(PostingTask).where(
        PostingTask.id == task.id, PostingTask.status == task.status,
    ).values(status=PostingTaskStatus.CANCELLED, error_message="Cancelled manually from web API."))
    if changed.rowcount != 1:
        raise HTTPException(409, "Пост уже начал публиковаться или изменил состояние. Обновите список.")
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

    _require_confirmed_publication_state(task)
    if task.account.owner_id != current_user_id or task.account.project_id != task.project_id:
        raise HTTPException(409, "Профиль больше не принадлежит этому проекту.")
    changed = await db.execute(update(PostingTask).where(
        PostingTask.id == task.id, PostingTask.status == PostingTaskStatus.QUEUED,
        PostingTask.account_id == task.account_id, PostingTask.scheduled_at == task.scheduled_at,
        _metadata_matches(task.generation_metadata),
    ).values(scheduled_at=datetime.now(UTC), started_at=None, finished_at=None, error_message=None,
             generation_metadata={**(task.generation_metadata or {}), "publish_now_requested": True}))
    if changed.rowcount != 1:
        raise HTTPException(409, "Пост уже начал публиковаться или изменил состояние. Обновите список.")
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


class TaskRevisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int
    posts_chain: list[str]
    reason: str
    created_at: datetime

    @field_validator("created_at", mode="after")
    @classmethod
    def timestamp(cls, value: datetime) -> datetime:
        return _as_utc(value)


class RevisionRestoreInput(BaseModel):
    expected_posts_chain: list[str] = Field(min_length=1, max_length=20)


@router.get("/{task_id}/revisions", response_model=list[TaskRevisionRead])
async def task_revisions(task_id: int, db: AsyncSession = Depends(get_db),
                         owner_id: int = Depends(get_current_user_id)):
    if await _get_owned_task(task_id, owner_id, db) is None:
        raise HTTPException(404, "Пост не найден")
    return list((await db.scalars(select(PostingTaskRevision).where(
        PostingTaskRevision.task_id == task_id, PostingTaskRevision.owner_id == owner_id)
        .order_by(PostingTaskRevision.id.desc()))).all())


@router.post("/{task_id}/revisions/{revision_id}/restore", response_model=PostingTaskRead)
async def restore_revision(task_id: int, revision_id: int, payload: RevisionRestoreInput,
                           db: AsyncSession = Depends(get_db), user: User = Depends(require_active_subscription)):
    task = await _get_owned_task(task_id, user.id, db)
    if task is None:
        raise HTTPException(404, "Пост не найден")
    revision = await db.scalar(select(PostingTaskRevision).where(
        PostingTaskRevision.id == revision_id, PostingTaskRevision.task_id == task_id,
        PostingTaskRevision.owner_id == user.id))
    if revision is None:
        raise HTTPException(404, "Версия не найдена")
    if task.status in {PostingTaskStatus.RUNNING, PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS}:
        raise HTTPException(409, "Начавшийся или опубликованный пост нельзя заменить")
    _require_confirmed_publication_state(task)
    before = list(task.posts_chain or [task.content_text])
    if before != payload.expected_posts_chain:
        raise HTTPException(409, "Текст изменился. Обновите редактор перед восстановлением")
    after = list(revision.posts_chain)
    if not after or any(not isinstance(p, str) or not p.strip() or len(p) > 500 for p in after):
        raise HTTPException(422, "Эта версия не подходит для публикации в Threads")
    changed = await db.execute(update(PostingTask).where(
        PostingTask.id == task.id, PostingTask.status == task.status,
        PostingTask.content_text == task.content_text, PostingTask.posts_chain == task.posts_chain,
        PostingTask.scheduled_at == task.scheduled_at, PostingTask.account_id == task.account_id,
        _metadata_matches(task.generation_metadata),
    ).values(posts_chain=after, content_text=after[0], status=PostingTaskStatus.DRAFT,
             scheduled_at=None, started_at=None, finished_at=None, error_message=None,
             generation_metadata={**_unapproved_metadata(task.generation_metadata), "restored_from_revision": revision.id}))
    if changed.rowcount != 1:
        raise HTTPException(409, "Пост изменился или начал публиковаться. Обновите редактор")
    await record_content_revision(db, task.id, user.id, before, after, "restored")
    await db.commit()
    await db.refresh(task)
    return task


class RewriteInput(BaseModel):
    mode: Literal["shorter", "hook", "clearer", "warmer", "custom"]
    instruction: str = Field(default="", max_length=600)


@router.post("/{task_id}/rewrite-preview")
@limiter.limit("3/minute;20/day", key_func=studio_limit_key)
async def rewrite_preview(task_id: int, request: Request, response: Response, payload: RewriteInput,
                          db: AsyncSession = Depends(get_db), user: User = Depends(studio_user),
                          _paid: User = Depends(require_active_subscription)):
    response.headers["Cache-Control"] = "no-store"
    task = await _get_owned_task(task_id, user.id, db)
    if task is None:
        raise HTTPException(404, "Пост не найден")
    if task.status not in {PostingTaskStatus.DRAFT, PostingTaskStatus.QUEUED}:
        raise HTTPException(409, "Этот пост уже нельзя переписывать")
    _require_confirmed_publication_state(task)
    modes = {"shorter": "Сократи текст, сохранив смысл и факты", "hook": "Улучши только начало, сохрани остальной смысл",
             "clearer": "Сделай текст конкретнее и понятнее", "warmer": "Сделай тон теплее и естественнее",
             "custom": "Выполни редакторскую правку пользователя"}
    if payload.mode == "custom" and not payload.instruction.strip():
        raise HTTPException(422, "Опишите нужную правку")
    chain = task.posts_chain or [task.content_text]
    if len(chain) > 7:
        raise HTTPException(422, "Для длинной цепочки используйте ручной редактор")
    style = await build_system_prompt(project_id=task.project_id, session=db)
    posts = await preview_or_error({"task": modes[payload.mode], "instruction": payload.instruction,
                                   "source_posts": chain, "project_style": style[:16000],
                                   "format": "Сохрани порядок и количество частей цепочки"}, len(chain))
    return {"posts_chain": [post["text"] for post in posts], "source_posts_chain": chain}


class ScheduleInput(BaseModel):
    scheduled_at: datetime
    account_id: int | None = None
    expected_posts_chain: list[str] | None = None


@router.post("/{task_id}/schedule", response_model=PostingTaskRead)
async def schedule_task(task_id: int, payload: ScheduleInput, db: AsyncSession = Depends(get_db),
                        user: User = Depends(require_active_subscription)):
    task = await _get_owned_task(task_id, user.id, db)
    if task is None:
        raise HTTPException(404, "Пост не найден")
    if task.status not in {PostingTaskStatus.DRAFT, PostingTaskStatus.QUEUED}:
        raise HTTPException(409, "Можно планировать только черновики и ожидающие посты")
    _require_confirmed_publication_state(task)
    chain = task.posts_chain or [task.content_text]
    if payload.expected_posts_chain is not None and payload.expected_posts_chain != chain:
        raise HTTPException(409, "Текст изменился после просмотра. Обновите список и согласуйте текущую версию")
    if not chain or any(not p.strip() or len(p) > 500 for p in chain):
        raise HTTPException(422, "Проверьте текст: каждый пост должен содержать от 1 до 500 символов")
    when = payload.scheduled_at
    if when.tzinfo is None:
        raise HTTPException(422, "Укажите время с часовым поясом")
    when = when.astimezone(UTC)
    now = datetime.now(UTC)
    if when < now + timedelta(minutes=2) or when > now + timedelta(days=90):
        raise HTTPException(422, "Выберите время от двух минут до 90 дней вперёд")
    known_expiries = [_as_utc(user.subscription_expires_at)] if user.subscription_expires_at else []
    if user.complimentary_access_expires_at and _as_utc(user.complimentary_access_expires_at) > now:
        known_expiries.append(_as_utc(user.complimentary_access_expires_at))
    if known_expiries and when >= max(known_expiries):
        raise HTTPException(409, "Это время находится за пределами оплаченного периода. Выберите более раннее время")
    project = await db.get(Project, task.project_id)
    if not project.is_active:
        raise HTTPException(409, "Проект на паузе. Включите его перед планированием")
    if not _is_project_in_active_window(project, when):
        raise HTTPException(422, "Выберите время в активные часы проекта")
    account_id = payload.account_id or task.account_id
    account = await db.scalar(select(Account).where(Account.id == account_id, Account.owner_id == user.id,
        Account.project_id == project.id, Account.platform == Platform.THREADS, Account.status == AccountStatus.ACTIVE,
        Account.cookies_encrypted.is_not(None), or_(Account.assigned_port.is_not(None), Account.proxy_provider == "proxly")))
    if account is None:
        raise HTTPException(409, "Выберите подключённый рабочий профиль Threads этого проекта")
    if account.cooldown_until and when < _as_utc(account.cooldown_until):
        raise HTTPException(409, "У профиля ещё действует пауза. Выберите более позднее время")
    # Serialize approvals for the account before checking its day allowance.
    locked = await db.execute(update(Account).where(
        Account.id == account.id, Account.owner_id == user.id, Account.project_id == project.id,
        Account.status == AccountStatus.ACTIVE, Account.cookies_encrypted.is_not(None),
        or_(Account.assigned_port.is_not(None), Account.proxy_provider == "proxly"),
        or_(Account.cooldown_until.is_(None), Account.cooldown_until <= when),
    ).values(last_error=Account.last_error))
    if locked.rowcount != 1:
        raise HTTPException(409, "Профиль изменил состояние. Обновите список перед планированием")
    daily_limit = _project_posts_per_day(project, user.tariff_posts_per_day)
    if len(chain) > daily_limit:
        raise HTTPException(409, "Цепочка превышает дневной лимит действий профиля. Сократите число частей")
    start, end = _project_day_bounds(project, when)
    # A delayed publication consumes the day it actually finished, not its old planned day.
    publication_time = case(
        (PostingTask.status.in_([PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS]),
         func.coalesce(PostingTask.finished_at, PostingTask.scheduled_at)),
        else_=PostingTask.scheduled_at,
    )
    others = list((await db.scalars(select(PostingTask).where(PostingTask.account_id == account.id,
        PostingTask.id != task.id, PostingTask.status.in_([PostingTaskStatus.QUEUED, PostingTaskStatus.RUNNING,
        PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS]),
        publication_time >= start, publication_time < end))).all())
    if sum(_publication_actions(other) for other in others) + len(chain) > daily_limit:
        raise HTTPException(409, "Лимит публикаций профиля на этот день уже заполнен. Выберите другой день")
    # The worker applies a rolling 24-hour action budget. Check both the inserted
    # time and later approvals which would include this new post in their window.
    rolling = list((await db.scalars(select(PostingTask).where(
        PostingTask.account_id == account.id, PostingTask.id != task.id,
        PostingTask.status.in_([PostingTaskStatus.QUEUED, PostingTaskStatus.RUNNING,
                               PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS]),
        publication_time > when - timedelta(days=1), publication_time < when + timedelta(days=1),
    ))).all())
    actions_at = []
    for other in rolling:
        moment = other.finished_at if other.status in {PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS} else None
        moment = moment or other.scheduled_at
        if moment is not None:
            actions_at.append((_as_utc(moment), _publication_actions(other)))
    actions_at.append((when, len(chain)))
    for boundary in {moment for moment, _ in actions_at if moment >= when}:
        if sum(count for moment, count in actions_at if boundary - timedelta(days=1) < moment <= boundary) > daily_limit:
            raise HTTPException(409, "Лимит действий профиля за 24 часа уже заполнен. Выберите другое время")
    minimum_interval = max(20, settings.posting_min_interval_minutes)
    nearby = await db.scalar(select(PostingTask.id).where(PostingTask.account_id == account.id,
        PostingTask.id != task.id, PostingTask.status.in_([PostingTaskStatus.QUEUED, PostingTaskStatus.RUNNING,
        PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS]),
        publication_time > when - timedelta(minutes=minimum_interval), publication_time < when + timedelta(minutes=minimum_interval)))
    if nearby:
        raise HTTPException(409, f"Между публикациями нужно оставить хотя бы {minimum_interval} минут")
    changed = await db.execute(update(PostingTask).where(PostingTask.id == task.id, PostingTask.status == task.status,
        PostingTask.posts_chain == task.posts_chain, PostingTask.content_text == task.content_text,
        PostingTask.scheduled_at == task.scheduled_at, PostingTask.account_id == task.account_id,
        _metadata_matches(task.generation_metadata),
    ).values(status=PostingTaskStatus.QUEUED, account_id=account.id, scheduled_at=when,
             generation_metadata={**{key: value for key, value in (task.generation_metadata or {}).items()
                                    if key != "publish_now_requested"}, "approved_by_owner": True}))
    if changed.rowcount != 1:
        raise HTTPException(409, "Пост уже изменился или начал публиковаться. Обновите список")
    await db.commit()
    await db.refresh(task)
    # Refresh the relationship after assigning a previously unassigned draft.
    await db.refresh(task, ["account"])
    return task


@router.post("/{task_id}/to-draft", response_model=PostingTaskRead)
async def return_to_draft(task_id: int, db: AsyncSession = Depends(get_db),
                          owner_id: int = Depends(get_current_user_id)):
    task = await _get_owned_task(task_id, owner_id, db)
    if task is None:
        raise HTTPException(404, "Пост не найден")
    _require_confirmed_publication_state(task)
    changed = await db.execute(update(PostingTask).where(PostingTask.id == task.id,
        PostingTask.status == PostingTaskStatus.QUEUED,
        _metadata_matches(task.generation_metadata)).values(status=PostingTaskStatus.DRAFT, scheduled_at=None,
            generation_metadata={key: value for key, value in (task.generation_metadata or {}).items()
                                 if key not in {"publish_now_requested", "approved_by_owner"}}))
    if changed.rowcount != 1:
        raise HTTPException(409, "Пост уже начал публиковаться или не находится в очереди")
    await db.commit()
    await db.refresh(task)
    return task


def _metadata_matches(metadata: dict[str, Any] | None):
    # Older rows can contain SQL NULL; newer assignments of None can contain JSON null.
    if metadata is None:
        return or_(PostingTask.generation_metadata.is_(None), PostingTask.generation_metadata == JSON.NULL)
    return PostingTask.generation_metadata == metadata


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _require_confirmed_publication_state(task: PostingTask) -> None:
    if (task.generation_metadata or {}).get("publication_confirmation_pending"):
        raise HTTPException(
            status_code=409,
            detail="Сначала проверьте результат публикации в Threads. Изменение текста не должно создавать повторный пост.",
        )


def _unapproved_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    return {key: value for key, value in (metadata or {}).items()
            if key not in {"publish_now_requested", "approved_by_owner"}}


def _publication_actions(task: PostingTask) -> int:
    count = len(task.posts_chain or []) or 1
    if task.status == PostingTaskStatus.PARTIAL_SUCCESS:
        count = int((task.generation_metadata or {}).get("published_chain_items") or count)
    return max(1, count)

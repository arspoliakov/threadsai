import asyncio
import logging

from app.ai_engine.safety import ContentSafetyError
import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from uuid import uuid4
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import limiter
from app.api.deps import get_current_user, get_db, require_active_subscription
from app.api.routes.projects import _get_owned_project
from app.ai_engine.prompt_builder import build_system_prompt
from app.db.models import Platform, PostingTask, PostingTaskStatus, StudioDraft, StudioRequest, User
from app.services.content_editor import content_preview

router = APIRouter(prefix="/studio", tags=["studio"])
logger = logging.getLogger(__name__)


async def studio_user(request: Request, user: User = Depends(get_current_user)) -> User:
    request.state.studio_owner = user.id
    return user


def studio_limit_key(request: Request) -> str:
    return f"content-studio:{request.state.studio_owner}"


class TrialInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    topic: str = Field(min_length=5, max_length=600)
    context: str = Field(min_length=20, max_length=3000)
    tone: Literal["friendly", "expert", "direct", "warm"] = "friendly"


class DraftRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    topic: str
    content_text: str
    imported_task_id: int | None


class TrialRead(BaseModel):
    remaining: int
    drafts: list[DraftRead]


async def preview_or_error(context: dict, count: int) -> list[dict[str, str]]:
    try:
        return await asyncio.wait_for(content_preview(context, count), timeout=50)
    except ContentSafetyError as exc:
        raise HTTPException(503 if exc.unavailable else 422, str(exc)) from None
    except Exception as exc:
        logger.warning("Content preview failed: %s", type(exc).__name__)
        raise HTTPException(502, "Не удалось подготовить тексты. Попробуйте ещё раз; ваши сохранённые посты не изменены.") from None


@limiter.limit("3/minute;6/day", key_func=studio_limit_key)
async def _trial_preview(request: Request, response: Response, context: dict):
    return await preview_or_error(context, 1)


@limiter.limit("1/minute;5/day", key_func=studio_limit_key)
async def _week_preview(request: Request, response: Response, context: dict):
    return await preview_or_error(context, 7)


async def _expire_reservations(db: AsyncSession, owner_id: int) -> None:
    # Serialize all quota/request changes for this owner, across API processes.
    await db.execute(update(User).where(User.id == owner_id).values(studio_trial_used=User.studio_trial_used))
    expired = list((await db.scalars(select(StudioRequest).where(
        StudioRequest.owner_id == owner_id, StudioRequest.status == "running",
        StudioRequest.reserved_at < datetime.now(UTC) - timedelta(minutes=2),
    ))).all())
    credits = sum(item.kind == "trial" for item in expired)
    for item in expired:
        item.status = "expired"
    if credits:
        await db.execute(update(User).where(User.id == owner_id)
                         .values(studio_trial_used=User.studio_trial_used - credits))
    await db.flush()


async def _reserve_request(db: AsyncSession, request: Request, response: Response,
                           owner_id: int, kind: str, payload: dict) -> tuple[str, dict | None]:
    key = request.headers.get("Idempotency-Key") or str(uuid4())
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", key):
        raise HTTPException(422, "Некорректный ключ запроса")
    response.headers["Idempotency-Key"] = key
    fingerprint = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True,
                                           separators=(",", ":")).encode()).hexdigest()
    await _expire_reservations(db, owner_id)
    previous = await db.scalar(select(StudioRequest).where(
        StudioRequest.owner_id == owner_id, StudioRequest.kind == kind, StudioRequest.request_key == key))
    if previous is not None:
        if previous.payload_hash != fingerprint:
            await db.commit()
            raise HTTPException(409, "Этот ключ уже использован для другого запроса. Начните новую генерацию.")
        if previous.status == "success":
            result = previous.result_json
            response.headers["Idempotency-Replayed"] = "true"
            await db.commit()
            return previous.id, result
        if previous.status == "running":
            await db.commit()
            raise HTTPException(409, "Генерация ещё выполняется. Подождите немного и повторите запрос.",
                                headers={"Retry-After": "5"})
    if kind == "trial":
        claimed = await db.execute(update(User).where(User.id == owner_id, User.studio_trial_used < 3)
                                   .values(studio_trial_used=User.studio_trial_used + 1))
        if claimed.rowcount != 1:
            await db.commit()
            raise HTTPException(409, "Три пробных черновика уже использованы. Они остаются доступными; продолжить можно в проекте с подпиской.")
    if previous is None:
        previous = StudioRequest(id=str(uuid4()), owner_id=owner_id, kind=kind, request_key=key,
                                 payload_hash=fingerprint, status="running", reserved_at=datetime.now(UTC))
        db.add(previous)
    else:
        # A fresh execution ID prevents a late expired worker from completing this retry.
        previous.id = str(uuid4())
        previous.status = "running"
        previous.reserved_at = datetime.now(UTC)
        previous.result_json = None
    await db.commit()
    return previous.id, None


async def _claim_completion(db: AsyncSession, request_id: str) -> None:
    claimed = await db.execute(update(StudioRequest).where(
        StudioRequest.id == request_id, StudioRequest.status == "running").values(status="success"))
    if claimed.rowcount != 1:
        await db.rollback()
        raise HTTPException(409, "Запрос уже завершён или истёк. Обновите список черновиков.")


async def _fail_request(db: AsyncSession, request_id: str, owner_id: int, trial: bool) -> None:
    await db.rollback()
    failed = await db.execute(update(StudioRequest).where(
        StudioRequest.id == request_id, StudioRequest.status == "running").values(status="failed"))
    if trial and failed.rowcount == 1:
        await db.execute(update(User).where(User.id == owner_id, User.studio_trial_used > 0)
                         .values(studio_trial_used=User.studio_trial_used - 1))
    await db.commit()


@router.get("/trial", response_model=TrialRead)
async def read_trial(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _expire_reservations(db, user.id)
    await db.commit()
    # The dependency may have loaded User before the reconciliation update.
    used = await db.scalar(select(User.studio_trial_used).where(User.id == user.id))
    drafts = list((await db.scalars(select(StudioDraft).where(StudioDraft.owner_id == user.id)
                                   .order_by(StudioDraft.id.desc()))).all())
    return TrialRead(remaining=max(0, 3 - used), drafts=drafts)


@router.post("/trial", response_model=DraftRead, status_code=201)
async def generate_trial(request: Request, response: Response, payload: TrialInput,
                         db: AsyncSession = Depends(get_db), user: User = Depends(studio_user)):
    response.headers["Cache-Control"] = "no-store"
    owner_id = user.id
    request_id, replay = await _reserve_request(db, request, response, owner_id, "trial", payload.model_dump())
    if replay is not None:
        response.status_code = 200
        current = await db.scalar(select(StudioDraft).where(StudioDraft.id == replay["id"], StudioDraft.owner_id == owner_id))
        return current if current is not None else DraftRead(**replay)
    try:
        posts = await _trial_preview(request, response, {**payload.model_dump(), "task": "Один готовый пост по конкретной теме и фактам автора"})
        await _claim_completion(db, request_id)
        draft = StudioDraft(owner_id=owner_id, topic=payload.topic, content_text=posts[0]["text"])
        db.add(draft)
        await db.flush()
        result = DraftRead.model_validate(draft).model_dump()
        await db.execute(update(StudioRequest).where(StudioRequest.id == request_id).values(result_json=result))
        await db.commit()
        return draft
    except BaseException:
        # Completion, draft and replay result commit atomically. A committed result
        # is never refunded even if response serialization subsequently fails.
        await _fail_request(db, request_id, owner_id, trial=True)
        raise


class ImportInput(BaseModel):
    project_id: int


@router.post("/trial/{draft_id}/import")
async def import_trial(draft_id: int, payload: ImportInput, db: AsyncSession = Depends(get_db),
                       user: User = Depends(require_active_subscription)):
    project = await _get_owned_project(project_id=payload.project_id, owner_id=user.id, db=db)
    await db.execute(update(User).where(User.id == user.id).values(studio_trial_used=User.studio_trial_used))
    draft = await db.scalar(select(StudioDraft).where(StudioDraft.id == draft_id, StudioDraft.owner_id == user.id))
    if draft is None:
        raise HTTPException(404, "Черновик не найден")
    if draft.imported_task_id is not None:
        raise HTTPException(409, "Черновик уже перенесён в проект. Откройте его расписание.")
    task = PostingTask(project_id=project.id, platform=Platform.THREADS, account=None,
                       content_text=draft.content_text, posts_chain=[draft.content_text], status=PostingTaskStatus.DRAFT)
    db.add(task)
    await db.flush()
    draft.imported_task_id = task.id
    await db.commit()
    return {"task_id": task.id, "project_id": project.id}


class PlanInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    rubrics: list[str] = Field(min_length=1, max_length=5)
    goal: str = Field(min_length=10, max_length=1000)


@router.post("/projects/{project_id}/week-plan")
async def generate_week_plan(project_id: int, request: Request, response: Response, payload: PlanInput,
                             db: AsyncSession = Depends(get_db), user: User = Depends(studio_user),
                             _paid: User = Depends(require_active_subscription)):
    response.headers["Cache-Control"] = "no-store"
    project = await _get_owned_project(project_id=project_id, owner_id=user.id, db=db)
    rubrics = [r.strip() for r in payload.rubrics if r.strip()]
    if not rubrics or any(len(r) > 100 for r in rubrics):
        raise HTTPException(422, "Укажите от одной до пяти рубрик, до 100 символов каждая.")
    request_id, replay = await _reserve_request(db, request, response, user.id, "week-plan",
                                               {"project_id": project_id, "rubrics": rubrics, "goal": payload.goal})
    if replay is not None:
        return replay
    owner_id = user.id
    try:
        style = await build_system_prompt(project_id=project.id, session=db)
        posts = await _week_preview(request, response, {"project_style": style[:16000], "project": {"name": project.name,
                                       "description": project.global_context or project.description,
                                       "audience": project.target_audience, "product": project.product_context,
                                       "tone": project.tone_of_voice, "stop_words": project.stop_words}, "goal": payload.goal,
                                       "rubrics": rubrics, "task": "Семь разных готовых постов: распределяй рубрики равномерно, каждая тема конкретна. Не выдумывай факты."})
        await _claim_completion(db, request_id)
        # Recheck project ownership after the network wait; it could have been deleted.
        await _get_owned_project(project_id=project_id, owner_id=owner_id, db=db)
        tasks = []
        for index, post in enumerate(posts):
            task = PostingTask(project_id=project_id, platform=Platform.THREADS, account=None,
                               content_text=post["text"], posts_chain=[post["text"]], status=PostingTaskStatus.DRAFT,
                               generation_metadata={"rubric": post["rubric"], "topic": post["topic"], "plan_day": index + 1})
            db.add(task)
            tasks.append(task)
        await db.flush()
        result = {"task_ids": [task.id for task in tasks], "count": len(tasks)}
        await db.execute(update(StudioRequest).where(StudioRequest.id == request_id).values(result_json=result))
        await db.commit()
        return result
    except BaseException:
        await _fail_request(db, request_id, owner_id, trial=False)
        raise

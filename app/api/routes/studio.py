import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import limiter
from app.api.deps import get_current_user, get_db, require_active_subscription
from app.api.routes.projects import _get_owned_project
from app.ai_engine.prompt_builder import build_system_prompt
from app.db.models import Platform, PostingTask, PostingTaskStatus, StudioDraft, User
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
    except Exception as exc:
        logger.warning("Content preview failed: %s", type(exc).__name__)
        raise HTTPException(502, "Не удалось подготовить тексты. Попробуйте ещё раз; ваши сохранённые посты не изменены.") from None


@router.get("/trial", response_model=TrialRead)
async def read_trial(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    drafts = list((await db.scalars(select(StudioDraft).where(StudioDraft.owner_id == user.id)
                                   .order_by(StudioDraft.id.desc()))).all())
    return TrialRead(remaining=max(0, 3 - user.studio_trial_used), drafts=drafts)


@router.post("/trial", response_model=DraftRead, status_code=201)
@limiter.limit("3/minute;6/day", key_func=studio_limit_key)
async def generate_trial(request: Request, response: Response, payload: TrialInput,
                         db: AsyncSession = Depends(get_db), user: User = Depends(studio_user)):
    response.headers["Cache-Control"] = "no-store"
    owner_id = user.id
    claimed = await db.execute(update(User).where(User.id == owner_id, User.studio_trial_used < 3)
                               .values(studio_trial_used=User.studio_trial_used + 1))
    if claimed.rowcount != 1:
        await db.rollback()
        raise HTTPException(409, "Три пробных черновика уже использованы. Они остаются доступными; продолжить можно в проекте с подпиской.")
    await db.commit()
    persisted = False
    try:
        posts = await preview_or_error({**payload.model_dump(), "task": "Один готовый пост по конкретной теме и фактам автора"}, 1)
        draft = StudioDraft(owner_id=owner_id, topic=payload.topic, content_text=posts[0]["text"])
        db.add(draft)
        await db.commit()
        persisted = True
        await db.refresh(draft)
        return draft
    except BaseException:
        await db.rollback()
        if persisted:
            # A response/refresh failure must not grant another credit after saving the draft.
            raise
        await db.execute(update(User).where(User.id == owner_id, User.studio_trial_used > 0)
                         .values(studio_trial_used=User.studio_trial_used - 1))
        await db.commit()
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
@limiter.limit("1/minute;5/day", key_func=studio_limit_key)
async def generate_week_plan(project_id: int, request: Request, response: Response, payload: PlanInput,
                             db: AsyncSession = Depends(get_db), user: User = Depends(studio_user),
                             _paid: User = Depends(require_active_subscription)):
    response.headers["Cache-Control"] = "no-store"
    project = await _get_owned_project(project_id=project_id, owner_id=user.id, db=db)
    rubrics = [r.strip() for r in payload.rubrics if r.strip()]
    if not rubrics or any(len(r) > 100 for r in rubrics):
        raise HTTPException(422, "Укажите от одной до пяти рубрик, до 100 символов каждая.")
    style = await build_system_prompt(project_id=project.id, session=db)
    posts = await preview_or_error({"project_style": style[:16000], "project": {"name": project.name,
                                   "description": project.global_context or project.description,
                                   "audience": project.target_audience, "product": project.product_context,
                                   "tone": project.tone_of_voice, "stop_words": project.stop_words}, "goal": payload.goal,
                                   "rubrics": rubrics, "task": "Семь разных готовых постов: распределяй рубрики равномерно, каждая тема конкретна. Не выдумывай факты."}, 7)
    tasks = []
    for index, post in enumerate(posts):
        task = PostingTask(project_id=project.id, platform=Platform.THREADS, account=None,
                           content_text=post["text"], posts_chain=[post["text"]], status=PostingTaskStatus.DRAFT,
                           generation_metadata={"rubric": post["rubric"], "topic": post["topic"], "plan_day": index + 1})
        db.add(task)
        tasks.append(task)
    await db.flush()
    result = {"task_ids": [task.id for task in tasks], "count": len(tasks)}
    await db.commit()
    return result

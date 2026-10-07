"""Owner-bound setup progress. Saving answers never starts publication."""
import asyncio
import json
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.auth import limiter
from app.api.deps import get_current_user, get_db
from app.db.models import Project, StudioDraft, User
from app.services.project_workflow import build_project_workflow
from app.services.style_assistant import StyleAnswers, generate_style_preview
from app.ai_engine.safety import ContentSafetyError

router = APIRouter(prefix="/onboarding", tags=["first setup"])
_style_users: set[int] = set()


class Preview(BaseModel):
    id: int = Field(gt=0)
    topic: str = Field(default="", max_length=600)
    content_text: str = Field(default="", max_length=500)
    imported_task_id: int | None = None


class SetupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    step: int | None = Field(default=None, ge=0, le=3)
    answers: dict[str, Any] | None = None
    preview: Preview | None = None
    project_id: int | None = Field(default=None, gt=0)
    completed: bool | None = None
    reset: bool = False

    @field_validator("answers")
    @classmethod
    def bounded_answers(cls, value):
        if value is None:
            return value
        if len(json.dumps(value, ensure_ascii=False, allow_nan=False)) > 16000:
            raise ValueError("Ответы слишком длинные")
        def inspect(item, depth=0):
            if depth > 4:
                raise ValueError("Слишком сложный формат ответов")
            if isinstance(item, dict):
                for key, child in item.items():
                    if any(part in key.lower() for part in ("password", "secret", "cookie", "token")):
                        raise ValueError("Данные входа не сохраняются в мастере")
                    inspect(child, depth + 1)
            elif isinstance(item, list):
                for child in item:
                    inspect(child, depth + 1)
        inspect(value)
        return value


def public_state(state):
    state = state or {}
    return {"step": state.get("step", 0), "answers": state.get("answers", {}),
            "preview": state.get("preview"), "project_id": state.get("project_id"),
            "completed": state.get("completed", False)}


@router.get("")
async def read_setup(response: Response, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    state = public_state(user.onboarding_state)
    if state["project_id"] and not await db.scalar(select(Project.id).where(Project.id == state["project_id"], Project.owner_id == user.id)):
        state.update(project_id=None, completed=False)
    if state["preview"]:
        draft = await db.scalar(select(StudioDraft).where(StudioDraft.id == state["preview"]["id"], StudioDraft.owner_id == user.id))
        if draft is None:
            state["preview"] = None
        else:
            state["preview"] = {"id": draft.id, "topic": draft.topic, "content_text": draft.content_text,
                                "imported_task_id": draft.imported_task_id}
    return state


@router.put("")
async def save_setup(payload: SetupUpdate, response: Response, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    # Acquire the SQLite writer before reading state; merge preserves create replay metadata.
    await db.execute(update(User).where(User.id == user.id).values(onboarding_state=User.onboarding_state))
    saved = dict(await db.scalar(select(User.onboarding_state).where(User.id == user.id)) or {})
    state = ({key: value for key, value in saved.items() if key.startswith("creation_")}
             if payload.reset else saved)
    values = payload.model_dump(exclude_unset=True, exclude={"reset"})
    if "answers" in values:
        values["answers"] = {**state.get("answers", {}), **(values["answers"] or {})}
    if payload.preview is not None:
        draft = await db.scalar(select(StudioDraft).where(StudioDraft.id == payload.preview.id, StudioDraft.owner_id == user.id))
        if draft is None:
            raise HTTPException(404, "Пробный текст не найден")
        values["preview"] = {"id": draft.id, "topic": draft.topic, "content_text": draft.content_text,
                             "imported_task_id": draft.imported_task_id}
    target = values.get("project_id", state.get("project_id"))
    project = None
    if target:
        project = await db.scalar(select(Project).where(Project.id == target, Project.owner_id == user.id))
        if project is None:
            raise HTTPException(404, "Проект не найден")
    if payload.completed is True:
        if project is None or not (await build_project_workflow(project, db)).ready:
            raise HTTPException(409, "Сначала проверьте подписку, тему и подключение аккаунта")
    state.update(values)
    await db.execute(update(User).where(User.id == user.id).values(onboarding_state=state))
    await db.commit()
    return public_state(state)


async def style_user(request: Request, user: User = Depends(get_current_user)):
    request.state.onboarding_owner = user.id
    return user


@router.post("/style")
@limiter.limit("2/minute;3/day", key_func=lambda request: f"setup-style:{request.state.onboarding_owner}")
async def setup_style(request: Request, response: Response, payload: StyleAnswers,
                      user: User = Depends(style_user)):
    response.headers["Cache-Control"] = "no-store"
    if user.id in _style_users:
        raise HTTPException(409, "Стиль уже готовится. Дождитесь ответа")
    _style_users.add(user.id)
    try:
        return {"body": await asyncio.wait_for(generate_style_preview(payload), timeout=40)}
    except ContentSafetyError as exc:
        raise HTTPException(503 if exc.unavailable else 422, str(exc)) from None
    except TimeoutError:
        raise HTTPException(504, "Ответы остались в форме. Попробуйте подготовить стиль ещё раз") from None
    except Exception:
        raise HTTPException(502, "Не удалось подготовить стиль. Можно вписать его вручную") from None
    finally:
        _style_users.discard(user.id)

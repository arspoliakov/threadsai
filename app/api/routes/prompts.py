from datetime import datetime
import asyncio
import logging

from app.ai_engine.safety import ContentSafetyError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db, require_active_subscription
from app.api.auth import limiter
from app.core.default_prompts import DEFAULT_GLOBAL_PROMPT
from app.db.models import GlobalPrompt, Project, ProjectPrompt, PromptType, User
from app.services.style_assistant import StyleAnswers, generate_style_preview, stage_global_style


router = APIRouter(prefix="/prompts", tags=["prompts"])
logger = logging.getLogger(__name__)
_assistant_users: set[int] = set()


async def _assistant_user(request: Request, user: User = Depends(require_active_subscription)) -> User:
    request.state.style_assistant_user = user.id
    return user


def _assistant_limit_key(request: Request) -> str:
    return f"style-assistant:{request.state.style_assistant_user}"


class StylePreviewRead(BaseModel):
    body: str


@router.post("/global/assist", response_model=StylePreviewRead)
@limiter.limit("3/minute;20/day", key_func=_assistant_limit_key)
async def assist_global_style(request: Request, response: Response, payload: StyleAnswers,
                              user: User = Depends(_assistant_user)) -> StylePreviewRead:
    response.headers["Cache-Control"] = "no-store"
    if user.id in _assistant_users:
        raise HTTPException(409, "Помощник уже готовит стиль. Дождитесь результата.")
    _assistant_users.add(user.id)
    try:
        body = await asyncio.wait_for(generate_style_preview(payload), timeout=40)
        return StylePreviewRead(body=body)
    except TimeoutError:
        raise HTTPException(504, "Нейросеть не успела ответить. Ответы сохранены в форме — попробуйте ещё раз.") from None
    except ContentSafetyError as exc:
        raise HTTPException(503 if exc.unavailable else 422, str(exc)) from None
    except Exception as exc:
        logger.warning("Style assistant failed: %s", type(exc).__name__)
        raise HTTPException(502, "Не удалось подготовить стиль. Попробуйте ещё раз или заполните его вручную.") from None
    finally:
        _assistant_users.discard(user.id)


class GlobalPromptCreate(BaseModel):
    prompt_type: PromptType
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1)
    version: str = Field(default="1.0.0", min_length=1, max_length=50)
    is_active: bool = True


class GlobalPromptUpdate(BaseModel):
    prompt_type: PromptType | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    body: str | None = Field(default=None, min_length=1)
    version: str | None = Field(default=None, min_length=1, max_length=50)
    is_active: bool | None = None


class GlobalPromptRead(GlobalPromptCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int | None
    created_at: datetime
    updated_at: datetime


class GlobalStyleApply(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    body: str = Field(min_length=1, max_length=30000)


@router.put("/global/style", response_model=GlobalPromptRead)
async def apply_global_style(payload: GlobalStyleApply, db: AsyncSession = Depends(get_db),
                             current_user_id: int = Depends(get_current_user_id)) -> GlobalPromptRead:
    prompt = await stage_global_style(db, current_user_id, payload.body)
    await db.commit()
    await db.refresh(prompt)
    return prompt


class ProjectPromptCreate(BaseModel):
    project_id: int
    prompt_type: PromptType
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1)
    priority: int = 100
    is_active: bool = True


class ProjectPromptUpdate(BaseModel):
    prompt_type: PromptType | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    body: str | None = Field(default=None, min_length=1)
    priority: int | None = None
    is_active: bool | None = None


class ProjectPromptRead(ProjectPromptCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


@router.post(
    "/global",
    response_model=GlobalPromptRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_global_prompt(
    payload: GlobalPromptCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> GlobalPromptRead:
    prompt = GlobalPrompt(**payload.model_dump(), owner_id=current_user_id)
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)
    return prompt


@router.get(
    "/global/active",
    response_model=list[GlobalPromptRead],
    status_code=status.HTTP_200_OK,
)
async def get_active_global_prompts(
    prompt_type: PromptType | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> list[GlobalPromptRead]:
    stmt = select(GlobalPrompt).where(
        GlobalPrompt.is_active.is_(True),
        GlobalPrompt.owner_id == current_user_id,
    )

    if prompt_type is not None:
        stmt = stmt.where(GlobalPrompt.prompt_type == prompt_type)

    stmt = stmt.order_by(GlobalPrompt.prompt_type.asc(), GlobalPrompt.created_at.desc())
    prompts = list((await db.scalars(stmt)).all())

    if prompts or prompt_type is not None:
        return prompts

    default_prompt = GlobalPrompt(
        owner_id=current_user_id,
        prompt_type=PromptType.VIRALITY,
        title="Default Anti-AI global content prompt",
        body=DEFAULT_GLOBAL_PROMPT,
        version="1.0.0",
        is_active=True,
    )
    db.add(default_prompt)
    await db.commit()
    await db.refresh(default_prompt)
    return [default_prompt]


@router.get(
    "/global/{prompt_id}",
    response_model=GlobalPromptRead,
    status_code=status.HTTP_200_OK,
)
async def get_global_prompt(
    prompt_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> GlobalPromptRead:
    prompt = await db.scalar(
        select(GlobalPrompt).where(GlobalPrompt.id == prompt_id, GlobalPrompt.owner_id == current_user_id)
    )
    if prompt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Global prompt not found",
        )

    return prompt


@router.patch(
    "/global/{prompt_id}",
    response_model=GlobalPromptRead,
    status_code=status.HTTP_200_OK,
)
async def update_global_prompt(
    prompt_id: int,
    payload: GlobalPromptUpdate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> GlobalPromptRead:
    prompt = await db.scalar(
        select(GlobalPrompt).where(GlobalPrompt.id == prompt_id, GlobalPrompt.owner_id == current_user_id)
    )
    if prompt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Global prompt not found",
        )

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(prompt, key, value)

    await db.commit()
    await db.refresh(prompt)
    return prompt


@router.post(
    "/project",
    response_model=ProjectPromptRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_prompt(
    payload: ProjectPromptCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ProjectPromptRead:
    await _assert_project_owner(payload.project_id, current_user_id, db)
    prompt = ProjectPrompt(**payload.model_dump())
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)
    return prompt


@router.get(
    "/project/{project_id}",
    response_model=list[ProjectPromptRead],
    status_code=status.HTTP_200_OK,
)
async def get_project_prompts(
    project_id: int,
    active_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> list[ProjectPromptRead]:
    await _assert_project_owner(project_id, current_user_id, db)
    stmt = select(ProjectPrompt).where(ProjectPrompt.project_id == project_id)

    if active_only:
        stmt = stmt.where(ProjectPrompt.is_active.is_(True))

    stmt = stmt.order_by(ProjectPrompt.priority.asc(), ProjectPrompt.created_at.desc())
    return list((await db.scalars(stmt)).all())


@router.get(
    "/project/prompt/{prompt_id}",
    response_model=ProjectPromptRead,
    status_code=status.HTTP_200_OK,
)
async def get_project_prompt(
    prompt_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ProjectPromptRead:
    prompt = await _get_owned_project_prompt(prompt_id, current_user_id, db)

    if prompt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project prompt not found",
        )

    return prompt


@router.patch(
    "/project/{prompt_id}",
    response_model=ProjectPromptRead,
    status_code=status.HTTP_200_OK,
)
async def update_project_prompt(
    prompt_id: int,
    payload: ProjectPromptUpdate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ProjectPromptRead:
    prompt = await _get_owned_project_prompt(prompt_id, current_user_id, db)

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(prompt, key, value)

    await db.commit()
    await db.refresh(prompt)
    return prompt


async def _assert_project_owner(project_id: int, owner_id: int, db: AsyncSession) -> None:
    project_id_result = await db.scalar(
        select(Project.id)
        .where(
            Project.id == project_id,
            Project.owner_id == owner_id,
        )
        .limit(1)
    )

    if project_id_result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )


async def _get_owned_project_prompt(
    prompt_id: int,
    owner_id: int,
    db: AsyncSession,
) -> ProjectPrompt:
    prompt = await db.scalar(
        select(ProjectPrompt)
        .join(Project, ProjectPrompt.project_id == Project.id)
        .where(
            ProjectPrompt.id == prompt_id,
            Project.owner_id == owner_id,
        )
        .limit(1)
    )

    if prompt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project prompt not found",
        )

    return prompt

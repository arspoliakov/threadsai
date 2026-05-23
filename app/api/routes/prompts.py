from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_current_user_id, get_db
from app.core.default_prompts import DEFAULT_GLOBAL_PROMPT
from app.db.models import GlobalPrompt, Project, ProjectPrompt, PromptType


router = APIRouter(prefix="/prompts", tags=["prompts"])


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
    created_at: datetime
    updated_at: datetime


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
    _: str = Depends(get_current_admin),
) -> GlobalPromptRead:
    prompt = GlobalPrompt(**payload.model_dump())
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
    _: str = Depends(get_current_admin),
) -> list[GlobalPromptRead]:
    stmt = select(GlobalPrompt).where(GlobalPrompt.is_active.is_(True))

    if prompt_type is not None:
        stmt = stmt.where(GlobalPrompt.prompt_type == prompt_type)

    stmt = stmt.order_by(GlobalPrompt.prompt_type.asc(), GlobalPrompt.created_at.desc())
    prompts = list((await db.scalars(stmt)).all())

    if prompts or prompt_type is not None:
        return prompts

    default_prompt = GlobalPrompt(
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
    _: str = Depends(get_current_admin),
) -> GlobalPromptRead:
    prompt = await db.get(GlobalPrompt, prompt_id)

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
    _: str = Depends(get_current_admin),
) -> GlobalPromptRead:
    prompt = await db.get(GlobalPrompt, prompt_id)

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

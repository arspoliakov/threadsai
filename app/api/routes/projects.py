import asyncio
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from unicodedata import normalize

from pydantic import BaseModel, ConfigDict
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db, require_active_subscription
from app.ai_engine.generators import generate_post
from app.db.models import (
    Account,
    AccountStatus,
    Platform,
    PostingTask,
    PostingTaskStatus,
    Project,
    ProjectOperation,
    ProjectOperationStatus,
    ProjectOperationType,
    ProjectPrompt,
    SavedTrend,
    StudioDraft,
    User,
)
from app.db.repositories.projects import ProjectRepository
from app.posting.scheduler import calculate_next_account_slot, schedule_project_queue_refill
from app.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate
from app.services.style_assistant import stage_global_style


router = APIRouter(prefix="/projects", tags=["projects"])
logger = logging.getLogger(__name__)


class ProjectAccountStateRead(BaseModel):
    id: int
    username: str
    platform: Platform
    status: AccountStatus
    last_error: str | None
    last_used_at: datetime | None


class ProjectDashboardRead(BaseModel):
    project: ProjectRead
    accounts_count: int
    saved_trends_count: int
    posting_tasks_by_status: dict[str, int]
    recent_errors: list[str]
    account_states: list[ProjectAccountStateRead]
    last_generation_at: datetime | None


class TriggerScrapingRead(BaseModel):
    project_id: int
    operation_id: int
    status: ProjectOperationStatus
    message: str | None


class ProjectOperationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    action_type: ProjectOperationType
    status: ProjectOperationStatus
    message: str | None
    result_json: dict[str, Any] | None
    started_at: datetime
    finished_at: datetime | None


class TriggerGenerationRead(BaseModel):
    project_id: int
    task_id: int
    status: PostingTaskStatus
    scheduled_at: datetime | None
    content_text: str
    posts_chain: list[str]


@router.post("/", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
    current_user: User = Depends(require_active_subscription),
) -> ProjectRead:
    projects_count = await db.scalar(
        select(func.count(Project.id)).where(Project.owner_id == current_user_id)
    )
    if (projects_count or 0) >= current_user.tariff_projects_limit:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "tariff_projects_limit_reached",
                "message": "Current tariff project limit is reached.",
                "limit": current_user.tariff_projects_limit,
                "tariff_plan": current_user.tariff_plan,
            },
        )
    if payload.posts_per_day > current_user.tariff_posts_per_day:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "tariff_posts_limit_reached",
                "message": "Current tariff posts-per-day limit is reached.",
                "limit": current_user.tariff_posts_per_day,
                "tariff_plan": current_user.tariff_plan,
            },
        )

    safe_slug = await _build_unique_project_slug(
        db=db,
        raw_value=payload.slug or payload.name,
    )
    repository = ProjectRepository(db)
    if payload.global_style_body is not None:
        if not payload.global_style_body.strip():
            raise HTTPException(422, "Стиль не может быть пустым")
        await stage_global_style(db, current_user_id, payload.global_style_body)
    project = await repository.create_project(payload.model_copy(update={"slug": safe_slug}), owner_id=current_user_id)

    return project


async def _build_unique_project_slug(db: AsyncSession, raw_value: str) -> str:
    base = _slugify_project_value(raw_value)
    candidate = base
    suffix = 1

    while await db.scalar(select(Project.id).where(Project.slug == candidate).limit(1)):
        suffix_text = f"-{suffix}"
        candidate = f"{base[:120 - len(suffix_text)]}{suffix_text}"
        suffix += 1

    return candidate


def _slugify_project_value(value: str) -> str:
    ascii_value = (
        normalize("NFKD", value.casefold().strip())
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")
    slug = re.sub(r"-{2,}", "-", slug).strip("-")[:100].strip("-")
    return slug or f"project-{int(datetime.now(UTC).timestamp())}"


@router.get("/{project_id}", response_model=ProjectRead, status_code=status.HTTP_200_OK)
async def get_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ProjectRead:
    return await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)


@router.patch("/{project_id}", response_model=ProjectRead, status_code=status.HTTP_200_OK)
async def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
    current_user: User = Depends(require_active_subscription),
) -> ProjectRead:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)

    if payload.posts_per_day is not None and payload.posts_per_day > current_user.tariff_posts_per_day:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "tariff_posts_limit_reached",
                "message": "Current tariff posts-per-day limit is reached.",
                "limit": current_user.tariff_posts_per_day,
                "tariff_plan": current_user.tariff_plan,
            },
        )

    if payload.auto_generate is True and current_user.subscription_expires_at is not None:
        expiries = [current_user.subscription_expires_at]
        if current_user.complimentary_access_expires_at is not None:
            expiries.append(current_user.complimentary_access_expires_at)
        expires_at = max(value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC) for value in expiries)
        if expires_at <= datetime.now(UTC):
            raise HTTPException(402, "Срок доступа истёк. Продлите подписку перед включением автоматической публикации")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, key, value)

    if payload.auto_generate is False:
        # Flush the mode change first, so queue completion sees it under the same
        # write lock. Never touch an explicitly approved or uncertain publication.
        await db.flush()
        await db.execute(update(PostingTask).where(
            PostingTask.project_id == project.id,
            PostingTask.status == PostingTaskStatus.QUEUED,
            PostingTask.generation_metadata["auto_generated"].as_boolean().is_(True),
            PostingTask.generation_metadata["approved_by_owner"].as_boolean().is_not(True),
            PostingTask.generation_metadata["publication_confirmation_pending"].as_boolean().is_not(True),
        ).values(status=PostingTaskStatus.DRAFT, scheduled_at=None,
                 error_message="Автоматическая публикация выключена. Проверьте текст и согласуйте время."))

    await db.commit()
    await db.refresh(project)
    schedule_project_queue_refill(project.id)
    return project


@router.put("/{project_id}", response_model=ProjectRead, status_code=status.HTTP_200_OK)
async def replace_project(
    project_id: int,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
    current_user: User = Depends(require_active_subscription),
) -> ProjectRead:
    return await update_project(
        project_id=project_id,
        payload=payload,
        db=db,
        current_user_id=current_user_id,
        current_user=current_user,
    )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> None:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)

    await db.execute(
        update(Account)
        .where(Account.project_id == project.id)
        .values(project_id=None)
    )
    await db.execute(update(StudioDraft).where(StudioDraft.imported_task_id.in_(
        select(PostingTask.id).where(PostingTask.project_id == project.id)
    )).values(imported_task_id=None))
    await db.execute(delete(PostingTask).where(PostingTask.project_id == project.id))
    await db.execute(delete(SavedTrend).where(SavedTrend.project_id == project.id))
    await db.execute(delete(ProjectPrompt).where(ProjectPrompt.project_id == project.id))
    await db.execute(delete(ProjectOperation).where(ProjectOperation.project_id == project.id))
    await db.execute(
        delete(Project).where(
            Project.id == project.id,
            Project.owner_id == current_user_id,
        )
    )
    await db.commit()


@router.get(
    "/{project_id}/dashboard",
    response_model=ProjectDashboardRead,
    status_code=status.HTTP_200_OK,
)
async def get_project_dashboard(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ProjectDashboardRead:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)

    accounts_count = await db.scalar(
        select(func.count(Account.id)).where(Account.project_id == project_id)
    )
    saved_trends_count = await db.scalar(
        select(func.count(SavedTrend.id)).where(SavedTrend.project_id == project_id)
    )
    status_rows = (
        await db.execute(
            select(PostingTask.status, func.count(PostingTask.id))
            .where(PostingTask.project_id == project_id)
            .group_by(PostingTask.status)
        )
    ).all()
    recent_errors = list(
        (
            await db.scalars(
                select(PostingTask.error_message)
                .where(
                    PostingTask.project_id == project_id,
                    PostingTask.status == PostingTaskStatus.FAILED,
                    PostingTask.error_message.is_not(None),
                )
                .order_by(PostingTask.updated_at.desc())
                .limit(5)
            )
        ).all()
    )
    account_states = list(
        (
            await db.scalars(
                select(Account)
                .where(Account.project_id == project_id)
                .order_by(Account.created_at.desc())
            )
        ).all()
    )
    last_generation_at = await db.scalar(
        select(func.max(PostingTask.created_at)).where(PostingTask.project_id == project_id)
    )

    return ProjectDashboardRead(
        project=project,
        accounts_count=accounts_count or 0,
        saved_trends_count=saved_trends_count or 0,
        posting_tasks_by_status={status.value: count for status, count in status_rows},
        recent_errors=recent_errors,
        account_states=[
            ProjectAccountStateRead(
                id=account.id,
                username=account.username,
                platform=account.platform,
                status=account.status,
                last_error=account.last_error,
                last_used_at=account.last_used_at,
            )
            for account in account_states
        ],
        last_generation_at=last_generation_at,
    )


@router.post(
    "/{project_id}/trigger-scraping",
    response_model=TriggerScrapingRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_project_scraping(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
    _subscription: User = Depends(require_active_subscription),
) -> TriggerScrapingRead:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)
    account_id = await _get_active_threads_account_id(project_id=project.id, owner_id=current_user_id, db=db)

    if account_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Сначала подключите рабочий профиль Threads. После этого можно будет собрать идеи для постов.",
        )

    running_operation = await db.scalar(
        select(ProjectOperation)
        .where(
            ProjectOperation.project_id == project.id,
            ProjectOperation.owner_id == current_user_id,
            ProjectOperation.action_type == ProjectOperationType.SCRAPING,
            ProjectOperation.status.in_([ProjectOperationStatus.QUEUED, ProjectOperationStatus.RUNNING]),
        )
        .order_by(ProjectOperation.started_at.desc())
        .limit(1)
    )

    if running_operation is not None:
        return TriggerScrapingRead(
            project_id=project.id,
            operation_id=running_operation.id,
            status=running_operation.status,
            message=running_operation.message,
        )

    operation = ProjectOperation(
        project_id=project.id,
        owner_id=current_user_id,
        action_type=ProjectOperationType.SCRAPING,
        status=ProjectOperationStatus.QUEUED,
        message="Сбор идей поставлен в очередь и начнётся в ближайшее безопасное окно.",
    )
    db.add(operation)
    await db.commit()
    await db.refresh(operation)

    return TriggerScrapingRead(
        project_id=project.id,
        operation_id=operation.id,
        status=operation.status,
        message=operation.message,
    )


@router.get(
    "/{project_id}/operations/latest",
    response_model=ProjectOperationRead | None,
    status_code=status.HTTP_200_OK,
)
async def get_latest_project_operation(
    project_id: int,
    action_type: ProjectOperationType = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ProjectOperationRead | None:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)
    operation = await db.scalar(
        select(ProjectOperation)
        .where(
            ProjectOperation.project_id == project.id,
            ProjectOperation.owner_id == current_user_id,
            ProjectOperation.action_type == action_type,
        )
        .order_by(ProjectOperation.started_at.desc())
        .limit(1)
    )

    return operation


@router.get(
    "/{project_id}/operations",
    response_model=list[ProjectOperationRead],
    status_code=status.HTTP_200_OK,
)
async def get_project_operations(
    project_id: int,
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> list[ProjectOperationRead]:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)
    operations = await db.scalars(
        select(ProjectOperation)
        .where(
            ProjectOperation.project_id == project.id,
            ProjectOperation.owner_id == current_user_id,
        )
        .order_by(ProjectOperation.started_at.desc())
        .limit(limit)
    )

    return list(operations.all())


@router.post(
    "/{project_id}/trigger-generation",
    response_model=TriggerGenerationRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_project_generation(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
    _subscription: User = Depends(require_active_subscription),
) -> TriggerGenerationRead:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)
    # Serialize the short reservation only; do not hold a database write lock while AI runs.
    await db.execute(update(Project).where(Project.id == project.id).values(is_active=Project.is_active))
    now = datetime.now(UTC)
    stale_before = now - timedelta(minutes=3)
    await db.execute(update(ProjectOperation).where(
        ProjectOperation.project_id == project.id,
        ProjectOperation.action_type == ProjectOperationType.GENERATION,
        ProjectOperation.status == ProjectOperationStatus.RUNNING,
        ProjectOperation.started_at < stale_before,
    ).values(status=ProjectOperationStatus.FAILED, finished_at=now,
             message="Генерация была прервана. Можно повторить запрос."))
    running = await db.scalar(select(ProjectOperation.id).where(
        ProjectOperation.project_id == project.id,
        ProjectOperation.action_type == ProjectOperationType.GENERATION,
        ProjectOperation.status == ProjectOperationStatus.RUNNING,
    ).limit(1))
    if running is not None:
        raise HTTPException(409, "Черновик уже генерируется. Дождитесь результата и обновите список")
    operation = ProjectOperation(
        project_id=project.id,
        owner_id=current_user_id,
        action_type=ProjectOperationType.GENERATION,
        status=ProjectOperationStatus.RUNNING,
        message="Генерация поста запущена.",
    )
    db.add(operation)
    await db.commit()
    operation_id = operation.id

    try:
        posting_task = await asyncio.wait_for(generate_post(
            project_id=project.id,
            topic_or_context=_build_generation_topic(project),
            session=db,
            platform=Platform.THREADS,
            account_id=None,
            scheduled_at=None,
            use_trends=True,
            persist=False,
        ), timeout=120)
        # End the read transaction used by the generator before checking the current
        # owner and reserving completion. Deletion can occur while the provider runs.
        await db.rollback()
        owned = await db.execute(update(Project).where(
            Project.id == project_id, Project.owner_id == current_user_id,
        ).values(is_active=Project.is_active))
        if owned.rowcount != 1:
            raise HTTPException(404, "Проект удалён или больше недоступен. Черновик не сохранён")
        completed = await db.execute(update(ProjectOperation).where(
            ProjectOperation.id == operation_id, ProjectOperation.project_id == project_id,
            ProjectOperation.owner_id == current_user_id,
            ProjectOperation.status == ProjectOperationStatus.RUNNING,
        ).values(status=ProjectOperationStatus.SUCCESS, finished_at=datetime.now(UTC),
                 message="Черновик подготовлен."))
        if completed.rowcount != 1:
            raise HTTPException(409, "Операция уже завершена или прервана. Обновите список черновиков")
        posting_task.status = PostingTaskStatus.DRAFT
        db.add(posting_task)
        await db.flush()
        await db.execute(update(ProjectOperation).where(ProjectOperation.id == operation_id).values(
            message=f"Черновик подготовлен: задача #{posting_task.id}.",
            result_json={"task_id": posting_task.id, "scheduled_at": None},
        ))
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        # The project (and operation) may have been removed during the AI request.
        # An absent or already completed operation must never be resurrected.
        await db.execute(update(ProjectOperation).where(
            ProjectOperation.id == operation_id, ProjectOperation.owner_id == current_user_id,
            ProjectOperation.status == ProjectOperationStatus.RUNNING,
        ).values(status=ProjectOperationStatus.FAILED,
                 message="Не удалось подготовить пост. Попробуйте ещё раз позже.",
                 result_json={"error_type": type(exc).__name__}, finished_at=datetime.now(UTC)))
        await db.commit()
        logger.warning("Manual draft generation failed for project %s (%s)", project_id, type(exc).__name__)
        raise HTTPException(502, "Не удалось подготовить черновик. Попробуйте ещё раз позже") from exc

    return TriggerGenerationRead(
        project_id=project_id,
        task_id=posting_task.id,
        status=posting_task.status,
        scheduled_at=posting_task.scheduled_at,
        content_text=posting_task.content_text,
        posts_chain=posting_task.posts_chain,
    )


@router.get("/", response_model=list[ProjectRead], status_code=status.HTTP_200_OK)
async def get_all_projects(
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> list[ProjectRead]:
    stmt = (
        select(Project)
        .where(Project.owner_id == current_user_id)
        .order_by(Project.created_at.desc())
    )
    return list((await db.scalars(stmt)).all())


async def _get_existing_project(project_id: int, db: AsyncSession) -> Project:
    repository = ProjectRepository(db)
    project = await repository.get_project(project_id)

    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    return project


async def _get_owned_project(project_id: int, owner_id: int, db: AsyncSession) -> Project:
    project = await db.scalar(
        select(Project)
        .where(
            Project.id == project_id,
            Project.owner_id == owner_id,
        )
        .limit(1)
    )

    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    return project


async def _get_active_threads_account_id(project_id: int, owner_id: int, db: AsyncSession) -> int | None:
    return await db.scalar(
        select(Account.id)
        .where(
            Account.project_id == project_id,
            Account.owner_id == owner_id,
            Account.platform == Platform.THREADS,
            Account.status == AccountStatus.ACTIVE,
            Account.cookies_encrypted.is_not(None),
            Account.assigned_port.is_not(None),
        )
        .order_by(Account.last_used_at.asc().nullsfirst(), Account.created_at.asc())
        .limit(1)
    )


def _build_generation_topic(project: ProjectRead) -> str:
    project_context = project.global_context or project.description
    context_parts = [
        project.name,
        project.niche,
        project_context,
        project.target_audience,
        project.product_context,
        ". ".join(project.target_actions or []),
        f"conversion mode: {project.conversion_mode}",
        f"conversion asset: {project.conversion_target}" if project.conversion_target else None,
    ]
    topic = ". ".join(part for part in context_parts if part)

    if topic:
        return topic

    return "Сгенерируй актуальный экспертный пост для Threads на основе правил проекта."

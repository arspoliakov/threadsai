import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import BaseModel, ConfigDict
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db
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
)
from app.db.repositories.projects import ProjectRepository
from app.db.session import AsyncSessionLocal
from app.parsers.scraper import scrape_trends
from app.parsers.trend_analyzer import analyze_and_save_trends
from app.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate


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


@router.post("/", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ProjectRead:
    repository = ProjectRepository(db)
    project = await repository.create_project(payload)
    project.owner_id = current_user_id
    await db.commit()
    await db.refresh(project)

    return project


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
) -> ProjectRead:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, key, value)

    await db.commit()
    await db.refresh(project)
    return project


@router.put("/{project_id}", response_model=ProjectRead, status_code=status.HTTP_200_OK)
async def replace_project(
    project_id: int,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> ProjectRead:
    return await update_project(project_id=project_id, payload=payload, db=db, current_user_id=current_user_id)


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
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> TriggerScrapingRead:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)

    running_operation = await db.scalar(
        select(ProjectOperation)
        .where(
            ProjectOperation.project_id == project.id,
            ProjectOperation.owner_id == current_user_id,
            ProjectOperation.action_type == ProjectOperationType.SCRAPING,
            ProjectOperation.status == ProjectOperationStatus.RUNNING,
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
        status=ProjectOperationStatus.RUNNING,
        message="Анализ трендов запущен. Можно уйти со страницы, процесс продолжится в фоне.",
    )
    db.add(operation)
    await db.commit()
    await db.refresh(operation)

    background_tasks.add_task(_run_scraping_operation, operation.id)

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
) -> TriggerGenerationRead:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)
    account_id = await db.scalar(
        select(Account.id)
        .where(
            Account.project_id == project.id,
            Account.platform == Platform.THREADS,
            Account.status == AccountStatus.ACTIVE,
        )
        .order_by(Account.last_used_at.asc().nullsfirst(), Account.created_at.asc())
        .limit(1)
    )

    if account_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project has no active Threads account assigned.",
        )

    operation = ProjectOperation(
        project_id=project.id,
        owner_id=current_user_id,
        action_type=ProjectOperationType.GENERATION,
        status=ProjectOperationStatus.RUNNING,
        message="Генерация поста запущена.",
    )
    db.add(operation)
    await db.flush()

    try:
        posting_task = await generate_post(
            project_id=project.id,
            topic_or_context=_build_generation_topic(project),
            session=db,
            platform=Platform.THREADS,
            account_id=account_id,
            scheduled_at=datetime.now(UTC) + timedelta(minutes=5),
            use_trends=True,
        )
        operation.status = ProjectOperationStatus.SUCCESS
        operation.message = f"Пост сгенерирован и поставлен в очередь: задача #{posting_task.id}."
        operation.result_json = {
            "task_id": posting_task.id,
            "scheduled_at": posting_task.scheduled_at.isoformat() if posting_task.scheduled_at else None,
        }
        operation.finished_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(posting_task)
    except Exception as exc:
        operation.status = ProjectOperationStatus.FAILED
        operation.message = f"Генерация завершилась ошибкой: {exc}"
        operation.result_json = {"error": str(exc)}
        operation.finished_at = datetime.now(UTC)
        await db.commit()
        raise

    return TriggerGenerationRead(
        project_id=project.id,
        task_id=posting_task.id,
        status=posting_task.status,
        scheduled_at=posting_task.scheduled_at,
        content_text=posting_task.content_text,
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


async def _run_scraping_operation(operation_id: int) -> None:
    async with AsyncSessionLocal() as session:
        operation = await session.get(ProjectOperation, operation_id)

        if operation is None:
            logger.warning("Project scraping operation %s not found.", operation_id)
            return

        try:
            logger.info("Project scraping operation %s started for project %s.", operation.id, operation.project_id)
            scrape_result = await scrape_trends(project_id=operation.project_id, session=session)
            saved_trends = await analyze_and_save_trends(
                project_id=operation.project_id,
                raw_posts=scrape_result.raw_posts,
                session=session,
            )
            operation.status = ProjectOperationStatus.SUCCESS
            operation.message = (
                f"Анализ трендов завершен: собрано {len(scrape_result.raw_posts)}, "
                f"сохранено {len(saved_trends)}."
            )
            operation.result_json = {
                "collected_posts_count": len(scrape_result.raw_posts),
                "saved_trends_count": len(saved_trends),
            }
            operation.finished_at = datetime.now(UTC)
            await session.commit()
            logger.info("Project scraping operation %s completed.", operation.id)
        except Exception as exc:
            await session.rollback()
            failed_operation = await session.get(ProjectOperation, operation_id)

            if failed_operation is not None:
                failed_operation.status = ProjectOperationStatus.FAILED
                failed_operation.message = f"Анализ трендов завершился ошибкой: {exc}"
                failed_operation.result_json = {"error": str(exc)}
                failed_operation.finished_at = datetime.now(UTC)
                await session.commit()

            logger.exception("Project scraping operation %s failed.", operation_id)


def _build_generation_topic(project: ProjectRead) -> str:
    context_parts = [
        project.name,
        project.niche,
        project.description,
        project.target_audience,
        project.product_context,
    ]
    topic = ". ".join(part for part in context_parts if part)

    if topic:
        return topic

    return "Сгенерируй актуальный экспертный пост для Threads на основе правил проекта."

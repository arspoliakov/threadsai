from datetime import UTC, datetime, timedelta

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db
from app.ai_engine.generators import generate_post
from app.db.models import Account, AccountStatus, Platform, PostingTask, PostingTaskStatus, Project, SavedTrend
from app.db.repositories.projects import ProjectRepository
from app.parsers.scraper import scrape_trends
from app.parsers.trend_analyzer import analyze_and_save_trends
from app.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate


router = APIRouter(prefix="/projects", tags=["projects"])


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
    collected_posts_count: int
    saved_trends_count: int


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
) -> TriggerScrapingRead:
    project = await _get_owned_project(project_id=project_id, owner_id=current_user_id, db=db)
    scrape_result = await scrape_trends(project_id=project.id, session=db)
    saved_trends = await analyze_and_save_trends(
        project_id=project.id,
        raw_posts=scrape_result.raw_posts,
        session=db,
    )

    return TriggerScrapingRead(
        project_id=project.id,
        collected_posts_count=len(scrape_result.raw_posts),
        saved_trends_count=len(saved_trends),
    )


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

    posting_task = await generate_post(
        project_id=project.id,
        topic_or_context=_build_generation_topic(project),
        session=db,
        platform=Platform.THREADS,
        account_id=account_id,
        scheduled_at=datetime.now(UTC) + timedelta(minutes=5),
        use_trends=True,
    )

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

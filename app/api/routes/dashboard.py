from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db
from app.db.models import PostingTask, PostingTaskStatus, Project
from app.posting.scheduler import scheduler


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class DashboardProjectSummary(BaseModel):
    id: int
    name: str
    published_count: int
    next_post_time: datetime | None
    avg_engagement: float | None = None


class DashboardSummaryRead(BaseModel):
    next_trend_check: datetime | None
    projects: list[DashboardProjectSummary]


@router.get("/summary", response_model=DashboardSummaryRead, status_code=status.HTTP_200_OK)
async def get_dashboard_summary(
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> DashboardSummaryRead:
    trend_job = scheduler.get_job("analyze_daily_trends")
    next_trend_check = trend_job.next_run_time if trend_job else None

    projects = list(
        (
            await db.scalars(
                select(Project).where(Project.is_active.is_(True)).order_by(Project.id.asc())
                .where(Project.owner_id == current_user_id)
            )
        ).all()
    )

    summaries: list[DashboardProjectSummary] = []
    for project in projects:
        published_count = await db.scalar(
            select(func.count(PostingTask.id)).where(
                PostingTask.project_id == project.id,
                PostingTask.status == PostingTaskStatus.SUCCESS,
            )
        )
        next_post_time = await db.scalar(
            select(func.min(PostingTask.scheduled_at)).where(
                PostingTask.project_id == project.id,
                PostingTask.status == PostingTaskStatus.QUEUED,
                PostingTask.scheduled_at.is_not(None),
            )
        )

        summaries.append(
            DashboardProjectSummary(
                id=project.id,
                name=project.name,
                published_count=published_count or 0,
                next_post_time=next_post_time,
                avg_engagement=None,
            )
        )

    return DashboardSummaryRead(next_trend_check=next_trend_check, projects=summaries)

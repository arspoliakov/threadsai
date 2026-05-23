from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db
from app.db.models import Platform, Project, SavedTrend


router = APIRouter(prefix="/trends", tags=["trends"])


class SavedTrendRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    platform: Platform
    source_url: str
    author_handle: str | None
    raw_text: str
    metrics_json: dict[str, Any] | None
    ai_summary: str | None
    virality_score: float | None
    hook_analysis: str | None
    hook_mechanic: str | None
    structure_pattern: str | None
    tone_and_rhythm: str | None
    living_phrases: list[str]
    semantic_forbidden_zone: list[str]
    adaptation_notes: str | None
    parsed_at: datetime | None
    analyzed: bool
    created_at: datetime
    updated_at: datetime


@router.get("/", response_model=list[SavedTrendRead], status_code=status.HTTP_200_OK)
async def get_trends(
    project_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> list[SavedTrendRead]:
    stmt = (
        select(SavedTrend)
        .join(Project, SavedTrend.project_id == Project.id)
        .where(Project.owner_id == current_user_id)
    )

    if project_id is not None:
        stmt = stmt.where(SavedTrend.project_id == project_id)

    stmt = stmt.order_by(SavedTrend.created_at.desc()).limit(limit)
    return list((await db.scalars(stmt)).all())

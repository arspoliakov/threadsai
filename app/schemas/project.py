from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
    description: str | None = None
    global_context: str | None = None
    target_actions: list[str] = Field(default_factory=list)
    niche: str | None = Field(default=None, max_length=255)
    target_audience: str | None = None
    tone_of_voice: str | None = None
    product_context: str | None = None
    stop_words: list[str] = Field(default_factory=list)
    posts_per_day: int = Field(default=3, ge=1, le=20)
    active_hours_start: str = Field(default="09:00", pattern=r"^\d{2}:\d{2}$")
    active_hours_end: str = Field(default="21:00", pattern=r"^\d{2}:\d{2}$")
    timezone: str = Field(default="Europe/Moscow", min_length=1, max_length=64)
    is_active: bool = True


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    slug: str | None = Field(
        default=None,
        min_length=1,
        max_length=120,
        pattern=r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$",
    )
    description: str | None = None
    global_context: str | None = None
    target_actions: list[str] | None = None
    niche: str | None = Field(default=None, max_length=255)
    target_audience: str | None = None
    tone_of_voice: str | None = None
    product_context: str | None = None
    stop_words: list[str] | None = None
    posts_per_day: int | None = Field(default=None, ge=1, le=20)
    active_hours_start: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    active_hours_end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    is_active: bool | None = None


class ProjectRead(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int | None
    created_at: datetime
    updated_at: datetime

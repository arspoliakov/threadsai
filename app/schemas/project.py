from datetime import datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    conversion_mode: str = Field(default="bio_link", pattern=r"^(bio_link|pinned_post|none)$")
    conversion_target: str | None = None
    conversion_intensity: int = Field(default=25, ge=0, le=100)
    stop_words: list[str] = Field(default_factory=list)
    posts_per_day: int = Field(default=3, ge=1, le=20)
    active_hours_start: str = Field(default="09:00", pattern=r"^\d{2}:\d{2}$")
    active_hours_end: str = Field(default="21:00", pattern=r"^\d{2}:\d{2}$")
    timezone: str = Field(default="Europe/Moscow", min_length=1, max_length=64)
    is_active: bool = True

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return _validate_timezone(value)

    @field_validator("active_hours_start", "active_hours_end")
    @classmethod
    def validate_active_time(cls, value: str) -> str:
        return _validate_active_time(value)


class ProjectCreate(ProjectBase):
    slug: str | None = Field(default=None, max_length=120)


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
    conversion_mode: str | None = Field(default=None, pattern=r"^(bio_link|pinned_post|none)$")
    conversion_target: str | None = None
    conversion_intensity: int | None = Field(default=None, ge=0, le=100)
    stop_words: list[str] | None = None
    posts_per_day: int | None = Field(default=None, ge=1, le=20)
    active_hours_start: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    active_hours_end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    is_active: bool | None = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return _validate_timezone(value)

    @field_validator("active_hours_start", "active_hours_end")
    @classmethod
    def validate_active_time(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return _validate_active_time(value)


class ProjectRead(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int | None
    created_at: datetime
    updated_at: datetime


def _validate_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("timezone must be a valid IANA timezone, for example Europe/Moscow") from exc

    return value


def _validate_active_time(value: str) -> str:
    try:
        parsed = time.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("time must use valid 24-hour HH:MM format") from exc

    if parsed.second or parsed.microsecond:
        raise ValueError("time must use HH:MM without seconds")

    return parsed.strftime("%H:%M")

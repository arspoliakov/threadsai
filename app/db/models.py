from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def enum_values(enum_cls: type[StrEnum]) -> list[str]:
    return [item.value for item in enum_cls]


class Platform(StrEnum):
    TWITTER = "twitter"
    INSTAGRAM = "instagram"
    FACEBOOK = "facebook"
    THREADS = "threads"
    BLUESKY = "bluesky"


class AccountStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"
    ERROR = "error"
    WARMING_UP = "warming_up"
    COOKIES_EXPIRED = "cookies_expired"
    BLOCKED = "blocked"
    PROXY_ERROR = "proxy_error"


class PostingTaskStatus(StrEnum):
    DRAFT = "draft"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    PARTIAL_SUCCESS = "partial_success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ProjectOperationType(StrEnum):
    SCRAPING = "scraping"
    GENERATION = "generation"


class ProjectOperationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class PromptType(StrEnum):
    VIRALITY = "virality"
    HOOK = "hook"
    FORMATTING = "formatting"
    RETENTION = "retention"
    PROJECT_CONTEXT = "project_context"
    TONE_OF_VOICE = "tone_of_voice"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    global_context: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_actions: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    niche: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_audience: Mapped[str | None] = mapped_column(Text, nullable=True)
    tone_of_voice: Mapped[str | None] = mapped_column(Text, nullable=True)
    product_context: Mapped[str | None] = mapped_column(Text, nullable=True)
    conversion_mode: Mapped[str] = mapped_column(String(32), default="bio_link", nullable=False)
    conversion_target: Mapped[str | None] = mapped_column(Text, nullable=True)
    conversion_intensity: Mapped[int] = mapped_column(Integer, default=25, nullable=False)
    stop_words: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    posts_per_day: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    active_hours_start: Mapped[str] = mapped_column(String(5), default="09:00", nullable=False)
    active_hours_end: Mapped[str] = mapped_column(String(5), default="21:00", nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Moscow", nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    accounts: Mapped[list[Account]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    posting_tasks: Mapped[list[PostingTask]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    saved_trends: Mapped[list[SavedTrend]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    project_prompts: Mapped[list[ProjectPrompt]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    operations: Mapped[list[ProjectOperation]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    owner: Mapped[User | None] = relationship(back_populates="projects")


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    telegram_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, index=True, nullable=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_name: Mapped[str] = mapped_column(String(255), nullable=False)
    photo_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    subscription_status: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    tariff_plan: Mapped[str] = mapped_column(String(32), default="none", nullable=False)
    tariff_accounts_limit: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tariff_posts_per_day: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tariff_projects_limit: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tariff_queue_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    projects: Mapped[list[Project]] = relationship(back_populates="owner")
    accounts: Mapped[list[Account]] = relationship(back_populates="owner")


class AccountExtensionLink(Base):
    __tablename__ = "account_extension_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class Account(Base, TimestampMixin):
    __tablename__ = "accounts"
    __table_args__ = (
        Index("ix_accounts_project_platform", "project_id", "platform"),
        Index("ix_accounts_assigned_port_unique", "assigned_port", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    platform: Mapped[Platform] = mapped_column(
        SAEnum(Platform, values_callable=enum_values),
        nullable=False,
    )
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    proxy_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    assigned_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session_data_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    cookies_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[AccountStatus] = mapped_column(
        SAEnum(AccountStatus, values_callable=enum_values),
        default=AccountStatus.ACTIVE,
        nullable=False,
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    proxy_error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    project: Mapped[Project | None] = relationship(back_populates="accounts")
    owner: Mapped[User | None] = relationship(back_populates="accounts")
    posting_tasks: Mapped[list[PostingTask]] = relationship(back_populates="account")


class PostingTask(Base, TimestampMixin):
    __tablename__ = "posting_tasks"
    __table_args__ = (
        Index("ix_posting_tasks_project_status", "project_id", "status"),
        Index("ix_posting_tasks_scheduled_at", "scheduled_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    source_trend_id: Mapped[int | None] = mapped_column(ForeignKey("saved_trends.id"), nullable=True)
    platform: Mapped[Platform] = mapped_column(
        SAEnum(Platform, values_callable=enum_values),
        nullable=False,
    )
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    posts_chain: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    media_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    status: Mapped[PostingTaskStatus] = mapped_column(
        SAEnum(PostingTaskStatus, values_callable=enum_values),
        default=PostingTaskStatus.DRAFT,
        nullable=False,
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_post_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    generation_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    project: Mapped[Project] = relationship(back_populates="posting_tasks")
    account: Mapped[Account | None] = relationship(back_populates="posting_tasks")
    source_trend: Mapped[SavedTrend | None] = relationship(back_populates="posting_tasks")

    @property
    def account_username(self) -> str | None:
        return self.account.username if self.account is not None else None


class SavedTrend(Base, TimestampMixin):
    __tablename__ = "saved_trends"
    __table_args__ = (
        Index("ix_saved_trends_project_platform", "project_id", "platform"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False)
    platform: Mapped[Platform] = mapped_column(
        SAEnum(Platform, values_callable=enum_values),
        nullable=False,
    )
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    author_handle: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    metrics_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    virality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    hook_analysis: Mapped[str | None] = mapped_column(Text, nullable=True)
    hook_mechanic: Mapped[str | None] = mapped_column(Text, nullable=True)
    structure_pattern: Mapped[str | None] = mapped_column(Text, nullable=True)
    tone_and_rhythm: Mapped[str | None] = mapped_column(Text, nullable=True)
    living_phrases: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    semantic_forbidden_zone: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    adaptation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    analyzed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    project: Mapped[Project] = relationship(back_populates="saved_trends")
    posting_tasks: Mapped[list[PostingTask]] = relationship(back_populates="source_trend")


class ProjectPrompt(Base, TimestampMixin):
    __tablename__ = "project_prompts"
    __table_args__ = (
        Index("ix_project_prompts_project_type", "project_id", "prompt_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False)
    prompt_type: Mapped[PromptType] = mapped_column(
        SAEnum(PromptType, values_callable=enum_values),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    project: Mapped[Project] = relationship(back_populates="project_prompts")


class GlobalPrompt(Base, TimestampMixin):
    __tablename__ = "global_prompts"
    __table_args__ = (
        Index("ix_global_prompts_type_active", "prompt_type", "is_active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    prompt_type: Mapped[PromptType] = mapped_column(
        SAEnum(PromptType, values_callable=enum_values),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(String(50), default="1.0.0", nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)


class ProjectOperation(Base, TimestampMixin):
    __tablename__ = "project_operations"
    __table_args__ = (
        Index("ix_project_operations_project_action", "project_id", "action_type"),
        Index("ix_project_operations_status", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    action_type: Mapped[ProjectOperationType] = mapped_column(
        SAEnum(ProjectOperationType, values_callable=enum_values),
        nullable=False,
    )
    status: Mapped[ProjectOperationStatus] = mapped_column(
        SAEnum(ProjectOperationStatus, values_callable=enum_values),
        default=ProjectOperationStatus.QUEUED,
        nullable=False,
    )
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="operations")

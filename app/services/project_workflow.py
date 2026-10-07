"""One owner-scoped account of readiness, without exposing connection secrets."""
from datetime import UTC, datetime

from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Account, AccountStatus, Platform, PostingTask, PostingTaskStatus, Project, ProjectOperation, ProjectOperationStatus, User
from app.services.publication_mode import publication_mode
from app.services.proxy_pool import build_threads_proxy_url_for_account
from app.services.subscriptions import has_current_subscription_access


class WorkflowBlocker(BaseModel):
    code: str
    message: str
    action_label: str
    action_href: str


class WorkflowAction(BaseModel):
    code: str
    label: str
    href: str


class ProjectWorkflowRead(BaseModel):
    ready: bool
    blockers: list[WorkflowBlocker]
    next_action: WorkflowAction | None
    next_post_at: datetime | None
    publication_mode: str
    review_count: int
    running_jobs: int

    @field_validator("next_post_at", mode="before")
    @classmethod
    def normalize_next_post_time(cls, value):
        if isinstance(value, datetime):
            return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        return value


def account_connection_ready(account: Account) -> bool:
    if account.platform != Platform.THREADS or account.status != AccountStatus.ACTIVE or not account.cookies_encrypted:
        return False
    if account.cooldown_until is not None:
        until = account.cooldown_until.replace(tzinfo=UTC) if account.cooldown_until.tzinfo is None else account.cooldown_until
        if until > datetime.now(UTC):
            return False
    try:
        return bool(build_threads_proxy_url_for_account(account))
    except Exception:
        return False


async def build_project_workflow(project: Project, session: AsyncSession) -> ProjectWorkflowRead:
    owner = await session.get(User, project.owner_id) if project.owner_id is not None else None
    accounts = list((await session.scalars(select(Account).where(
        Account.project_id == project.id, Account.owner_id == project.owner_id,
        Account.platform == Platform.THREADS).order_by(Account.id))).all())
    blockers = []
    settings_href = f"/app/projects/{project.id}/settings"
    posts_href = f"/app/projects/{project.id}/queue"

    def block(code, message, label, href):
        blockers.append(WorkflowBlocker(code=code, message=message, action_label=label, action_href=href))

    if owner is None or not has_current_subscription_access(owner):
        block("subscription_expired", "Для работы проекта нужна действующая подписка.", "Открыть подписку", "/app/billing")
    if not project.is_active:
        block("project_paused", "Проект на паузе.", "Открыть настройки", settings_href)
    if not (project.global_context or project.description or "").strip():
        block("context_missing", "Расскажите, о чём писать и для кого.", "Добавить тему", settings_href + "#content")
    working = [a for a in accounts if account_connection_ready(a)]
    if not accounts:
        block("account_missing", "Подключите свой аккаунт Threads.", "Подключить аккаунт", settings_href + "#accounts")
    elif not working:
        a = accounts[0]
        if a.status in {AccountStatus.BLOCKED, AccountStatus.ERROR}:
            block("account_security", "Аккаунт остановлен: требуется проверка входа или ограничений Threads.", "Проверить аккаунт", settings_href + "#accounts")
        elif a.status in {AccountStatus.DISABLED, AccountStatus.WARMING_UP}:
            block("account_paused", "Аккаунт сейчас не готов к работе.", "Проверить аккаунт", settings_href + "#accounts")
        elif a.cooldown_until is not None and (a.cooldown_until.replace(tzinfo=UTC) if a.cooldown_until.tzinfo is None else a.cooldown_until) > datetime.now(UTC):
            block("account_paused", "Аккаунт временно на паузе после ограничения Threads.", "Проверить аккаунт", settings_href + "#accounts")
        elif a.status == AccountStatus.COOKIES_EXPIRED or not a.cookies_encrypted:
            block("login_expired", "Нужно обновить вход в Threads.", "Обновить вход", settings_href + "#accounts")
        else:
            block("proxy_unavailable", "Соединение аккаунта требует проверки.", "Проверить подключение", settings_href + "#accounts")
    review_count = int(await session.scalar(select(func.count(PostingTask.id)).where(
        PostingTask.project_id == project.id, PostingTask.status == PostingTaskStatus.DRAFT)) or 0)
    running_jobs = int(await session.scalar(select(func.count(PostingTask.id)).where(
        PostingTask.project_id == project.id, PostingTask.status == PostingTaskStatus.RUNNING)) or 0)
    running_jobs += int(await session.scalar(select(func.count(ProjectOperation.id)).where(
        ProjectOperation.project_id == project.id,
        ProjectOperation.status.in_([ProjectOperationStatus.QUEUED, ProjectOperationStatus.RUNNING]))) or 0)
    next_at = await session.scalar(select(func.min(PostingTask.scheduled_at)).where(
        PostingTask.project_id == project.id, PostingTask.status == PostingTaskStatus.QUEUED,
        PostingTask.scheduled_at >= datetime.now(UTC)))
    mode = publication_mode(project)
    uncertain = await session.scalar(select(PostingTask.id).where(
        PostingTask.project_id == project.id,
        PostingTask.generation_metadata["publication_confirmation_pending"].as_boolean().is_(True)).limit(1))
    if uncertain is not None:
        block("publication_unconfirmed", "Результат отправки одного из постов нужно проверить.", "Проверить результат", posts_href + "?filter=attention")
    if blockers:
        first = blockers[0]
        action = WorkflowAction(code=first.code, label=first.action_label, href=first.action_href)
    elif review_count:
        action = WorkflowAction(code="review_backlog", label="Проверить подготовленные посты", href=posts_href + "?filter=review")
    elif running_jobs:
        action = WorkflowAction(code="jobs_running", label="Посмотреть ход работы", href=posts_href)
    elif mode == "manual":
        action = WorkflowAction(code="create_post", label="Создать пост", href=posts_href + "?create=1")
    else:
        action = WorkflowAction(code="view_posts", label="Открыть посты", href=posts_href)
    return ProjectWorkflowRead(ready=not blockers, blockers=blockers, next_action=action,
        next_post_at=next_at, publication_mode=mode, review_count=review_count, running_jobs=running_jobs)

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.db.models import Account, AccountStatus, Platform, PostingTask, PostingTaskStatus, Project
from app.posting.adapters.base import BasePostingAdapter
from app.posting.adapters.threads import ThreadsAdapter
from app.posting.exceptions import RetryablePostingException, SessionExpiredException, ThreadChainPartialSuccess
from app.posting.scheduler import schedule_account_queue_refill
from app.services.proxy_pool import build_threads_proxy_url_for_account
from app.telegram.notifications import send_user_notification


SESSION_USERNAME_PLACEHOLDERS = {"", "из сессии", "Из сессии", "pending_from_session"}


def get_adapter(platform: Platform) -> BasePostingAdapter:
    if platform == Platform.THREADS:
        return ThreadsAdapter()

    raise ValueError(f"Unsupported posting platform: {platform.value}")


async def execute_posting_task(
    task_id: int,
    session: AsyncSession,
    *,
    deadline_at: float | None = None,
    ip_guard_proxy_url: str | None = None,
    expected_proxy_ip: str | None = None,
) -> PostingTask:
    stmt = (
        select(PostingTask)
        .options(
            joinedload(PostingTask.account)
            .joinedload(Account.project)
            .joinedload(Project.owner)
        )
        .where(PostingTask.id == task_id)
    )
    task = (await session.scalars(stmt)).one_or_none()

    if task is None:
        raise ValueError(f"Posting task not found: {task_id}")

    if task.account is None:
        await _mark_failed(session, task, "У задачи нет привязанного аккаунта публикации.")
        return task

    account: Account = task.account

    if account.status != AccountStatus.ACTIVE:
        task.status = PostingTaskStatus.QUEUED
        task.started_at = None
        task.finished_at = None
        task.error_message = f"Аккаунт недоступен для публикации: {account.status.value}"
        await session.commit()
        await session.refresh(task)
        return task

    if not _account_proxy_url(account):
        task.status = PostingTaskStatus.QUEUED
        task.started_at = None
        task.finished_at = None
        task.error_message = "Threads account has no assigned proxy port."
        await session.commit()
        await session.refresh(task)
        return task

    try:
        task.status = PostingTaskStatus.RUNNING
        task.started_at = datetime.now(UTC)
        task.error_message = None
        await session.commit()
        await session.refresh(task)

        adapter = get_adapter(account.platform)
        publish_result = await adapter.publish(
            account=account,
            task=task,
            deadline_at=deadline_at,
            ip_guard_proxy_url=ip_guard_proxy_url,
            expected_proxy_ip=expected_proxy_ip,
        )

        if publish_result.detected_username and _should_update_username(account.username):
            account.username = publish_result.detected_username

        task.status = PostingTaskStatus.SUCCESS
        task.finished_at = datetime.now(UTC)
        task.error_message = None
        account.last_used_at = task.finished_at
        account.last_error = None
        await session.commit()
        await session.refresh(task)
        schedule_account_queue_refill(task.project_id, account.id)
        return task
    except SessionExpiredException as exc:
        error_message = str(exc)
        await _mark_session_expired(session, task, account, error_message)
        await _notify_account_owner_about_session(account)
        return task
    except ThreadChainPartialSuccess as exc:
        error_message = str(exc)
        await _mark_partial_success(session, task, account, error_message, exc.published_count)
        return task
    except RetryablePostingException as exc:
        error_message = str(exc)
        await _mark_retryable(session, task, account, error_message)
        return task
    except Exception as exc:
        error_message = str(exc)
        await _mark_failed(session, task, error_message)
        await _notify_account_owner_about_posting_error(account, task, error_message)
        return task


async def _mark_failed(session: AsyncSession, task: PostingTask, error_message: str) -> None:
    task.status = PostingTaskStatus.FAILED
    task.finished_at = datetime.now(UTC)
    task.error_message = error_message
    task.retry_count += 1
    if task.account is not None:
        task.account.last_error = error_message
    await session.commit()
    await session.refresh(task)
    if task.account_id is not None:
        schedule_account_queue_refill(task.project_id, task.account_id)


async def _mark_retryable(
    session: AsyncSession,
    task: PostingTask,
    account: Account,
    error_message: str,
) -> None:
    is_proxy_rotation = _is_proxy_rotation_retry(error_message)
    task.status = PostingTaskStatus.QUEUED
    task.started_at = None
    task.finished_at = None
    task.error_message = (
        "Техническая пауза: прокси сменил IP во время публикации. Система повторит задачу автоматически."
        if is_proxy_rotation
        else error_message
    )
    task.retry_count += 1
    if not is_proxy_rotation:
        account.last_error = error_message
    await session.commit()
    await session.refresh(task)


async def _mark_partial_success(
    session: AsyncSession,
    task: PostingTask,
    account: Account,
    error_message: str,
    published_count: int,
) -> None:
    task.status = PostingTaskStatus.PARTIAL_SUCCESS
    task.finished_at = datetime.now(UTC)
    task.error_message = error_message
    metadata = task.generation_metadata if isinstance(task.generation_metadata, dict) else {}
    metadata["partial_success"] = True
    metadata["published_chain_items"] = published_count
    task.generation_metadata = metadata
    account.last_used_at = task.finished_at
    account.last_error = error_message
    await session.commit()
    await session.refresh(task)
    schedule_account_queue_refill(task.project_id, account.id)


async def _mark_session_expired(
    session: AsyncSession,
    task: PostingTask,
    account: Account,
    error_message: str,
) -> None:
    account.status = AccountStatus.COOKIES_EXPIRED
    account.last_error = error_message
    task.status = PostingTaskStatus.QUEUED
    task.started_at = None
    task.finished_at = None
    task.error_message = error_message
    await session.commit()
    await session.refresh(task)


async def _notify_account_owner_about_session(account: Account) -> None:
    project = account.project
    owner = project.owner if project is not None else None
    telegram_id = owner.telegram_id if owner is not None else None
    username = account.username or "без username"
    text = (
        f"Сессия Threads у аккаунта @{username} истекла.\n\n"
        "Публикация приостановлена, задача возвращена в очередь. "
        "Открой настройки проекта и обнови cookies."
    )
    await send_user_notification(telegram_id=telegram_id, text=text)


async def _notify_account_owner_about_posting_error(
    account: Account,
    task: PostingTask,
    error_message: str,
) -> None:
    project = account.project
    owner = project.owner if project is not None else None
    telegram_id = owner.telegram_id if owner is not None else None
    username = account.username or "без username"
    project_name = project.name if project is not None else f"#{task.project_id}"
    text = (
        "Публикация не прошла.\n\n"
        f"Проект: {project_name}\n"
        f"Аккаунт: @{username}\n"
        f"Задача: #{task.id}\n\n"
        f"Ошибка: {error_message[:1200]}"
    )
    await send_user_notification(telegram_id=telegram_id, text=text)


def _should_update_username(username: str | None) -> bool:
    normalized_username = (username or "").strip()
    return normalized_username in SESSION_USERNAME_PLACEHOLDERS


def _account_proxy_url(account: Account) -> str | None:
    return build_threads_proxy_url_for_account(account)


def _is_proxy_rotation_retry(error_message: str) -> bool:
    return "proxy ip changed during selenium session" in error_message.casefold()

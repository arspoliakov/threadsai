from datetime import UTC, datetime, timedelta
import time
from app.posting.error_safety import redact_connection_secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.db.models import Account, AccountStatus, Platform, PostingTask, PostingTaskStatus, Project
from app.core.config import settings
from app.posting.safety import extend_cooldown
from app.posting.adapters.base import BasePostingAdapter
from app.posting.adapters.threads import ThreadsAdapter
from app.posting.exceptions import (
    PublicationVerificationPending,
    RetryablePostingException,
    SessionExpiredException,
    ThreadChainPartialSuccess,
)
from app.posting.scheduler import schedule_account_queue_refill
from app.services.admin_notifier import send_admin_alert
from app.services.proxy_pool import build_threads_proxy_url_for_account
from app.services.subscriptions import has_current_subscription_access
from app.telegram.notifications import send_user_notification


SESSION_USERNAME_PLACEHOLDERS = {"", "из сессии", "Из сессии", "pending_from_session"}

QUARANTINE_ERROR_MARKERS = (
    "could not open threads composer",
    "could not type text into threads composer",
    "threads ui race",
    "composer editor",
    "manual verification",
    "manual confirmation",
    "confirm you're human",
    "checkpoint",
    "captcha",
    "login screen",
    "log in",
    "choose how you want",
    "content is not available",
    "http error 500",
    "error 500",
    "try again later",
    "too many requests",
    "temporarily blocked",
    "account suspended",
    "account disabled",
    "action blocked",
    "попробуйте позже",
    "аккаунт заблокирован",
    "аккаунт приостановлен",
)

HARD_QUARANTINE_ERROR_MARKERS = (
    "try again later",
    "too many requests",
    "temporarily blocked",
    "account suspended",
    "account disabled",
    "action blocked",
    "попробуйте позже",
    "аккаунт заблокирован",
    "аккаунт приостановлен",
    "manual verification",
    "manual confirmation",
    "confirm you're human",
    "checkpoint",
    "captcha",
    "login screen",
    "log in",
    "choose how you want",
    "content is not available",
    "http error 500",
    "error 500",
)

PROXY_RETRY_MARKERS = (
    "proxy ip changed during selenium session",
    "proxy/network",
    "err_proxy",
    "tunnel connection failed",
    "no exit node",
    "proxy",
)


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

    if account.project is None or account.project.owner is None or not has_current_subscription_access(account.project.owner):
        task.status = PostingTaskStatus.QUEUED
        task.started_at = None
        task.error_message = "Подписка закончилась. Возобновите доступ для публикации."
        await session.commit()
        return task

    owner = account.project.owner
    # Do not begin a send after known access expiration even within this job.
    access_end = owner.subscription_expires_at
    gift_end = owner.complimentary_access_expires_at
    if owner.subscription_phase == "gift":
        access_end = gift_end
    elif access_end is not None and gift_end is not None:
        normalized_paid = access_end if access_end.tzinfo else access_end.replace(tzinfo=UTC)
        normalized_gift = gift_end if gift_end.tzinfo else gift_end.replace(tzinfo=UTC)
        access_end = max(normalized_paid, normalized_gift)
    if access_end is not None:
        access_end = access_end if access_end.tzinfo else access_end.replace(tzinfo=UTC)
        access_deadline = time.monotonic() + max(0, (access_end - datetime.now(UTC)).total_seconds())
        deadline_at = min(deadline_at, access_deadline) if deadline_at is not None else access_deadline

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
        task.error_message = "У аккаунта Threads нет назначенного прокси-порта."
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
        task.external_post_url = publish_result.external_post_url
        task.finished_at = datetime.now(UTC)
        task.error_message = None
        account.last_used_at = task.finished_at
        extend_cooldown(account, task.finished_at + timedelta(minutes=settings.posting_min_interval_minutes))
        account.last_error = None
        await session.commit()
        await session.refresh(task)
        schedule_account_queue_refill(task.project_id, account.id)
        return task
    except SessionExpiredException as exc:
        error_message = redact_connection_secrets(str(exc))
        await _mark_session_expired(session, task, account, error_message)
        await _notify_account_owner_about_session(account)
        return task
    except ThreadChainPartialSuccess as exc:
        error_message = redact_connection_secrets(str(exc))
        await _mark_partial_success(session, task, account, error_message, exc.published_count)
        if _should_quarantine_account(error_message, task.retry_count):
            account.status = AccountStatus.ERROR
            await session.commit()
            await _notify_account_owner_about_quarantine(account, task, error_message)
        return task
    except PublicationVerificationPending as exc:
        error_message = redact_connection_secrets(str(exc))
        await _mark_partial_success(session, task, account, error_message, 0)
        task.generation_metadata = {**(task.generation_metadata or {}), "publication_confirmation_pending": True}
        account.status = AccountStatus.ERROR
        await session.commit()
        await _notify_account_owner_about_quarantine(account, task, error_message)
        return task
    except RetryablePostingException as exc:
        error_message = redact_connection_secrets(str(exc))
        if _should_quarantine_account(error_message, task.retry_count):
            await _mark_account_needs_review(session, task, account, error_message)
            await _notify_account_owner_about_quarantine(account, task, error_message)
        else:
            await _mark_retryable(session, task, account, error_message)
        return task
    except Exception as exc:
        error_message = redact_connection_secrets(str(exc))
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
        task.account.status = AccountStatus.ERROR
    await session.commit()
    await session.refresh(task)


async def _mark_retryable(
    session: AsyncSession,
    task: PostingTask,
    account: Account,
    error_message: str,
) -> None:
    is_proxy_rotation = _is_proxy_rotation_retry(error_message)
    retry_delay = timedelta(minutes=min(240, 30 * (2 ** min(task.retry_count, 3))))
    extend_cooldown(account, datetime.now(UTC) + retry_delay)
    task.status = PostingTaskStatus.QUEUED
    task.started_at = None
    task.finished_at = None
    task.scheduled_at = datetime.now(UTC) + retry_delay
    task.error_message = (
        "Техническая пауза: прокси сменил IP во время публикации. "
        "Система повторит задачу после безопасной задержки."
        if is_proxy_rotation
        else "Техническая пауза: временная ошибка браузера или прокси. "
        "Система повторит задачу позже."
    )
    task.retry_count += 1
    account.last_error = error_message
    await session.commit()
    await session.refresh(task)


async def _mark_account_needs_review(
    session: AsyncSession,
    task: PostingTask,
    account: Account,
    error_message: str,
) -> None:
    account.status = AccountStatus.ERROR
    account.last_error = error_message[:2000]
    task.status = PostingTaskStatus.QUEUED
    task.started_at = None
    task.finished_at = None
    task.scheduled_at = None
    task.error_message = (
        "Публикация остановлена: требуется проверка доступа или исчерпан лимит повторных попыток. "
        "Профиль поставлен на защитную паузу до ручной проверки."
    )
    task.retry_count += 1
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
    metadata = dict(task.generation_metadata) if isinstance(task.generation_metadata, dict) else {}
    metadata["partial_success"] = True
    metadata["published_chain_items"] = published_count
    task.generation_metadata = metadata
    account.last_used_at = task.finished_at
    extend_cooldown(account, task.finished_at + timedelta(minutes=settings.posting_min_interval_minutes))
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
    task.scheduled_at = None
    task.error_message = error_message
    await session.commit()
    await session.refresh(task)


async def _notify_account_owner_about_session(account: Account) -> None:
    project = account.project
    owner = project.owner if project is not None else None
    telegram_id = owner.telegram_id if owner is not None else None
    username = account.username or "без username"
    text = (
        f"Профиль Threads @{username} поставлен на паузу.\n\n"
        "Почему: Threads не подтвердил текущую сессию cookies. "
        "Мы остановили публикации, чтобы не добивать аккаунт повторными попытками.\n\n"
        "Что сделать:\n"
        "1. Открой Threads вручную в этом профиле.\n"
        "2. Если Meta просит проверку или вход, пройди её руками.\n"
        "3. Экспортируй свежие cookies через Cookie-Editor.\n"
        "4. В ThreadsGo открой проект → Настройки → профиль → вставь cookies "
        "и нажми «Проверить и возобновить».\n\n"
        "После успешной проверки очередь продолжит работать сама."
    )
    await send_user_notification(telegram_id=telegram_id, text=text)


async def _notify_account_owner_about_quarantine(
    account: Account,
    task: PostingTask,
    error_message: str,
) -> None:
    project = account.project
    owner = project.owner if project is not None else None
    telegram_id = owner.telegram_id if owner is not None else None
    username = account.username or "без username"
    project_name = project.name if project is not None else f"#{task.project_id}"
    await send_admin_alert(
        "Threads profile quarantined.\n\n"
        f"Project: {project_name}\n"
        f"Account: #{account.id} @{username}\n"
        f"Task: #{task.id}\n"
        f"Error: {error_message[:2200]}"
    )
    text = (
        "Профиль поставлен на защитную паузу.\n\n"
        f"Проект: {project_name}\n"
        f"Аккаунт: @{username}\n"
        f"Задача: #{task.id}\n\n"
        "Почему: возникла ошибка доступа, исчерпан лимит попыток или результат отправки не подтверждён. "
        "Проверьте профиль и последние посты вручную, чтобы избежать повторных публикаций.\n\n"
        "Что сделать:\n"
        "1. Открой Threads вручную и проверь, что профиль живой.\n"
        "2. Если есть проверка Meta, пройди её.\n"
        "3. В ThreadsGo открой настройки проекта и нажми «Проверить и возобновить».\n"
        "4. Если проверка не проходит, обнови данные входа и повтори проверку."
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
    await send_admin_alert(
        "Threads publication failed.\n\n"
        f"Project: {project_name}\n"
        f"Account: #{account.id} @{username}\n"
        f"Task: #{task.id}\n"
        f"Error: {error_message[:2200]}"
    )
    text = (
        "Публикация не прошла.\n\n"
        f"Проект: {project_name}\n"
        f"Аккаунт: @{username}\n"
        f"Задача: #{task.id}\n\n"
        "Текст сохранён и никуда не пропал. Мы уже получили технический лог и проверяем причину. "
        "Открой настройки проекта и посмотри статус профиля; если он активен, повторять действие сразу не нужно."
    )
    await send_user_notification(telegram_id=telegram_id, text=text)


def _should_update_username(username: str | None) -> bool:
    normalized_username = (username or "").strip()
    return normalized_username in SESSION_USERNAME_PLACEHOLDERS


def _account_proxy_url(account: Account) -> str | None:
    return build_threads_proxy_url_for_account(account)


def _should_quarantine_account(error_message: str, retry_count: int = 0) -> bool:
    normalized = error_message.casefold()
    # Meta restrictions take priority even if the exception also mentions a proxy.
    if any(marker in normalized for marker in HARD_QUARANTINE_ERROR_MARKERS):
        return True
    if retry_count >= settings.posting_max_retries - 1:
        return True
    if _is_proxy_rotation_retry(error_message):
        return False
    if _is_proxy_transport_retry(error_message):
        return False
    if any(marker in normalized for marker in QUARANTINE_ERROR_MARKERS):
        return retry_count >= 2
    return False


def _is_proxy_rotation_retry(error_message: str) -> bool:
    return "proxy ip changed during selenium session" in error_message.casefold()


def _is_proxy_transport_retry(error_message: str) -> bool:
    normalized = error_message.casefold()
    return any(marker in normalized for marker in PROXY_RETRY_MARKERS)

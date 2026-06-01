import asyncio
from datetime import UTC, datetime

from aiogram import Bot, Dispatcher
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import Command
from aiogram.types import Message
from sqlalchemy import func, select

from app.core.config import settings
from app.db.models import Account, AccountStatus, Platform, PostingTask, PostingTaskStatus, ProjectOperation, ProjectOperationStatus
from app.db.session import AsyncSessionLocal


admin_dp = Dispatcher()
_admin_bot: Bot | None = None


def _is_admin(message: Message) -> bool:
    return bool(settings.admin_tg_id and message.from_user and message.from_user.id == settings.admin_tg_id)


async def _guard_admin(message: Message) -> bool:
    if _is_admin(message):
        return True

    await message.answer("Access denied.")
    return False


@admin_dp.message(Command("status"))
async def admin_status_handler(message: Message) -> None:
    if not await _guard_admin(message):
        return

    await message.answer("ThreadsGo admin bot is active.")


@admin_dp.message(Command("queue"))
async def admin_queue_handler(message: Message) -> None:
    if not await _guard_admin(message):
        return

    now = datetime.now(UTC)
    async with AsyncSessionLocal() as session:
        queued_posts = await session.scalar(
            select(func.count(PostingTask.id)).where(PostingTask.status == PostingTaskStatus.QUEUED)
        )
        running_posts = await session.scalar(
            select(func.count(PostingTask.id)).where(PostingTask.status == PostingTaskStatus.RUNNING)
        )
        oldest_task = await session.scalar(
            select(PostingTask)
            .where(
                PostingTask.status == PostingTaskStatus.QUEUED,
                PostingTask.scheduled_at.is_not(None),
                PostingTask.scheduled_at <= now,
            )
            .order_by(PostingTask.scheduled_at.asc(), PostingTask.id.asc())
            .limit(1)
        )
        queued_scraping = await session.scalar(
            select(func.count(ProjectOperation.id)).where(ProjectOperation.status == ProjectOperationStatus.QUEUED)
        )
        running_operations = await session.scalar(
            select(func.count(ProjectOperation.id)).where(ProjectOperation.status == ProjectOperationStatus.RUNNING)
        )

    delay_minutes = 0
    if oldest_task and oldest_task.scheduled_at:
        scheduled_at = oldest_task.scheduled_at
        if scheduled_at.tzinfo is None:
            scheduled_at = scheduled_at.replace(tzinfo=UTC)
        delay_minutes = max(0, int((now - scheduled_at).total_seconds() / 60))

    await message.answer(
        "Queue health\n"
        f"Queued posts: {queued_posts or 0}\n"
        f"Running posts: {running_posts or 0}\n"
        f"Oldest due delay: {delay_minutes} min\n"
        f"Queued operations: {queued_scraping or 0}\n"
        f"Running operations: {running_operations or 0}"
    )


@admin_dp.message(Command("proxy"))
async def admin_proxy_handler(message: Message) -> None:
    if not await _guard_admin(message):
        return

    async with AsyncSessionLocal() as session:
        assigned_ports = list(
            (
                await session.scalars(
                    select(Account.assigned_port)
                    .where(
                        Account.platform == Platform.THREADS,
                        Account.assigned_port.is_not(None),
                    )
                    .order_by(Account.assigned_port.asc())
                )
            ).all()
        )
        active_accounts = await session.scalar(
            select(func.count(Account.id)).where(
                Account.platform == Platform.THREADS,
                Account.status == AccountStatus.ACTIVE,
            )
        )

    configured_count = max(0, settings.proxy_port_end - settings.proxy_port_start + 1)
    lines = [
        "Proxy port pool",
        f"Host: {settings.proxy_host or 'not configured'}",
        f"Range: {settings.proxy_port_start}-{settings.proxy_port_end}",
        f"Configured ports: {configured_count}",
        f"Assigned ports: {len(assigned_ports)}",
        f"Active Threads accounts: {active_accounts or 0}",
    ]

    if assigned_ports:
        lines.append("Recent assigned ports: " + ", ".join(str(port) for port in assigned_ports[-20:]))

    await message.answer("\n".join(lines))


def get_admin_bot() -> Bot | None:
    global _admin_bot

    if not settings.admin_bot_token:
        return None

    if _admin_bot is None:
        _admin_bot = Bot(token=settings.admin_bot_token)

    return _admin_bot


async def start_admin_bot_polling() -> None:
    bot = get_admin_bot()

    if bot is None:
        return

    try:
        await admin_dp.start_polling(bot)
    except TelegramAPIError:
        return
    except Exception:
        return


async def stop_admin_bot() -> None:
    global _admin_bot

    if _admin_bot is not None:
        await _admin_bot.session.close()
        _admin_bot = None


async def cancel_admin_polling_task(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def _safe_proxy_label(proxy_url: str) -> str:
    if "@" not in proxy_url:
        return proxy_url

    scheme, _, tail = proxy_url.partition("://")
    _, _, host = tail.rpartition("@")
    return f"{scheme}://***@{host}" if scheme else f"***@{host}"

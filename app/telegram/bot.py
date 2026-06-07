import asyncio

from aiogram import Bot, Dispatcher
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import Command
from aiogram.types import ChatMemberUpdated, InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.services.subscriptions import activate_user_subscription, handle_user_left_tariff_chat


dp = Dispatcher()
_bot: Bot | None = None


@dp.message(Command("status"))
async def status_handler(message: Message) -> None:
    await message.answer("Сервис активен. Управление доступно только через Web API.")


@dp.message(Command("start"))
async def start_handler(message: Message) -> None:
    app_url = settings.public_app_url.rstrip("/")
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть кабинет ThreadsGo",
                    web_app=WebAppInfo(url=f"{app_url}/login"),
                )
            ],
            [
                InlineKeyboardButton(
                    text="Открыть в браузере",
                    url=f"{app_url}/login",
                )
            ],
        ]
    )
    await message.answer(
        "ThreadsGo готов.\n\n"
        "Если Telegram-виджет на сайте не открылся, войдите отсюда: нажмите «Открыть кабинет ThreadsGo». "
        "Telegram передаст безопасные данные входа, а сайт выдаст вам сессию без пароля.",
        reply_markup=keyboard,
    )


@dp.chat_member()
async def tariff_chat_member_handler(event: ChatMemberUpdated, bot: Bot) -> None:
    telegram_id = int(event.new_chat_member.user.id)
    chat_id = int(event.chat.id)
    old_active = _is_active_chat_member_status(event.old_chat_member)
    new_active = _is_active_chat_member_status(event.new_chat_member)

    if old_active == new_active:
        return

    async with AsyncSessionLocal() as session:
        if new_active:
            await activate_user_subscription(
                telegram_id=telegram_id,
                chat_id=chat_id,
                session=session,
            )
            return

        await handle_user_left_tariff_chat(
            bot=bot,
            telegram_id=telegram_id,
            left_chat_id=chat_id,
            session=session,
        )


def _is_active_chat_member_status(member: object) -> bool:
    raw_status = getattr(member, "status", "")
    status = str(getattr(raw_status, "value", raw_status))
    if status in {"creator", "administrator", "member"}:
        return True

    if status == "restricted":
        return bool(getattr(member, "is_member", False))

    return False


def get_bot() -> Bot | None:
    global _bot

    if not settings.telegram_bot_token:
        return None

    if _bot is None:
        _bot = Bot(token=settings.telegram_bot_token)

    return _bot


async def start_bot_polling() -> None:
    bot = get_bot()

    if bot is None:
        return

    try:
        await dp.start_polling(bot, handle_signals=False)
    except TelegramAPIError:
        return
    except Exception:
        return


async def stop_bot() -> None:
    global _bot

    if _bot is not None:
        await _bot.session.close()
        _bot = None


async def cancel_polling_task(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

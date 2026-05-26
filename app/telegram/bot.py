import asyncio

from aiogram import Bot, Dispatcher
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

from app.core.config import settings


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
        await dp.start_polling(bot)
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

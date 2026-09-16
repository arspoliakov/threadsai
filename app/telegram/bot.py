import asyncio
import logging

from aiogram import Bot, Dispatcher, F
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import Command, CommandObject
from aiogram.types import CallbackQuery, ChatMemberUpdated, InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.services.subscriptions import activate_user_subscription, handle_user_left_tariff_chat
from app.services.telegram_login import ChallengeError, bind_bot_challenge, decide_challenge


logger = logging.getLogger(__name__)
dp = Dispatcher()
_bot: Bot | None = None


@dp.message(Command("status"))
async def status_handler(message: Message) -> None:
    await message.answer("Сервис активен. Управление доступно только через Web API.")


@dp.message(Command("start"))
async def start_handler(message: Message, command: CommandObject) -> None:
    argument = (command.args or "").strip()
    if argument.startswith("login_"):
        await _handle_login_start(message, argument.removeprefix("login_"))
        return

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
        "Для входа в браузере начните авторизацию на сайте — бот покажет отдельную кнопку подтверждения. "
        "Кнопка ниже открывает самостоятельный кабинет внутри Telegram.",
        reply_markup=keyboard,
    )


async def _handle_login_start(message: Message, bot_secret: str) -> None:
    sender = message.from_user
    if sender is None or sender.is_bot or message.chat.type != "private":
        await message.answer("Подтвердить вход можно только в личном чате с ботом.")
        return
    profile = {
        "first_name": sender.first_name,
        "last_name": sender.last_name,
        "username": sender.username,
        "language_code": sender.language_code,
    }
    try:
        async with AsyncSessionLocal() as session:
            challenge = await bind_bot_challenge(
                session=session,
                bot_secret=bot_secret,
                telegram_id=int(sender.id),
                profile=profile,
            )
    except ChallengeError as exc:
        text = (
            "Время подтверждения истекло. Вернитесь на сайт и начните вход заново."
            if exc.code == "challenge_expired"
            else "Эта ссылка входа недействительна или уже использована. Начните вход на сайте заново."
        )
        await message.answer(text)
        return

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Да, войти", callback_data=f"tga:ok:{challenge.id}"),
                InlineKeyboardButton(text="Отменить", callback_data=f"tga:no:{challenge.id}"),
            ]
        ]
    )
    await message.answer(
        "Подтвердить вход в ThreadsGo?\n\n"
        f"Код на сайте: {challenge.display_code}\n"
        f"Сайт: {settings.public_app_url.rstrip('/')}\n\n"
        "Подтверждайте только вход, который вы сами начали. Код должен совпадать с кодом во вкладке сайта.",
        reply_markup=keyboard,
    )


@dp.callback_query(F.data.startswith("tga:"))
async def telegram_login_callback(callback: CallbackQuery) -> None:
    sender = callback.from_user
    data = callback.data or ""
    parts = data.split(":", 2)
    if len(parts) != 3 or parts[1] not in {"ok", "no"}:
        await callback.answer("Некорректная кнопка входа.", show_alert=True)
        return
    approve = parts[1] == "ok"
    try:
        async with AsyncSessionLocal() as session:
            await decide_challenge(
                session=session,
                challenge_id=parts[2],
                telegram_id=int(sender.id),
                approve=approve,
            )
    except ChallengeError as exc:
        messages = {
            "challenge_expired": "Время входа истекло. Начните заново на сайте.",
            "access_denied": "Вход сейчас недоступен для этого аккаунта.",
            "challenge_cancelled": "Эта попытка уже отменена.",
            "challenge_consumed": "Вход уже выполнен.",
        }
        await callback.answer(messages.get(exc.code, "Эта попытка входа больше недоступна."), show_alert=True)
        return

    result_text = (
        "Готово! Теперь вернитесь во вкладку сайта, где вы начали вход. Авторизация завершится автоматически."
        if approve
        else "Вход отменён. Можно вернуться на сайт и начать новую попытку."
    )
    await callback.answer("Вход подтверждён" if approve else "Вход отменён")
    if callback.message is not None:
        try:
            await callback.message.edit_text(result_text, reply_markup=None)
        except TelegramAPIError:
            logger.warning("Could not edit Telegram login confirmation message for user_id=%s", sender.id)


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

    retry_delay = 2
    while True:
        try:
            await dp.start_polling(bot, handle_signals=False)
            retry_delay = 2
        except asyncio.CancelledError:
            raise
        except TelegramAPIError as exc:
            logger.warning("Telegram bot polling interrupted: %s. Retrying in %s seconds.", exc, retry_delay)
        except Exception:
            logger.exception("Telegram bot polling crashed. Retrying in %s seconds.", retry_delay)

        await asyncio.sleep(retry_delay)
        retry_delay = min(60, retry_delay * 2)


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

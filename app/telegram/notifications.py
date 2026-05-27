from aiogram.exceptions import TelegramAPIError

from app.core.config import settings
from app.services.admin_notifier import send_admin_alert
from app.telegram.bot import get_bot


async def send_admin_notification(text: str) -> bool:
    return await send_admin_alert(text)


async def send_user_notification(telegram_id: int | None, text: str) -> bool:
    if not settings.telegram_bot_token or telegram_id is None:
        return False

    bot = get_bot()
    if bot is None:
        return False

    try:
        await bot.send_message(chat_id=telegram_id, text=text)
        return True
    except TelegramAPIError:
        return False
    except Exception:
        return False

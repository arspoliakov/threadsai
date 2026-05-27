from __future__ import annotations

import logging

import httpx

from app.core.config import settings


logger = logging.getLogger(__name__)


async def send_admin_alert(text: str) -> bool:
    if not settings.admin_bot_token or settings.admin_tg_id is None:
        return False

    url = f"https://api.telegram.org/bot{settings.admin_bot_token}/sendMessage"
    payload = {
        "chat_id": settings.admin_tg_id,
        "text": text[:3900],
        "disable_web_page_preview": True,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("Admin Telegram alert failed: %s", exc)
        return False

from __future__ import annotations

import json

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Account, Platform
from app.schemas.account import AccountCreate, AccountUpdate


def strip_user_proxy_from_session_data(raw_value: str | None) -> str | None:
    if not raw_value:
        return raw_value

    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError:
        return raw_value

    if not isinstance(payload, dict):
        return raw_value

    payload.pop("proxy", None)
    return json.dumps(payload, ensure_ascii=False)


async def prepare_account_create(payload: AccountCreate, session: AsyncSession) -> AccountCreate:
    update_data = {
        "proxy_url": None,
        "session_data_encrypted": strip_user_proxy_from_session_data(payload.session_data_encrypted),
    }

    if payload.platform == Platform.THREADS:
        update_data["proxy_url"] = await choose_threads_proxy(session)

    return payload.model_copy(update=update_data)


def prepare_account_update(payload: AccountUpdate) -> AccountUpdate:
    update_data = payload.model_dump(exclude_unset=True)
    update_data.pop("proxy_url", None)

    if "session_data_encrypted" in update_data:
        update_data["session_data_encrypted"] = strip_user_proxy_from_session_data(
            update_data["session_data_encrypted"]
        )

    return AccountUpdate(**update_data)


async def choose_threads_proxy(session: AsyncSession) -> str:
    proxy_urls = settings.threads_proxy_pool_urls()
    if not proxy_urls:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Threads proxy pool is not configured. Contact support.",
        )

    usage_rows = (
        await session.execute(
            select(Account.proxy_url, func.count(Account.id))
            .where(
                Account.platform == Platform.THREADS,
                Account.proxy_url.is_not(None),
            )
            .group_by(Account.proxy_url)
        )
    ).all()
    usage_by_proxy = {proxy_url: count for proxy_url, count in usage_rows if proxy_url}

    return min(proxy_urls, key=lambda proxy_url: (usage_by_proxy.get(proxy_url, 0), proxy_urls.index(proxy_url)))

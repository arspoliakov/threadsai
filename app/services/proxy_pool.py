from __future__ import annotations

import json
from urllib.parse import quote

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Account, Platform
from app.schemas.account import AccountCreate, AccountCreatePrepared, AccountUpdate
from app.services.admin_notifier import send_admin_alert


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


async def prepare_account_create(payload: AccountCreate, session: AsyncSession) -> AccountCreatePrepared:
    update_data = {
        "session_data_encrypted": strip_user_proxy_from_session_data(payload.session_data_encrypted),
    }

    if payload.platform == Platform.THREADS:
        update_data["assigned_port"] = await assign_threads_proxy_port(session)

    prepared_data = payload.model_dump()
    prepared_data.update(update_data)
    return AccountCreatePrepared(**prepared_data)


def prepare_account_update(payload: AccountUpdate) -> AccountUpdate:
    update_data = payload.model_dump(exclude_unset=True)

    if "session_data_encrypted" in update_data:
        update_data["session_data_encrypted"] = strip_user_proxy_from_session_data(
            update_data["session_data_encrypted"]
        )

    return AccountUpdate(**update_data)


async def assign_threads_proxy_port(session: AsyncSession) -> int:
    _validate_proxy_port_config()

    max_assigned_port = await session.scalar(
        select(func.max(Account.assigned_port)).where(
            Account.platform == Platform.THREADS,
            Account.assigned_port.is_not(None),
        )
    )

    next_port = settings.proxy_port_start if max_assigned_port is None else int(max_assigned_port) + 1
    if next_port > settings.proxy_port_end:
        await send_admin_alert(
            "Proxy port pool exhausted.\n\n"
            f"Range: {settings.proxy_port_start}-{settings.proxy_port_end}\n"
            f"Last assigned port: {max_assigned_port}"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Threads proxy port pool is exhausted. Contact support.",
        )

    return next_port


def build_threads_proxy_url_for_account(account: Account) -> str | None:
    if account.assigned_port is None:
        return None

    return build_threads_proxy_url(account.assigned_port)


def build_threads_proxy_url(port: int) -> str:
    _validate_proxy_port_config()

    login = quote(settings.proxy_login, safe="")
    password = quote(settings.proxy_password, safe="")
    return f"http://{login}:{password}@{settings.proxy_host}:{port}"


def _validate_proxy_port_config() -> None:
    if not settings.proxy_host or not settings.proxy_login or not settings.proxy_password:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Threads proxy base credentials are not configured. Contact support.",
        )

    if settings.proxy_port_start > settings.proxy_port_end:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Threads proxy port range is invalid. Contact support.",
        )

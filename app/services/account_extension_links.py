from __future__ import annotations

import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Account, AccountExtensionLink, AccountStatus, Platform, Project, User
from app.schemas.account import AccountCreate
from app.services.proxy_pool import prepare_account_create


LINK_LIFETIME = timedelta(minutes=10)
ALLOWED_COOKIE_DOMAINS = {"threads.net", "threads.com"}
ALLOWED_COOKIE_KEYS = {
    "name",
    "value",
    "domain",
    "path",
    "secure",
    "httpOnly",
    "sameSite",
    "expirationDate",
}


async def create_extension_link(
    *,
    owner: User,
    session: AsyncSession,
    project_id: int | None = None,
    account_id: int | None = None,
) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    await session.execute(
        delete(AccountExtensionLink).where(
            (AccountExtensionLink.expires_at < now) | (AccountExtensionLink.consumed_at.is_not(None))
        )
    )

    if account_id is not None:
        account = await _get_owned_account(account_id=account_id, owner_id=owner.id, session=session)
        project_id = account.project_id
    elif project_id is not None:
        await _get_owned_project(project_id=project_id, owner_id=owner.id, session=session)

    raw_token = secrets.token_urlsafe(32)
    expires_at = now + LINK_LIFETIME
    session.add(
        AccountExtensionLink(
            token_hash=_hash_token(raw_token),
            owner_id=owner.id,
            project_id=project_id,
            account_id=account_id,
            expires_at=expires_at,
        )
    )
    await session.commit()
    return raw_token, expires_at


async def consume_extension_link(
    *,
    raw_token: str,
    raw_cookies: list[dict[str, Any]],
    session: AsyncSession,
) -> Account:
    now = datetime.now(UTC)
    token_hash = _hash_token(raw_token)
    link = await session.scalar(
        select(AccountExtensionLink)
        .where(
            AccountExtensionLink.token_hash == token_hash,
            AccountExtensionLink.consumed_at.is_(None),
            AccountExtensionLink.expires_at >= now,
        )
        .limit(1)
    )
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Код подключения истек или уже использован.",
        )

    claim_result = await session.execute(
        update(AccountExtensionLink)
        .where(
            AccountExtensionLink.id == link.id,
            AccountExtensionLink.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    if claim_result.rowcount != 1:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Код подключения уже используется.")

    owner = await session.get(User, link.owner_id)
    if owner is None or not owner.subscription_status:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Подписка не активна.")

    cookies = _sanitize_threads_cookies(raw_cookies)
    cookies_payload = json.dumps(cookies, ensure_ascii=False)

    if link.account_id is not None:
        account = await _get_owned_account(account_id=link.account_id, owner_id=owner.id, session=session)
        account.cookies_encrypted = cookies_payload
        account.status = AccountStatus.ACTIVE
        account.last_error = None
        await session.commit()
        await session.refresh(account)
        return account

    accounts_count = await session.scalar(select(func.count(Account.id)).where(Account.owner_id == owner.id))
    if (accounts_count or 0) >= owner.tariff_accounts_limit:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Достигнут лимит профилей тарифа.")

    if link.project_id is not None:
        await _get_owned_project(project_id=link.project_id, owner_id=owner.id, session=session)

    prepared = await prepare_account_create(
        AccountCreate(
            project_id=link.project_id,
            platform=Platform.THREADS,
            username="pending_from_session",
            session_data_encrypted=json.dumps(
                {"auth_method": "extension", "username_source": "session"},
                ensure_ascii=False,
            ),
            cookies_encrypted=cookies_payload,
            status=AccountStatus.ACTIVE,
        ),
        session,
    )
    account = Account(**prepared.model_dump(), owner_id=owner.id)
    session.add(account)
    await session.commit()
    await session.refresh(account)
    return account


def _sanitize_threads_cookies(raw_cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not raw_cookies or len(raw_cookies) > 100:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Threads cookies не найдены.")

    cookies: list[dict[str, Any]] = []
    for raw_cookie in raw_cookies:
        name = str(raw_cookie.get("name") or "").strip()
        value = str(raw_cookie.get("value") or "")
        domain = str(raw_cookie.get("domain") or "").strip().lstrip(".").casefold()
        if not name or not value or domain not in ALLOWED_COOKIE_DOMAINS:
            continue

        cookie = {key: raw_cookie[key] for key in ALLOWED_COOKIE_KEYS if key in raw_cookie}
        if "expirationDate" in cookie:
            cookie["expiry"] = cookie.pop("expirationDate")
        same_site = str(cookie.get("sameSite") or "").casefold()
        if same_site in {"strict", "lax", "no_restriction"}:
            cookie["sameSite"] = {"strict": "Strict", "lax": "Lax", "no_restriction": "None"}[same_site]
        else:
            cookie.pop("sameSite", None)
        cookies.append(cookie)

    if not cookies or not any(cookie.get("name") == "sessionid" for cookie in cookies):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Откройте Threads и войдите в профиль перед подключением.",
        )
    return cookies


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


async def _get_owned_account(*, account_id: int, owner_id: int, session: AsyncSession) -> Account:
    account = await session.scalar(
        select(Account).where(Account.id == account_id, Account.owner_id == owner_id).limit(1)
    )
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Профиль не найден.")
    return account


async def _get_owned_project(*, project_id: int, owner_id: int, session: AsyncSession) -> Project:
    project = await session.scalar(
        select(Project).where(Project.id == project_id, Project.owner_id == owner_id).limit(1)
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Проект не найден.")
    return project

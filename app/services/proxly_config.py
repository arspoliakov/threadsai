"""Encrypted, explicit Proxly assignments. This module never enables migration globally."""
from __future__ import annotations

import json
import math
import re
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.secrets import decrypt_secret, encrypt_secret, is_encrypted_secret
from app.db.models import Account, Platform, ProxyProviderConfig

PROXLY_PROVIDER = "proxly"
FIRST_THREADSGO_SESSION_ID = 11


def _fail(message: str) -> None:
    raise HTTPException(status_code=409, detail=message)


async def save_proxly_config(db: AsyncSession, *, access_login: str, password: str | None,
                             host: str = "proxly.ru", port: int = 8080, country: str = "nl",
                             sticky_minutes: int = 30, package_gb: float = 10,
                             package_cost_rub: float = 1120) -> dict:
    # Fixed gateway prevents operator test endpoints becoming arbitrary network probes.
    if host != "proxly.ru" or port != 8080 or country != "nl" or sticky_minutes != 30:
        _fail("Поддерживается проверенный формат Proxly: proxly.ru:8080, NL, sticky 30 минут.")
    if not re.fullmatch(r"[A-Za-z0-9_]+", access_login or "") or len(access_login) > 128:
        _fail("Укажите базовый логин доступа без параметров страны и session.")
    if (not math.isfinite(package_gb) or not math.isfinite(package_cost_rub) or
            package_gb <= 0 or package_cost_rub <= 0 or package_gb > 100000 or package_cost_rub > 100000000):
        _fail("Некорректные параметры общего пакета.")
    config = await db.get(ProxyProviderConfig, PROXLY_PROVIDER)
    if password is None and config:
        current = json.loads(decrypt_secret(config.credentials_encrypted) or "{}")
        password = current.get("password")
    if not password or len(password) > 512:
        _fail("Для первого подключения требуется пароль Proxly.")
    credentials = encrypt_secret(json.dumps({"access_login": access_login, "password": password}))
    if config is None:
        config = ProxyProviderConfig(provider=PROXLY_PROVIDER, next_session_id=FIRST_THREADSGO_SESSION_ID)
        db.add(config)
    config.credentials_encrypted = credentials
    config.host, config.port, config.country = host, port, country
    config.sticky_minutes = sticky_minutes
    config.package_gb, config.package_cost_rub = package_gb, package_cost_rub
    await db.flush()
    return await read_proxly_config(db)


async def read_proxly_config(db: AsyncSession) -> dict:
    config = await db.get(ProxyProviderConfig, PROXLY_PROVIDER)
    if config is None:
        return {"configured": False, "provider": PROXLY_PROVIDER, "reserved_clinic_ids": [1, 10]}
    return {"configured": True, "provider": PROXLY_PROVIDER, "host": config.host,
            "port": config.port, "country": config.country, "sticky_minutes": config.sticky_minutes,
            "package_gb": config.package_gb, "package_cost_rub": config.package_cost_rub,
            "next_session_id": config.next_session_id, "reserved_clinic_ids": [1, 10],
            "balance_source": "configured_package_not_provider_balance"}


async def assign_proxly_account(db: AsyncSession, account: Account) -> Account:
    if account.platform != Platform.THREADS:
        _fail("Подключение Proxly доступно только для Threads.")
    config = await db.get(ProxyProviderConfig, PROXLY_PROVIDER)
    if config is None:
        _fail("Сначала настройте защищённый доступ Proxly.")
    if account.proxy_session_id is None:
        # A persistent atomic counter also avoids reusing IDs of deleted accounts.
        next_id = await db.scalar(update(ProxyProviderConfig)
            .where(ProxyProviderConfig.provider == PROXLY_PROVIDER,
                   ProxyProviderConfig.next_session_id >= FIRST_THREADSGO_SESSION_ID)
            .values(next_session_id=ProxyProviderConfig.next_session_id + 1)
            .returning(ProxyProviderConfig.next_session_id))
        if next_id is None:
            _fail("Диапазон session ID требует проверки оператором.")
        account.proxy_session_id = int(next_id) - 1
    if account.proxy_session_id < FIRST_THREADSGO_SESSION_ID:
        _fail("Session ID 1–10 зарезервированы для ThreadsClinic.")
    credentials = json.loads(decrypt_secret(config.credentials_encrypted) or "{}")
    credentials.update(host=config.host, port=config.port, country=config.country,
                       sticky_minutes=config.sticky_minutes)
    account.proxy_credentials_encrypted = encrypt_secret(json.dumps(credentials))
    account.proxy_provider = PROXLY_PROVIDER
    await db.flush()
    return account


async def restore_legacy_proxy(db: AsyncSession, account: Account) -> Account:
    if account.assigned_port is None:
        _fail("Сохранённого подключения Proxymarket нет. Требуется отдельная настройка.")
    # Keep encrypted Proxly binding for a later explicit resume, preserving session ID.
    account.proxy_provider = "proxymarket"
    await db.flush()
    return account


async def allocate_proxly_probe_urls(db: AsyncSession) -> tuple[list[int], tuple[str, str]]:
    """Consume durable IDs for isolated probes without creating or changing accounts."""
    config = await db.get(ProxyProviderConfig, PROXLY_PROVIDER)
    if config is None:
        _fail("Сначала настройте защищённый доступ Proxly.")
    end = await db.scalar(update(ProxyProviderConfig)
        .where(ProxyProviderConfig.provider == PROXLY_PROVIDER,
               ProxyProviderConfig.next_session_id >= FIRST_THREADSGO_SESSION_ID)
        .values(next_session_id=ProxyProviderConfig.next_session_id + 2)
        .returning(ProxyProviderConfig.next_session_id))
    if end is None:
        _fail("Диапазон session ID требует проверки оператором.")
    ids = [int(end) - 2, int(end) - 1]
    credentials = json.loads(decrypt_secret(config.credentials_encrypted) or "{}")
    credentials.update(host=config.host, port=config.port, country=config.country, sticky_minutes=config.sticky_minutes)
    encrypted = encrypt_secret(json.dumps(credentials))
    accounts = [Account(proxy_provider=PROXLY_PROVIDER, proxy_session_id=i,
                        proxy_credentials_encrypted=encrypted) for i in ids]
    return ids, (build_proxly_url_for_account(accounts[0]), build_proxly_url_for_account(accounts[1]))


def build_proxly_url_for_account(account: Account) -> str:
    if not account.proxy_session_id or account.proxy_session_id < FIRST_THREADSGO_SESSION_ID:
        _fail("Для аккаунта не назначена безопасная session Proxly.")
    if not is_encrypted_secret(account.proxy_credentials_encrypted):
        _fail("Защищённое подключение Proxly не настроено.")
    try:
        config = json.loads(decrypt_secret(account.proxy_credentials_encrypted) or "{}")
        if config.get("host") != "proxly.ru" or config.get("port") != 8080:
            raise ValueError()
        if config.get("country") != "nl" or config.get("sticky_minutes") != 30:
            raise ValueError()
        login, password = config["access_login"], config["password"]
        if not login or not password:
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        _fail("Защищённое подключение Proxly требует проверки оператором.")
    username = f"{login}-country-nl-session-{account.proxy_session_id}-time-30"
    return f"http://{quote(username, safe='')}:{quote(password, safe='')}@proxly.ru:8080"

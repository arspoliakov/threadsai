"""Operator-only shared proxy controls. No credential-bearing responses."""
import asyncio
from datetime import UTC, datetime
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_operator
from app.core.config import settings
from app.db.models import Account, AccountStatus, Platform, PostingTask, PostingTaskStatus, ProjectOperation, ProjectOperationStatus, ProxyUsageEvent
from app.posting.profile_lock import ProfileLock
from app.services.proxly_config import allocate_proxly_probe_urls, assign_proxly_account, read_proxly_config, restore_legacy_proxy, save_proxly_config
from app.services.proxy_pool import build_threads_proxy_url_for_account

router = APIRouter(prefix="/admin/proxies", tags=["operator proxies"], dependencies=[Depends(require_operator)])
check_lock = asyncio.Lock()


class ConfigWrite(BaseModel):
    access_login: SecretStr
    password: SecretStr | None = None
    package_gb: float = Field(default=10, gt=0, le=100000)
    package_cost_rub: float = Field(default=1120, gt=0)


class AssignmentWrite(BaseModel):
    provider: str = Field(pattern="^(proxly|legacy)$")


@router.get("")
async def summary(db: AsyncSession = Depends(get_db)):
    config = await read_proxly_config(db)
    accounts = list((await db.scalars(select(Account).where(Account.platform == Platform.THREADS).order_by(Account.id))).all())
    usage = (await db.execute(select(ProxyUsageEvent.account_id, ProxyUsageEvent.provider,
        func.sum(ProxyUsageEvent.estimated_bytes)).group_by(ProxyUsageEvent.account_id, ProxyUsageEvent.provider))).all()
    totals = {(a, p): int(b or 0) for a, p, b in usage}
    service_usage = (await db.execute(select(ProxyUsageEvent.service, ProxyUsageEvent.provider,
        func.sum(ProxyUsageEvent.estimated_bytes)).group_by(ProxyUsageEvent.service, ProxyUsageEvent.provider))).all()
    latest = {}
    checks = (await db.scalars(select(ProxyUsageEvent).where(ProxyUsageEvent.operation == "connection_check")
        .order_by(ProxyUsageEvent.id.desc()).limit(500))).all()
    for event in checks:
        latest.setdefault((event.account_id, event.provider), event)
    user_usage = (await db.execute(select(ProxyUsageEvent.owner_id, ProxyUsageEvent.provider,
        func.sum(ProxyUsageEvent.estimated_bytes), func.count(ProxyUsageEvent.id))
        .group_by(ProxyUsageEvent.owner_id, ProxyUsageEvent.provider))).all()
    telemetry = (await db.execute(select(ProxyUsageEvent.account_id, ProxyUsageEvent.provider,
        ProxyUsageEvent.source, ProxyUsageEvent.status, func.count(ProxyUsageEvent.id))
        .group_by(ProxyUsageEvent.account_id, ProxyUsageEvent.provider, ProxyUsageEvent.source, ProxyUsageEvent.status))).all()
    observed = {(a, p): sum(n for i, provider, source, status, n in telemetry if i == a and provider == p
                           and source.startswith("browser_") and status != "unavailable") for a, p, _, _, _ in telemetry}
    missing = {(a, p): sum(n for i, provider, source, status, n in telemetry if i == a and provider == p
                           and source.startswith("browser_") and status == "unavailable") for a, p, _, _, _ in telemetry}
    rate = config.get("package_cost_rub", 1120) / config.get("package_gb", 10)
    return {"config": config, "provider_balance_gb": None, "clinic_usage_available": False,
        "usage_source": "Observed browser encoded response bytes; excludes unobserved traffic, requests and TLS overhead",
        "users": [{"owner_id": u, "provider": p, "estimated_bytes": int(b or 0), "event_count": int(n),
            "estimated_cost_rub": round(int(b or 0) / 1_000_000_000 * (rate if p == "proxly" else 400), 4)}
            for u, p, b, n in user_usage],
        "services": [{"service": s, "provider": p, "estimated_bytes": int(b or 0),
            "estimated_cost_rub": round(int(b or 0) / 1_000_000_000 * (rate if p == "proxly" else 400), 4)} for s, p, b in service_usage],
        "accounts": [{"id": a.id, "owner_id": a.owner_id, "username": a.username,
            "provider": a.proxy_provider, "session_id": a.proxy_session_id, "status": a.status,
            "estimated_bytes": sum(v for (i, _), v in totals.items() if i == a.id),
            "observed_browser_event_count": observed.get((a.id, a.proxy_provider), 0),
            "missing_browser_telemetry_count": missing.get((a.id, a.proxy_provider), 0),
            "usage_measured": observed.get((a.id, a.proxy_provider), 0) > 0,
            "check_status": latest[(a.id, a.proxy_provider)].status if (a.id, a.proxy_provider) in latest else "not_checked",
            "checked_at": latest[(a.id, a.proxy_provider)].created_at.replace(tzinfo=UTC).isoformat()
                if (a.id, a.proxy_provider) in latest else None} for a in accounts]}


@router.put("/config")
async def configure(payload: ConfigWrite, db: AsyncSession = Depends(get_db)):
    await save_proxly_config(db, access_login=payload.access_login.get_secret_value(),
        password=payload.password.get_secret_value() if payload.password else None,
        package_gb=payload.package_gb, package_cost_rub=payload.package_cost_rub)
    await db.commit()
    return await read_proxly_config(db)


@router.post("/probe")
async def isolated_probe(db: AsyncSession = Depends(get_db)):
    """Two parallel sticky clients, no login, no existing account changes."""
    from scripts.proxy_trial_probe import Config, probe
    from app.posting.proxy_manager import browser_semaphore
    async with check_lock, browser_semaphore:
        ids, urls = await allocate_proxly_probe_urls(db)
        # IDs are reserved even if a client disconnects during the network test.
        await db.commit()
        result = await probe(Config(samples=2, interval=1, max_runtime=20, response_budget=2048), urls)
        for label in ("A", "B"):
            samples = result["sessions"][label]["samples"]
            db.add(ProxyUsageEvent(service="threadsgo", provider="proxly", operation="isolated_probe",
                estimated_bytes=sum(s["application_response_bytes"] for s in samples), source="http_response_body",
                status="connected" if result["sessions"][label]["complete"] else "connection_failed"))
        await db.commit()
        result.update(session_ids=ids, threads_compatibility_verified=False)
        return result


async def get_account(db, account_id):
    account = await db.get(Account, account_id)
    if account is None or account.platform != Platform.THREADS:
        raise HTTPException(404, "Threads account not found")
    return account


@router.put("/accounts/{account_id}")
async def assign(account_id: int, payload: AssignmentWrite, db: AsyncSession = Depends(get_db)):
    guard = ProfileLock(Path(settings.chrome_profiles_dir) / f"account_{account_id}.lock")
    if not guard.acquire(timeout=0):
        raise HTTPException(409, "Account browser is busy; retry after completion")
    try:
        if db.bind.dialect.name == "sqlite":
            await db.execute(text("BEGIN IMMEDIATE"))
        account = await get_account(db, account_id)
        busy_post = await db.scalar(select(PostingTask.id).where(PostingTask.account_id == account_id,
            PostingTask.status == PostingTaskStatus.RUNNING).limit(1))
        busy_scan = await db.scalar(select(ProjectOperation.id).where(ProjectOperation.project_id == account.project_id,
            ProjectOperation.status == ProjectOperationStatus.RUNNING).limit(1))
        if busy_post or busy_scan:
            raise HTTPException(409, "Account has an active operation; retry after completion")
        if payload.provider == "proxly":
            await assign_proxly_account(db, account)
        else:
            await restore_legacy_proxy(db, account)
        account.status = AccountStatus.DISABLED
        account.last_error = "Пилот Proxly: проверьте вход и включите профиль вручную." if payload.provider == "proxly" else "Подключение восстановлено: проверьте вход и включите профиль вручную."
        await db.commit()
        return {"account_id": account.id, "provider": account.proxy_provider, "session_id": account.proxy_session_id,
                "status": account.status, "paused": True, "next_action": "check_session_then_enable_manually"}
    finally:
        guard.release()


@router.post("/accounts/{account_id}/check")
async def check(account_id: int, db: AsyncSession = Depends(get_db)):
    # One bounded HTTP check, never a Threads action, and never direct fallback.
    from app.posting.proxy_manager import browser_semaphore
    async with check_lock, browser_semaphore:
        account = await get_account(db, account_id)
        proxy = build_threads_proxy_url_for_account(account)
        if not proxy:
            raise HTTPException(409, "Proxy is not configured")
        result = "connection_failed"
        byte_count = 0
        try:
            import ipaddress
            async with httpx.AsyncClient(proxy=proxy, timeout=10, trust_env=False, follow_redirects=False) as client:
                async with client.stream("GET", "https://api.ipify.org") as response:
                    response.raise_for_status()
                    body = b""
                    async for chunk in response.aiter_bytes():
                        byte_count += len(chunk)
                        if byte_count > 512:
                            raise ValueError("Response exceeds check budget")
                        body += chunk
                    ipaddress.ip_address(body.decode().strip())
                    result = "connected"
        except Exception:
            # Never stringify provider exceptions: they can contain credentials.
            pass
        db.add(ProxyUsageEvent(account_id=account.id, owner_id=account.owner_id, service="threadsgo",
            provider=account.proxy_provider, operation="connection_check", estimated_bytes=byte_count,
            source="http_response_body", status=result))
        await db.commit()
        return {"status": result, "estimated_response_bytes": byte_count, "checked_at": datetime.now(UTC).isoformat(),
            "threads_compatibility_verified": False}

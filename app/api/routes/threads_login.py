import asyncio
import json
import threading
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, Header
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db, require_active_subscription
from app.core.secrets import encrypt_secret
from app.db.models import Account, AccountStatus, Platform, User
from app.schemas.account import AccountRead
from app.services.proxy_pool import assign_threads_proxy_port, threads_proxy_assignment_lock
from app.services.threads_login_window import login_window
from app.posting.browser_capacity import browser_semaphore

router = APIRouter(prefix="/threads-login", tags=["accounts"])


class Start(BaseModel):
    username: str = Field(pattern=r"^[A-Za-z0-9_.]{2,30}$")


class Input(BaseModel):
    kind: Literal["click", "text", "key", "scroll"]
    x: int = Field(default=0, ge=0, lt=1024)
    y: int = Field(default=0, ge=0, lt=768)
    text: str = Field(default="", max_length=1024)
    key: Literal["Enter","Tab","Backspace","Escape","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"] = "Tab"
    delta: int = Field(default=0, ge=-1000, le=1000)


async def check_capacity(db, user):
    count = await db.scalar(select(func.count(Account.id)).where(Account.owner_id == user.id))
    if (count or 0) >= user.tariff_accounts_limit:
        raise HTTPException(402, "Достигнут лимит профилей вашего тарифа.")


@router.post("/start")
async def start(payload: Start, db: AsyncSession = Depends(get_db), user: User = Depends(require_active_subscription)):
    async with threads_proxy_assignment_lock:
        await check_capacity(db, user)
        port = await assign_threads_proxy_port(db)
    try:
        await asyncio.wait_for(browser_semaphore.acquire(), timeout=5)
    except TimeoutError:
        raise HTTPException(409, "Все окна браузера заняты. Попробуйте подключить профиль через несколько минут.") from None
    loop = asyncio.get_running_loop()
    claimed = threading.Event()
    release_guard = threading.Lock()
    released = False
    def release_capacity():
        nonlocal released
        with release_guard:
            if released:
                return
            released = True
        try:
            loop.call_soon_threadsafe(browser_semaphore.release)
        except RuntimeError:
            pass  # The process/event loop is already shutting down.
    try:
        return await asyncio.to_thread(login_window.start, user.id, payload.username, port, release_capacity, claimed)
    except BaseException:
        # A started worker owns the reservation until Chrome actually closes.
        if not claimed.is_set():
            release_capacity()
        raise


@router.get("/frame")
async def frame(token: str = Header(alias="X-Login-Window"), owner: int = Depends(get_current_user_id)):
    value = await asyncio.to_thread(login_window.command, owner, token, "frame")
    return Response(value, media_type="image/jpeg", headers={"Cache-Control":"no-store", "Pragma":"no-cache", "X-Content-Type-Options":"nosniff"})


@router.post("/input")
async def input_action(payload: Input, token: str = Header(alias="X-Login-Window"), owner: int = Depends(get_current_user_id)):
    return await asyncio.to_thread(login_window.command, owner, token, payload.kind, payload.model_dump())


@router.post("/finish", response_model=AccountRead)
async def finish(token: str = Header(alias="X-Login-Window"), db: AsyncSession = Depends(get_db), user: User = Depends(require_active_subscription)):
    async with threads_proxy_assignment_lock:
        room = login_window.access(user.id, token)
        await check_capacity(db, user)
        occupied = await db.scalar(select(Account.id).where(Account.assigned_port == room["port"]).limit(1))
        if occupied:
            raise HTTPException(409, "Подключение сервера изменилось. Закройте окно и повторите вход.")
        cookies = await asyncio.to_thread(login_window.command, user.id, token, "finish")
        duplicate = await db.scalar(select(Account.id).where(Account.owner_id==user.id, Account.platform==Platform.THREADS, func.lower(Account.username)==room["username"].lower()).limit(1))
        if duplicate:
            raise HTTPException(409, "Этот профиль уже добавлен. Используйте его карточку.")
        # The user may have closed the window while verification was running.
        login_window.access(user.id, token)
        account = Account(owner_id=user.id, platform=Platform.THREADS, username=room["username"],
                          status=AccountStatus.ACTIVE, assigned_port=room["port"],
                          cookies_encrypted=encrypt_secret(json.dumps(cookies)))
        db.add(account)
        await db.flush()  # Allocate a destination ID without exposing an incomplete account.
        try:
            await asyncio.to_thread(login_window.command, user.id, token, "adopt", {"account_id": account.id})
            await db.commit()
        except BaseException:
            # Keep the DB reservation during cleanup, including a cancelled request.
            try:
                await asyncio.shield(asyncio.to_thread(login_window.discard_adopted_profile, user.id, token, account.id))
            finally:
                await asyncio.shield(db.rollback())
            raise
        await db.refresh(account)
        login_window.close(user.id, token)
        return account


@router.post("/stop")
async def stop(token: str = Header(alias="X-Login-Window"), owner: int = Depends(get_current_user_id)):
    login_window.close(owner, token)
    return {"ok":True}

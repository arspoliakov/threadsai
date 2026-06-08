from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db, require_active_subscription
from app.db.models import Account, AccountStatus, PostingTask, Project, User
from app.db.repositories.accounts import AccountRepository
from app.posting.exceptions import SessionExpiredException
from app.posting.scheduler import schedule_account_queue_refill
from app.posting.session_checker import check_session_in_subprocess
from app.schemas.account import AccountCreate, AccountRead, AccountUpdate
from app.services.account_extension_links import consume_extension_link, create_extension_link
from app.services.proxy_pool import prepare_account_create, prepare_account_update


router = APIRouter(prefix="/accounts", tags=["accounts"])


class AccountStatusUpdate(BaseModel):
    status: AccountStatus
    last_error: str | None = None


class AccountSessionCheckRead(BaseModel):
    account_id: int
    status: AccountStatus
    message: str
    detected_username: str | None = None


class AccountExtensionLinkCreate(BaseModel):
    project_id: int | None = None
    account_id: int | None = None


class AccountExtensionLinkRead(BaseModel):
    token: str
    expires_at: datetime


class AccountExtensionLinkConsume(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    cookies: list[dict[str, Any]] = Field(min_length=1, max_length=100)


@router.post(
    "/extension-links",
    response_model=AccountExtensionLinkRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_account_extension_link(
    payload: AccountExtensionLinkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_active_subscription),
) -> AccountExtensionLinkRead:
    token, expires_at = await create_extension_link(
        owner=current_user,
        session=db,
        project_id=payload.project_id,
        account_id=payload.account_id,
    )
    return AccountExtensionLinkRead(token=token, expires_at=expires_at)


@router.post(
    "/extension-links/consume",
    response_model=AccountRead,
    status_code=status.HTTP_201_CREATED,
)
async def consume_account_extension_link(
    payload: AccountExtensionLinkConsume,
    db: AsyncSession = Depends(get_db),
) -> AccountRead:
    account = await consume_extension_link(
        raw_token=payload.token,
        raw_cookies=payload.cookies,
        session=db,
    )
    if account.project_id is not None and account.status == AccountStatus.ACTIVE:
        schedule_account_queue_refill(account.project_id, account.id)
    return account


@router.post("/", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: AccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
    current_user: User = Depends(require_active_subscription),
) -> AccountRead:
    accounts_count = await db.scalar(
        select(func.count(Account.id)).where(Account.owner_id == current_user_id)
    )
    if (accounts_count or 0) >= current_user.tariff_accounts_limit:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "tariff_accounts_limit_reached",
                "message": "Current tariff account limit is reached.",
                "limit": current_user.tariff_accounts_limit,
                "tariff_plan": current_user.tariff_plan,
            },
        )

    if payload.project_id is not None:
        project = await _get_owned_project(payload.project_id, current_user_id, db)

        if project is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )

    prepared_payload = await prepare_account_create(payload, db)
    account_repository = AccountRepository(db)
    account = await account_repository.create_account(prepared_payload)
    account.owner_id = current_user_id
    await db.commit()
    await db.refresh(account)
    if account.project_id is not None and account.status == AccountStatus.ACTIVE:
        schedule_account_queue_refill(account.project_id, account.id)
    return account


@router.get("/", response_model=list[AccountRead], status_code=status.HTTP_200_OK)
async def get_accounts(
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> list[AccountRead]:
    result = await db.scalars(
        select(Account)
        .where(Account.owner_id == current_user_id)
        .order_by(Account.created_at.desc())
    )
    return list(result.all())


@router.get(
    "/project/{project_id}",
    response_model=list[AccountRead],
    status_code=status.HTTP_200_OK,
)
async def get_accounts_by_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> list[AccountRead]:
    project = await _get_owned_project(project_id, current_user_id, db)

    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    stmt = (
        select(Account)
        .where(
            Account.project_id == project_id,
            Account.owner_id == current_user_id,
        )
        .order_by(Account.created_at.desc())
    )
    return list((await db.scalars(stmt)).all())


@router.patch(
    "/{account_id}/status",
    response_model=AccountRead,
    status_code=status.HTTP_200_OK,
)
async def update_account_status(
    account_id: int,
    payload: AccountStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> AccountRead:
    account = await _get_owned_account(account_id, current_user_id, db)

    account.status = payload.status
    account.last_error = payload.last_error
    await db.commit()
    await db.refresh(account)
    if account.project_id is not None and account.status == AccountStatus.ACTIVE:
        schedule_account_queue_refill(account.project_id, account.id)
    return account


@router.patch(
    "/{account_id}",
    response_model=AccountRead,
    status_code=status.HTTP_200_OK,
)
async def update_account(
    account_id: int,
    payload: AccountUpdate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> AccountRead:
    account = await _get_owned_account(account_id, current_user_id, db)

    if payload.project_id is not None:
        project = await _get_owned_project(payload.project_id, current_user_id, db)

        if project is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )

    previous_project_id = account.project_id
    previous_status = account.status
    prepared_payload = prepare_account_update(payload)

    for key, value in prepared_payload.model_dump(exclude_unset=True).items():
        setattr(account, key, value)

    await db.commit()
    await db.refresh(account)
    if (
        account.project_id is not None
        and account.status == AccountStatus.ACTIVE
        and (previous_project_id != account.project_id or previous_status != account.status)
    ):
        schedule_account_queue_refill(account.project_id, account.id)
    return account


@router.post(
    "/{account_id}/unlink",
    response_model=AccountRead,
    status_code=status.HTTP_200_OK,
)
async def unlink_account_from_project(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> AccountRead:
    account = await _get_owned_account(account_id, current_user_id, db)
    account.project_id = None
    await db.commit()
    await db.refresh(account)
    return account


@router.post(
    "/{account_id}/check-session",
    response_model=AccountSessionCheckRead,
    status_code=status.HTTP_200_OK,
)
async def check_account_session(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> AccountSessionCheckRead:
    account = await _get_owned_account(account_id, current_user_id, db)

    if account.platform.value != "threads":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session check is available only for Threads accounts.",
        )

    try:
        result = await check_session_in_subprocess(account.id, timeout_seconds=60)
        if result.detected_username:
            account.username = result.detected_username
        account.status = AccountStatus.ACTIVE
        account.last_error = None
        await db.commit()
        await db.refresh(account)
        if account.project_id is not None:
            schedule_account_queue_refill(account.project_id, account.id)
        return AccountSessionCheckRead(
            account_id=account.id,
            status=account.status,
            detected_username=result.detected_username,
            message="Сессия Threads активна. Cookies работают.",
        )
    except SessionExpiredException as exc:
        account.status = AccountStatus.COOKIES_EXPIRED
        account.last_error = str(exc)
        await db.commit()
        await db.refresh(account)
        return AccountSessionCheckRead(
            account_id=account.id,
            status=account.status,
            message="Сессия Threads истекла. Обновите cookies.",
        )
    except Exception as exc:
        account.status = AccountStatus.ERROR
        account.last_error = str(exc)
        await db.commit()
        await db.refresh(account)
        return AccountSessionCheckRead(
            account_id=account.id,
            status=account.status,
            message=f"Не удалось проверить сессию: {exc}",
        )


@router.delete(
    "/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> None:
    account = await _get_owned_account(account_id, current_user_id, db)
    await db.execute(
        update(PostingTask)
        .where(PostingTask.account_id == account.id)
        .values(account_id=None)
    )
    await db.delete(account)
    await db.commit()


async def _get_owned_project(project_id: int, owner_id: int, db: AsyncSession) -> Project | None:
    return await db.scalar(
        select(Project)
        .where(
            Project.id == project_id,
            Project.owner_id == owner_id,
        )
        .limit(1)
    )


async def _get_owned_account(account_id: int, owner_id: int, db: AsyncSession) -> Account:
    account = await db.scalar(
        select(Account)
        .where(
            Account.id == account_id,
            Account.owner_id == owner_id,
        )
        .limit(1)
    )

    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found",
        )

    return account

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id, get_db
from app.db.models import Account, AccountStatus, Project
from app.db.repositories.accounts import AccountRepository
from app.schemas.account import AccountCreate, AccountRead, AccountUpdate


router = APIRouter(prefix="/accounts", tags=["accounts"])


class AccountStatusUpdate(BaseModel):
    status: AccountStatus
    last_error: str | None = None


@router.post("/", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: AccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> AccountRead:
    if payload.project_id is not None:
        project = await _get_owned_project(payload.project_id, current_user_id, db)

        if project is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )

    account_repository = AccountRepository(db)
    account = await account_repository.create_account(payload)
    account.owner_id = current_user_id
    await db.commit()
    await db.refresh(account)
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

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, key, value)

    await db.commit()
    await db.refresh(account)
    return account


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

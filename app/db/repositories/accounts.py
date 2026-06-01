from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Account, AccountStatus
from app.schemas.account import AccountCreate, AccountCreatePrepared


class AccountRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_account(self, data: AccountCreate | AccountCreatePrepared) -> Account:
        account = Account(**data.model_dump())
        self.session.add(account)
        await self.session.commit()
        await self.session.refresh(account)
        return account

    async def get_accounts_by_project(self, project_id: int) -> list[Account]:
        stmt = (
            select(Account)
            .where(Account.project_id == project_id)
            .order_by(Account.created_at.desc())
        )
        result = await self.session.scalars(stmt)
        return list(result.all())

    async def update_account_status(
        self,
        account_id: int,
        status: AccountStatus,
        last_error: str | None = None,
    ) -> Account | None:
        stmt = select(Account).where(Account.id == account_id)
        result = await self.session.scalars(stmt)
        account = result.one_or_none()

        if account is None:
            return None

        account.status = status
        account.last_error = last_error
        await self.session.commit()
        await self.session.refresh(account)
        return account

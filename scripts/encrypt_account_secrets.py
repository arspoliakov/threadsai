from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.core.secrets import encrypt_secret, is_encrypted_secret
from app.db.models import Account
from app.db.session import AsyncSessionLocal


async def main() -> None:
    changed = 0
    async with AsyncSessionLocal() as session:
        accounts = list((await session.scalars(select(Account))).all())
        for account in accounts:
            for field_name in ("cookies_encrypted", "session_data_encrypted"):
                value = getattr(account, field_name)
                if not value or is_encrypted_secret(value):
                    continue
                setattr(account, field_name, encrypt_secret(value))
                changed += 1

        await session.commit()

    print(f"Encrypted account secret fields: {changed}")


if __name__ == "__main__":
    asyncio.run(main())

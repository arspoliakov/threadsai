from __future__ import annotations

import asyncio
import json
import sys

from app.db.models import Account
from app.db.session import AsyncSessionLocal
from app.posting.adapters.threads import ThreadsAdapter
from app.posting.exceptions import SessionExpiredException


async def _load_account(account_id: int) -> Account:
    async with AsyncSessionLocal() as session:
        account = await session.get(Account, account_id)
        if account is None:
            raise RuntimeError(f"Account not found: {account_id}")

        return account


def _emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main() -> int:
    if len(sys.argv) != 2:
        _emit({"status": "error", "message": "Usage: python -m app.posting.session_check_runner <account_id>"})
        return 2

    account_id = int(sys.argv[1])

    try:
        account = asyncio.run(_load_account(account_id))
        result = ThreadsAdapter(timeout_seconds=20)._check_session_sync(account)
        _emit(
            {
                "status": "ok",
                "success": result.success,
                "detected_username": result.detected_username,
            }
        )
        return 0
    except SessionExpiredException as exc:
        _emit({"status": "session_expired", "message": str(exc)})
        return 0
    except Exception as exc:
        _emit({"status": "error", "message": str(exc)})
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

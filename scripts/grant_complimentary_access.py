from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select

from app.db.models import User
from app.db.session import AsyncSessionLocal
from app.services.subscriptions import grant_complimentary_access


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Grant time-limited complimentary ThreadsGo access.")
    parser.add_argument("--telegram-id", type=int, required=True)
    parser.add_argument("--plan", choices=("basic", "pro", "agency"), default="basic")
    parser.add_argument("--days", type=int, required=True)
    parser.add_argument("--reason", required=True)
    return parser.parse_args()


async def run(args: argparse.Namespace) -> None:
    async with AsyncSessionLocal() as session:
        user = await session.scalar(select(User).where(User.telegram_id == args.telegram_id).limit(1))
        if user is None:
            raise SystemExit(f"User with telegram_id={args.telegram_id} was not found")

        expires_at = await grant_complimentary_access(
            user=user,
            session=session,
            plan_name=args.plan,
            days=args.days,
            reason=args.reason,
        )
        print(
            f"Granted {args.plan} access to user_id={user.id} "
            f"telegram_id={args.telegram_id} until {expires_at.isoformat()}"
        )


if __name__ == "__main__":
    asyncio.run(run(parse_args()))

from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import User
from app.db.session import AsyncSessionLocal


bearer_scheme = HTTPBearer(auto_error=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def get_current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )

    if credentials.credentials == settings.web_admin_token:
        return "admin"

    from app.api.auth import verify_access_token

    try:
        payload = verify_access_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin token",
        ) from exc

    telegram_id = payload.get("telegram_id")
    try:
        normalized_telegram_id = int(telegram_id) if telegram_id is not None else None
    except (TypeError, ValueError):
        normalized_telegram_id = None

    if not settings.is_telegram_id_approved(normalized_telegram_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Telegram user is not approved for dashboard access",
        )

    return str(payload.get("sub") or "telegram-user")


async def get_current_user_id(current_user: str = Depends(get_current_admin)) -> int:
    try:
        return int(current_user)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant-scoped API requires Telegram JWT authentication.",
        ) from exc


async def get_current_user(
    current_user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await db.scalar(select(User).where(User.id == current_user_id).limit(1))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user


async def require_active_subscription(
    user: User = Depends(get_current_user),
) -> User:
    if user.subscription_status:
        return user

    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "code": "subscription_required",
            "message": "Subscription is inactive. Choose a Tribute plan to continue.",
            "tariff_plan": user.tariff_plan,
        },
    )

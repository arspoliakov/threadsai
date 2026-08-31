import hmac
from typing import Any

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.db.models import User
from app.services.subscriptions import apply_tribute_webhook_payload, get_tariff_chats, refresh_user_subscription
from app.telegram.bot import get_bot


router = APIRouter(prefix="/billing", tags=["billing"])


class BillingPlanRead(BaseModel):
    name: str
    accounts: int
    posts: int
    projects: int
    queue_days: int
    tribute_url: str


class BillingStatusRead(BaseModel):
    subscription_status: bool
    subscription_phase: str
    subscription_expires_at: str | None
    tariff_plan: str
    accounts_limit: int
    posts_per_day_limit: int
    projects_limit: int
    queue_days: int
    plans: list[BillingPlanRead]


@router.get("/status", response_model=BillingStatusRead, status_code=status.HTTP_200_OK)
async def get_billing_status(current_user: User = Depends(get_current_user)) -> BillingStatusRead:
    return _build_billing_status(current_user)


@router.post("/refresh", response_model=BillingStatusRead, status_code=status.HTTP_200_OK)
async def refresh_billing_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillingStatusRead:
    bot = get_bot()
    if bot is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Telegram subscription check is temporarily unavailable.",
        )

    await refresh_user_subscription(bot=bot, user=current_user, session=db)
    return _build_billing_status(current_user)


@router.post("/tribute/webhook", status_code=status.HTTP_200_OK)
async def tribute_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _validate_tribute_webhook_secret(request)

    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook JSON") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook payload must be an object")

    applied = await apply_tribute_webhook_payload(payload=payload, session=db)
    return {"ok": True, "applied": applied}


def _build_billing_status(current_user: User) -> BillingStatusRead:
    return BillingStatusRead(
        subscription_status=current_user.subscription_status,
        subscription_phase=current_user.subscription_phase,
        subscription_expires_at=current_user.subscription_expires_at.isoformat()
        if current_user.subscription_expires_at
        else None,
        tariff_plan=current_user.tariff_plan,
        accounts_limit=current_user.tariff_accounts_limit,
        posts_per_day_limit=current_user.tariff_posts_per_day,
        projects_limit=current_user.tariff_projects_limit,
        queue_days=current_user.tariff_queue_days,
        plans=_build_plan_reads(),
    )


def _build_plan_reads() -> list[BillingPlanRead]:
    tribute_urls = {
        "basic": settings.tribute_basic_url,
        "pro": settings.tribute_pro_url,
        "agency": settings.tribute_agency_url,
    }
    plan_order = {"basic": 0, "pro": 1, "agency": 2}
    plans = [
        BillingPlanRead(
            name=tariff.name,
            accounts=tariff.accounts,
            posts=tariff.posts,
            projects=tariff.projects,
            queue_days=tariff.queue_days,
            tribute_url=tribute_urls.get(tariff.name, ""),
        )
        for tariff in get_tariff_chats().values()
    ]
    return sorted(plans, key=lambda plan: plan_order.get(plan.name, 99))


def _validate_tribute_webhook_secret(request: Request) -> None:
    expected_secret = settings.tribute_webhook_secret.strip()
    if not expected_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Tribute webhook is not configured")

    provided_secret = (
        request.headers.get("x-tribute-webhook-secret")
        or request.headers.get("x-webhook-secret")
        or request.query_params.get("token")
        or ""
    ).strip()
    auth_header = request.headers.get("authorization", "").strip()
    if auth_header.lower().startswith("bearer "):
        provided_secret = auth_header[7:].strip()

    if not hmac.compare_digest(provided_secret, expected_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook secret")

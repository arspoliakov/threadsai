from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_operator
from app.db.models import User, RetentionBotContact, RetentionCampaign, RetentionDelivery, RetentionConsentEvent
from app.services import retention as service

router = APIRouter(prefix="/retention", tags=["retention"])
admin_router = APIRouter(prefix="/admin/retention", tags=["operator retention"], dependencies=[Depends(require_operator)])


class PreferenceWrite(BaseModel):
    marketing_consent: bool
    onboarding_consent: bool


class CampaignPreview(BaseModel):
    segment: Literal["all", "no_project", "no_first_post", "active_subscribers"]
    kind: Literal["marketing", "onboarding"]
    message: str = Field(min_length=1, max_length=3500)

    @field_validator("message")
    @classmethod
    def meaningful_message(cls, value):
        if not value.strip():
            raise ValueError("Сообщение не может быть пустым")
        return value.strip()


class CampaignWrite(CampaignPreview):
    title: str = Field(min_length=1, max_length=150)
    request_key: str = Field(default_factory=lambda: str(uuid4()), min_length=8, max_length=64)


class SettingsWrite(BaseModel):
    sending_enabled: bool
    automated_enabled: bool


class LegacyConsentImport(BaseModel):
    prior_consent_confirmed: Literal[True]


def campaign_json(campaign):
    return {key: getattr(campaign, key) for key in ("id", "title", "message", "segment", "kind", "status", "recipient_count", "created_at")}


@router.get("/preferences")
async def preferences(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await service.preferences(db, user)


@router.put("/preferences")
async def save_preferences(body: PreferenceWrite, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user.marketing_consent = body.marketing_consent
    user.onboarding_consent = body.onboarding_consent
    user.retention_consent_updated_at = datetime.now(UTC)
    db.add(RetentionConsentEvent(user_id=user.id, marketing_consent=body.marketing_consent,
        onboarding_consent=body.onboarding_consent, version=service.CONSENT_VERSION, source="account_preferences"))
    disabled = [kind for kind, enabled in (("marketing", body.marketing_consent), ("onboarding", body.onboarding_consent)) if not enabled]
    if disabled:
        await db.execute(update(RetentionDelivery).where(RetentionDelivery.user_id == user.id,
            RetentionDelivery.status == "queued", RetentionDelivery.kind.in_(disabled)).values(status="cancelled", error_code="opt_out"))
    await db.commit()
    return await service.preferences(db, user)


@admin_router.get("")
async def summary(db: AsyncSession = Depends(get_db)):
    config = await service.get_settings(db)
    totals = dict((await db.execute(select(RetentionDelivery.status, func.count()).group_by(RetentionDelivery.status))).all())
    campaigns = list((await db.scalars(select(RetentionCampaign).order_by(RetentionCampaign.id.desc()).limit(50))).all())
    campaign_stats = (await db.execute(select(RetentionDelivery.campaign_id, RetentionDelivery.status, func.count())
        .where(RetentionDelivery.campaign_id.in_([c.id for c in campaigns])).group_by(RetentionDelivery.campaign_id, RetentionDelivery.status))).all()
    counts_by_campaign = {}
    for campaign_id, status, count in campaign_stats:
        counts_by_campaign.setdefault(campaign_id, {})[status] = count
    return {"sending_enabled": config.sending_enabled, "automated_enabled": config.automated_enabled,
        "counts": {"users": await db.scalar(select(func.count()).select_from(User)),
            "opted_in": await db.scalar(select(func.count()).select_from(User).where(or_(User.marketing_consent.is_(True), User.onboarding_consent.is_(True)))),
            "reachable": await db.scalar(select(func.count()).select_from(User).join(RetentionBotContact, User.telegram_id == RetentionBotContact.telegram_id)
                .where(RetentionBotContact.reachable.is_(True), RetentionBotContact.blocked.is_(False))),
            "queued": totals.get("queued", 0), "sent": totals.get("sent", 0), "failed": totals.get("failed", 0),
            "uncertain": totals.get("uncertain", 0), "cancelled": totals.get("cancelled", 0)},
        "campaigns": [{**campaign_json(c), "delivery_stats": counts_by_campaign.get(c.id, {})} for c in campaigns], "automatic_rules": service.RULES,
        "frequency_limits": {"min_interval_hours": 72, "max_per_7_days": 2, "max_per_30_days": 3, "quiet_hours_timezone": "Europe/Moscow", "send_hours": "10:00–20:00"}}


@admin_router.put("/settings")
async def settings(body: SettingsWrite, db: AsyncSession = Depends(get_db)):
    config = await service.get_settings(db)
    config.sending_enabled = body.sending_enabled
    config.automated_enabled = body.automated_enabled
    await db.commit()
    return {"sending_enabled": config.sending_enabled, "automated_enabled": config.automated_enabled}


@admin_router.post("/preview")
async def preview(body: CampaignPreview, db: AsyncSession = Depends(get_db)):
    ids, excluded = await service.preview(db, body.segment, body.kind)
    return {"eligible_count": len(ids), "excluded_count": excluded}


@admin_router.post("/import-legacy-consents")
async def import_legacy_consents(body: LegacyConsentImport, db: AsyncSession = Depends(get_db)):
    return {"imported_users": await service.import_owner_confirmed_legacy_consents(db)}


@admin_router.post("/campaigns")
async def create_campaign(body: CampaignWrite, db: AsyncSession = Depends(get_db)):
    existing = await db.scalar(select(RetentionCampaign).where(RetentionCampaign.request_key == body.request_key))
    if existing and (existing.title, existing.message, existing.segment, existing.kind) != (body.title, body.message, body.segment, body.kind):
        raise HTTPException(409, "Ключ запроса уже использован для другой рассылки")
    campaign = await service.create_campaign(db, **body.model_dump())
    return campaign_json(campaign)


@admin_router.post("/campaigns/{campaign_id}/cancel")
async def cancel_campaign(campaign_id: int, db: AsyncSession = Depends(get_db)):
    campaign = await db.get(RetentionCampaign, campaign_id)
    if campaign is None:
        raise HTTPException(404, "Рассылка не найдена")
    campaign.status = "cancelled"
    await db.execute(update(RetentionDelivery).where(RetentionDelivery.campaign_id == campaign_id,
        RetentionDelivery.status == "queued").values(status="cancelled", error_code="campaign_cancelled"))
    await db.commit()
    return campaign_json(campaign)

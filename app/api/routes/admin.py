"""Profile-bound operator overview. Never return account credentials or browser data."""
from datetime import UTC, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_db, require_operator
from app.core.config import settings
from app.db.models import User, Project, Account, PostingTask, PostingTaskStatus, ProjectOperation, TributeWebhookEvent
from app.services.subscriptions import has_current_subscription_access
from app.services.product_funnel import build_product_funnel
from app.services.product_analytics import build_product_analytics

router = APIRouter(prefix='/admin', tags=['operator dashboard'], dependencies=[Depends(require_operator)])

@router.get('/product-funnel')
async def product_funnel(days: int = Query(default=30, ge=0, le=30), db: AsyncSession = Depends(get_db)):
    if days not in {0, 7, 30}:
        raise HTTPException(422, "Выберите когорту 7, 30 дней или весь период (0).")
    return await build_product_funnel(db, days=days)

@router.get('/product-analytics')
async def product_analytics(days: int = Query(default=30, ge=0, le=30), db: AsyncSession = Depends(get_db)):
    if days not in {0, 7, 30}:
        raise HTTPException(422, "Выберите когорту 7, 30 дней или весь период (0).")
    return await build_product_analytics(db, days=days)

async def grouped(db, model, column):
    return {str(getattr(key, 'value', key)): count for key, count in (await db.execute(select(column, func.count()).select_from(model).group_by(column))).all()}

@router.get('/overview')
async def overview(db: AsyncSession = Depends(get_db)):
    users = list((await db.scalars(select(User))).all())
    now = datetime.now(UTC)
    project_owners = set((await db.scalars(select(Project.owner_id).where(Project.owner_id.is_not(None)).distinct())).all())
    published_owners = set((await db.scalars(select(Project.owner_id).join(PostingTask, PostingTask.project_id == Project.id).where(PostingTask.status.in_([PostingTaskStatus.SUCCESS, PostingTaskStatus.PARTIAL_SUCCESS])).distinct())).all())
    return {'checked_at':now,'counts': {'users':len(users), 'active_subscriptions':sum(has_current_subscription_access(u) for u in users),
        'registered_7d':sum((u.created_at.replace(tzinfo=UTC) if u.created_at.tzinfo is None else u.created_at) >= now-timedelta(days=7) for u in users),
        'with_project':len(project_owners), 'with_publication':len(published_owners),
        'projects':await db.scalar(select(func.count()).select_from(Project)), 'accounts':await db.scalar(select(func.count()).select_from(Account))},
        'tasks':await grouped(db, PostingTask, PostingTask.status), 'accounts':await grouped(db, Account, Account.status),
        'operations':await grouped(db, ProjectOperation, ProjectOperation.status), 'tribute_events':await grouped(db, TributeWebhookEvent, TributeWebhookEvent.status),
        'integrations':{'telegram_configured':bool(settings.telegram_bot_token), 'tribute_key_configured':bool(settings.tribute_webhook_secret)},
        'notes':['Статусы интеграций показывают наличие настроек, а не проверку доступности провайдера.', 'Активная подписка не равна новой оплате; выручка не рассчитывается по тарифам.']}

@router.get('/users')
async def users(search: str = Query(default='', max_length=120), offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=100), db: AsyncSession = Depends(get_db)):
    query = select(User)
    term = search.strip().lstrip('@')
    if term:
        pattern='%'+term.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        filters=[User.username.ilike(pattern,escape='\\'), User.first_name.ilike(pattern,escape='\\')]
        if term.isdigit(): filters.append(User.telegram_id == int(term))
        query=query.where(or_(*filters))
    total=await db.scalar(select(func.count()).select_from(query.subquery()))
    result=list((await db.scalars(query.order_by(User.created_at.desc(),User.id.desc()).offset(offset).limit(limit))).all())
    ids=[u.id for u in result]
    projects=dict((await db.execute(select(Project.owner_id,func.count()).where(Project.owner_id.in_(ids)).group_by(Project.owner_id))).all())
    accounts=dict((await db.execute(select(Account.owner_id,func.count()).where(Account.owner_id.in_(ids)).group_by(Account.owner_id))).all())
    return {'total':total,'offset':offset,'users':[{'id':u.id,'telegram_id':u.telegram_id,'username':u.username,'first_name':u.first_name,'created_at':u.created_at,
        'active_subscription':has_current_subscription_access(u),'plan':u.tariff_plan,'phase':u.subscription_phase,'expires_at':u.subscription_expires_at,
        'gift_expires_at':u.complimentary_access_expires_at,'projects':projects.get(u.id,0),'accounts':accounts.get(u.id,0),
        'marketing_consent':u.marketing_consent,'onboarding_consent':u.onboarding_consent} for u in result]}

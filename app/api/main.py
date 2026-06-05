import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi import _rate_limit_exceeded_handler

from app.api import auth
from app.api.auth import limiter
from app.api.middleware.error_reporting import ErrorReportingMiddleware
from app.api.routes import accounts, billing, dashboard, health, projects, prompts, tasks, trends
from app.posting.proxy_manager import ProxyManager
from app.posting.scheduler import scheduler, setup_posting_scheduler
from app.telegram.admin_bot import cancel_admin_polling_task, start_admin_bot_polling, stop_admin_bot
from app.telegram.bot import cancel_polling_task, start_bot_polling, stop_bot


proxy_manager = ProxyManager()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    polling_task: asyncio.Task[None] | None = asyncio.create_task(start_bot_polling())
    admin_polling_task: asyncio.Task[None] | None = asyncio.create_task(start_admin_bot_polling())
    setup_posting_scheduler()
    scheduler.start()
    proxy_manager.start()

    try:
        yield
    finally:
        await proxy_manager.stop()
        if scheduler.running:
            scheduler.shutdown(wait=False)
        await cancel_polling_task(polling_task)
        await cancel_admin_polling_task(admin_polling_task)
        await stop_bot()
        await stop_admin_bot()


app = FastAPI(
    title="AI Auto Poster API",
    description="Multi-tenant API for project and social account management.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(ErrorReportingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

API_V1_PREFIX = "/api/v1"

app.include_router(auth.router, prefix=API_V1_PREFIX)
app.include_router(health.router, prefix=API_V1_PREFIX)
app.include_router(dashboard.router, prefix=API_V1_PREFIX)
app.include_router(billing.router, prefix=API_V1_PREFIX)
app.include_router(projects.router, prefix=API_V1_PREFIX)
app.include_router(accounts.router, prefix=API_V1_PREFIX)
app.include_router(tasks.router, prefix=API_V1_PREFIX)
app.include_router(trends.router, prefix=API_V1_PREFIX)
app.include_router(prompts.router, prefix=API_V1_PREFIX)

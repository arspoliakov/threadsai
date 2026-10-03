"""Shared process-wide browser capacity, including session-check subprocesses."""
import asyncio
from app.core.config import settings

browser_semaphore = asyncio.Semaphore(max(1, settings.max_concurrent_browsers))

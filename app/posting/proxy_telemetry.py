"""Partial browser response-byte estimates, never provider billing/balance."""
import json
from queue import SimpleQueue, Empty

_events = SimpleQueue()


def collect_browser_estimate(driver, account_id):
    if account_id is None:
        return
    try:
        encoded = 0
        for entry in driver.get_log("performance"):
            message = json.loads(entry["message"])["message"]
            if message.get("method") == "Network.loadingFinished":
                encoded += max(0, int(message.get("params", {}).get("encodedDataLength", 0)))
        _events.put((account_id, encoded, "partial"))
    except Exception:
        _events.put((account_id, 0, "unavailable"))


async def flush_browser_estimates():
    from app.db.session import AsyncSessionLocal
    from app.db.models import Account, ProxyUsageEvent
    rows = []
    while True:
        try:
            rows.append(_events.get_nowait())
        except Empty:
            break
    if not rows:
        return
    async with AsyncSessionLocal() as session:
        for account_id, estimated, status in rows:
            account = await session.get(Account, account_id)
            if account is not None:
                session.add(ProxyUsageEvent(account_id=account_id, owner_id=account.owner_id,
                    service="threadsgo", provider=account.proxy_provider or "proxymarket",
                    operation="browser", estimated_bytes=estimated,
                    source="browser_partial_encoded_response", status=status))
        await session.commit()

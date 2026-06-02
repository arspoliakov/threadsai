from __future__ import annotations

import asyncio
import json
import sys

from app.posting.adapters.base import PublishResult
from app.posting.exceptions import ProxyNetworkException, SessionExpiredException


async def check_session_in_subprocess(account_id: int, *, timeout_seconds: int = 60) -> PublishResult:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "app.posting.session_check_runner",
        str(account_id),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except TimeoutError as exc:
        process.kill()
        await process.communicate()
        raise ProxyNetworkException("Threads session check timed out while starting Chrome.") from exc

    stdout_text = stdout.decode(errors="replace")
    stderr_text = stderr.decode(errors="replace")
    payload = _extract_json_payload(stdout_text)

    if payload is None:
        message = stderr_text.strip() or stdout_text.strip() or f"Session check subprocess exited with {process.returncode}."
        raise ProxyNetworkException(message)

    status = payload.get("status")
    if status == "ok":
        return PublishResult(
            success=bool(payload.get("success", True)),
            detected_username=payload.get("detected_username") or None,
        )

    message = str(payload.get("message") or "Threads session check failed.")
    if status == "session_expired":
        raise SessionExpiredException(message)

    raise ProxyNetworkException(message)


def _extract_json_payload(stdout_text: str) -> dict[str, object] | None:
    for line in reversed(stdout_text.splitlines()):
        value = line.strip()
        if not value.startswith("{"):
            continue

        try:
            payload = json.loads(value)
        except json.JSONDecodeError:
            continue

        if isinstance(payload, dict):
            return payload

    return None

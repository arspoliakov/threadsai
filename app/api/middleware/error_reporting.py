import logging
import traceback
from uuid import uuid4

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from app.api.auth import verify_access_token
from app.telegram.notifications import send_admin_notification


logger = logging.getLogger(__name__)


class ErrorReportingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        try:
            return await call_next(request)
        except Exception as exc:
            error_id = uuid4().hex[:10]
            logger.exception("Unhandled API error %s", error_id)
            await _notify_admin_about_error(error_id=error_id, request=request, exc=exc)

            return JSONResponse(
                status_code=500,
                content={
                    "detail": "Произошла внутренняя ошибка. Мы уже отправили лог админу и разбираемся.",
                    "error_reported": True,
                    "error_id": error_id,
                },
            )


async def _notify_admin_about_error(error_id: str, request: Request, exc: Exception) -> None:
    user_context = _extract_user_context(request)
    client_host = request.client.host if request.client else "unknown"
    traceback_tail = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-2600:]

    text = (
        "🚨 Ошибка в ThreadsGo\n"
        f"ID: {error_id}\n"
        f"Метод: {request.method}\n"
        f"URL: {request.url.path}\n"
        f"IP: {client_host}\n"
        f"Пользователь: {user_context}\n"
        f"Ошибка: {type(exc).__name__}: {exc}\n\n"
        f"{traceback_tail}"
    )

    await send_admin_notification(text[:3900])


def _extract_user_context(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")

    if scheme.lower() != "bearer" or not token:
        return "не авторизован / токен не передан"

    try:
        payload = verify_access_token(token)
    except Exception:
        return "токен есть, но не распарсился"

    user_id = payload.get("sub")
    telegram_id = payload.get("telegram_id")
    username = payload.get("username")

    return f"user_id={user_id}, telegram_id={telegram_id}, username={username or '-'}"

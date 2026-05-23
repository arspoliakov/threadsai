from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.api.deps import get_db
from app.db.models import User


logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TelegramAuthPayload(BaseModel):
    id: int
    first_name: str = Field(min_length=1)
    username: str | None = None
    photo_url: str | None = None
    auth_date: int
    hash: str


@router.post("/login", response_model=LoginResponse, status_code=status.HTTP_200_OK)
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginRequest) -> LoginResponse:
    client_host = request.client.host if request.client else "unknown"
    logger.info("Login attempt from %s", client_host)

    if payload.password != settings.web_admin_password:
        logger.info("Login failed from %s: invalid password", client_host)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
        )

    logger.info("Login succeeded from %s", client_host)
    return LoginResponse(access_token=settings.web_admin_token)


@router.post("/telegram", response_model=LoginResponse, status_code=status.HTTP_200_OK)
@limiter.limit("10/minute")
async def telegram_login(
    request: Request,
    payload: TelegramAuthPayload,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    client_host = request.client.host if request.client else "unknown"
    logger.info("Telegram login attempt from %s for telegram_id=%s", client_host, payload.id)

    _validate_telegram_auth(payload)
    user = await _get_or_create_telegram_user(payload=payload, db=db)
    token = create_access_token(
        {
            "sub": str(user.id),
            "telegram_id": user.telegram_id,
            "username": user.username,
            "type": "access",
        }
    )
    logger.info("Telegram login succeeded from %s for user_id=%s", client_host, user.id)
    return LoginResponse(access_token=token)


def _validate_telegram_auth(payload: TelegramAuthPayload) -> None:
    if not settings.telegram_bot_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Telegram bot token is not configured",
        )

    auth_datetime = datetime.fromtimestamp(payload.auth_date, tz=UTC)
    auth_age_seconds = (datetime.now(UTC) - auth_datetime).total_seconds()
    if auth_age_seconds < 0 or auth_age_seconds > settings.telegram_auth_max_age_seconds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram auth payload is expired",
        )

    payload_dict = payload.model_dump(exclude={"hash"}, exclude_none=True)
    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(payload_dict.items())
    )
    secret_key = hashlib.sha256(settings.telegram_bot_token.encode("utf-8")).digest()
    expected_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, payload.hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Telegram auth hash",
        )


async def _get_or_create_telegram_user(payload: TelegramAuthPayload, db: AsyncSession) -> User:
    stmt = select(User).where(User.telegram_id == payload.id).limit(1)
    user = await db.scalar(stmt)

    if user is None:
        user = User(
            telegram_id=payload.id,
            username=payload.username,
            first_name=payload.first_name,
            photo_url=payload.photo_url,
        )
        db.add(user)
    else:
        user.username = payload.username
        user.first_name = payload.first_name
        user.photo_url = payload.photo_url

    await db.commit()
    await db.refresh(user)
    return user


def create_access_token(payload: dict[str, Any]) -> str:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    token_payload = {
        **payload,
        "exp": int(expires_at.timestamp()),
        "iat": int(datetime.now(UTC).timestamp()),
    }
    header = {"alg": "HS256", "typ": "JWT"}
    signing_input = ".".join(
        [
            _base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            _base64url_encode(json.dumps(token_payload, separators=(",", ":")).encode("utf-8")),
        ]
    )
    signature = hmac.new(
        settings.jwt_secret_key.encode("utf-8"),
        signing_input.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{signing_input}.{_base64url_encode(signature)}"


def verify_access_token(token: str) -> dict[str, Any]:
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
    except ValueError as exc:
        raise ValueError("Malformed token") from exc

    signing_input = f"{encoded_header}.{encoded_payload}"
    expected_signature = hmac.new(
        settings.jwt_secret_key.encode("utf-8"),
        signing_input.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    if not hmac.compare_digest(_base64url_encode(expected_signature), encoded_signature):
        raise ValueError("Invalid token signature")

    payload = json.loads(_base64url_decode(encoded_payload))
    expires_at = int(payload.get("exp", 0))
    if expires_at < int(datetime.now(UTC).timestamp()):
        raise ValueError("Token expired")

    return payload


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _base64url_decode(value: str) -> bytes:
    padded_value = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded_value.encode("ascii"))

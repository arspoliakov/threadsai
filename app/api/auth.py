from __future__ import annotations

import base64
import asyncio
import hashlib
import hmac
import json
import logging
from urllib.parse import parse_qsl
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.api.deps import get_current_user_id, get_db
from app.db.models import User
from app.services import telegram_login as bot_login


logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AuthAttributionPayload(BaseModel):
    first_landing: str | None = Field(default=None, max_length=2048)
    referrer: str | None = Field(default=None, max_length=2048)
    utm: dict[str, str] = Field(default_factory=dict)
    analytics: dict[str, str] = Field(default_factory=dict)


class TelegramAuthPayload(BaseModel):
    id: int
    first_name: str = Field(min_length=1)
    last_name: str | None = None
    username: str | None = None
    photo_url: str | None = None
    auth_date: int
    hash: str
    attribution: AuthAttributionPayload | None = None


class CurrentUserResponse(BaseModel):
    id: int
    telegram_id: int | None
    username: str | None
    first_name: str
    photo_url: str | None
    subscription_status: bool
    subscription_phase: str
    tariff_plan: str
    tariff_accounts_limit: int
    tariff_posts_per_day: int
    tariff_projects_limit: int
    tariff_queue_days: int


class TelegramWebAppLoginRequest(BaseModel):
    init_data: str = Field(min_length=1)
    attribution: AuthAttributionPayload | None = None


class TelegramBotStartRequest(BaseModel):
    attribution: AuthAttributionPayload | None = None


class TelegramBotChallengeRequest(BaseModel):
    challenge_id: str = Field(min_length=1, max_length=64)
    browser_secret: str = Field(min_length=1, max_length=128)


class TelegramBotStartResponse(BaseModel):
    challenge_id: str
    browser_secret: str
    bot_url: str
    expires_at: datetime
    poll_interval_ms: int = 3000
    display_code: str


class TelegramBotStatusResponse(BaseModel):
    status: str
    expires_at: datetime


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

    if not settings.is_telegram_id_approved(payload.id):
        logger.warning("Telegram login denied for unapproved telegram_id=%s", payload.id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Telegram user is not approved yet",
        )

    user = await _get_or_create_telegram_user(payload=payload, db=db)
    await _sync_subscription_after_login(user=user, db=db)
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


@router.post("/telegram-webapp", response_model=LoginResponse, status_code=status.HTTP_200_OK)
@limiter.limit("10/minute")
async def telegram_webapp_login(
    request: Request,
    payload: TelegramWebAppLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    client_host = request.client.host if request.client else "unknown"
    telegram_user = _validate_telegram_webapp_auth(payload.init_data)
    telegram_id = int(telegram_user["id"])
    logger.info("Telegram WebApp login attempt from %s for telegram_id=%s", client_host, telegram_id)

    if not settings.is_telegram_id_approved(telegram_id):
        logger.warning("Telegram WebApp login denied for unapproved telegram_id=%s", telegram_id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Telegram user is not approved yet",
        )

    user = await _get_or_create_telegram_user(
        payload=TelegramAuthPayload(
            id=telegram_id,
            first_name=str(telegram_user.get("first_name") or "Telegram"),
            username=telegram_user.get("username"),
            photo_url=telegram_user.get("photo_url"),
            auth_date=int(dict(parse_qsl(payload.init_data)).get("auth_date", 0)),
            hash=dict(parse_qsl(payload.init_data)).get("hash", ""),
            attribution=payload.attribution,
        ),
        db=db,
    )
    await _sync_subscription_after_login(user=user, db=db)
    token = create_access_token(
        {
            "sub": str(user.id),
            "telegram_id": user.telegram_id,
            "username": user.username,
            "type": "access",
        }
    )
    logger.info("Telegram WebApp login succeeded from %s for user_id=%s", client_host, user.id)
    return LoginResponse(access_token=token)


@router.post(
    "/telegram-bot/start",
    response_model=TelegramBotStartResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/minute")
async def telegram_bot_login_start(
    request: Request,
    response: Response,
    payload: TelegramBotStartRequest,
    db: AsyncSession = Depends(get_db),
) -> TelegramBotStartResponse:
    del request
    response.headers["Cache-Control"] = "no-store"
    username = settings.telegram_bot_username.strip().lstrip("@")
    if not settings.telegram_bot_login_enabled or not settings.telegram_bot_token or not username:
        raise _challenge_http_error(bot_login.ChallengeError("bot_unavailable", 503))
    created = await bot_login.create_challenge(
        session=db,
        attribution=payload.attribution.model_dump() if payload.attribution else None,
    )
    return TelegramBotStartResponse(
        challenge_id=created.challenge.id,
        browser_secret=created.browser_secret,
        bot_url=f"https://t.me/{username}?start=login_{created.bot_secret}",
        expires_at=created.challenge.expires_at,
        display_code=created.challenge.display_code,
    )


@router.post("/telegram-bot/status", response_model=TelegramBotStatusResponse)
@limiter.limit("30/minute")
async def telegram_bot_login_status(
    request: Request,
    response: Response,
    payload: TelegramBotChallengeRequest,
    db: AsyncSession = Depends(get_db),
) -> TelegramBotStatusResponse:
    del request
    response.headers["Cache-Control"] = "no-store"
    try:
        challenge = await bot_login.get_browser_challenge(
            session=db,
            challenge_id=payload.challenge_id,
            browser_secret=payload.browser_secret,
        )
    except bot_login.ChallengeError as exc:
        raise _challenge_http_error(exc) from exc
    return TelegramBotStatusResponse(
        status=bot_login.browser_status(challenge),
        expires_at=challenge.expires_at,
    )


@router.post("/telegram-bot/cancel", response_model=TelegramBotStatusResponse)
@limiter.limit("10/minute")
async def telegram_bot_login_cancel(
    request: Request,
    response: Response,
    payload: TelegramBotChallengeRequest,
    db: AsyncSession = Depends(get_db),
) -> TelegramBotStatusResponse:
    del request
    response.headers["Cache-Control"] = "no-store"
    try:
        challenge = await bot_login.get_browser_challenge(
            session=db,
            challenge_id=payload.challenge_id,
            browser_secret=payload.browser_secret,
        )
        current = await bot_login.cancel_challenge(session=db, challenge=challenge)
    except bot_login.ChallengeError as exc:
        raise _challenge_http_error(exc) from exc
    return TelegramBotStatusResponse(status=current, expires_at=challenge.expires_at)


@router.post("/telegram-bot/complete", response_model=LoginResponse)
@limiter.limit("10/minute")
async def telegram_bot_login_complete(
    request: Request,
    response: Response,
    payload: TelegramBotChallengeRequest,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    del request
    response.headers["Cache-Control"] = "no-store"
    try:
        challenge = await bot_login.get_browser_challenge(
            session=db,
            challenge_id=payload.challenge_id,
            browser_secret=payload.browser_secret,
        )
        retry_token = bot_login.get_retry_token(challenge)
        if retry_token:
            if not settings.is_telegram_id_approved(challenge.telegram_id):
                raise bot_login.ChallengeError("access_denied", 403)
            return LoginResponse(access_token=retry_token)
        current = bot_login.browser_status(challenge)
        if current != "approved":
            code = "challenge_pending" if current == "pending" else f"challenge_{current}"
            raise bot_login.ChallengeError(code, 409 if current != "expired" else 410)
        if challenge.telegram_id is None or not settings.is_telegram_id_approved(challenge.telegram_id):
            raise bot_login.ChallengeError("access_denied", 403)
        profile = challenge.telegram_profile_json or {}
        user = await _get_or_create_verified_telegram_user(
            telegram_id=challenge.telegram_id,
            first_name=str(profile.get("first_name") or "Telegram"),
            username=profile.get("username"),
            photo_url=None,
            attribution=challenge.attribution_json,
            db=db,
        )
        await _sync_subscription_after_login(user=user, db=db)
        token = create_access_token(
            {
                "sub": str(user.id),
                "telegram_id": user.telegram_id,
                "username": user.username,
                "type": "access",
            }
        )
        token = await bot_login.consume_challenge(
            session=db,
            challenge=challenge,
            user_id=user.id,
            token=token,
        )
        return LoginResponse(access_token=token)
    except bot_login.ChallengeError as exc:
        raise _challenge_http_error(exc) from exc


@router.get("/me", response_model=CurrentUserResponse, status_code=status.HTTP_200_OK)
async def get_current_user_profile(
    current_user_id: int = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> CurrentUserResponse:
    user = await db.get(User, current_user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return CurrentUserResponse(
        id=user.id,
        telegram_id=user.telegram_id,
        username=user.username,
        first_name=user.first_name,
        photo_url=user.photo_url,
        subscription_status=user.subscription_status,
        subscription_phase=user.subscription_phase,
        tariff_plan=user.tariff_plan,
        tariff_accounts_limit=user.tariff_accounts_limit,
        tariff_posts_per_day=user.tariff_posts_per_day,
        tariff_projects_limit=user.tariff_projects_limit,
        tariff_queue_days=user.tariff_queue_days,
    )


def _validate_telegram_auth(payload: TelegramAuthPayload) -> None:
    if not settings.telegram_bot_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Telegram bot token is not configured",
        )

    try:
        auth_datetime = datetime.fromtimestamp(payload.auth_date, tz=UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram auth_date is invalid",
        ) from exc
    auth_age_seconds = (datetime.now(UTC) - auth_datetime).total_seconds()
    if auth_age_seconds < 0 or auth_age_seconds > settings.telegram_auth_max_age_seconds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram auth payload is expired",
        )

    payload_dict = payload.model_dump(exclude={"hash", "attribution"}, exclude_none=True)
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


def _validate_telegram_webapp_auth(init_data: str) -> dict[str, Any]:
    if not settings.telegram_bot_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Telegram bot token is not configured",
        )

    parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram WebApp auth hash is missing",
        )

    auth_date_raw = parsed.get("auth_date", "0")
    try:
        auth_date = int(auth_date_raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram WebApp auth_date is invalid",
        ) from exc

    try:
        auth_datetime = datetime.fromtimestamp(auth_date, tz=UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram WebApp auth_date is invalid",
        ) from exc
    auth_age_seconds = (datetime.now(UTC) - auth_datetime).total_seconds()
    if auth_age_seconds < 0 or auth_age_seconds > settings.telegram_auth_max_age_seconds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram WebApp auth payload is expired",
        )

    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(parsed.items())
    )
    secret_key = hmac.new(
        b"WebAppData",
        settings.telegram_bot_token.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    expected_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Telegram WebApp auth hash",
        )

    user_raw = parsed.get("user")
    if not user_raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram WebApp user payload is missing",
        )

    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram WebApp user payload is invalid",
        ) from exc

    if not isinstance(user, dict) or "id" not in user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram WebApp user id is missing",
        )

    return user


async def _get_or_create_telegram_user(payload: TelegramAuthPayload, db: AsyncSession) -> User:
    return await _get_or_create_verified_telegram_user(
        telegram_id=payload.id,
        first_name=payload.first_name,
        username=payload.username,
        photo_url=payload.photo_url,
        attribution=payload.attribution.model_dump() if payload.attribution else None,
        db=db,
    )


async def _get_or_create_verified_telegram_user(
    *,
    telegram_id: int,
    first_name: str,
    username: str | None,
    photo_url: str | None,
    attribution: dict[str, Any] | None,
    db: AsyncSession,
) -> User:
    stmt = select(User).where(User.telegram_id == telegram_id).limit(1)
    user = await db.scalar(stmt)

    if user is None:
        user = User(
            telegram_id=telegram_id,
            username=username,
            first_name=first_name,
            photo_url=photo_url,
            first_landing_path=_clean_optional_string(attribution.get("first_landing")) if attribution else None,
            first_referrer=_clean_optional_string(attribution.get("referrer")) if attribution else None,
            first_utm_json=_clean_string_dict(attribution.get("utm")) if attribution else None,
            first_analytics_json=_clean_string_dict(attribution.get("analytics")) if attribution else None,
        )
        db.add(user)
    else:
        user.username = username
        user.first_name = first_name
        if photo_url is not None:
            user.photo_url = photo_url
        if attribution is not None:
            if not user.first_landing_path:
                user.first_landing_path = _clean_optional_string(attribution.get("first_landing"))
            if not user.first_referrer:
                user.first_referrer = _clean_optional_string(attribution.get("referrer"))
            if not user.first_utm_json:
                user.first_utm_json = _clean_string_dict(attribution.get("utm")) or None
            if not user.first_analytics_json:
                user.first_analytics_json = _clean_string_dict(attribution.get("analytics")) or None

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        user = await db.scalar(select(User).where(User.telegram_id == telegram_id).limit(1))
        if user is None:
            raise
    await db.refresh(user)
    return user


def _clean_optional_string(value: str | None) -> str | None:
    if value is None:
        return None

    stripped = value.strip()
    return stripped[:2048] if stripped else None


def _clean_string_dict(values: dict[str, str] | None) -> dict[str, str]:
    if not values:
        return {}

    cleaned: dict[str, str] = {}
    for key, value in values.items():
        clean_key = str(key).strip()[:128]
        clean_value = str(value).strip()[:2048]
        if clean_key and clean_value:
            cleaned[clean_key] = clean_value
    return cleaned


async def _sync_subscription_after_login(*, user: User, db: AsyncSession) -> None:
    if user.subscription_status:
        return

    try:
        from app.services.subscriptions import sync_user_subscription_after_login
        from app.telegram.bot import get_bot

        bot = get_bot()
        if bot is None:
            return

        async with asyncio.timeout(3):
            await sync_user_subscription_after_login(bot=bot, user=user, session=db)
    except Exception:
        # Authentication must stay available even when Telegram temporarily cannot
        # confirm channel membership. The regular reconciler will retry later.
        logger.exception("Could not synchronize subscription during login for user_id=%s.", user.id)
        await db.rollback()


def _challenge_http_error(exc: bot_login.ChallengeError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail={"code": exc.code})


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

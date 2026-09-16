from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from cryptography.fernet import Fernet
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import TelegramLoginChallenge


CHALLENGE_TTL_SECONDS = 300
RESULT_RETRY_SECONDS = 60


class ChallengeError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class NewChallenge:
    challenge: TelegramLoginChallenge
    browser_secret: str
    bot_secret: str


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


def _secret_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _token_cipher() -> Fernet:
    key = hashlib.sha256(
        ("threadsgo.telegram-login-result\0" + settings.jwt_secret_key).encode("utf-8")
    ).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_result_token(token: str) -> str:
    return _token_cipher().encrypt(token.encode("utf-8")).decode("ascii")


def decrypt_result_token(token: str) -> str:
    return _token_cipher().decrypt(token.encode("ascii")).decode("utf-8")


async def create_challenge(
    *,
    session: AsyncSession,
    attribution: dict[str, Any] | None,
) -> NewChallenge:
    now = _now()
    await session.execute(
        update(TelegramLoginChallenge)
        .where(
            TelegramLoginChallenge.result_retry_until.is_not(None),
            TelegramLoginChallenge.result_retry_until < now,
            TelegramLoginChallenge.result_token_encrypted.is_not(None),
        )
        .values(result_token_encrypted=None)
        .execution_options(synchronize_session=False)
    )
    await session.execute(
        delete(TelegramLoginChallenge).where(
            TelegramLoginChallenge.expires_at < now - timedelta(hours=1)
        )
    )
    browser_secret = secrets.token_urlsafe(32)
    bot_secret = secrets.token_urlsafe(32)
    challenge = TelegramLoginChallenge(
        id=secrets.token_urlsafe(16),
        browser_secret_hash=_secret_hash(browser_secret),
        bot_secret_hash=_secret_hash(bot_secret),
        status="pending",
        expires_at=now
        + timedelta(
            seconds=max(
                60,
                settings.telegram_login_challenge_ttl_seconds or CHALLENGE_TTL_SECONDS,
            )
        ),
        attribution_json=attribution,
        display_code=f"{secrets.randbelow(1_000_000):06d}",
    )
    session.add(challenge)
    await session.commit()
    await session.refresh(challenge)
    return NewChallenge(challenge=challenge, browser_secret=browser_secret, bot_secret=bot_secret)


async def get_browser_challenge(
    *,
    session: AsyncSession,
    challenge_id: str,
    browser_secret: str,
) -> TelegramLoginChallenge:
    if len(challenge_id) > 64 or len(browser_secret) > 128:
        raise ChallengeError("challenge_invalid", 404)
    challenge = await session.get(TelegramLoginChallenge, challenge_id)
    if challenge is None or not hmac.compare_digest(
        challenge.browser_secret_hash,
        _secret_hash(browser_secret),
    ):
        raise ChallengeError("challenge_invalid", 404)
    return challenge


def browser_status(challenge: TelegramLoginChallenge) -> str:
    if challenge.status in {"pending", "approved"} and (_aware(challenge.expires_at) or _now()) <= _now():
        return "expired"
    return challenge.status


async def cancel_challenge(
    *,
    session: AsyncSession,
    challenge: TelegramLoginChallenge,
) -> str:
    if browser_status(challenge) == "expired":
        return "expired"
    if challenge.status in {"pending", "approved"}:
        await session.execute(
            update(TelegramLoginChallenge)
            .where(
                TelegramLoginChallenge.id == challenge.id,
                TelegramLoginChallenge.status.in_(["pending", "approved"]),
            )
            .values(status="cancelled")
            .execution_options(synchronize_session=False)
        )
        await session.commit()
        await session.refresh(challenge)
    return challenge.status


async def bind_bot_challenge(
    *,
    session: AsyncSession,
    bot_secret: str,
    telegram_id: int,
    profile: dict[str, Any],
) -> TelegramLoginChallenge:
    if len(bot_secret) > 128:
        raise ChallengeError("challenge_invalid", 404)
    challenge = await session.scalar(
        select(TelegramLoginChallenge).where(
            TelegramLoginChallenge.bot_secret_hash == _secret_hash(bot_secret)
        )
    )
    if challenge is None:
        raise ChallengeError("challenge_invalid", 404)
    if browser_status(challenge) == "expired":
        raise ChallengeError("challenge_expired", 410)
    if challenge.status not in {"pending", "approved"}:
        raise ChallengeError(f"challenge_{challenge.status}", 409)
    if challenge.telegram_id is not None and challenge.telegram_id != telegram_id:
        raise ChallengeError("challenge_invalid", 404)

    if challenge.telegram_id is None:
        result = await session.execute(
            update(TelegramLoginChallenge)
            .where(
                TelegramLoginChallenge.id == challenge.id,
                TelegramLoginChallenge.status == "pending",
                TelegramLoginChallenge.telegram_id.is_(None),
            )
            .values(telegram_id=telegram_id, telegram_profile_json=profile)
            .execution_options(synchronize_session=False)
        )
        await session.commit()
        if result.rowcount != 1:
            await session.refresh(challenge)
            if challenge.telegram_id != telegram_id:
                raise ChallengeError("challenge_invalid", 404)
        else:
            await session.refresh(challenge)
    return challenge


async def decide_challenge(
    *,
    session: AsyncSession,
    challenge_id: str,
    telegram_id: int,
    approve: bool,
) -> str:
    challenge = await session.get(TelegramLoginChallenge, challenge_id)
    if challenge is None or challenge.telegram_id != telegram_id:
        raise ChallengeError("challenge_invalid", 404)
    current = browser_status(challenge)
    if current == "expired":
        raise ChallengeError("challenge_expired", 410)
    target = "approved" if approve else "denied"
    if current == target:
        return target
    if current != "pending":
        raise ChallengeError(f"challenge_{current}", 409)
    if approve and not settings.is_telegram_id_approved(telegram_id):
        raise ChallengeError("access_denied", 403)
    values: dict[str, Any] = {"status": target}
    if approve:
        values["approved_at"] = _now()
    result = await session.execute(
        update(TelegramLoginChallenge)
        .where(
            TelegramLoginChallenge.id == challenge_id,
            TelegramLoginChallenge.status == "pending",
            TelegramLoginChallenge.telegram_id == telegram_id,
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    if result.rowcount != 1:
        await session.refresh(challenge)
        if challenge.status != target:
            raise ChallengeError(f"challenge_{browser_status(challenge)}", 409)
    return target


def get_retry_token(challenge: TelegramLoginChallenge) -> str | None:
    retry_until = _aware(challenge.result_retry_until)
    if (
        challenge.status == "consumed"
        and challenge.result_token_encrypted
        and retry_until is not None
        and retry_until >= _now()
    ):
        return decrypt_result_token(challenge.result_token_encrypted)
    return None


async def consume_challenge(
    *,
    session: AsyncSession,
    challenge: TelegramLoginChallenge,
    user_id: int,
    token: str,
) -> str:
    now = _now()
    encrypted = encrypt_result_token(token)
    result = await session.execute(
        update(TelegramLoginChallenge)
        .where(
            TelegramLoginChallenge.id == challenge.id,
            TelegramLoginChallenge.status == "approved",
            TelegramLoginChallenge.expires_at > now,
        )
        .values(
            status="consumed",
            consumed_at=now,
            user_id=user_id,
            result_token_encrypted=encrypted,
            result_retry_until=now + timedelta(seconds=RESULT_RETRY_SECONDS),
        )
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    if result.rowcount == 1:
        return token
    await session.refresh(challenge)
    retry_token = get_retry_token(challenge)
    if retry_token:
        return retry_token
    raise ChallengeError(f"challenge_{browser_status(challenge)}", 409)

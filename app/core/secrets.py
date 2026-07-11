from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


ENCRYPTED_PREFIX = "enc:v1:"


class SecretConfigurationError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    raw_key = settings.data_encryption_key.strip()
    if not raw_key:
        raise SecretConfigurationError(
            "DATA_ENCRYPTION_KEY is not configured. Generate a Fernet key before storing account secrets."
        )

    try:
        return Fernet(raw_key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise SecretConfigurationError("DATA_ENCRYPTION_KEY must be a valid Fernet key.") from exc


def is_encrypted_secret(value: str | None) -> bool:
    return bool(value and value.startswith(ENCRYPTED_PREFIX))


def encrypt_secret(value: str | None) -> str | None:
    if value is None or value == "" or is_encrypted_secret(value):
        return value

    token = _get_fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{ENCRYPTED_PREFIX}{token}"


def decrypt_secret(value: str | None) -> str | None:
    if value is None or value == "":
        return value
    if not is_encrypted_secret(value):
        return value

    token = value.removeprefix(ENCRYPTED_PREFIX)
    try:
        return _get_fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError, UnicodeEncodeError) as exc:
        raise ValueError("Stored account secret cannot be decrypted with DATA_ENCRYPTION_KEY.") from exc

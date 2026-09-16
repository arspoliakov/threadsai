from __future__ import annotations

import hashlib
import hmac
import time
import unittest

from fastapi import HTTPException

from app.api import auth


class TelegramWidgetAuthTest(unittest.TestCase):
    def setUp(self) -> None:
        self.old_token = auth.settings.telegram_bot_token
        self.old_max_age = auth.settings.telegram_auth_max_age_seconds
        auth.settings.telegram_bot_token = "widget-test-token"
        auth.settings.telegram_auth_max_age_seconds = 300

    def tearDown(self) -> None:
        auth.settings.telegram_bot_token = self.old_token
        auth.settings.telegram_auth_max_age_seconds = self.old_max_age

    def signed_payload(self, **overrides: object) -> auth.TelegramAuthPayload:
        raw: dict[str, object] = {
            "id": 123456789,
            "first_name": "Илья",
            "auth_date": int(time.time()),
        }
        raw.update(overrides)
        data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(raw.items()))
        secret_key = hashlib.sha256(auth.settings.telegram_bot_token.encode()).digest()
        raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        return auth.TelegramAuthPayload(**raw)

    def test_accepts_signed_last_name_and_unicode(self) -> None:
        auth._validate_telegram_auth(self.signed_payload(last_name="Семёнов", username="ilya"))

    def test_accepts_missing_and_explicit_empty_last_name(self) -> None:
        auth._validate_telegram_auth(self.signed_payload())
        auth._validate_telegram_auth(self.signed_payload(last_name=""))

    def test_rejects_field_tampering(self) -> None:
        payload = self.signed_payload(last_name="Семёнов")
        payload.last_name = "Другой"
        with self.assertRaises(HTTPException) as raised:
            auth._validate_telegram_auth(payload)
        self.assertEqual(raised.exception.status_code, 401)

    def test_rejects_expired_and_extreme_timestamp(self) -> None:
        with self.assertRaises(HTTPException):
            auth._validate_telegram_auth(self.signed_payload(auth_date=int(time.time()) - 301))
        payload = self.signed_payload()
        payload.auth_date = 10**30
        with self.assertRaises(HTTPException) as raised:
            auth._validate_telegram_auth(payload)
        self.assertEqual(raised.exception.status_code, 401)

    def test_local_attribution_is_not_signed(self) -> None:
        payload = self.signed_payload(last_name="Семёнов")
        payload.attribution = auth.AuthAttributionPayload(utm={"utm_source": "test"})
        auth._validate_telegram_auth(payload)


if __name__ == "__main__":
    unittest.main()

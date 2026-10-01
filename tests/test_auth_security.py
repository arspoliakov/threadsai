import unittest
from unittest.mock import patch

from app.api import auth


class JwtSecurityTest(unittest.TestCase):
    def test_missing_or_development_secret_cannot_sign_or_verify(self):
        for secret in ("", "short", "change-me-local-jwt-secret"):
            with self.subTest(secret=secret), patch.object(auth.settings, "jwt_secret_key", secret):
                with self.assertRaises(ValueError):
                    auth.create_access_token({"sub": "1"})
                with self.assertRaises(ValueError):
                    auth.verify_access_token("a.b.c")

    def test_valid_secret_accepts_real_token_and_rejects_tampering(self):
        with patch.object(auth.settings, "jwt_secret_key", "test-secret-with-at-least-32-characters"):
            token = auth.create_access_token({"sub": "1"})
            self.assertEqual(auth.verify_access_token(token)["sub"], "1")
            with self.assertRaises(ValueError):
                auth.verify_access_token(token + "x")

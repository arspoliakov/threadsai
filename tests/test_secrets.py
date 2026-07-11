from __future__ import annotations

import unittest

from cryptography.fernet import Fernet

from app.core.config import settings
from app.core.secrets import (
    ENCRYPTED_PREFIX,
    _get_fernet,
    decrypt_secret,
    encrypt_secret,
    is_encrypted_secret,
)


class SecretEncryptionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_key = settings.data_encryption_key
        settings.data_encryption_key = Fernet.generate_key().decode("ascii")
        _get_fernet.cache_clear()

    def tearDown(self) -> None:
        settings.data_encryption_key = self.previous_key
        _get_fernet.cache_clear()

    def test_round_trip_does_not_store_plaintext(self) -> None:
        plaintext = '[{"name":"sessionid","value":"secret-cookie"}]'
        encrypted = encrypt_secret(plaintext)

        self.assertIsNotNone(encrypted)
        self.assertTrue(encrypted.startswith(ENCRYPTED_PREFIX))
        self.assertNotIn("secret-cookie", encrypted)
        self.assertEqual(decrypt_secret(encrypted), plaintext)

    def test_legacy_plaintext_remains_readable(self) -> None:
        legacy = "sessionid=legacy"
        self.assertFalse(is_encrypted_secret(legacy))
        self.assertEqual(decrypt_secret(legacy), legacy)


if __name__ == "__main__":
    unittest.main()

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app.posting.profile_lock import ProfileLock
from app.services import profile_storage as storage


class CompactProfilesTest(unittest.TestCase):
    def config(self, root, per=1, total=4):
        return SimpleNamespace(chrome_profiles_dir=str(root), chrome_profile_limit_mb=per,
            chrome_profiles_total_limit_mb=total)

    def make_file(self, root, name, value=b"fixture"):
        target = root/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value)
        return target

    def test_cleanup_only_cache_keeps_auth_settings_and_external_symlink(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)/"profiles"
            profile = root/"account_1"
            retained = ["Default/Network/Cookies", "Default/Cookies", "Default/Local Storage/leveldb/auth",
                "Default/IndexedDB/account", "Default/Session Storage/auth", "Default/Preferences",
                "Local State", "browser_settings.json", "threadsai-session.json"]
            for name in retained:
                self.make_file(profile, name)
            self.make_file(profile, "Default/Cache/Cache_Data/heavy", b"x"*100)
            self.make_file(profile, "Default/Media Cache/video", b"x"*100)
            outside = Path(temporary)/"outside"
            self.make_file(outside, "protected", b"preserve")
            try:
                (profile/"ShaderCache").symlink_to(outside, target_is_directory=True)
            except OSError:
                pass  # Windows may prohibit unprivileged symlinks.
            with patch.object(storage, "settings", self.config(root)):
                result = storage.cleanup_inactive_profiles()
            self.assertEqual(result["reclaimed_bytes"], 200)
            for name in retained:
                self.assertEqual((profile/name).read_bytes(), b"fixture")
            self.assertEqual((outside/"protected").read_bytes(), b"preserve")

    def test_live_locked_profile_is_excluded(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            profile = root/"account_1"
            cache = self.make_file(profile, "Default/Cache/live", b"must-stay")
            lock = ProfileLock(root/"account_1.lock")
            self.assertTrue(lock.acquire(timeout=1))
            try:
                with patch.object(storage, "settings", self.config(root)):
                    result = storage.cleanup_inactive_profiles()
                    summary = storage.get_profile_storage_summary()
                self.assertEqual(result["busy_skipped"], 1)
                self.assertTrue(summary["profiles"][0]["busy"])
                self.assertEqual(cache.read_bytes(), b"must-stay")
            finally:
                lock.release()

    def test_per_profile_and_global_quota_reject_without_auth_deletion(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root/"account_1"
            cookies = self.make_file(first, "Default/Network/Cookies", b"a"*(1024*1024+1))
            self.make_file(first, "Default/Cache/heavy", b"c"*100)
            with patch.object(storage, "settings", self.config(root, per=1, total=8)):
                with self.assertRaises(storage.ProfileStorageLimit):
                    storage.ensure_profile_capacity(first)
            self.assertEqual(cookies.stat().st_size, 1024*1024+1)
            self.assertFalse((first/"Default/Cache").exists())
            second = root/"account_2"
            retained = self.make_file(second, "Default/Local Storage/auth", b"b"*(1024*1024))
            with patch.object(storage, "settings", self.config(root, per=4, total=1)):
                with self.assertRaises(storage.ProfileStorageLimit):
                    storage.ensure_profile_capacity(second)
            self.assertEqual(retained.stat().st_size, 1024*1024)
            self.assertTrue(cookies.exists())

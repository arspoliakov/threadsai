"""Cache-only cleanup of closed Chrome profiles; authentication data is never evicted."""
from __future__ import annotations
import os
from pathlib import Path
import re
import shutil

from app.core.config import settings
from app.posting.profile_lock import ProfileLock

# Exact cache locations only. Never Cookies, Network, Local/Session Storage,
# IndexedDB, Preferences, History, or a recursive sweep of arbitrary temp files.
CACHE_DIRECTORIES = (
    "Default/Cache", "Default/Code Cache", "Default/GPUCache", "Default/Media Cache",
    "Default/Service Worker/CacheStorage", "Default/Service Worker/ScriptCache",
    "ShaderCache", "GrShaderCache", "GraphiteDawnCache", "DawnCache",
    "Crashpad/reports", "Crash Reports", "BrowserMetrics",
    "component_crx_cache",
)
CACHE_FILES = ("BrowserMetrics-spare.pma",)
_PROFILE_NAME = re.compile(r"(?:account_[1-9][0-9]*|ephemeral_[0-9]+_[0-9]+)\Z")


class ProfileStorageLimit(RuntimeError):
    pass


def _root() -> Path:
    return Path(settings.chrome_profiles_dir).resolve()


def _profiles(root: Path):
    if not root.exists():
        return []
    return sorted((path for path in root.iterdir() if _PROFILE_NAME.fullmatch(path.name)
        and path.is_dir() and not path.is_symlink()), key=lambda path: path.name)


def _size(path: Path) -> int:
    total = 0
    if not path.exists() or path.is_symlink():
        return 0
    for base, directories, files in os.walk(path, followlinks=False):
        directories[:] = [name for name in directories if not (Path(base)/name).is_symlink()]
        for name in files:
            file = Path(base)/name
            try:
                if not file.is_symlink():
                    total += file.stat().st_size
            except OSError:
                continue
    return total


def _lock(profile: Path):
    return ProfileLock(profile.parent / (profile.name + ".lock"))


def _validated(profile: Path) -> Path:
    profile = Path(profile)
    root = _root()
    if profile.is_symlink() or profile.parent.resolve() != root or not _PROFILE_NAME.fullmatch(profile.name):
        raise ProfileStorageLimit("Папка браузерного профиля недоступна. Обратитесь в поддержку.")
    return profile


def _has_chrome_marker(profile: Path) -> bool:
    # A failed quit can leave Chrome alive after the service loses its driver.
    return any((profile / name).exists() or (profile / name).is_symlink()
        for name in ("SingletonLock", "SingletonSocket"))


def _remove_allowlisted_cache(profile: Path) -> int:
    if _has_chrome_marker(profile):
        return 0
    before = _size(profile)
    resolved = profile.resolve()
    for relative in CACHE_DIRECTORIES:
        cache = profile / relative
        # Refuse any symlink component, including an ancestor inside the profile.
        chain = [cache, *cache.parents]
        if any(part.is_symlink() for part in chain if part != profile.parent):
            continue
        try:
            cache.resolve().relative_to(resolved)
            if cache.is_dir():
                shutil.rmtree(cache)
        except (OSError, ValueError):
            continue
    for relative in CACHE_FILES:
        cache = profile / relative
        try:
            if not cache.is_symlink() and cache.is_file():
                cache.resolve().relative_to(resolved)
                cache.unlink()
        except (OSError, ValueError):
            continue
    return max(0, before - _size(profile))


def cleanup_closed_profile(profile: Path, *, lock_held: bool = False) -> int:
    """Caller may assert its own OS lock only AFTER Chrome has exited."""
    profile = _validated(profile)
    if lock_held:
        return _remove_allowlisted_cache(profile)
    lock = _lock(profile)
    if not lock.acquire(timeout=0):
        return 0
    try:
        return _remove_allowlisted_cache(profile)
    finally:
        lock.release()


def cleanup_inactive_profiles() -> dict:
    root = _root()
    root.mkdir(parents=True, exist_ok=True)
    global_lock = ProfileLock(root / "storage_quota.lock")
    result = {"scanned": 0, "cleaned": 0, "busy_skipped": 0, "reclaimed_bytes": 0}
    if not global_lock.acquire(timeout=5):
        raise ProfileStorageLimit("Хранилище профилей сейчас занято. Повторите позже.")
    try:
        for profile in _profiles(root):
            result["scanned"] += 1
            lock = _lock(profile)
            if _has_chrome_marker(profile) or not lock.acquire(timeout=0):
                result["busy_skipped"] += 1
                continue
            try:
                reclaimed = _remove_allowlisted_cache(profile)
                result["reclaimed_bytes"] += reclaimed
                result["cleaned"] += int(reclaimed > 0)
            finally:
                lock.release()
        return result
    finally:
        global_lock.release()


def ensure_profile_capacity(profile: Path, *, lock_held: bool = False) -> None:
    """Admission check: clean cache, reject excess, never delete authenticated state."""
    profile = _validated(profile)
    root = _root()
    root.mkdir(parents=True, exist_ok=True)
    global_lock = ProfileLock(root / "storage_quota.lock")
    if not global_lock.acquire(timeout=5):
        raise ProfileStorageLimit("Хранилище профилей сейчас занято. Повторите позже.")
    try:
        cleanup_closed_profile(profile, lock_held=lock_held)
        per_limit = settings.chrome_profile_limit_mb * 1024 * 1024
        global_limit = settings.chrome_profiles_total_limit_mb * 1024 * 1024
        if _size(profile) > per_limit:
            raise ProfileStorageLimit("Профиль остановлен: превышен лимит хранилища браузера. Данные входа сохранены; требуется помощь администратора.")
        profiles = _profiles(root)
        if sum(_size(item) for item in profiles) > global_limit:
            for other in profiles:
                if other != profile:
                    cleanup_closed_profile(other)
            if sum(_size(item) for item in _profiles(root)) > global_limit:
                raise ProfileStorageLimit("Работа остановлена: хранилище браузерных профилей заполнено. Данные входа сохранены; требуется помощь администратора.")
    finally:
        global_lock.release()


def get_profile_storage_summary() -> dict:
    root = _root()
    per_limit = settings.chrome_profile_limit_mb * 1024 * 1024
    global_limit = settings.chrome_profiles_total_limit_mb * 1024 * 1024
    profiles = []
    for profile in _profiles(root):
        lock = _lock(profile)
        available = False if _has_chrome_marker(profile) else lock.acquire(timeout=0)
        if available:
            lock.release()
        size = _size(profile)
        account = profile.name.startswith("account_")
        profiles.append({"account_id": int(profile.name[8:]) if account else None,
            "kind": "account" if account else "ephemeral", "bytes": size,
            "over_limit": size > per_limit, "busy": not available})
    disk_path = root if root.exists() else root.parent
    while not disk_path.exists() and disk_path != disk_path.parent:
        disk_path = disk_path.parent
    total = sum(item["bytes"] for item in profiles)
    return {"total_bytes": total, "global_limit_bytes": global_limit,
        "per_profile_limit_bytes": per_limit, "free_disk_bytes": shutil.disk_usage(disk_path).free,
        "profiles": profiles, "over_global_limit": total > global_limit}

"""Short-lived, owner-operated browsers. Frames and input are never persisted."""
from __future__ import annotations

import queue
import base64
import secrets
import threading
import time
import os
import json
import hashlib
from pathlib import Path
from urllib.parse import urlparse

from fastapi import HTTPException

from app.posting.adapters.threads import ThreadsAdapter, _get_profile_lock
from app.services.proxy_pool import build_threads_proxy_url


class LoginWindow:
    def __init__(self):
        self.guard = threading.Lock()
        self.room = None

    def start(self, owner: int, username: str, port: int, capacity_release=None, capacity_claimed=None):
        with self.guard:
            if self.room and self.room["thread"].is_alive():
                raise HTTPException(409, "Окно входа занято. Попробуйте через несколько минут.")
            room = dict(owner=owner, username=username, port=port,
                        token=secrets.token_urlsafe(32), expires=time.monotonic()+900,
                        stop=threading.Event(), ready=threading.Event(), commands=queue.Queue(1), command_guard=threading.Lock(), error=None, capacity_release=capacity_release)
            room["thread"] = threading.Thread(target=self._worker, args=(room,), daemon=True)
            self.room = room
            if capacity_claimed is not None:
                capacity_claimed.set()
            try:
                room["thread"].start()
            except Exception:
                if capacity_claimed is not None:
                    capacity_claimed.clear()
                raise
        if not room["ready"].wait(45) or room["error"]:
            room["stop"].set()
            raise HTTPException(503, "Не удалось открыть Threads. Используйте импорт сессии или попробуйте позже.")
        return {"token":room["token"], "expires_in":max(0, int(room["expires"] - time.monotonic()))}

    def access(self, owner, token):
        room = self.room
        if not room or room["owner"] != owner or not secrets.compare_digest(token, room["token"]) or room["stop"].is_set() or time.monotonic() >= room["expires"]:
            raise HTTPException(404, "Окно закрыто или срок входа истёк.")
        return room

    def command(self, owner, token, kind, payload=None):
        room = self.access(owner, token)
        # Only one operation may be outstanding; never replay input after a timeout.
        guard = room.setdefault("command_guard", threading.Lock())
        if not guard.acquire(blocking=False):
            raise HTTPException(409, "Предыдущее действие ещё выполняется. Дождитесь его завершения.")
        answer = queue.Queue(1)
        cancelled = threading.Event()
        deadline = time.monotonic() + 35
        try:
            room["commands"].put_nowait((kind, payload or {}, answer, cancelled, deadline))
            while True:
                # A completed handoff closes the room; consume its answer first.
                try:
                    ok, value = answer.get_nowait()
                    break
                except queue.Empty:
                    pass
                if room["stop"].is_set() or time.monotonic() >= room["expires"]:
                    raise HTTPException(404, "Окно закрыто или срок входа истёк.")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise queue.Empty
                try:
                    ok, value = answer.get(timeout=min(.25, remaining))
                    break
                except queue.Empty:
                    continue
            if not ok:
                raise HTTPException(409, value)
            return value
        except (queue.Full, queue.Empty):
            raise HTTPException(409, "Окно не ответило. Проверьте изображение перед повторением действия.") from None
        finally:
            cancelled.set()
            guard.release()

    def close(self, owner, token):
        # Closing is idempotent, including after the worker expired. Ownership still applies.
        room = self.room
        if not room or room["owner"] != owner or not secrets.compare_digest(token, room["token"]):
            raise HTTPException(404, "Окно закрыто или срок входа истёк.")
        room["stop"].set()

    def shutdown(self):
        if self.room:
            self.room["stop"].set()

    def discard_adopted_profile(self, owner: int, token: str, account_id: int):
        """Rollback only this uncommitted handoff; never remove another account."""
        room = self.room
        if not room or room["owner"] != owner or not secrets.compare_digest(token, room["token"]):
            return
        room["stop"].set()
        thread = room.get("thread")
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=35)
            if thread.is_alive():
                return  # Never remove a directory still used by Chrome.
        if room.get("adopted_account_id") != account_id:
            return
        lock = _get_profile_lock(account_id)
        if lock is None or not lock.acquire(timeout=5):
            return
        try:
            path = room.get("adopted_profile_path")
            if path is not None:
                ThreadsAdapter()._remove_directory_safely(Path(path))
            room.pop("adopted_account_id", None)
            room.pop("adopted_profile_path", None)
        finally:
            lock.release()

    def _adopt_closed_profile(self, room, adapter, source: Path, account_id: int, cancelled, deadline):
        if account_id < 1 or not room.get("verified_cookies"):
            raise ValueError("Сначала подтвердите вход в профиль.")
        destination = adapter._get_user_data_dir(account_id)
        if source.parent.resolve() != destination.parent.resolve() or not source.name.startswith("ephemeral_"):
            raise ValueError("Не удалось сохранить профиль браузера.")
        lock = _get_profile_lock(account_id)
        if lock is None or not lock.acquire(timeout=5):
            raise ValueError("Профиль браузера занят. Повторите подключение.")
        try:
            if destination.exists():
                raise ValueError("Папка профиля уже существует. Повторите подключение после проверки командой сервиса.")
            if cancelled.is_set() or time.monotonic() >= deadline or room["stop"].is_set():
                raise ValueError("Сохранение профиля отменено.")
            if os.name != "nt":
                source.chmod(0o700)
            (source / "browser_settings.json").write_text(json.dumps({
                "version": 1, "viewport_width": 1024, "viewport_height": 768,
            }), encoding="utf-8")
            snapshot = hashlib.sha256(json.dumps(room["verified_cookies"], sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
            (source / "threadsai-session.json").write_text(json.dumps({"snapshot_hash": snapshot}), encoding="utf-8")
            if os.name != "nt":
                (source / "browser_settings.json").chmod(0o600)
                (source / "threadsai-session.json").chmod(0o600)
            # Chrome has already exited; its SQLite databases and local storage move together.
            source.rename(destination)
            room["adopted_account_id"] = account_id
            room["adopted_profile_path"] = destination
            return {"ok": True}
        finally:
            lock.release()

    def _worker(self, room):
        adapter = ThreadsAdapter(timeout_seconds=20)
        driver = extension = None
        try:
            extension = adapter._create_proxy_extension(build_threads_proxy_url(room["port"]), -secrets.randbelow(1000000000)-1)
            driver = adapter._create_driver(extension)  # Always a fresh ephemeral profile.
            # Bound transport requests too: page timeouts alone do not bound a stalled driver.
            driver.command_executor.client_config.timeout = 30
            driver.set_page_load_timeout(25)
            driver.set_script_timeout(10)
            driver.set_window_size(1024, 768)
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", dict(width=1024,height=768,deviceScaleFactor=1,mobile=False))
            driver.get("https://www.threads.com/login")
            if room["stop"].is_set():
                return
            room["ready"].set()
            while not room["stop"].is_set() and time.monotonic() < room["expires"]:
                try:
                    kind, payload, answer, cancelled, deadline = room["commands"].get(timeout=.5)
                except queue.Empty:
                    continue
                if cancelled.is_set() or room["stop"].is_set() or time.monotonic() >= min(deadline, room["expires"]):
                    continue
                try:
                    if len(driver.window_handles)>1:
                        driver.switch_to.window(driver.window_handles[-1])
                    url = urlparse(driver.current_url)
                    host = (url.hostname or "").lower()
                    if url.scheme != "https" or not any(host == root or host.endswith("."+root) for root in ("threads.com","threads.net","instagram.com","facebook.com")):
                        raise ValueError("Окно открыло посторонний сайт. Закройте его и повторите вход.")
                    if cancelled.is_set() or room["stop"].is_set() or time.monotonic() >= min(deadline, room["expires"]):
                        continue
                    if kind in {"click", "text", "key", "scroll"}:
                        room.pop("verified_cookies", None)
                    if kind == "frame":
                        value = base64.b64decode(driver.execute_cdp_cmd("Page.captureScreenshot", {"format":"jpeg","quality":65,"captureBeyondViewport":False})["data"])
                    elif kind == "click":
                        for event in ("mousePressed","mouseReleased"):
                            driver.execute_cdp_cmd("Input.dispatchMouseEvent", dict(type=event,x=payload["x"],y=payload["y"],button="left",clickCount=1))
                        value = {"ok":True}
                    elif kind == "text":
                        driver.execute_cdp_cmd("Input.insertText", {"text":payload["text"]})
                        value = {"ok":True}
                    elif kind == "key":
                        codes = {"Enter":13,"Tab":9,"Backspace":8,"Escape":27,"ArrowLeft":37,"ArrowUp":38,"ArrowRight":39,"ArrowDown":40}
                        key = payload["key"]
                        for event in ("keyDown","keyUp"):
                            driver.execute_cdp_cmd("Input.dispatchKeyEvent", dict(type=event,key=key,windowsVirtualKeyCode=codes[key]))
                        value = {"ok":True}
                    elif kind == "scroll":
                        driver.execute_cdp_cmd("Input.dispatchMouseEvent", dict(type="mouseWheel",x=512,y=384,deltaX=0,deltaY=payload["delta"]))
                        value = {"ok":True}
                    elif kind == "finish":
                        if host not in ("www.threads.com","threads.com","www.threads.net","threads.net"):
                            raise ValueError("Вернитесь в Threads после входа и откройте главную ленту.")
                        adapter._assert_no_blocking_challenge(driver)
                        adapter._assert_authenticated_session(driver)
                        # A public /@username URL is not proof of the signed-in owner.
                        detected = driver.execute_script(r"""
                            const names = new Set();
                            for (const a of document.querySelectorAll('a[href]')) {
                                const url = new URL(a.href);
                                if (url.origin !== location.origin || !/^\/@[A-Za-z0-9_.]+\/?$/.test(url.pathname)) continue;
                                const labels = [a.getAttribute('aria-label'), a.getAttribute('title'),
                                    ...Array.from(a.querySelectorAll('[aria-label], svg title')).map(el => el.getAttribute('aria-label') || el.textContent)];
                                // Only the dedicated profile control identifies the signed-in account.
                                if (!labels.some(label => /^(profile|your profile|профиль|ваш профиль)$/i.test((label || '').trim()))) continue;
                                names.add(url.pathname.split('/')[1].slice(1).toLowerCase());
                            }
                            return names.size === 1 ? Array.from(names)[0] : null;
                        """)
                        if not detected or detected.casefold() != room["username"].casefold():
                            raise ValueError("Не подтверждён профиль @"+room["username"]+". Войдите в нужный профиль и откройте главную ленту.")
                        cookies = driver.execute_cdp_cmd("Network.getAllCookies", {})["cookies"]
                        cookies = [c for c in cookies if any(c["domain"].lstrip(".") == root or c["domain"].lstrip(".").endswith("."+root) for root in ("threads.com","threads.net","instagram.com"))]
                        for c in cookies:
                            if "expires" in c:
                                c["expiry"] = int(c.pop("expires"))
                                if c["expiry"] <= 0: c.pop("expiry")
                        if not cookies:
                            raise ValueError("Сессия ещё не готова. Завершите вход.")
                        room["verified_cookies"] = cookies
                        value = cookies
                    elif kind == "adopt":
                        if not room.get("verified_cookies"):
                            raise ValueError("Подтвердите вход ещё раз перед сохранением профиля.")
                        source = Path(driver._threadsai_user_data_dir)
                        # Do not let the generic cleanup delete the profile before transfer.
                        driver._threadsai_persistent_profile = True
                        try:
                            driver.quit()
                        except Exception:
                            driver._threadsai_persistent_profile = False
                            raise ValueError("Браузер не завершил работу. Повторите подключение.") from None
                        driver = None
                        try:
                            value = self._adopt_closed_profile(room, adapter, source, int(payload["account_id"]), cancelled, deadline)
                        except Exception:
                            adapter._remove_directory_safely(source)
                            raise
                        answer.put((True, value))
                        break
                    else:
                        raise ValueError("Неизвестное действие")
                    answer.put((True,value))
                except ValueError as exc:
                    answer.put((False,str(exc)))
                except Exception:
                    answer.put((False,"Действие не завершилось. Проверьте окно перед повторением."))
        except Exception:
            room["error"] = True
            room["ready"].set()
        finally:
            room["stop"].set()
            room.pop("verified_cookies", None)
            try:
                adapter._quit_driver_safely(driver)
                if extension is not None:
                    adapter._remove_path_safely(extension)
            finally:
                release = room.get("capacity_release")
                if release is not None:
                    release()


login_window = LoginWindow()

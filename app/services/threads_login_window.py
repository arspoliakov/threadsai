"""Short-lived, owner-operated browsers. Frames and input are never persisted."""
from __future__ import annotations

import queue
import base64
import secrets
import threading
import time
from urllib.parse import urlparse

from fastapi import HTTPException

from app.posting.adapters.threads import ThreadsAdapter
from app.services.proxy_pool import build_threads_proxy_url


class LoginWindow:
    def __init__(self):
        self.guard = threading.Lock()
        self.room = None

    def start(self, owner: int, username: str, port: int):
        with self.guard:
            if self.room and self.room["thread"].is_alive():
                raise HTTPException(409, "Окно входа занято. Попробуйте через несколько минут.")
            room = dict(owner=owner, username=username, port=port,
                        token=secrets.token_urlsafe(32), expires=time.monotonic()+900,
                        stop=threading.Event(), ready=threading.Event(), commands=queue.Queue(4), error=None)
            room["thread"] = threading.Thread(target=self._worker, args=(room,), daemon=True)
            self.room = room
            room["thread"].start()
        if not room["ready"].wait(45) or room["error"]:
            room["stop"].set()
            raise HTTPException(503, "Не удалось открыть Threads. Используйте импорт сессии или попробуйте позже.")
        return {"token":room["token"], "expires_in":900}

    def access(self, owner, token):
        room = self.room
        if not room or room["owner"] != owner or not secrets.compare_digest(token, room["token"]) or room["stop"].is_set() or time.monotonic() >= room["expires"]:
            raise HTTPException(404, "Окно закрыто или срок входа истёк.")
        return room

    def command(self, owner, token, kind, payload=None):
        room = self.access(owner, token)
        answer = queue.Queue(1)
        try:
            room["commands"].put_nowait((kind, payload or {}, answer))
            ok, value = answer.get(timeout=35)
        except (queue.Full, queue.Empty):
            raise HTTPException(409, "Окно не ответило. Дождитесь обновления изображения.") from None
        if not ok:
            raise HTTPException(409, value)
        return value

    def close(self, owner, token):
        self.access(owner, token)["stop"].set()

    def shutdown(self):
        if self.room:
            self.room["stop"].set()

    def _worker(self, room):
        adapter = ThreadsAdapter(timeout_seconds=20)
        driver = extension = None
        try:
            extension = adapter._create_proxy_extension(build_threads_proxy_url(room["port"]), -secrets.randbelow(1000000000)-1)
            driver = adapter._create_driver(extension)  # Always a fresh ephemeral profile.
            driver.set_page_load_timeout(25)
            driver.set_script_timeout(10)
            driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", dict(width=1024,height=768,deviceScaleFactor=1,mobile=False))
            driver.get("https://www.threads.com/login")
            room["ready"].set()
            while not room["stop"].is_set() and time.monotonic() < room["expires"]:
                try:
                    kind, payload, answer = room["commands"].get(timeout=.5)
                except queue.Empty:
                    continue
                try:
                    if len(driver.window_handles)>1:
                        driver.switch_to.window(driver.window_handles[-1])
                    host = (urlparse(driver.current_url).hostname or "").lower()
                    if not any(host == root or host.endswith("."+root) for root in ("threads.com","threads.net","instagram.com","facebook.com")):
                        raise ValueError("Окно открыло посторонний сайт. Закройте его и повторите вход.")
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
                        detected = driver.execute_script("""for (const a of document.querySelectorAll('nav a[href^="/@"], [role="navigation"] a[href^="/@"], a[aria-label="Profile"][href^="/@"], a[aria-label="Профиль"][href^="/@"]')) { const p = new URL(a.href).pathname; if(p.startsWith('/@')) return p.split('/')[1].slice(1); } return null;""")
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
                        value = cookies
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
            adapter._quit_driver_safely(driver)
            if extension is not None: adapter._remove_path_safely(extension)


login_window = LoginWindow()

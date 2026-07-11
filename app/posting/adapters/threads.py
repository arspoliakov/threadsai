from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TypeVar
from urllib.parse import unquote, urlparse

import httpx
try:
    import undetected_chromedriver as uc
except ImportError as exc:  # Python 3.13 removed distutils used by uc 3.5.5.
    uc = None  # type: ignore[assignment]
    UNDETECTED_CHROMEDRIVER_IMPORT_ERROR: ImportError | None = exc
else:
    UNDETECTED_CHROMEDRIVER_IMPORT_ERROR = None
from selenium.common.exceptions import (
    ElementClickInterceptedException,
    StaleElementReferenceException,
    TimeoutException,
    WebDriverException,
)
from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from app.db.models import Account, PostingTask
from app.core.config import settings
from app.core.secrets import decrypt_secret
from app.posting.adapters.base import BasePostingAdapter, PublishResult
from app.posting.exceptions import (
    PublicationVerificationPending,
    PostingDeadlineExceeded,
    ProxyNetworkException,
    RetryablePostingException,
    SessionExpiredException,
    ThreadChainPartialSuccess,
)
from app.services.proxy_pool import build_threads_proxy_url_for_account


SCREENSHOTS_DIR = Path("./data/screenshots")
PROXY_EXTENSIONS_DIR = Path(settings.proxy_extensions_dir)
CHROME_PROFILES_DIR = Path(settings.chrome_profiles_dir)
CHROME_PROFILE_CACHE_LIMIT_MB = int(os.getenv("CHROME_PROFILE_CACHE_LIMIT_MB", "20"))
SESSION_EXPIRY_CONFIRMATION_ATTEMPTS = 3
PROFILE_LOCKS: dict[int, Any] = {}
PROFILE_LOCKS_GUARD = threading.Lock()
logger = logging.getLogger(__name__)
T = TypeVar("T")


@dataclass(slots=True)
class ProxyIpWatchdog:
    stop_event: threading.Event
    changed_event: threading.Event
    expected_ip: str
    current_ip: str | None = None


@dataclass(frozen=True, slots=True)
class BrowserFingerprintProfile:
    """Stable per-account browser surface. It must not change every launch."""

    width: int
    height: int
    canvas_noise: int
    canvas_x: int
    canvas_y: int


class ThreadsAdapter(BasePostingAdapter):
    BASE_URL = "https://www.threads.net/"
    LOGIN_URL = "https://www.threads.net/login"

    XPATHS = {
        "username": "/html/body/div[1]/div/div/div[2]/div/div/div/div[1]/div[1]/div[3]/form/div/div[2]/input",
        "password": "/html/body/div[1]/div/div/div[2]/div/div/div/div[1]/div[1]/div[3]/form/div/div[3]/input",
        "login_button": "/html/body/div[1]/div/div/div[2]/div/div/div/div[1]/div[1]/div[3]/form/div/div[4]/div[2]",
        "thread_popup": "/html/body/div[2]/div/div/div[2]/div/div/div/div[1]/div[1]/div[1]/div/div[1]",
        "thread_text": "/html/body/div[2]/div/div/div[3]/div/div/div[1]/div/div[2]/div/div/div/div[2]/div/div/div/div[2]/div/div[1]/div/div/div[3]/div[1]/div[1]",
        "upload_photo": "/html/body/div[2]/div/div/div[3]/div/div/div[1]/div/div[2]/div/div/div/div[2]/div/div/div/div[2]/div/div[1]/div/div/div[3]/div[2]/input",
        "share_thread": "/html/body/div[2]/div/div/div[3]/div/div/div[1]/div/div[2]/div/div/div/div[2]/div/div/div/div[2]/div/div[2]/div/div[1]/div",
        "go_instagram": "/html/body/div[1]/div/div/div[2]/div/div/div/div[1]/div[1]/div[2]/div/a[1]",
    }

    COMPOSER_TRIGGER_LOCATORS = [
        (
            By.XPATH,
            '//*[local-name()="svg" and (contains(@aria-label, "Новая ветка") or contains(@aria-label, "Новый пост") or contains(@aria-label, "New thread") or contains(@aria-label, "New post"))]'
            '/ancestor::*[@role="button" or self::button][1]',
        ),
        (
            By.XPATH,
            '//*[contains(normalize-space(), "Что нового?") or contains(normalize-space(), "What\'s new?")]'
            '/ancestor::*[@role="button" or self::button or @tabindex][1]',
        ),
    ]

    COMPOSER_EDITOR_LOCATORS = [
        (By.CSS_SELECTOR, 'div[contenteditable="true"][role="textbox"]'),
        (By.CSS_SELECTOR, 'div[contenteditable="true"]'),
        (By.XPATH, XPATHS["thread_text"]),
    ]

    COMPOSER_DIRECT_URLS = (
        "https://www.threads.net/new",
        "https://www.threads.net/intent/post",
    )

    def __init__(self, timeout_seconds: int = 25) -> None:
        self.timeout_seconds = timeout_seconds

    async def publish(
        self,
        account: Account,
        task: PostingTask,
        *,
        deadline_at: float | None = None,
        ip_guard_proxy_url: str | None = None,
        expected_proxy_ip: str | None = None,
    ) -> PublishResult:
        return await asyncio.to_thread(
            self._publish_sync,
            account,
            task,
            deadline_at,
            ip_guard_proxy_url,
            expected_proxy_ip,
        )

    async def check_session(self, account: Account) -> PublishResult:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._check_session_sync, account),
                timeout=max(30, self.timeout_seconds + 20),
            )
        except TimeoutError as exc:
            raise ProxyNetworkException("Threads session check timed out while starting Chrome.") from exc

    def _check_session_sync(self, account: Account) -> PublishResult:
        proxy_url = build_threads_proxy_url_for_account(account)
        proxy_extension_path: Path | None = None
        driver: WebDriver | None = None

        try:
            if proxy_url:
                proxy_extension_path = self._create_proxy_extension(proxy_url, account.id)

            driver = self._create_driver(proxy_extension_path, account_id=account.id)
            self._apply_network_blocking(driver)
            self._authenticate_with_cookies(driver, account)
            detected_username = self._extract_authenticated_username(driver)
            logger.info("Threads session check completed for account #%s", account.id)
            return PublishResult(success=True, detected_username=detected_username)
        finally:
            self._quit_driver_safely(driver)
            if proxy_extension_path is not None:
                self._remove_path_safely(proxy_extension_path)

    def _publish_sync(
        self,
        account: Account,
        task: PostingTask,
        deadline_at: float | None = None,
        ip_guard_proxy_url: str | None = None,
        expected_proxy_ip: str | None = None,
    ) -> PublishResult:
        proxy_url = build_threads_proxy_url_for_account(account)

        for attempt in range(2):
            proxy_extension_path: Path | None = None
            driver: WebDriver | None = None
            deadline_watchdog: threading.Event | None = None
            ip_watchdog: ProxyIpWatchdog | None = None

            try:
                self._raise_if_deadline_exceeded(deadline_at)
                if proxy_url:
                    proxy_extension_path = self._create_proxy_extension(proxy_url, task.id)

                driver = self._create_driver(proxy_extension_path, account_id=account.id)
                deadline_watchdog = self._start_deadline_watchdog(driver, deadline_at, task.id)
                ip_watchdog = self._start_proxy_ip_watchdog(
                    driver=driver,
                    proxy_url=ip_guard_proxy_url,
                    expected_ip=expected_proxy_ip,
                    task_label=f"posting task #{task.id}",
                )
                self._raise_if_deadline_exceeded(deadline_at)
                self._raise_if_proxy_ip_changed(ip_watchdog)
                self._apply_network_blocking(driver)
                self._authenticate_with_cookies(driver, account)
                self._raise_if_deadline_exceeded(deadline_at)
                self._raise_if_proxy_ip_changed(ip_watchdog)
                logger.info("Threads auth completed for task #%s", task.id)
                detected_username = self._extract_authenticated_username(driver)
                self._raise_if_deadline_exceeded(deadline_at)
                self._raise_if_proxy_ip_changed(ip_watchdog)
                existing_post_urls = self._get_profile_post_urls(
                    driver,
                    username=detected_username or account.username,
                )
                self._share_posts_chain(driver, _normalize_posts_chain(task), task.media_url)
                self._raise_if_deadline_exceeded(deadline_at)
                published_post_url = self._verify_published_post(
                    driver,
                    username=detected_username or account.username,
                    expected_text=_normalize_posts_chain(task)[0],
                    existing_post_urls=existing_post_urls,
                    deadline_at=deadline_at,
                    ip_watchdog=ip_watchdog,
                )
                logger.info(
                    "Threads publish flow completed and verified for task #%s: %s",
                    task.id,
                    published_post_url,
                )
                return PublishResult(
                    success=True,
                    detected_username=detected_username,
                    external_post_url=published_post_url,
                )
            except (
                PostingDeadlineExceeded,
                ProxyNetworkException,
                PublicationVerificationPending,
                RetryablePostingException,
                SessionExpiredException,
                ThreadChainPartialSuccess,
            ):
                raise
            except Exception as exc:
                self._raise_if_proxy_ip_changed(ip_watchdog)
                if self._is_deadline_exceeded(deadline_at):
                    raise PostingDeadlineExceeded(
                        f"Threads task #{task.id} exceeded the safe proxy window."
                    ) from exc

                if self._is_retryable_network_error(exc):
                    raise ProxyNetworkException(f"Threads proxy/network transport failed: {exc}") from exc

                if self._is_retryable_ui_error(exc):
                    raise RetryablePostingException(
                        f"Threads UI race while publishing; task will retry automatically: {exc}"
                    ) from exc

                screenshot_path = self._save_error_screenshot(driver, task.id)
                if attempt == 0 and self._is_recoverable_browser_crash(exc):
                    logger.warning("Threads browser crashed for task #%s, retrying once: %s", task.id, exc)
                    self._quit_driver_safely(driver)
                    driver = None
                    time.sleep(2)
                    continue

                screenshot_note = f" Screenshot: {screenshot_path}" if screenshot_path else ""
                raise RuntimeError(f"Threads publishing failed: {exc}.{screenshot_note}") from exc
            finally:
                if deadline_watchdog is not None:
                    deadline_watchdog.set()
                if ip_watchdog is not None:
                    ip_watchdog.stop_event.set()
                self._quit_driver_safely(driver)
                if proxy_extension_path is not None:
                    self._remove_path_safely(proxy_extension_path)

        raise RuntimeError("Threads publishing failed after browser self-healing retry.")

    def _start_deadline_watchdog(
        self,
        driver: WebDriver,
        deadline_at: float | None,
        task_id: int,
    ) -> threading.Event | None:
        if deadline_at is None:
            return None

        stop_event = threading.Event()

        def quit_on_deadline() -> None:
            remaining_seconds = max(0.0, deadline_at - time.monotonic())
            if stop_event.wait(remaining_seconds):
                return

            logger.warning("Threads task #%s reached Selenium deadline; forcing driver.quit().", task_id)
            self._quit_driver_safely(driver)

        threading.Thread(target=quit_on_deadline, daemon=True).start()
        return stop_event

    def _start_proxy_ip_watchdog(
        self,
        *,
        driver: WebDriver,
        proxy_url: str | None,
        expected_ip: str | None,
        task_label: str,
    ) -> ProxyIpWatchdog | None:
        if not proxy_url or not expected_ip:
            return None

        watchdog = ProxyIpWatchdog(
            stop_event=threading.Event(),
            changed_event=threading.Event(),
            expected_ip=expected_ip,
        )

        def quit_on_ip_change() -> None:
            while not watchdog.stop_event.wait(5.0):
                try:
                    current_ip = self._get_proxy_ip_sync(proxy_url)
                except Exception as exc:
                    logger.warning("Proxy IP watchdog polling failed for %s: %s", task_label, exc)
                    continue

                watchdog.current_ip = current_ip
                if current_ip != expected_ip:
                    logger.warning(
                        "Proxy IP changed during %s: %s -> %s. Forcing driver.quit().",
                        task_label,
                        expected_ip,
                        current_ip,
                    )
                    watchdog.changed_event.set()
                    self._quit_driver_safely(driver)
                    return

        threading.Thread(target=quit_on_ip_change, daemon=True).start()
        return watchdog

    def _raise_if_proxy_ip_changed(self, watchdog: ProxyIpWatchdog | None) -> None:
        if watchdog is not None and watchdog.changed_event.is_set():
            current_ip = watchdog.current_ip or "unknown"
            raise ProxyNetworkException(
                f"Proxy IP changed during Selenium session: {watchdog.expected_ip} -> {current_ip}."
            )

    def _get_proxy_ip_sync(self, proxy_url: str) -> str:
        with httpx.Client(proxy=proxy_url, timeout=10.0) as client:
            response = client.get("https://api.ipify.org")
            response.raise_for_status()
            current_ip = response.text.strip()

        if not current_ip:
            raise ProxyNetworkException("Proxy IP watchdog received an empty ipify response.")

        return current_ip

    def _raise_if_deadline_exceeded(self, deadline_at: float | None) -> None:
        if self._is_deadline_exceeded(deadline_at):
            raise PostingDeadlineExceeded("Threads Selenium deadline exceeded before task completion.")

    def _is_deadline_exceeded(self, deadline_at: float | None) -> bool:
        return deadline_at is not None and time.monotonic() >= deadline_at

    def _create_driver(self, proxy_extension_path: Path | None, *, account_id: int | None = None) -> WebDriver:
        use_undetected_driver = settings.chrome_driver_backend.casefold() == "undetected"
        if use_undetected_driver and uc is None:
            raise RuntimeError(
                "CHROME_DRIVER_BACKEND=undetected выбран, но undetected-chromedriver не импортируется. "
                "Используйте Python 3.12 либо переключите CHROME_DRIVER_BACKEND=selenium. "
                f"Причина импорта: {UNDETECTED_CHROMEDRIVER_IMPORT_ERROR}"
            )
        options = uc.ChromeOptions() if use_undetected_driver else webdriver.ChromeOptions()
        user_data_dir = self._get_user_data_dir(account_id)
        fingerprint_profile = _build_fingerprint_profile(account_id)
        profile_lock = _get_profile_lock(account_id)

        if profile_lock is not None:
            logger.info("Waiting for Chrome profile lock: account #%s", account_id)
            if not profile_lock.acquire(timeout=max(10, self.timeout_seconds)):
                raise ProxyNetworkException(f"Chrome profile is busy for account #{account_id}.")
            logger.info("Chrome profile lock acquired: account #%s", account_id)

        user_data_dir.mkdir(parents=True, exist_ok=True)

        if _is_headless_browser_enabled():
            options.add_argument("--headless=new")

        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-software-rasterizer")
        options.add_argument("--disable-setuid-sandbox")
        options.add_argument("--disable-crash-reporter")
        options.add_argument("--disable-in-process-stack-traces")
        options.add_argument("--disable-logging")
        options.add_argument("--no-zygote")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--force-webrtc-ip-handling-policy=disable_non_proxied_udp")
        options.add_argument("--webrtc-ip-handling-policy=disable_non_proxied_udp")
        options.add_argument(f"--window-size={fingerprint_profile.width},{fingerprint_profile.height}")
        options.add_argument(f"--user-data-dir={user_data_dir}")
        options.add_argument("--disk-cache-size=52428800")
        options.add_argument("--media-cache-size=1")
        options.add_argument("--blink-settings=imagesEnabled=false")
        options.add_argument("--disable-notifications")
        options.add_argument("--disable-popup-blocking")
        options.add_argument("--disable-background-networking")
        options.add_argument("--disable-sync")
        options.add_argument("--disable-default-apps")
        options.add_argument("--no-default-browser-check")
        options.add_argument("--disable-telemetry")
        options.add_argument("--metrics-recording-only")
        options.add_argument("--mute-audio")
        options.add_argument("--autoplay-policy=user-gesture-required")

        options.add_experimental_option(
            "prefs",
            {
                "profile.managed_default_content_settings.images": 2,
                "profile.managed_default_content_settings.stylesheets": 1,
                "profile.managed_default_content_settings.plugins": 2,
                "profile.managed_default_content_settings.popups": 2,
                "profile.managed_default_content_settings.notifications": 2,
                "profile.managed_default_content_settings.media_stream": 2,
                "profile.managed_default_content_settings.media_stream_mic": 2,
                "profile.managed_default_content_settings.media_stream_camera": 2,
                "profile.managed_default_content_settings.sound": 2,
                "profile.default_content_setting_values.autoplay": 2,
                "profile.default_content_setting_values.images": 2,
                "profile.default_content_setting_values.stylesheets": 1,
                "profile.default_content_setting_values.plugins": 2,
                "profile.default_content_setting_values.media_stream": 2,
                "profile.default_content_setting_values.notifications": 2,
                "profile.default_content_setting_values.sound": 2,
                "download.prompt_for_download": False,
            },
        )
        if proxy_extension_path is not None:
            options.add_argument(f"--load-extension={proxy_extension_path}")

        try:
            options.add_experimental_option("excludeSwitches", ["enable-automation", "enable-logging"])
            options.add_experimental_option("useAutomationExtension", False)
        except Exception:
            pass

        try:
            self._trim_chrome_profile_cache(user_data_dir)
            if use_undetected_driver:
                driver = uc.Chrome(options=options, use_subprocess=True)
            else:
                driver = webdriver.Chrome(options=options)
            setattr(driver, "_threadsai_user_data_dir", user_data_dir)
            setattr(driver, "_threadsai_persistent_profile", account_id is not None)
            setattr(driver, "_threadsai_profile_lock", profile_lock)
            self._apply_stealth_scripts(driver, fingerprint_profile)
            return driver
        except WebDriverException as exc:
            if profile_lock is not None:
                try:
                    profile_lock.release()
                except RuntimeError:
                    pass
            if account_id is None:
                self._remove_directory_safely(user_data_dir)
            if proxy_extension_path is not None:
                raise ProxyNetworkException(f"Chrome/proxy driver startup failed: {exc}") from exc
            raise RuntimeError(
                "Chrome не смог стартовать на сервере. Проверь установку google-chrome/chromium, "
                "совместимость ChromeDriver и системные библиотеки. "
                f"Исходная ошибка: {exc}"
            ) from exc
        except Exception as exc:
            if profile_lock is not None:
                try:
                    profile_lock.release()
                except RuntimeError:
                    pass
            if account_id is None:
                self._remove_directory_safely(user_data_dir)
            raise ProxyNetworkException(f"Chrome/proxy driver startup failed: {exc}") from exc

    def _apply_stealth_scripts(
        self,
        driver: WebDriver,
        fingerprint_profile: BrowserFingerprintProfile,
    ) -> None:
        script = f"""
                Object.defineProperty(navigator, 'webdriver', {{
                  get: () => undefined
                }});
                Object.defineProperty(navigator, 'plugins', {{
                  get: () => [1, 2, 3, 4, 5]
                }});
                Object.defineProperty(navigator, 'languages', {{
                  get: () => ['ru-RU', 'ru', 'en-US', 'en']
                }});
                window.chrome = window.chrome || {{ runtime: {{}} }};

                try {{
                  const canvasNoise = {fingerprint_profile.canvas_noise};
                  const canvasX = {fingerprint_profile.canvas_x};
                  const canvasY = {fingerprint_profile.canvas_y};
                  const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
                  CanvasRenderingContext2D.prototype.getImageData = function(...args) {{
                    const imageData = originalGetImageData.apply(this, args);
                    for (let i = 0; i < imageData.data.length; i += 64) {{
                      imageData.data[i] = imageData.data[i] ^ canvasNoise;
                    }}
                    return imageData;
                  }};
                  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
                  HTMLCanvasElement.prototype.toDataURL = function(...args) {{
                    const context = this.getContext('2d');
                    if (context) {{
                      context.fillStyle = 'rgba(1,1,1,0.01)';
                      context.fillRect(canvasX % Math.max(1, this.width), canvasY % Math.max(1, this.height), 1, 1);
                    }}
                    return originalToDataURL.apply(this, args);
                  }};
                }} catch (_) {{}}

                try {{
                  Object.defineProperty(window, 'RTCPeerConnection', {{
                    configurable: true,
                    value: undefined
                  }});
                  Object.defineProperty(window, 'webkitRTCPeerConnection', {{
                    configurable: true,
                    value: undefined
                  }});
                }} catch (_) {{}}

                const stopMedia = (node) => {{
                  if (!node) return;
                  const mediaNodes = node.matches && node.matches('video,audio')
                    ? [node]
                    : Array.from(node.querySelectorAll ? node.querySelectorAll('video,audio') : []);

                  for (const media of mediaNodes) {{
                    try {{
                      media.preload = 'none';
                      media.autoplay = false;
                      media.muted = true;
                      media.pause();
                      media.removeAttribute('src');
                      media.querySelectorAll('source').forEach((source) => source.removeAttribute('src'));
                      media.load();
                    }} catch (_) {{}}
                  }}
                }};

                try {{
                  Object.defineProperty(HTMLMediaElement.prototype, 'preload', {{
                    configurable: true,
                    get() {{ return 'none'; }},
                    set() {{ return 'none'; }}
                  }});
                }} catch (_) {{}}

                try {{
                  HTMLMediaElement.prototype.play = function() {{
                    stopMedia(this);
                    return Promise.resolve();
                  }};
                }} catch (_) {{}}

                new MutationObserver((mutations) => {{
                  for (const mutation of mutations) {{
                    mutation.addedNodes.forEach(stopMedia);
                  }}
                }}).observe(document.documentElement, {{ childList: true, subtree: true }});
                """
        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": script},
        )

    def _apply_network_blocking(self, driver: WebDriver) -> None:
        # Chrome prefs are the first line of defense. CDP blocking catches CSS/media URLs
        # that still slip through content settings and saves proxy traffic.
        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd(
            "Network.setBlockedURLs",
            {
                "urls": [
                    "*.jpg",
                    "*.jpeg",
                    "*.png",
                    "*.gif",
                    "*.webp",
                    "*.svg",
                    "*.ico",
                    "*.mp4",
                    "*.webm",
                    "*.mov",
                    "*.avi",
                    "*.m3u8",
                    "*.m4v",
                    "*.3gp",
                    "*.ts",
                    "*.mp3",
                    "*.wav",
                    "*.m4a",
                    "*.aac",
                    "*.opus",
                    "*.woff",
                    "*.woff2",
                    "*.ttf",
                    "*.otf",
                    "*video*",
                    "*Video*",
                    "*audio*",
                    "*Audio*",
                    "*mime=video*",
                    "*mime=audio*",
                    "*video_dashinit*",
                    "*bytestart*",
                    "*byteend*",
                    "*fbcdn.net/v/*",
                    "*cdninstagram.com/v/*",
                    "*scontent*.cdninstagram.com/v/*",
                    "*scontent*.fbcdn.net/v/*",
                ]
            },
        )
        logger.info("Chrome network blocking enabled for images, fonts, audio and video")

    def _authenticate_with_cookies(self, driver: WebDriver, account: Account) -> None:
        cookies = self._load_cookies(account)

        if not cookies:
            raise ValueError("Threads publishing requires cookies_encrypted JSON cookies.")

        driver.get(self.BASE_URL)
        self._wait_for_dom(driver)
        current_host = urlparse(driver.current_url).hostname or "www.threads.net"
        added_cookies_count = 0

        for cookie in cookies:
            normalized_cookie = self._normalize_cookie(cookie)
            if not self._is_cookie_domain_compatible(normalized_cookie, current_host):
                logger.debug(
                    "Skipping cookie with incompatible domain for Threads: %s",
                    normalized_cookie.get("domain"),
                )
                continue

            try:
                driver.add_cookie(normalized_cookie)
                added_cookies_count += 1
            except WebDriverException as exc:
                if "invalid cookie domain" in str(exc).casefold():
                    logger.debug("Skipping cookie rejected by Chrome domain check: %s", normalized_cookie.get("domain"))
                    continue
                raise

        if added_cookies_count == 0:
            raise SessionExpiredException("Threads cookies expired: no compatible threads.net cookies found.")

        driver.refresh()
        self._wait_for_dom(driver)
        self._assert_authenticated_session(driver)
        self._assert_no_blocking_challenge(driver)

    def _assert_authenticated_session(self, driver: WebDriver) -> None:
        last_reason = "login page detected"

        for attempt in range(SESSION_EXPIRY_CONFIRMATION_ATTEMPTS):
            current_path = urlparse(driver.current_url).path.casefold()
            redirected_to_login = current_path.startswith("/login")
            login_form_detected = self._has_login_markers(driver)

            if not redirected_to_login and not login_form_detected:
                logger.info(
                    "Threads authenticated session check passed on attempt %s/%s",
                    attempt + 1,
                    SESSION_EXPIRY_CONFIRMATION_ATTEMPTS,
                )
                return

            last_reason = "redirected to login page" if redirected_to_login else "login password form detected"
            logger.warning(
                "Threads session may be logged out (%s), confirmation %s/%s",
                last_reason,
                attempt + 1,
                SESSION_EXPIRY_CONFIRMATION_ATTEMPTS,
            )

            if attempt < SESSION_EXPIRY_CONFIRMATION_ATTEMPTS - 1:
                time.sleep(2)
                driver.get(self.BASE_URL)
                self._wait_for_dom(driver)

        raise SessionExpiredException(
            f"Threads cookies expired after {SESSION_EXPIRY_CONFIRMATION_ATTEMPTS} confirmations: {last_reason}."
        )

    def _has_login_markers(self, driver: WebDriver) -> bool:
        login_locators = [
            (By.CSS_SELECTOR, 'input[type="password"]'),
            (By.CSS_SELECTOR, 'input[name="password"]'),
            (By.XPATH, "//*[contains(text(), 'Войти') or contains(text(), 'Log in') or contains(text(), 'Login')]"),
            (By.XPATH, "//*[contains(text(), 'Забыли пароль') or contains(text(), 'Forgot password')]"),
        ]

        # Generic "Log in" text may be rendered in an authenticated Threads shell.
        # Only a visible password input is strong enough evidence of a logged-out session.
        for by, selector in login_locators[:2]:
            try:
                elements = driver.find_elements(by, selector)
            except WebDriverException:
                continue

            for element in elements[:3]:
                try:
                    if element.is_displayed():
                        return True
                except StaleElementReferenceException:
                    continue

        return False

    def _assert_no_blocking_challenge(self, driver: WebDriver) -> None:
        if self._wait_for_composer_editor(driver, timeout_seconds=1) is not None:
            return

        challenge_text = self._find_blocking_challenge_text(driver)
        if not challenge_text:
            return

        raise SessionExpiredException(
            "Threads requires manual confirmation before publishing. "
            f"Visible challenge: {challenge_text}. Refresh cookies after passing this screen manually."
        )

    def _find_blocking_challenge_text(self, driver: WebDriver) -> str | None:
        try:
            result = driver.execute_script(
                r"""
                const strongPageMarkers = [
                  'choose how you want to create a threads account',
                  'confirm you\'re human',
                  'enter the code from the image',
                  'use your instagram account',
                  'use your mobile number',
                  'log in with instagram',
                  'log in to threads',
                  'create a threads account',
                  'security check',
                  'checkpoint',
                  '\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435, \u0447\u0442\u043e \u0432\u044b \u0447\u0435\u043b\u043e\u0432\u0435\u043a',
                  '\u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442 threads',
                  '\u0432\u043e\u0439\u0442\u0438 \u0432 threads',
                  '\u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u0438'
                ];
                const inputMarkers = [
                  'use your mobile number',
                  'mobile number',
                  'phone number',
                  'add phone',
                  'get a new code',
                  'enter code',
                  'enter the code',
                  'code from the image',
                  'new code',
                  'verification',
                  '\u043d\u043e\u043c\u0435\u0440 \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0430',
                  '\u043c\u043e\u0431\u0438\u043b\u044c\u043d',
                  '\u0442\u0435\u043b\u0435\u0444\u043e\u043d',
                  '\u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u043d\u043e\u0432\u044b\u0439 \u043a\u043e\u0434',
                  '\u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0434',
                  '\u043d\u043e\u0432\u044b\u0439 \u043a\u043e\u0434',
                  '\u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430'
                ];

                const url = window.location.href.toLowerCase();
                if (url.includes('/login') || url.includes('checkpoint')) {
                  return `url:${window.location.href}`;
                }

                const bodyText = (document.body?.innerText || '')
                  .replace(/\s+/g, ' ')
                  .trim();
                const normalizedBody = bodyText.toLowerCase();
                const pageMarker = strongPageMarkers.find((marker) => normalizedBody.includes(marker));
                if (pageMarker) {
                  const markerIndex = Math.max(0, normalizedBody.indexOf(pageMarker));
                  return bodyText.slice(markerIndex, markerIndex + 220);
                }

                function isVisible(element) {
                  const rect = element.getBoundingClientRect();
                  const style = window.getComputedStyle(element);
                  return rect.width > 8 &&
                    rect.height > 8 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    Number(style.opacity || '1') > 0;
                }

                function describe(element) {
                  return [
                    element.innerText || '',
                    element.textContent || '',
                    element.getAttribute('aria-label') || '',
                    element.getAttribute('title') || '',
                    element.getAttribute('placeholder') || ''
                  ].join(' ').replace(/\s+/g, ' ').trim();
                }

                const selectors = [
                  'input',
                  'textarea',
                  '[placeholder]',
                  '[aria-label]'
                ];
                const seen = new Set();
                for (const selector of selectors) {
                  for (const element of document.querySelectorAll(selector)) {
                    if (seen.has(element) || !isVisible(element)) continue;
                    seen.add(element);
                    const text = describe(element);
                    const normalized = text.toLowerCase();
                    if (inputMarkers.some((label) => normalized.includes(label))) {
                      return text.slice(0, 180);
                    }
                  }
                }
                return null;
                """
            )
        except WebDriverException:
            return None

        return str(result).strip() if result else None

    def _share_posts_chain(self, driver: WebDriver, posts_chain: list[str], media_url: str | None) -> None:
        if not posts_chain:
            raise ValueError("Threads posting task has an empty posts_chain.")

        published_count = 0

        for index, text in enumerate(posts_chain):
            try:
                if index == 0:
                    self._share_thread(driver, text, media_url)
                else:
                    self._reply_to_latest_visible_thread(driver, text)
                published_count += 1
            except Exception as exc:
                if published_count > 0:
                    raise ThreadChainPartialSuccess(
                        f"Threads chain failed after {published_count}/{len(posts_chain)} posts: {exc}",
                        published_count=published_count,
                    ) from exc
                raise

    def _share_thread(self, driver: WebDriver, text: str, media_url: str | None) -> None:
        driver.get(self.BASE_URL)
        self._wait_for_dom(driver)
        logger.info("Threads page loaded before opening composer")
        time.sleep(random.uniform(1.4, 3.6))

        self._open_thread_composer(driver)
        time.sleep(random.uniform(1.8, 4.2))
        self._type_thread_text(driver, text)
        time.sleep(random.uniform(4.0, 8.0))

        if media_url:
            self._safe_send_keys(driver, By.XPATH, self.XPATHS["upload_photo"], media_url)
            logger.info("Threads media path attached")
            time.sleep(random.uniform(2.0, 4.0))

        self._submit_thread(driver)

    def _reply_to_latest_visible_thread(self, driver: WebDriver, text: str) -> None:
        self._open_reply_composer(driver)
        self._type_thread_text(driver, text)
        self._submit_thread(driver)

    def _open_reply_composer(self, driver: WebDriver) -> None:
        reply_locators = [
            (By.CSS_SELECTOR, '[aria-label="Reply"]'),
            (By.CSS_SELECTOR, '[aria-label*="Reply"]'),
            (By.CSS_SELECTOR, '[aria-label*="reply"]'),
            (By.CSS_SELECTOR, '[aria-label*="Ответ"]'),
            (By.CSS_SELECTOR, '[aria-label*="ответ"]'),
            (By.XPATH, '//*[@aria-label="Reply" or contains(@aria-label, "Reply") or contains(@aria-label, "Ответ")]/ancestor::*[@role="button"][1]'),
            (By.XPATH, '//*[contains(text(), "Reply") or contains(text(), "Ответить")]/ancestor::*[@role="button"][1]'),
        ]
        last_error: Exception | None = None

        for by, selector in reply_locators:
            try:
                self._js_click_first_match(driver, by, selector)
                logger.info("Threads reply trigger clicked: %s", selector)

                if self._wait_for_composer_editor(driver, timeout_seconds=8) is not None:
                    logger.info("Threads reply editor is ready")
                    return
            except (TimeoutException, WebDriverException, StaleElementReferenceException) as exc:
                last_error = exc

        if last_error is not None:
            raise TimeoutException(f"Could not open Threads reply composer: {last_error}") from last_error

        raise TimeoutException("Could not open Threads reply composer.")

    def _open_thread_composer(self, driver: WebDriver) -> None:
        last_error: Exception | None = None

        if self._wait_for_composer_editor(driver, timeout_seconds=3) is not None:
            logger.info("Threads composer editor was already visible")
            return

        self._assert_no_blocking_challenge(driver)

        for by, selector in self.COMPOSER_TRIGGER_LOCATORS:
            try:
                self._js_click_first_match(driver, by, selector)
                logger.info("Threads composer trigger clicked: %s", selector)

                if self._wait_for_composer_editor(driver, timeout_seconds=8) is not None:
                    logger.info("Threads composer editor is ready")
                    return
            except (TimeoutException, WebDriverException, StaleElementReferenceException) as exc:
                last_error = exc

        for attempt in range(1, 4):
            try:
                self._dismiss_threads_overlays(driver)
                self._assert_no_blocking_challenge(driver)
                clicked_target = self._js_click_composer_trigger(driver)
                logger.info(
                    "Threads composer trigger clicked by strict DOM scan on attempt %s: %s",
                    attempt,
                    clicked_target,
                )

                if self._wait_for_composer_editor(driver, timeout_seconds=8) is not None:
                    logger.info("Threads composer editor is ready after strict DOM scan")
                    return
            except (TimeoutException, WebDriverException, StaleElementReferenceException) as exc:
                last_error = exc
                logger.warning("Threads composer strict DOM scan failed on attempt %s: %s", attempt, exc)

        for composer_url in self.COMPOSER_DIRECT_URLS:
            try:
                self._dismiss_threads_overlays(driver)
                driver.get(composer_url)
                self._wait_for_dom(driver)
                logger.info("Threads direct composer URL opened as fallback: %s", composer_url)

                if self._wait_for_composer_editor(driver, timeout_seconds=12) is not None:
                    logger.info("Threads composer editor is ready after direct URL fallback")
                    return

                self._assert_no_blocking_challenge(driver)
            except (TimeoutException, WebDriverException, StaleElementReferenceException) as exc:
                last_error = exc
                logger.warning("Threads direct composer URL fallback failed (%s): %s", composer_url, exc)

        if last_error is not None:
            raise RetryablePostingException(
                f"Could not open Threads composer: {last_error}"
            ) from last_error

        raise RetryablePostingException("Could not open Threads composer.")

    def _dismiss_threads_overlays(self, driver: WebDriver) -> None:
        try:
            ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        except WebDriverException:
            pass

        try:
            driver.execute_script(
                r"""
                const labels = [
                  'not now',
                  'later',
                  'close',
                  '\u043d\u0435 \u0441\u0435\u0439\u0447\u0430\u0441',
                  '\u043f\u043e\u0437\u0436\u0435',
                  '\u0437\u0430\u043a\u0440\u044b\u0442\u044c'
                ];
                const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
                for (const element of candidates) {
                  const text = [
                    element.innerText || '',
                    element.textContent || '',
                    element.getAttribute('aria-label') || '',
                    element.getAttribute('title') || ''
                  ].join(' ').trim().toLowerCase();
                  if (!text || !labels.some((label) => text.includes(label))) continue;
                  const rect = element.getBoundingClientRect();
                  const style = window.getComputedStyle(element);
                  if (
                    rect.width > 8 &&
                    rect.height > 8 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden'
                  ) {
                    element.click();
                    return true;
                  }
                }
                return false;
                """
            )
        except WebDriverException:
            pass

    def _js_click_composer_trigger(self, driver: WebDriver) -> str:
        result = driver.execute_script(
            r"""
            const exactTriggerLabels = [
              'new thread',
              'new post',
              'start a thread',
              "what's new",
              'write',
              'post',
              '\u043d\u043e\u0432\u0430\u044f \u0432\u0435\u0442\u043a\u0430',
              '\u043d\u043e\u0432\u044b\u0439 \u043f\u043e\u0441\u0442',
              '\u0447\u0442\u043e \u043d\u043e\u0432\u043e\u0433\u043e',
              '\u043d\u0430\u043f\u0438\u0441\u0430\u0442\u044c',
              '\u043f\u043e\u0441\u0442'
            ];
            const partialTriggerLabels = [
              "what's new",
              'start a thread',
              '\u0447\u0442\u043e \u043d\u043e\u0432\u043e\u0433\u043e'
            ];
            const rejectLabels = [
              'continue',
              'get a new code',
              'new code',
              'log in',
              'login',
              'sign in',
              'sign up',
              'create account',
              'forgot',
              'password',
              'email',
              'phone',
              'phone number',
              'mobile number',
              'use your mobile number',
              'add phone',
              'next',
              'back',
              'verify',
              'verification',
              'security',
              'security check',
              'checkpoint',
              'confirm',
              'code',
              '\u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c',
              '\u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u043d\u043e\u0432\u044b\u0439 \u043a\u043e\u0434',
              '\u043d\u043e\u0432\u044b\u0439 \u043a\u043e\u0434',
              '\u0432\u043e\u0439\u0442\u0438',
              '\u0432\u0445\u043e\u0434',
              '\u0440\u0435\u0433\u0438\u0441\u0442\u0440',
              '\u043f\u0430\u0440\u043e\u043b',
              '\u043d\u043e\u043c\u0435\u0440 \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0430',
              '\u043c\u043e\u0431\u0438\u043b\u044c\u043d',
              '\u0442\u0435\u043b\u0435\u0444\u043e\u043d',
              '\u0434\u0430\u043b\u0435\u0435',
              '\u043d\u0430\u0437\u0430\u0434',
              '\u043a\u043e\u0434',
              '\u043f\u0440\u043e\u0432\u0435\u0440\u043a',
              '\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434',
              '\u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d',
              'cookie',
              'privacy',
              'terms',
              'learn more',
              '\u043a\u0443\u043a',
              '\u043a\u043e\u043d\u0444\u0438\u0434\u0435\u043d\u0446',
              '\u0443\u0441\u043b\u043e\u0432'
            ];
            const selectors = [
              'a[href*="/new"]',
              'a[href*="/intent/post"]',
              'button',
              '[role="button"]',
              '[tabindex="0"]'
            ];
            const seen = new Set();
            const candidates = [];

            function isVisible(element) {
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              return rect.width > 12 &&
                rect.height > 12 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || '1') > 0;
            }

            function describe(element) {
              return [
                element.innerText || '',
                element.textContent || '',
                element.getAttribute('aria-label') || '',
                element.getAttribute('title') || '',
                element.getAttribute('href') || ''
              ].join(' ').replace(/\s+/g, ' ').trim();
            }

            for (const selector of selectors) {
              for (const rawElement of document.querySelectorAll(selector)) {
                if (seen.has(rawElement)) continue;
                seen.add(rawElement);
                if (!isVisible(rawElement)) continue;

                const element = rawElement.closest('a, button, [role="button"], [tabindex="0"]') || rawElement;
                const text = describe(element).toLowerCase();
                const href = (element.getAttribute('href') || '').toLowerCase();
                let score = 0;
                const hasDirectHref = href.includes('/new') || href.includes('/intent/post');
                const hasExactTrigger = exactTriggerLabels.some((label) => text === label || text.startsWith(label + ' '));
                const hasPartialTrigger = partialTriggerLabels.some((label) => text.includes(label));

                if (rejectLabels.some((label) => text.includes(label))) {
                  continue;
                }
                if (!hasDirectHref && !hasExactTrigger && !hasPartialTrigger) {
                  continue;
                }
                if (!hasDirectHref && text.length > 260) {
                  continue;
                }

                if (hasDirectHref) score += 120;
                if (hasExactTrigger) score += 100;
                if (hasPartialTrigger) score += 80;
                if (element.querySelector('svg')) score += 10;

                const rect = element.getBoundingClientRect();
                if (rect.left < window.innerWidth * 0.35 || rect.top < window.innerHeight * 0.45) {
                  score += 5;
                }
                if (text.includes('reply') || text.includes('\u043e\u0442\u0432\u0435\u0442')) {
                  score -= 80;
                }
                if (text.includes('search') || text.includes('\u043f\u043e\u0438\u0441\u043a')) {
                  score -= 80;
                }
                if (text === 'create' || text === '\u0441\u043e\u0437\u0434\u0430\u0442\u044c') {
                  score -= 120;
                }

                if (score >= 80) {
                  candidates.push({ element, score, text: describe(element), area: rect.width * rect.height });
                }
              }
            }

            candidates.sort((a, b) => {
              if (a.score !== b.score) return b.score - a.score;
              return b.area - a.area;
            });

            const target = candidates[0];
            if (!target) return null;

            target.element.scrollIntoView({ block: 'center', inline: 'nearest' });
            target.element.click();
            return target.text || target.element.tagName;
            """
        )

        if not result:
            raise TimeoutException("Threads composer trigger was not found by DOM scan.")

        return str(result)[:160]

    def _is_composer_editor_present(self, driver: WebDriver) -> bool:
        return self._wait_for_composer_editor(driver, timeout_seconds=4) is not None

    def _wait_for_composer_editor(
        self,
        driver: WebDriver,
        *,
        timeout_seconds: int | float | None = None,
    ) -> WebElement | None:
        try:
            return WebDriverWait(driver, timeout_seconds or self.timeout_seconds).until(
                lambda current_driver: self._find_best_visible_editor(current_driver)
            )
        except TimeoutException:
            return None

    def _type_thread_text(self, driver: WebDriver, text: str) -> None:
        last_error: Exception | None = None

        for by, selector in self.COMPOSER_EDITOR_LOCATORS:
            try:
                self._safe_type_into_active_editor(driver, by, selector, text, retries=3)
                logger.info("Threads text inserted into composer")
                return
            except (TimeoutException, WebDriverException, StaleElementReferenceException) as exc:
                last_error = exc

        if last_error is not None:
            raise TimeoutException(f"Could not type text into Threads composer: {last_error}") from last_error

        raise TimeoutException("Could not type text into Threads composer.")

    def _submit_thread(self, driver: WebDriver) -> None:
        time.sleep(random.uniform(2.5, 6.0))
        try:
            self._click_submit_button(driver)
            logger.info("Threads publish button clicked")
        except (TimeoutException, WebDriverException, StaleElementReferenceException) as exc:
            logger.warning("Threads publish button click failed, falling back to hotkey: %s", exc)
            self._submit_thread_with_hotkey(driver)

        self._wait_after_publish_submit(driver)

    def _click_submit_button(self, driver: WebDriver) -> None:
        def click_button() -> None:
            button = WebDriverWait(driver, 10).until(
                lambda current_driver: self._find_submit_button(current_driver)
            )
            self._scroll_to_element(driver, button)
            try:
                button.click()
            except WebDriverException:
                ActionChains(driver).move_to_element(button).pause(random.uniform(0.15, 0.45)).click().perform()

        self._retry_on_stale("click_submit_button", click_button, retries=3)

    def _find_submit_button(self, driver: WebDriver) -> WebElement | None:
        try:
            return driver.execute_script(
                """
                const exactLabels = ['post', 'publish', 'опубликовать', 'запостить'];
                const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]') || document;
                const candidates = Array.from(dialog.querySelectorAll('button, [role="button"]'));

                function isVisible(element) {
                  const rect = element.getBoundingClientRect();
                  const style = window.getComputedStyle(element);
                  return rect.width > 8 &&
                    rect.height > 8 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.pointerEvents !== 'none';
                }

                const exactMatches = [];
                const ariaMatches = [];

                for (const element of candidates) {
                  if (!isVisible(element)) continue;
                  if (element.disabled || element.getAttribute('aria-disabled') === 'true') continue;
                  const visibleText = (element.innerText || element.textContent || '').trim().toLowerCase();
                  const ariaText = [
                    element.getAttribute('aria-label') || '',
                    element.getAttribute('title') || ''
                  ].join(' ').trim().toLowerCase();
                  if (visibleText.includes('option') || ariaText.includes('option')) continue;
                  if (exactLabels.some((label) => visibleText === label)) {
                    exactMatches.push(element);
                    continue;
                  }
                  if (exactLabels.some((label) => ariaText === label)) {
                    ariaMatches.push(element);
                  }
                }

                return exactMatches[exactMatches.length - 1] || ariaMatches[ariaMatches.length - 1] || null;
                """
            )
        except WebDriverException:
            return None

    def _submit_thread_with_hotkey(self, driver: WebDriver) -> None:
        def send_submit_hotkey() -> None:
            editor = self._wait_for_composer_editor(driver, timeout_seconds=8)
            if editor is None:
                raise TimeoutException("Composer editor is not active before submit hotkey.")

            self._scroll_to_element(driver, editor)
            driver.execute_script("arguments[0].click();", editor)
            self._wait_until_editor_has_focus(driver, editor)
            ActionChains(driver).key_down(Keys.CONTROL).send_keys(Keys.ENTER).key_up(Keys.CONTROL).perform()

        self._retry_on_stale("submit_thread_with_hotkey", send_submit_hotkey, retries=3)
        logger.info("Threads publish hotkey sent")

    def _wait_after_publish_submit(self, driver: WebDriver) -> None:
        try:
            WebDriverWait(driver, 20).until(
                lambda current_driver: not self._has_visible_composer_editor(current_driver)
                or self._active_editor_text_is_empty(current_driver)
            )
            logger.info("Threads publish submit acknowledged by UI")
        except TimeoutException:
            raise TimeoutException("Threads UI did not confirm publication after submit.")

    def _verify_published_post(
        self,
        driver: WebDriver,
        *,
        username: str | None,
        expected_text: str,
        existing_post_urls: set[str],
        deadline_at: float | None,
        ip_watchdog: ProxyIpWatchdog | None,
    ) -> str:
        normalized_username = (username or "").strip().lstrip("@")
        if not normalized_username:
            raise RuntimeError("Threads publication could not be verified because the account username is unknown.")

        expected_normalized = _normalize_verification_text(expected_text)
        if not expected_normalized:
            raise RuntimeError("Threads publication could not be verified because the post text is empty.")

        profile_url = f"{self.BASE_URL.rstrip('/')}/@{normalized_username}"
        for attempt in range(5):
            self._raise_if_deadline_exceeded(deadline_at)
            self._raise_if_proxy_ip_changed(ip_watchdog)
            driver.get(profile_url)
            self._wait_for_dom(driver)

            post_url = self._find_matching_post_url(
                driver,
                expected_normalized,
                excluded_urls=existing_post_urls,
            )
            if post_url and self._post_url_matches_expected_text(
                driver,
                post_url=post_url,
                expected_normalized=expected_normalized,
            ):
                return _normalize_threads_post_url(post_url)

            if attempt < 4:
                time.sleep(5)

        raise PublicationVerificationPending(
            "Threads принял отправку поста, но не показал его в профиле до истечения окна проверки. "
            "Задача помечена как частично успешная, чтобы не создавать ложный failed и не дублировать публикацию."
        )

    def _get_profile_post_urls(self, driver: WebDriver, *, username: str | None) -> set[str]:
        normalized_username = (username or "").strip().lstrip("@")
        if not normalized_username:
            return set()

        driver.get(f"{self.BASE_URL.rstrip('/')}/@{normalized_username}")
        self._wait_for_dom(driver)
        for attempt in range(3):
            try:
                raw_urls = driver.execute_script(
                    """
                    return Array.from(document.querySelectorAll('a[href*="/post/"]'))
                      .map((link) => link.href)
                      .filter(Boolean);
                    """
                )
                return {
                    _normalize_threads_post_url(str(url))
                    for url in (raw_urls or [])
                    if "/post/" in str(url)
                }
            except (StaleElementReferenceException, WebDriverException) as exc:
                if attempt >= 2:
                    raise RetryablePostingException(
                        "Threads profile changed while preparing publication. The task will retry automatically."
                    ) from exc
                time.sleep(1)

        return set()

    def _find_matching_post_url(
        self,
        driver: WebDriver,
        expected_normalized: str,
        *,
        excluded_urls: set[str],
    ) -> str | None:
        containers: list[WebElement] = []
        seen_ids: set[str] = set()
        for selector in (
            'div[role="article"]',
            "article",
            '[data-pressable-container="true"]',
            'div:has(a[href*="/post/"])',
        ):
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, selector)
            except WebDriverException:
                continue

            for element in elements[:20]:
                if element.id in seen_ids:
                    continue
                seen_ids.add(element.id)
                containers.append(element)

        expected_prefix = expected_normalized[:160]
        normalized_excluded_urls = {_normalize_threads_post_url(url) for url in excluded_urls}
        for container in containers:
            try:
                container_text = _normalize_verification_text(container.text)
                if len(container_text) < 20 or expected_prefix not in container_text:
                    continue
                links = container.find_elements(By.CSS_SELECTOR, 'a[href*="/post/"]')
            except (StaleElementReferenceException, WebDriverException):
                continue

            for link in links:
                href = link.get_attribute("href") or ""
                if "/post/" in href and _normalize_threads_post_url(href) not in normalized_excluded_urls:
                    return href

        return None

    def _post_url_matches_expected_text(
        self,
        driver: WebDriver,
        *,
        post_url: str,
        expected_normalized: str,
    ) -> bool:
        try:
            driver.get(post_url)
            self._wait_for_dom(driver)
            expected_prefix = expected_normalized[:160]
            return bool(
                WebDriverWait(driver, 10).until(
                    lambda current_driver: expected_prefix
                    in _normalize_verification_text(current_driver.find_element(By.TAG_NAME, "body").text)
                )
            )
        except (StaleElementReferenceException, TimeoutException, WebDriverException):
            return False

    def _has_visible_composer_editor(self, driver: WebDriver) -> bool:
        for by, selector in self.COMPOSER_EDITOR_LOCATORS:
            try:
                elements = driver.find_elements(by, selector)
            except WebDriverException:
                continue

            for element in elements:
                try:
                    if element.is_displayed():
                        return True
                except StaleElementReferenceException:
                    continue

        return False

    def _active_editor_text_is_empty(self, driver: WebDriver) -> bool:
        try:
            active_element = driver.switch_to.active_element
            text = active_element.text or active_element.get_attribute("innerText") or ""
            return not text.strip()
        except (StaleElementReferenceException, WebDriverException):
            return False

    def _js_click_first_match(self, driver: WebDriver, by: str, selector: str) -> None:
        def click_visible_element() -> None:
            elements = WebDriverWait(driver, self.timeout_seconds).until(
                EC.presence_of_all_elements_located((by, selector))
            )

            for element in elements:
                if not element.is_displayed():
                    continue

                self._scroll_to_element(driver, element)
                driver.execute_script("arguments[0].click();", element)
                return

            raise TimeoutException(f"No visible element for JS click: {selector}")

        self._retry_on_stale(
            f"js_click_first_match:{selector}",
            click_visible_element,
            retries=3,
        )

    def _safe_click(
        self,
        driver: WebDriver,
        by: str,
        selector: str,
        *,
        retries: int = 4,
        retry_delay_seconds: float = 0.5,
    ) -> None:
        last_error: Exception | None = None

        for _ in range(retries):
            try:
                element = WebDriverWait(driver, self.timeout_seconds).until(
                    EC.element_to_be_clickable((by, selector))
                )
                self._scroll_to_element(driver, element)
                try:
                    element.click()
                except (StaleElementReferenceException, ElementClickInterceptedException):
                    fresh_element = WebDriverWait(driver, self.timeout_seconds).until(
                        EC.element_to_be_clickable((by, selector))
                    )
                    self._scroll_to_element(driver, fresh_element)
                    driver.execute_script("arguments[0].click();", fresh_element)
                return
            except (StaleElementReferenceException, ElementClickInterceptedException) as exc:
                last_error = exc
                time.sleep(retry_delay_seconds)

        if last_error is not None:
            raise last_error

        raise TimeoutException(f"Element is not clickable: {selector}")

    def _safe_send_keys(
        self,
        driver: WebDriver,
        by: str,
        selector: str,
        value: str,
        *,
        retries: int = 4,
        retry_delay_seconds: float = 0.5,
    ) -> None:
        last_error: Exception | None = None

        for _ in range(retries):
            try:
                element = WebDriverWait(driver, self.timeout_seconds).until(
                    EC.element_to_be_clickable((by, selector))
                )
                self._scroll_to_element(driver, element)
                element.click()
                element.send_keys(value)
                logger.info("Threads send_keys completed for selector: %s", selector)
                return
            except (StaleElementReferenceException, ElementClickInterceptedException) as exc:
                last_error = exc
                time.sleep(retry_delay_seconds)

        if last_error is not None:
            raise last_error

        raise TimeoutException(f"Element is not ready for send_keys: {selector}")

    def _safe_type_into_active_editor(
        self,
        driver: WebDriver,
        by: str,
        selector: str,
        value: str,
        *,
        retries: int = 4,
        retry_delay_seconds: float = 0.5,
    ) -> None:
        last_error: Exception | None = None

        for _ in range(retries):
            try:
                element = self._wait_for_composer_editor(driver, timeout_seconds=self.timeout_seconds)
                if element is None:
                    raise TimeoutException(f"Composer editor is not visible: {selector}")

                self._scroll_to_element(driver, element)
                self._focus_composer_editor(driver, element)

                try:
                    self._wait_until_editor_has_focus(driver, element)
                    self._paste_text_like_human(driver, value)
                    self._wait_until_editor_contains_text(driver, value)
                    return
                except (TimeoutException, WebDriverException) as typing_error:
                    logger.warning("Threads clipboard-style input failed, falling back to JS input: %s", typing_error)

                if not self._inject_text_with_javascript(driver, element, value):
                    raise TimeoutException(f"Could not inject text into composer editor: {selector}")

                self._wait_until_editor_contains_text(driver, value)
                return
            except (StaleElementReferenceException, ElementClickInterceptedException, WebDriverException) as exc:
                last_error = exc
                time.sleep(retry_delay_seconds)

        if last_error is not None:
            raise last_error

        raise TimeoutException(f"Editor is not ready for ActionChains input: {selector}")

    def _focus_composer_editor(self, driver: WebDriver, element: WebElement) -> bool:
        try:
            return bool(
                driver.execute_script(
                    """
                    const element = arguments[0];
                    element.scrollIntoView({ block: 'center', inline: 'nearest' });
                    element.click();
                    element.focus();

                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(element);
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);

                    const active = document.activeElement;
                    return active === element || element.contains(active);
                    """,
                    element,
                )
            )
        except WebDriverException:
            return False

    def _paste_text_like_human(self, driver: WebDriver, value: str) -> None:
        self._write_text_to_browser_clipboard(driver, value)
        time.sleep(random.uniform(0.35, 1.2))
        ActionChains(driver).key_down(Keys.CONTROL).send_keys("v").key_up(Keys.CONTROL).perform()
        logger.info("Threads text pasted into active composer via Ctrl+V")

    def _write_text_to_browser_clipboard(self, driver: WebDriver, value: str) -> None:
        try:
            driver.execute_cdp_cmd(
                "Browser.grantPermissions",
                {
                    "origin": self.BASE_URL.rstrip("/"),
                    "permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"],
                },
            )
        except WebDriverException:
            pass

        written = driver.execute_async_script(
            """
            const text = arguments[0];
            const done = arguments[arguments.length - 1];
            if (!navigator.clipboard || !navigator.clipboard.writeText) {
              done(false);
              return;
            }
            navigator.clipboard.writeText(text)
              .then(() => done(true))
              .catch(() => done(false));
            """,
            value,
        )
        if not written:
            raise WebDriverException("Browser clipboard API is unavailable.")

    def _retry_on_stale(
        self,
        action_name: str,
        action: Callable[[], T],
        *,
        retries: int = 5,
        retry_delay_seconds: float = 0.5,
    ) -> T:
        last_error: Exception | None = None

        for attempt in range(1, retries + 1):
            try:
                result = action()
                if attempt > 1:
                    logger.info("Threads action recovered after stale DOM: %s", action_name)
                return result
            except (StaleElementReferenceException, ElementClickInterceptedException) as exc:
                last_error = exc
                logger.warning(
                    "Threads DOM race on action %s, retry %s/%s: %s",
                    action_name,
                    attempt,
                    retries,
                    exc,
                )
                time.sleep(retry_delay_seconds)

        if last_error is not None:
            raise last_error

        raise TimeoutException(f"Threads action failed without explicit error: {action_name}")

    def _scroll_to_element(self, driver: WebDriver, element: WebElement) -> None:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", element)

    def _wait_until_editor_has_focus(self, driver: WebDriver, element: WebElement) -> None:
        WebDriverWait(driver, 5).until(
            lambda current_driver: self._element_has_focus(current_driver, element)
        )

    def _element_has_focus(self, driver: WebDriver, element: WebElement) -> bool:
        try:
            return bool(
                driver.execute_script(
                    """
                    const element = arguments[0];
                    const active = document.activeElement;
                    return active === element || element.contains(active);
                    """,
                    element,
                )
            )
        except (StaleElementReferenceException, WebDriverException):
            return False

    def _wait_until_editor_contains_text(self, driver: WebDriver, expected_text: str) -> None:
        expected_prefix = expected_text.strip()[:24]
        if not expected_prefix:
            return

        WebDriverWait(driver, 8).until(
            lambda current_driver: any(
                expected_prefix in self._read_element_text(element)
                for element in self._find_visible_editors(current_driver)
            )
        )
        logger.info("Threads editor contains inserted text")

    def _find_visible_editors(self, driver: WebDriver) -> list[WebElement]:
        best_editor = self._find_best_visible_editor(driver)
        if best_editor is not None:
            return [best_editor]

        editors: list[WebElement] = []

        for by, selector in self.COMPOSER_EDITOR_LOCATORS:
            try:
                elements = driver.find_elements(by, selector)
            except WebDriverException:
                continue

            for element in elements:
                try:
                    if element.is_displayed():
                        editors.append(element)
                except StaleElementReferenceException:
                    continue

        return editors

    def _find_best_visible_editor(self, driver: WebDriver) -> WebElement | None:
        try:
            return driver.execute_script(
                """
                const selectors = [
                  '[role="dialog"] div[contenteditable="true"][role="textbox"]',
                  '[role="dialog"] div[contenteditable="true"]',
                  '[aria-modal="true"] div[contenteditable="true"][role="textbox"]',
                  '[aria-modal="true"] div[contenteditable="true"]',
                  'div[contenteditable="true"][role="textbox"]',
                  'div[contenteditable="true"]'
                ];
                const seen = new Set();
                const candidates = [];

                for (const selector of selectors) {
                  for (const element of document.querySelectorAll(selector)) {
                    if (seen.has(element)) continue;
                    seen.add(element);
                    const rect = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);
                    if (
                      rect.width < 20 ||
                      rect.height < 10 ||
                      style.visibility === 'hidden' ||
                      style.display === 'none'
                    ) {
                      continue;
                    }
                    const inDialog = Boolean(element.closest('[role="dialog"], [aria-modal="true"]'));
                    const label = [
                      element.getAttribute('aria-label') || '',
                      element.getAttribute('placeholder') || '',
                      element.textContent || '',
                      element.closest('[role="dialog"], [aria-modal="true"]')?.textContent || ''
                    ].join(' ').toLowerCase();
                    const looksLikeComposer = (
                      label.includes("what's new") ||
                      label.includes('new thread') ||
                      label.includes('что нового') ||
                      label.includes('новая тема')
                    );
                    const disabled = (
                      element.getAttribute('aria-disabled') === 'true' ||
                      element.getAttribute('contenteditable') === 'false'
                    );
                    if (disabled) continue;
                    candidates.push({ element, inDialog, looksLikeComposer, rect });
                  }
                }

                candidates.sort((a, b) => {
                  if (a.inDialog !== b.inDialog) return a.inDialog ? -1 : 1;
                  if (a.looksLikeComposer !== b.looksLikeComposer) return a.looksLikeComposer ? -1 : 1;
                  return (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height);
                });

                return candidates.length ? candidates[0].element : null;
                """
            )
        except WebDriverException:
            return None

    def _read_element_text(self, element: WebElement) -> str:
        try:
            return element.text or element.get_attribute("innerText") or element.get_attribute("textContent") or ""
        except (StaleElementReferenceException, WebDriverException):
            return ""

    def _find_optional_element(self, driver: WebDriver, by: str, selector: str) -> WebElement | None:
        try:
            return WebDriverWait(driver, 3).until(EC.element_to_be_clickable((by, selector)))
        except (TimeoutException, WebDriverException):
            return None

    def _inject_text_with_javascript(self, driver: WebDriver, element, value: str) -> bool:
        try:
            return bool(driver.execute_script(
                """
                const element = arguments[0];
                const text = arguments[1];
                const lines = text.split('\\n');

                element.scrollIntoView({ block: 'center', inline: 'nearest' });
                element.click();
                element.focus();

                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(element);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);

                let inserted = false;
                try {
                  inserted = document.execCommand('insertText', false, text);
                } catch (_) {
                  inserted = false;
                }

                if (!inserted || !element.innerText.includes(lines[0])) {
                  element.innerHTML = '';
                  for (let index = 0; index < lines.length; index += 1) {
                    if (index > 0) {
                      element.appendChild(document.createElement('br'));
                    }
                    element.appendChild(document.createTextNode(lines[index]));
                  }
                }

                for (const eventName of ['beforeinput', 'input', 'keyup', 'change']) {
                  let event;
                  if (eventName === 'beforeinput' || eventName === 'input') {
                    event = new InputEvent(eventName, {
                      bubbles: true,
                      cancelable: true,
                      inputType: 'insertText',
                      data: text
                    });
                  } else {
                    event = new Event(eventName, { bubbles: true });
                  }
                  element.dispatchEvent(event);
                }
                element.dispatchEvent(new Event('change', { bubbles: true }));
                return (element.innerText || element.textContent || '').includes(lines[0]);
                """,
                element,
                value,
            ))
        except WebDriverException:
            return False

    def _extract_authenticated_username(self, driver: WebDriver) -> str | None:
        candidates: list[str] = []

        current_path = urlparse(driver.current_url).path
        if current_path.startswith("/@"):
            candidates.append(current_path.split("/", maxsplit=2)[1])

        selectors = [
            'a[href^="/@"]',
            'a[href*="threads.net/@"]',
            '[role="link"][href^="/@"]',
        ]
        for selector in selectors:
            try:
                links = driver.find_elements(By.CSS_SELECTOR, selector)
            except WebDriverException:
                continue

            for link in links:
                href = link.get_attribute("href") or ""
                path = urlparse(href).path
                if path.startswith("/@"):
                    candidates.append(path.split("/", maxsplit=2)[1])

        try:
            script_result = driver.execute_script(
                """
                const bodyText = document.body ? document.body.innerText : "";
                const match = bodyText.match(/@[a-zA-Z0-9._]{2,30}/);
                return match ? match[0] : null;
                """
            )
            if isinstance(script_result, str):
                candidates.append(script_result)
        except WebDriverException:
            pass

        for candidate in candidates:
            username = candidate.strip().lstrip("@").split("?")[0].split("/")[0]
            if self._is_plausible_username(username):
                return username

        return None

    def _is_plausible_username(self, value: str) -> bool:
        if not 2 <= len(value) <= 30:
            return False

        allowed_chars = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._")
        return all(char in allowed_chars for char in value)

    def _wait_for_dom(self, driver: WebDriver) -> None:
        WebDriverWait(driver, self.timeout_seconds).until(
            lambda current_driver: current_driver.execute_script("return document.readyState") == "complete"
        )

    def _create_proxy_extension(self, proxy_url: str, task_id: int) -> Path:
        parsed_proxy = urlparse(proxy_url)

        if parsed_proxy.scheme not in {"http", "https"}:
            raise ValueError("Proxy must use http:// or https:// scheme.")

        if not parsed_proxy.hostname or not parsed_proxy.port:
            raise ValueError("Proxy URL must include host and port.")

        PROXY_EXTENSIONS_DIR.mkdir(parents=True, exist_ok=True)
        extension_path = PROXY_EXTENSIONS_DIR / f"{task_id}_{int(time.time() * 1000)}_proxy_auth"
        extension_path.mkdir(parents=True, exist_ok=True)
        username = unquote(parsed_proxy.username or "")
        password = unquote(parsed_proxy.password or "")
        scheme = json.dumps(parsed_proxy.scheme)
        host = json.dumps(parsed_proxy.hostname)
        username_js = json.dumps(username)
        password_js = json.dumps(password)
        port = parsed_proxy.port

        manifest = {
            "manifest_version": 3,
            "name": "Threads Proxy Auth",
            "version": "1.0.0",
            "permissions": ["proxy", "storage", "webRequest", "webRequestAuthProvider"],
            "host_permissions": ["<all_urls>"],
            "background": {"service_worker": "background.js"},
            "minimum_chrome_version": "108",
        }
        background_js = f"""
const proxyConfig = {{
  mode: "fixed_servers",
  rules: {{
    singleProxy: {{
      scheme: {scheme},
      host: {host},
      port: {port}
    }},
    bypassList: ["localhost", "127.0.0.1"]
  }}
}};

chrome.proxy.settings.set({{value: proxyConfig, scope: "regular"}});

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {{
    if (!details.isProxy) {{
      callback();
      return;
    }}

    callback({{
      authCredentials: {{
        username: {username_js},
        password: {password_js}
      }}
    }});
  }},
  {{urls: ["<all_urls>"]}},
  ["asyncBlocking"]
);
"""

        (extension_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        (extension_path / "background.js").write_text(background_js, encoding="utf-8")

        return extension_path

    def _save_error_screenshot(self, driver: WebDriver | None, task_id: int) -> str | None:
        if driver is None:
            return None

        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        screenshot_path = SCREENSHOTS_DIR / f"{task_id}_error.png"

        try:
            driver.save_screenshot(str(screenshot_path))
        except Exception:
            return None

        return str(screenshot_path)

    def _load_cookies(self, account: Account) -> list[dict[str, Any]]:
        payload = self._load_json(decrypt_secret(account.cookies_encrypted))

        if not payload:
            return []

        if isinstance(payload, list):
            return payload

        if isinstance(payload, dict) and isinstance(payload.get("cookies"), list):
            return payload["cookies"]

        if isinstance(payload, str):
            return self._parse_cookie_header(payload)

        raise ValueError("cookies_encrypted must be a JSON list or an object with a cookies list.")

    def _parse_cookie_header(self, cookie_header: str) -> list[dict[str, Any]]:
        cookies: list[dict[str, Any]] = []

        for raw_pair in cookie_header.split(";"):
            pair = raw_pair.strip()
            if not pair or "=" not in pair:
                continue

            name, value = pair.split("=", maxsplit=1)
            name = name.strip()
            value = value.strip()

            if name:
                cookies.append(
                    {
                        "name": name,
                        "value": value,
                        "domain": ".threads.net",
                        "path": "/",
                        "secure": True,
                    }
                )

        if not cookies:
            raise ValueError("Cookie string does not contain name=value pairs.")

        return cookies

    def _normalize_cookie(self, cookie: dict[str, Any]) -> dict[str, Any]:
        allowed_keys = {
            "name",
            "value",
            "path",
            "domain",
            "secure",
            "httpOnly",
            "expiry",
            "sameSite",
        }
        normalized_cookie = {key: value for key, value in cookie.items() if key in allowed_keys}

        if "sameSite" in normalized_cookie and normalized_cookie["sameSite"] not in {"Strict", "Lax", "None"}:
            normalized_cookie.pop("sameSite")

        return normalized_cookie

    def _is_cookie_domain_compatible(self, cookie: dict[str, Any], current_host: str) -> bool:
        raw_domain = cookie.get("domain")
        if not raw_domain:
            return True

        domain = str(raw_domain).strip().lstrip(".").casefold()
        host = current_host.strip().casefold()
        return host == domain or host.endswith(f".{domain}")

    def _load_json(self, raw_value: str | None) -> Any:
        if not raw_value:
            return {}

        try:
            return json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise ValueError("Account session/cookies payload must be valid JSON.") from exc

    def _remove_file_safely(self, path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    def _remove_path_safely(self, path: Path) -> None:
        if path.is_dir():
            self._remove_directory_safely(path)
        else:
            self._remove_file_safely(path)

    def _get_user_data_dir(self, account_id: int | None) -> Path:
        if account_id is None:
            return CHROME_PROFILES_DIR / f"ephemeral_{os.getpid()}_{time.time_ns()}"

        return CHROME_PROFILES_DIR / f"account_{account_id}"

    def _trim_chrome_profile_cache(self, user_data_dir: Path) -> None:
        max_bytes = CHROME_PROFILE_CACHE_LIMIT_MB * 1024 * 1024
        profile_size = _get_directory_size(user_data_dir)

        if profile_size <= max_bytes:
            return

        logger.info(
            "Chrome profile cache cleanup started for %s: %.1f MB > %s MB",
            user_data_dir,
            profile_size / 1024 / 1024,
            CHROME_PROFILE_CACHE_LIMIT_MB,
        )
        for relative_path in (
            "Default/Cache",
            "Default/Code Cache",
            "Default/GPUCache",
            "Default/Media Cache",
            "Default/Service Worker/CacheStorage",
            "Default/Service Worker/ScriptCache",
            "ShaderCache",
            "GrShaderCache",
            "GraphiteDawnCache",
        ):
            self._remove_directory_safely(user_data_dir / relative_path)

        logger.info("Chrome profile cache cleanup completed for %s", user_data_dir)

    def _quit_driver_safely(self, driver: WebDriver | None) -> None:
        if driver is None:
            return
        user_data_dir = getattr(driver, "_threadsai_user_data_dir", None)
        is_persistent_profile = bool(getattr(driver, "_threadsai_persistent_profile", False))
        profile_lock = getattr(driver, "_threadsai_profile_lock", None)

        try:
            driver.quit()
        except WebDriverException:
            pass
        finally:
            if isinstance(user_data_dir, Path) and not is_persistent_profile:
                self._remove_directory_safely(user_data_dir)
            if profile_lock is not None:
                try:
                    profile_lock.release()
                except RuntimeError:
                    pass

    def _remove_directory_safely(self, path: Path) -> None:
        try:
            import shutil

            shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass

    def _is_recoverable_browser_crash(self, exc: Exception) -> bool:
        error_text = str(exc).casefold()
        return "invalid session id" in error_text or "disconnected" in error_text

    def _is_retryable_network_error(self, exc: Exception) -> bool:
        error_text = str(exc).casefold()
        retryable_markers = (
            "net::",
            "err_proxy",
            "err_tunnel",
            "err_connection",
            "err_internet",
            "err_network",
            "proxy",
            "timed out receiving message",
            "timeout receiving message",
            "target window already closed",
            "chrome not reachable",
            "disconnected",
        )
        return isinstance(exc, WebDriverException) and any(marker in error_text for marker in retryable_markers)

    def _is_retryable_ui_error(self, exc: Exception) -> bool:
        error_text = str(exc).casefold()
        retryable_markers = (
            "stale element reference",
            "stale element not found",
            "could not open threads composer",
            "could not type text into threads composer",
            "composer editor is not",
            "editor is not ready",
            "threads ui did not confirm publication",
            "element click intercepted",
            "element is not clickable",
        )
        return isinstance(
            exc,
            (
                TimeoutException,
                StaleElementReferenceException,
                ElementClickInterceptedException,
                WebDriverException,
            ),
        ) and any(marker in error_text for marker in retryable_markers)


def _is_headless_browser_enabled() -> bool:
    return os.getenv("HEADLESS_BROWSER", "True").strip().casefold() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _normalize_posts_chain(task: PostingTask) -> list[str]:
    raw_chain = task.posts_chain if isinstance(task.posts_chain, list) else []
    posts_chain = [str(item).strip() for item in raw_chain if str(item).strip()]
    fallback = (task.content_text or "").strip()
    return posts_chain or ([fallback] if fallback else [])


def _get_profile_lock(account_id: int | None) -> threading.Lock | None:
    if account_id is None:
        return None

    with PROFILE_LOCKS_GUARD:
        if account_id not in PROFILE_LOCKS:
            PROFILE_LOCKS[account_id] = threading.Lock()

        return PROFILE_LOCKS[account_id]


def _build_fingerprint_profile(account_id: int | None) -> BrowserFingerprintProfile:
    seed = account_id if account_id is not None else os.getpid()
    randomizer = random.Random(seed)
    viewport_pool = (
        (1366, 900),
        (1440, 900),
        (1440, 1200),
        (1536, 960),
        (1600, 1000),
    )
    width, height = viewport_pool[randomizer.randrange(len(viewport_pool))]
    return BrowserFingerprintProfile(
        width=width,
        height=height,
        canvas_noise=randomizer.randint(1, 3),
        canvas_x=randomizer.randint(1, 11),
        canvas_y=randomizer.randint(1, 11),
    )


def _get_directory_size(path: Path) -> int:
    if not path.exists():
        return 0

    total_size = 0
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total_size += item.stat().st_size
        except OSError:
            continue

    return total_size


def _normalize_verification_text(value: str) -> str:
    return " ".join(value.casefold().split())


def _normalize_threads_post_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if not parsed.netloc or "/post/" not in parsed.path:
        return value.strip()

    return f"https://www.threads.com{parsed.path.rstrip('/')}"

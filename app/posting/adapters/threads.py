from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable, TypeVar
from urllib.parse import unquote, urlparse

from selenium import webdriver
from selenium.common.exceptions import (
    ElementClickInterceptedException,
    StaleElementReferenceException,
    TimeoutException,
    WebDriverException,
)
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from app.db.models import Account, PostingTask
from app.posting.adapters.base import BasePostingAdapter, PublishResult
from app.posting.exceptions import SessionExpiredException


SCREENSHOTS_DIR = Path("./data/screenshots")
PROXY_EXTENSIONS_DIR = Path("./data/proxy_extensions")
logger = logging.getLogger(__name__)
T = TypeVar("T")


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
            '//*[local-name()="svg" and (contains(@aria-label, "Новая") or contains(@aria-label, "New") or contains(@aria-label, "Create"))]'
            '/ancestor::*[@role="button" or self::button][1]',
        ),
        (
            By.XPATH,
            '//*[contains(normalize-space(), "Что нового?") or contains(normalize-space(), "What\'s new?")]'
            '/ancestor::*[@role="button" or self::button or @tabindex][1]',
        ),
        (By.XPATH, XPATHS["thread_popup"]),
    ]

    COMPOSER_EDITOR_LOCATORS = [
        (By.CSS_SELECTOR, 'div[contenteditable="true"][role="textbox"]'),
        (By.CSS_SELECTOR, 'div[contenteditable="true"]'),
        (By.XPATH, XPATHS["thread_text"]),
    ]

    COMPOSER_TRIGGER_LOCATORS = [
        (By.XPATH, "//*[text()='Новая ветка']"),
        (By.XPATH, "//*[contains(text(), 'Что нового?')]"),
        (By.XPATH, "//div[contains(@class, 'x1i10hfl') and @role='button']"),
    ]

    COMPOSER_EDITOR_LOCATORS = [
        (By.XPATH, "//div[@contenteditable='true']"),
    ]

    def __init__(self, timeout_seconds: int = 25) -> None:
        self.timeout_seconds = timeout_seconds

    async def publish(self, account: Account, task: PostingTask) -> PublishResult:
        return await asyncio.to_thread(self._publish_sync, account, task)

    async def check_session(self, account: Account) -> PublishResult:
        return await asyncio.to_thread(self._check_session_sync, account)

    def _check_session_sync(self, account: Account) -> PublishResult:
        session_payload = self._load_json(account.session_data_encrypted)
        proxy_url = session_payload.get("proxy") or account.proxy_url
        proxy_extension_path: Path | None = None
        driver: WebDriver | None = None

        try:
            if proxy_url:
                proxy_extension_path = self._create_proxy_extension(proxy_url, account.id)

            driver = self._create_driver(proxy_extension_path)
            self._apply_network_blocking(driver)
            self._authenticate_with_cookies(driver, account)
            detected_username = self._extract_authenticated_username(driver)
            logger.info("Threads session check completed for account #%s", account.id)
            return PublishResult(success=True, detected_username=detected_username)
        finally:
            self._quit_driver_safely(driver)
            if proxy_extension_path is not None:
                self._remove_file_safely(proxy_extension_path)

    def _publish_sync(self, account: Account, task: PostingTask) -> PublishResult:
        session_payload = self._load_json(account.session_data_encrypted)
        proxy_url = session_payload.get("proxy") or account.proxy_url

        for attempt in range(2):
            proxy_extension_path: Path | None = None
            driver: WebDriver | None = None

            try:
                if proxy_url:
                    proxy_extension_path = self._create_proxy_extension(proxy_url, task.id)

                driver = self._create_driver(proxy_extension_path)
                self._apply_network_blocking(driver)
                self._authenticate_with_cookies(driver, account)
                logger.info("Threads auth completed for task #%s", task.id)
                detected_username = self._extract_authenticated_username(driver)
                self._share_thread(driver, task.content_text, task.media_url)
                logger.info("Threads publish flow completed for task #%s", task.id)
                return PublishResult(success=True, detected_username=detected_username)
            except Exception as exc:
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
                self._quit_driver_safely(driver)
                if proxy_extension_path is not None:
                    self._remove_file_safely(proxy_extension_path)

        raise RuntimeError("Threads publishing failed after browser self-healing retry.")

    def _create_driver(self, proxy_extension_path: Path | None) -> WebDriver:
        options = Options()
        user_data_dir = Path(tempfile.mkdtemp(prefix="threadsai_chrome_"))

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
        options.add_argument("--remote-debugging-pipe")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--window-size=1440,1200")
        options.add_argument(f"--user-data-dir={user_data_dir}")
        options.add_argument("--blink-settings=imagesEnabled=false")
        options.add_argument("--disable-notifications")
        options.add_argument("--disable-popup-blocking")
        options.add_argument("--disable-background-networking")
        options.add_argument("--disable-sync")
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
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option("useAutomationExtension", False)

        if proxy_extension_path is not None:
            options.add_extension(str(proxy_extension_path))

        try:
            driver = webdriver.Chrome(options=options)
            setattr(driver, "_threadsai_user_data_dir", user_data_dir)
            self._apply_stealth_scripts(driver)
            return driver
        except WebDriverException as exc:
            self._remove_directory_safely(user_data_dir)
            raise RuntimeError(
                "Chrome не смог стартовать на сервере. Проверь установку google-chrome/chromium, "
                "совместимость ChromeDriver и системные библиотеки. "
                f"Исходная ошибка: {exc}"
            ) from exc

    def _apply_stealth_scripts(self, driver: WebDriver) -> None:
        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": """
                Object.defineProperty(navigator, 'webdriver', {
                  get: () => undefined
                });
                Object.defineProperty(navigator, 'plugins', {
                  get: () => [1, 2, 3, 4, 5]
                });
                Object.defineProperty(navigator, 'languages', {
                  get: () => ['ru-RU', 'ru', 'en-US', 'en']
                });
                window.chrome = window.chrome || { runtime: {} };

                const stopMedia = (node) => {
                  if (!node) return;
                  const mediaNodes = node.matches && node.matches('video,audio')
                    ? [node]
                    : Array.from(node.querySelectorAll ? node.querySelectorAll('video,audio') : []);

                  for (const media of mediaNodes) {
                    try {
                      media.preload = 'none';
                      media.autoplay = false;
                      media.muted = true;
                      media.pause();
                      media.removeAttribute('src');
                      media.querySelectorAll('source').forEach((source) => source.removeAttribute('src'));
                      media.load();
                    } catch (_) {}
                  }
                };

                try {
                  Object.defineProperty(HTMLMediaElement.prototype, 'preload', {
                    configurable: true,
                    get() { return 'none'; },
                    set() { return 'none'; }
                  });
                } catch (_) {}

                try {
                  HTMLMediaElement.prototype.play = function() {
                    stopMedia(this);
                    return Promise.resolve();
                  };
                } catch (_) {}

                new MutationObserver((mutations) => {
                  for (const mutation of mutations) {
                    mutation.addedNodes.forEach(stopMedia);
                  }
                }).observe(document.documentElement, { childList: true, subtree: true });
                """
            },
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

        for cookie in cookies:
            driver.add_cookie(self._normalize_cookie(cookie))

        driver.refresh()
        self._wait_for_dom(driver)
        self._assert_authenticated_session(driver)

    def _assert_authenticated_session(self, driver: WebDriver) -> None:
        current_path = urlparse(driver.current_url).path.casefold()
        if current_path.startswith("/login"):
            raise SessionExpiredException("Threads cookies expired: redirected to login page.")

        if self._has_login_markers(driver):
            raise SessionExpiredException("Threads cookies expired: login form detected.")

        logger.info("Threads authenticated session check passed")

    def _has_login_markers(self, driver: WebDriver) -> bool:
        login_locators = [
            (By.CSS_SELECTOR, 'input[type="password"]'),
            (By.CSS_SELECTOR, 'input[name="password"]'),
            (By.XPATH, "//*[contains(text(), 'Войти') or contains(text(), 'Log in') or contains(text(), 'Login')]"),
            (By.XPATH, "//*[contains(text(), 'Забыли пароль') or contains(text(), 'Forgot password')]"),
        ]

        for by, selector in login_locators:
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

    def _share_thread(self, driver: WebDriver, text: str, media_url: str | None) -> None:
        driver.get(self.BASE_URL)
        self._wait_for_dom(driver)
        logger.info("Threads page loaded before opening composer")

        self._open_thread_composer(driver)
        self._type_thread_text(driver, text)

        if media_url:
            self._safe_send_keys(driver, By.XPATH, self.XPATHS["upload_photo"], media_url)
            logger.info("Threads media path attached")

        self._submit_thread_with_hotkey(driver)

    def _open_thread_composer(self, driver: WebDriver) -> None:
        last_error: Exception | None = None

        for by, selector in self.COMPOSER_TRIGGER_LOCATORS:
            try:
                self._js_click_first_match(driver, by, selector)
                logger.info("Threads composer trigger clicked: %s", selector)

                if self._wait_for_composer_editor(driver, timeout_seconds=8) is not None:
                    logger.info("Threads composer editor is ready")
                    return
            except (TimeoutException, WebDriverException, StaleElementReferenceException) as exc:
                last_error = exc

        if last_error is not None:
            raise TimeoutException(f"Could not open Threads composer: {last_error}") from last_error

        raise TimeoutException("Could not open Threads composer.")

    def _is_composer_editor_present(self, driver: WebDriver) -> bool:
        return self._wait_for_composer_editor(driver, timeout_seconds=4) is not None

    def _wait_for_composer_editor(
        self,
        driver: WebDriver,
        *,
        timeout_seconds: int | float | None = None,
    ) -> WebElement | None:
        for by, selector in self.COMPOSER_EDITOR_LOCATORS:
            try:
                element = WebDriverWait(driver, timeout_seconds or self.timeout_seconds).until(
                    EC.element_to_be_clickable((by, selector))
                )
                return element
            except (TimeoutException, WebDriverException):
                continue

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
        self._wait_after_publish_submit(driver)

    def _wait_after_publish_submit(self, driver: WebDriver) -> None:
        try:
            WebDriverWait(driver, 12).until(
                lambda current_driver: not self._has_visible_composer_editor(current_driver)
                or self._active_editor_text_is_empty(current_driver)
            )
            logger.info("Threads publish submit acknowledged by UI")
        except TimeoutException:
            logger.warning("Threads UI did not confirm submit within timeout; continuing after hotkey.")

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
                element = WebDriverWait(driver, self.timeout_seconds).until(
                    EC.element_to_be_clickable((by, selector))
                )
                self._scroll_to_element(driver, element)
                driver.execute_script("arguments[0].click();", element)
                self._wait_until_editor_has_focus(driver, element)
                ActionChains(driver).send_keys(value).perform()
                self._wait_until_editor_contains_text(driver, value)
                return
            except (StaleElementReferenceException, ElementClickInterceptedException, WebDriverException) as exc:
                last_error = exc
                fresh_element = self._find_optional_element(driver, by, selector)
                if fresh_element is not None and self._inject_text_with_javascript(driver, fresh_element, value):
                    logger.info("Threads text inserted with JavaScript fallback")
                    return

                time.sleep(retry_delay_seconds)

        if last_error is not None:
            raise last_error

        raise TimeoutException(f"Editor is not ready for ActionChains input: {selector}")

    def _retry_on_stale(
        self,
        action_name: str,
        action: Callable[[], T],
        *,
        retries: int = 3,
        retry_delay_seconds: float = 0.35,
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
            driver.execute_script(
                """
                const element = arguments[0];
                const text = arguments[1];
                element.focus();
                element.innerText = text;
                element.textContent = text;
                element.dispatchEvent(new InputEvent('input', {
                  bubbles: true,
                  inputType: 'insertText',
                  data: text
                }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                """,
                element,
                value,
            )
            return True
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
        extension_path = PROXY_EXTENSIONS_DIR / f"{task_id}_proxy_auth.zip"
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

        with zipfile.ZipFile(extension_path, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("background.js", background_js)

        return extension_path

    def _save_error_screenshot(self, driver: WebDriver | None, task_id: int) -> str | None:
        if driver is None:
            return None

        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        screenshot_path = SCREENSHOTS_DIR / f"{task_id}_error.png"

        try:
            driver.save_screenshot(str(screenshot_path))
        except WebDriverException:
            return None

        return str(screenshot_path)

    def _load_cookies(self, account: Account) -> list[dict[str, Any]]:
        payload = self._load_json(account.cookies_encrypted)

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

    def _quit_driver_safely(self, driver: WebDriver | None) -> None:
        if driver is None:
            return
        user_data_dir = getattr(driver, "_threadsai_user_data_dir", None)

        try:
            driver.quit()
        except WebDriverException:
            pass
        finally:
            if isinstance(user_data_dir, Path):
                self._remove_directory_safely(user_data_dir)

    def _remove_directory_safely(self, path: Path) -> None:
        try:
            import shutil

            shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass

    def _is_recoverable_browser_crash(self, exc: Exception) -> bool:
        error_text = str(exc).casefold()
        return "invalid session id" in error_text or "disconnected" in error_text


def _is_headless_browser_enabled() -> bool:
    return os.getenv("HEADLESS_BROWSER", "True").strip().casefold() not in {
        "0",
        "false",
        "no",
        "off",
    }

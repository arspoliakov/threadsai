from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from selenium.common.exceptions import StaleElementReferenceException, WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Account, AccountStatus, Platform, SavedTrend
from app.posting.adapters.threads import ThreadsAdapter
from app.posting.exceptions import PostingDeadlineExceeded, ProxyNetworkException


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_THREADS_FEED_URL = "https://www.threads.net/"
MAX_SCRAPED_POSTS = 30
MAX_ACCEPTED_POSTS = 10
MAX_DOM_CONTAINERS_TO_PARSE = 50
MIN_TEXT_LENGTH = 20
MIN_LIKES_THRESHOLD = 10
DEFAULT_UNKNOWN_LIKES_SCORE = 1
SCROLL_TIMES = 4
SCROLL_PAUSE_SECONDS = 2.5
INITIAL_FEED_PAUSE_SECONDS = 3
EMPTY_FEED_REFRESH_PAUSE_SECONDS = 5
MAX_EMPTY_FEED_REFRESHES = 2
THREADS_POST_SELECTOR = '[data-pressable-container="true"], div[role="article"], article'


@dataclass(slots=True)
class ScrapeTrendsResult:
    raw_posts: list[dict[str, Any]]
    saved_raw_count: int


class ThreadsTrendScraper:
    def __init__(self, timeout_seconds: int = 25) -> None:
        self.adapter = ThreadsAdapter(timeout_seconds=timeout_seconds)

    def scrape(
        self,
        account: Account,
        target_url: str = DEFAULT_THREADS_FEED_URL,
        *,
        deadline_at: float | None = None,
    ) -> list[dict[str, Any]]:
        session_payload = self.adapter._load_json(account.session_data_encrypted)
        proxy_url = session_payload.get("proxy") or account.proxy_url
        proxy_extension_path: Path | None = None
        driver: WebDriver | None = None
        deadline_watchdog = None

        try:
            self.adapter._raise_if_deadline_exceeded(deadline_at)
            if proxy_url:
                proxy_extension_path = self.adapter._create_proxy_extension(proxy_url, account.id)

            driver = self.adapter._create_driver(proxy_extension_path, account_id=account.id)
            deadline_watchdog = self.adapter._start_deadline_watchdog(driver, deadline_at, account.id)
            self.adapter._raise_if_deadline_exceeded(deadline_at)
            self.adapter._apply_network_blocking(driver)
            self.adapter._authenticate_with_cookies(driver, account)
            self.adapter._raise_if_deadline_exceeded(deadline_at)
            driver.get(target_url)
            self.adapter._wait_for_dom(driver)
            _sleep_with_deadline(INITIAL_FEED_PAUSE_SECONDS, deadline_at, self.adapter)
            self._wait_for_feed_content(driver, deadline_at)
            self._scroll_feed(driver, deadline_at)
            self.adapter._raise_if_deadline_exceeded(deadline_at)
            return self._extract_posts(driver, target_url)
        except PostingDeadlineExceeded:
            raise
        except WebDriverException as exc:
            if self.adapter._is_deadline_exceeded(deadline_at):
                raise PostingDeadlineExceeded("Threads scraping exceeded the safe proxy window.") from exc

            if self.adapter._is_retryable_network_error(exc):
                raise ProxyNetworkException(f"Threads scraping proxy/network transport failed: {exc}") from exc

            raise
        finally:
            if deadline_watchdog is not None:
                deadline_watchdog.set()
            self.adapter._quit_driver_safely(driver)
            if proxy_extension_path is not None:
                self.adapter._remove_file_safely(proxy_extension_path)

    def _scroll_feed(self, driver: WebDriver, deadline_at: float | None = None) -> None:
        for _ in range(SCROLL_TIMES):
            self.adapter._raise_if_deadline_exceeded(deadline_at)
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            _sleep_with_deadline(SCROLL_PAUSE_SECONDS, deadline_at, self.adapter)

    def _wait_for_feed_content(self, driver: WebDriver, deadline_at: float | None = None) -> None:
        for attempt in range(MAX_EMPTY_FEED_REFRESHES + 1):
            self.adapter._raise_if_deadline_exceeded(deadline_at)
            if self._has_feed_content(driver):
                logger.info("Лента Threads прогружена, попытка: %s", attempt + 1)
                return

            if attempt >= MAX_EMPTY_FEED_REFRESHES:
                logger.warning("Лента Threads осталась пустой после refresh-попыток")
                return

            logger.info("Лента Threads пустая, делаю принудительный refresh: %s/%s", attempt + 1, MAX_EMPTY_FEED_REFRESHES)
            driver.refresh()
            self.adapter._wait_for_dom(driver)
            _sleep_with_deadline(EMPTY_FEED_REFRESH_PAUSE_SECONDS, deadline_at, self.adapter)

    def _has_feed_content(self, driver: WebDriver) -> bool:
        try:
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, THREADS_POST_SELECTOR))
            )
        except WebDriverException:
            return False

        for container in self._find_post_containers(driver):
            try:
                text = self._extract_post_text(container)
            except (StaleElementReferenceException, WebDriverException):
                continue

            if len(text) > 10:
                return True

        return False

    def _extract_posts(self, driver: WebDriver, target_url: str) -> list[dict[str, Any]]:
        containers = self._find_post_containers(driver)
        logger.info("Найдено DOM-блоков постов: %s", len(containers))

        # React может держать в DOM сотни старых блоков. Нам нужен быстрый срез,
        # а не полный обход кладбища уже отрисованных постов.
        containers = containers[:MAX_DOM_CONTAINERS_TO_PARSE]
        logger.info("DOM-блоков взято в разбор: %s", len(containers))

        seen_texts: set[str] = set()
        posts: list[dict[str, Any]] = []
        accepted_count = 0

        for index, container in enumerate(containers, start=1):
            try:
                text = self._extract_post_text(container)
            except StaleElementReferenceException:
                logger.info("Вердикт: Отклонен (DOM устарел во время разбора)")
                continue

            preview = _preview_text(text)
            logger.info("Разбор поста: %s", preview)

            if not _is_meaningful_post_text(text):
                logger.info("Вердикт: Отклонен (мусорный текст)")
                continue

            if text in seen_texts:
                logger.info("Вердикт: Отклонен (дубликат в памяти)")
                continue

            # Критично: фиксируем дубль до поиска лайков и до любых запросов в БД.
            seen_texts.add(text)

            try:
                likes = self._extract_likes(container)
            except StaleElementReferenceException:
                logger.info("Вердикт: Отклонен (DOM устарел во время поиска лайков)")
                continue

            logger.info("Лайки: %s", likes if likes is not None else "не найдено")

            if likes is not None and likes < MIN_LIKES_THRESHOLD:
                logger.info("Вердикт: Отклонен (< 10 лайков)")
                continue

            score = likes if likes is not None else DEFAULT_UNKNOWN_LIKES_SCORE
            if likes is None:
                logger.warning("Лайки не найдены, сохранен по дефолту: %s", preview)

            posts.append(
                {
                    "text": text,
                    "views": 0,
                    "likes": score,
                    "likes_found": likes is not None,
                    "comments": 0,
                    "author": None,
                    "url": self._extract_post_url(container, target_url, index),
                    "platform": Platform.THREADS,
                }
            )
            accepted_count += 1
            logger.info("Вердикт: Кандидат принят (%s/%s)", accepted_count, MAX_ACCEPTED_POSTS)

            if accepted_count >= MAX_ACCEPTED_POSTS:
                logger.info("Достигнут лимит принятых постов: %s", MAX_ACCEPTED_POSTS)
                break

        return sorted(posts, key=lambda post: post["likes"], reverse=True)[:MAX_SCRAPED_POSTS]

    def _find_post_containers(self, driver: WebDriver):
        selectors = [
            'div[role="article"]',
            "article",
            '[data-pressable-container="true"]',
            'div:has(a[href*="/post/"])',
        ]
        containers = []
        seen_ids: set[str] = set()

        for selector in selectors:
            if len(containers) >= MAX_DOM_CONTAINERS_TO_PARSE:
                break

            try:
                elements = driver.find_elements(By.CSS_SELECTOR, selector)
            except WebDriverException:
                continue

            elements = elements[:MAX_DOM_CONTAINERS_TO_PARSE]

            for element in elements:
                if len(containers) >= MAX_DOM_CONTAINERS_TO_PARSE:
                    break

                element_id = element.id
                if element_id in seen_ids:
                    continue

                seen_ids.add(element_id)
                containers.append(element)

        return containers[:MAX_DOM_CONTAINERS_TO_PARSE]

    def _extract_post_text(self, element) -> str:
        text_nodes: list[str] = []

        for selector in ['div[dir="auto"]', 'span[dir="auto"]']:
            try:
                nodes = element.find_elements(By.CSS_SELECTOR, selector)
            except WebDriverException:
                continue

            for node in nodes:
                text = _normalize_text(node.text)
                if _is_meaningful_post_text(text):
                    text_nodes.append(text)

        if text_nodes:
            return max(text_nodes, key=len)

        return _normalize_text(element.text)

    def _extract_likes(self, element) -> int | None:
        candidates: list[str] = []

        try:
            labeled_nodes = element.find_elements(By.CSS_SELECTOR, "[aria-label]")
        except WebDriverException:
            labeled_nodes = []

        for node in labeled_nodes:
            try:
                label = node.get_attribute("aria-label")
            except StaleElementReferenceException:
                continue

            if label:
                candidates.append(label)

        candidates.extend(self._extract_heart_neighborhood_texts(element))

        try:
            candidates.append(element.text)
        except StaleElementReferenceException:
            pass

        for candidate in candidates:
            likes = parse_likes_count(candidate)
            if likes is not None:
                return likes

        return self._extract_likes_from_obfuscated_engagement(element)

    def _extract_heart_neighborhood_texts(self, element) -> list[str]:
        snippets: list[str] = []
        selectors = [
            'svg[aria-label*="Like"]',
            'svg[aria-label*="like"]',
            'svg[aria-label*="Нрав"]',
            'svg[aria-label*="нрав"]',
            'svg[aria-label*="лайк"]',
            'svg[aria-label*="серд"]',
            'div[role="button"] svg',
        ]

        for selector in selectors:
            try:
                icons = element.find_elements(By.CSS_SELECTOR, selector)
            except WebDriverException:
                continue

            for icon in icons:
                try:
                    snippet = icon.find_element(By.XPATH, "./ancestor::*[@role='button'][1]").text
                except WebDriverException:
                    try:
                        snippet = icon.find_element(By.XPATH, "./ancestor::div[1]").text
                    except WebDriverException:
                        continue

                normalized_snippet = _normalize_text(snippet)
                if normalized_snippet:
                    snippets.append(normalized_snippet)

        return snippets

    def _extract_likes_from_obfuscated_engagement(self, element) -> int | None:
        candidates: list[int] = []

        selectors = [
            'div[role="button"]',
            'span[role="button"]',
            "button",
            'a[href*="/liked_by"]',
            'a[href*="/likes"]',
            "span",
            "div",
        ]

        for selector in selectors:
            try:
                nodes = element.find_elements(By.CSS_SELECTOR, selector)
            except WebDriverException:
                continue

            for node in nodes:
                try:
                    node_text = _normalize_text(node.text)
                    aria_label = node.get_attribute("aria-label") or ""
                    title = node.get_attribute("title") or ""
                    text_blob = " ".join(part for part in (node_text, aria_label, title) if part)
                except StaleElementReferenceException:
                    continue

                value = parse_compact_count(text_blob)
                if value is not None:
                    candidates.append(value)

        if not candidates:
            return None

        return max(candidates)

    def _extract_post_url(self, element, target_url: str, index: int) -> str:
        try:
            links = element.find_elements(By.CSS_SELECTOR, 'a[href*="/post/"]')
        except WebDriverException:
            return f"{target_url.rstrip('/')}#scraped-{index}"

        if not links:
            return f"{target_url.rstrip('/')}#scraped-{index}"

        href = links[0].get_attribute("href")
        return href or f"{target_url.rstrip('/')}#scraped-{index}"


async def scrape_trends(
    project_id: int,
    session: AsyncSession,
    target_url: str = DEFAULT_THREADS_FEED_URL,
    deadline_at: float | None = None,
    account_id: int | None = None,
) -> ScrapeTrendsResult:
    account = await _get_scraping_account(project_id=project_id, session=session, account_id=account_id)

    if account is None:
        raise ValueError("Project has no active Threads account with cookies for scraping.")

    raw_posts = await asyncio.to_thread(
        ThreadsTrendScraper().scrape,
        account,
        target_url,
        deadline_at=deadline_at,
    )
    raw_posts = sorted(raw_posts, key=lambda post: post.get("likes", 0), reverse=True)
    saved_raw_count = await save_scraped_posts(project_id=project_id, raw_posts=raw_posts, session=session)
    return ScrapeTrendsResult(raw_posts=raw_posts, saved_raw_count=saved_raw_count)


async def save_scraped_posts(
    project_id: int,
    raw_posts: list[dict[str, Any]],
    session: AsyncSession,
) -> int:
    saved_count = 0
    await session.execute(delete(SavedTrend).where(SavedTrend.project_id == project_id))
    await session.flush()
    logger.info("Garbage Collection: старые тренды проекта #%s удалены перед сохранением свежей ленты", project_id)

    for post in sorted(raw_posts, key=lambda item: item.get("likes", 0), reverse=True):
        if saved_count >= MAX_ACCEPTED_POSTS:
            logger.info("Достигнут лимит сохраненных постов: %s", MAX_ACCEPTED_POSTS)
            break

        likes = int(post.get("likes", DEFAULT_UNKNOWN_LIKES_SCORE) or DEFAULT_UNKNOWN_LIKES_SCORE)
        likes_found = bool(post.get("likes_found", likes > DEFAULT_UNKNOWN_LIKES_SCORE))
        text = post["text"][:1000]

        if likes_found and likes < MIN_LIKES_THRESHOLD:
            logger.info("Вердикт: Отклонен (< 10 лайков) - %s", _preview_text(text))
            continue

        if not likes_found:
            likes = DEFAULT_UNKNOWN_LIKES_SCORE
            logger.warning("Лайки не найдены, сохранен по дефолту: %s", _preview_text(text))

        existing_id = await session.scalar(
            select(SavedTrend.id).where(
                SavedTrend.project_id == project_id,
                SavedTrend.raw_text == text,
            )
        )

        if existing_id is not None:
            logger.info("Вердикт: Отклонен (дубликат в БД) - %s", _preview_text(text))
            continue

        session.add(
            SavedTrend(
                project_id=project_id,
                platform=Platform.THREADS,
                source_url=post.get("url") or DEFAULT_THREADS_FEED_URL,
                author_handle=post.get("author"),
                raw_text=text,
                metrics_json={
                    "views": post.get("views", 0),
                    "likes": likes,
                    "likes_found": likes_found,
                    "comments": post.get("comments", 0),
                    "engagement_rate": 0.0,
                },
                virality_score=float(likes),
                analyzed=False,
            )
        )
        saved_count += 1
        logger.info("Вердикт: Сохранен (%s/%s) - %s", saved_count, MAX_ACCEPTED_POSTS, _preview_text(text))

    await session.commit()
    return saved_count


async def scrape_daily_trend_feed() -> list[dict[str, Any]]:
    """Compatibility fallback for old callers.

    Real scraping needs a project-bound account and DB session, so production code
    should call scrape_trends(project_id, session) instead.
    """

    return []


async def _get_scraping_account(
    project_id: int,
    session: AsyncSession,
    account_id: int | None = None,
) -> Account | None:
    stmt = (
        select(Account)
        .where(
            Account.project_id == project_id,
            Account.platform == Platform.THREADS,
            Account.status == AccountStatus.ACTIVE,
            Account.cookies_encrypted.is_not(None),
        )
        .order_by(Account.last_used_at.asc().nulls_first(), Account.created_at.asc())
        .limit(1)
    )
    if account_id is not None:
        stmt = stmt.where(Account.id == account_id)

    return await session.scalar(stmt)


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _preview_text(text: str) -> str:
    return f"{text[:30]}..." if len(text) > 30 else text


def _is_meaningful_post_text(text: str) -> bool:
    if len(text) < MIN_TEXT_LENGTH:
        return False

    if text.startswith("http") and " " not in text:
        return False

    lowered_text = text.casefold()
    ui_noise = {
        "like",
        "likes",
        "reply",
        "repost",
        "share",
        "поделиться",
        "ответить",
        "нравится",
        "репост",
        "threads",
    }

    return lowered_text not in ui_noise


def parse_likes_count(value: str) -> int | None:
    normalized_value = value.casefold().replace("\xa0", " ")
    if not any(marker in normalized_value for marker in ("like", "нрав", "лайк", "heart", "серд")):
        return None

    return parse_compact_count(normalized_value)


def parse_compact_count(value: str) -> int | None:
    normalized_value = value.casefold().replace("\xa0", " ")
    patterns = [
        r"(\d+(?:[,.]\d+)?)\s*(тыс\.?|тысяч|k)",
        r"(\d+(?:[,.]\d+)?)\s*(млн\.?|million|m)",
        r"(?<![\w@])(\d[\d\s,.]*)(?![\w@])",
    ]

    for pattern in patterns:
        match = re.search(pattern, normalized_value)
        if not match:
            continue

        number = _parse_localized_number(match.group(1))
        suffix = match.group(2) if len(match.groups()) > 1 else ""

        if suffix.startswith(("тыс", "k")):
            return int(number * 1_000)

        if suffix.startswith(("млн", "million", "m")):
            return int(number * 1_000_000)

        return int(number)

    return None


def _parse_localized_number(value: str) -> float:
    clean_value = value.replace(" ", "").replace(",", ".")

    if clean_value.count(".") > 1:
        clean_value = clean_value.replace(".", "")

    return float(clean_value)


def _sleep_with_deadline(seconds: float, deadline_at: float | None, adapter: ThreadsAdapter) -> None:
    end_at = time.monotonic() + seconds
    while time.monotonic() < end_at:
        adapter._raise_if_deadline_exceeded(deadline_at)
        time.sleep(min(0.5, end_at - time.monotonic()))

    adapter._raise_if_deadline_exceeded(deadline_at)

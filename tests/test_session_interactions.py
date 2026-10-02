import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from selenium.common.exceptions import WebDriverException
from app.posting.adapters.threads import ThreadsAdapter, ProxyIpWatchdog, _keyboard_chunks
from app.posting.exceptions import PostingDeadlineExceeded, ProxyNetworkException
from app.parsers.scraper import ThreadsTrendScraper


class SessionInteractionTest(unittest.TestCase):
    def test_pauses_stop_on_deadline_and_ip_change(self):
        adapter = ThreadsAdapter()
        driver = SimpleNamespace(_threadsai_interaction_deadline=0)
        with self.assertRaises(PostingDeadlineExceeded):
            adapter._pause_interaction(driver, 5)
        watchdog = ProxyIpWatchdog(threading.Event(), threading.Event(), "first")
        watchdog.changed_event.set()
        driver = SimpleNamespace(_threadsai_interaction_ip_watchdog=watchdog)
        with self.assertRaises(ProxyNetworkException):
            adapter._pause_interaction(driver, 5)

    def test_keyboard_keeps_all_text_and_stops_when_focus_is_lost(self):
        text = "Первая строка.\n\nВторая строка с emoji 🙂 и  пробелами."
        self.assertEqual("".join(_keyboard_chunks(text)), text)
        self.assertTrue(all(len(chunk) <= 24 for chunk in _keyboard_chunks(text)))
        adapter = ThreadsAdapter()
        driver = SimpleNamespace()
        editor = Mock()
        with patch.object(adapter, "_element_has_focus", side_effect=[True, False]), patch.object(adapter, "_pause_interaction"):
            with self.assertRaises(WebDriverException):
                adapter._type_text_in_chunks(driver, editor, text)
        editor.send_keys.assert_called_once()

    def test_feed_keeps_previous_viewport_and_stops_without_reload(self):
        scraper = ThreadsTrendScraper()
        driver = Mock()
        driver.execute_script.return_value = 900
        first = {"text": "first text", "likes": 30}
        second = {"text": "second text", "likes": 40}
        with patch.object(scraper.adapter, "_pause_interaction"), patch.object(scraper.adapter, "_check_interaction_guard"), patch.object(scraper.adapter, "_assert_no_blocking_challenge"), patch.object(scraper, "_extract_posts", side_effect=[[first], [second], [second], [second]]), patch.object(scraper, "_feed_signature", return_value=["same"]), patch("app.parsers.scraper.ActionChains"), patch("app.parsers.scraper.WebDriverWait"):
            posts = scraper._scroll_feed(driver)
        self.assertEqual([p["text"] for p in posts], ["second text", "first text"])
        driver.refresh.assert_not_called()

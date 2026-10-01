import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from selenium.common.exceptions import TimeoutException, WebDriverException

from app.posting.adapters.threads import ThreadsAdapter
from app.posting.exceptions import PublicationVerificationPending, SessionExpiredException


class BrowserFlowTest(unittest.TestCase):
    def test_session_reused_and_new_export_replaces_it(self):
        adapter = ThreadsAdapter()
        account = SimpleNamespace(id=1, username="owner")
        cookies = [{"name": "sessionid", "value": "first", "domain": ".threads.net", "path": "/"}]
        with TemporaryDirectory() as directory:
            driver = Mock(_threadsai_user_data_dir=Path(directory), current_url=adapter.BASE_URL)
            with patch.object(adapter, "_load_cookies", return_value=cookies), \
                 patch.object(adapter, "_wait_for_dom"), \
                 patch.object(adapter, "_assert_authenticated_session") as authenticated, \
                 patch.object(adapter, "_assert_no_blocking_challenge"), \
                 patch.object(adapter, "_extract_authenticated_username", return_value="owner"):
                adapter._authenticate_with_cookies(driver, account)
                driver.add_cookie.assert_called_once()
                marker = json.loads((Path(directory) / "threadsai-session.json").read_text())
                self.assertNotIn("first", json.dumps(marker))
                driver.reset_mock()
                adapter._authenticate_with_cookies(driver, account)
                driver.add_cookie.assert_not_called()
                driver.delete_all_cookies.assert_not_called()
                authenticated.side_effect = SessionExpiredException("expired")
                with self.assertRaises(SessionExpiredException):
                    adapter._authenticate_with_cookies(driver, account)
                driver.add_cookie.assert_not_called()
                authenticated.side_effect = None
                cookies[0]["value"] = "renewed"
                adapter._authenticate_with_cookies(driver, account)
                driver.add_cookie.assert_called_once()
                driver.delete_all_cookies.assert_called_once()

    def test_wrong_owner_never_marks_session_valid(self):
        adapter = ThreadsAdapter()
        with patch.object(adapter, "_extract_authenticated_username", return_value="someone_else"):
            with self.assertRaises(SessionExpiredException):
                adapter._require_session_identity(Mock(), SimpleNamespace(username="owner"))

    def test_full_editor_text_required_and_partial_paste_replaced(self):
        adapter = ThreadsAdapter()
        driver = SimpleNamespace()
        editor = Mock()
        expected = "Same prefix of twenty four characters, with the full ending 🙂"
        with patch.object(adapter, "_find_visible_editors", return_value=[editor]), \
             patch.object(adapter, "_read_element_text", return_value=expected[:24]), \
             patch("app.posting.adapters.threads.WebDriverWait") as wait:
            wait.return_value.until.side_effect = lambda predicate: self.assertFalse(predicate(driver))
            adapter._wait_until_editor_contains_text(driver, expected)
        with patch.object(adapter, "_wait_for_composer_editor", return_value=editor), \
             patch.object(adapter, "_scroll_to_element"), \
             patch.object(adapter, "_focus_composer_editor"), \
             patch.object(adapter, "_wait_until_editor_has_focus"), \
             patch.object(adapter, "_select_editor_contents") as select, \
             patch.object(adapter, "_paste_text_like_human"), \
             patch.object(adapter, "_wait_until_editor_contains_text", side_effect=[TimeoutException(), None]):
            adapter._safe_type_into_active_editor(driver, "css selector", "editor", expected)
            self.assertEqual(select.call_count, 2)
            self.assertEqual(editor.send_keys.call_args_list[-1].args, (expected,))

    def test_chain_uses_each_verified_parent_and_stops_on_uncertainty(self):
        adapter = ThreadsAdapter()
        driver = SimpleNamespace()
        root = "https://www.threads.com/@owner/post/root"
        reply = "https://www.threads.com/@owner/post/reply"
        with patch.object(adapter, "_share_thread"), \
             patch.object(adapter, "_reply_to_verified_thread") as send_reply, \
             patch.object(adapter, "_verify_published_post", side_effect=[root, reply, reply + "2"]) as verify:
            result = adapter._share_posts_chain(driver, ["first", "second", "third"], None,
                username="owner", existing_post_urls=set(), deadline_at=None, ip_watchdog=None)
            self.assertEqual(result, root)
            self.assertEqual(send_reply.call_args_list[0].args, (driver, "second", root, "first"))
            self.assertEqual(send_reply.call_args_list[1].args, (driver, "third", reply, "second"))
            self.assertEqual(verify.call_args_list[1].kwargs["parent_url"], root)
        with patch.object(adapter, "_share_thread"), \
             patch.object(adapter, "_reply_to_verified_thread") as send_reply, \
             patch.object(adapter, "_verify_published_post", side_effect=PublicationVerificationPending("pending")):
            with self.assertRaises(PublicationVerificationPending):
                adapter._share_posts_chain(driver, ["first", "second"], None,
                    username="owner", existing_post_urls=set(), deadline_at=None, ip_watchdog=None)
            send_reply.assert_not_called()

    def test_disconnected_reply_stops_as_uncertain_and_is_not_retried(self):
        adapter = ThreadsAdapter()
        driver = SimpleNamespace()
        def disconnected(*args):
            driver._threadsai_submission_attempts = 1
            raise WebDriverException("lost response")
        with patch.object(adapter, "_share_thread"), \
             patch.object(adapter, "_verify_published_post", return_value="https://www.threads.com/@owner/post/root"), \
             patch.object(adapter, "_reply_to_verified_thread", side_effect=disconnected) as reply:
            with self.assertRaises(PublicationVerificationPending):
                adapter._share_posts_chain(driver, ["first", "second", "third"], None,
                    username="owner", existing_post_urls=set(), deadline_at=None, ip_watchdog=None)
            reply.assert_called_once()

    def test_filters_keep_images_fonts_and_scripts_and_submission_rechecks_text(self):
        adapter = ThreadsAdapter()
        driver = Mock()
        adapter._apply_network_blocking(driver)
        patterns = driver.execute_cdp_cmd.call_args.args[1]["urls"]
        self.assertIn("*.mp4?*", patterns)
        for unsafe in ("*video*", "*audio*", "*.png", "*.woff", "*.ts"):
            self.assertNotIn(unsafe, patterns)
        driver = SimpleNamespace(_threadsai_expected_editor_text="complete text")
        with patch.object(adapter, "_wait_until_editor_contains_text", side_effect=TimeoutException()), \
             patch.object(adapter, "_click_submit_button") as submit:
            with self.assertRaises(TimeoutException):
                adapter._submit_thread(driver)
            submit.assert_not_called()

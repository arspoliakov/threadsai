import queue
import threading
import time
import unittest
from unittest.mock import patch, Mock

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes.threads_login import Input
from app.services.threads_login_window import LoginWindow


class LoginWindowTests(unittest.TestCase):
    def test_owner_token_and_expiration_are_all_required(self):
        window = LoginWindow()
        window.room = dict(owner=1, token="secret", stop=threading.Event(), expires=time.monotonic()+30)
        self.assertIs(window.access(1, "secret"), window.room)
        for owner, token in ((2,"secret"),(1,"wrong")):
            with self.assertRaises(HTTPException): window.access(owner, token)
        window.room["expires"] = time.monotonic()-1
        with self.assertRaises(HTTPException): window.access(1,"secret")

    def test_wrong_profile_cannot_export_and_foreign_cookies_are_removed(self):
        window = LoginWindow()
        room = dict(owner=1, token="secret", username="owner", port=1234, ready=threading.Event(), stop=threading.Event(), commands=queue.Queue(4), expires=time.monotonic()+30)
        window.room = room
        driver = Mock()
        driver.current_url = "https://www.threads.com/"
        driver.window_handles = ["one"]
        driver.execute_script.return_value = "someone_else"
        driver.execute_cdp_cmd.return_value = {"cookies":[{"domain":".threads.com","name":"sessionid","value":"private","expires":12345},{"domain":"other.test","name":"unrelated","value":"private"}]}
        adapter = Mock()
        adapter._create_driver.return_value = driver
        with patch("app.services.threads_login_window.ThreadsAdapter", return_value=adapter), patch("app.services.threads_login_window.build_threads_proxy_url", return_value="proxy"):
            worker = threading.Thread(target=window._worker,args=(room,))
            worker.start()
            self.assertTrue(room["ready"].wait(2))
            with self.assertRaises(HTTPException): window.command(1,"secret","finish")
            driver.execute_script.return_value = "owner"
            result = window.command(1,"secret","finish")
            self.assertEqual(len(result),1)
            self.assertEqual(result[0]["expiry"],12345)
            window.close(1,"secret")
            worker.join(2)
            self.assertFalse(worker.is_alive())
            adapter._quit_driver_safely.assert_called_once_with(driver)

    def test_input_bounds_and_keys(self):
        for data in ({"kind":"click","x":1024},{"kind":"text","text":"x"*1025},{"kind":"key","key":"Control+l"},{"kind":"scroll","delta":1001}):
            with self.assertRaises(ValidationError): Input(**data)


if __name__ == "__main__": unittest.main()

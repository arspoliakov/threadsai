"""OS-backed Chrome profile lock shared by workers and session-check subprocesses."""
import os
from pathlib import Path
import threading
import time


class ProfileLock:
    def __init__(self, path: Path):
        self.path = path
        self.thread_lock = threading.Lock()
        self.handle = None

    def acquire(self, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        if not self.thread_lock.acquire(timeout=timeout):
            return False
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.handle = self.path.open("a+b")
            if self.path.stat().st_size == 0:
                self.handle.write(b"0")
                self.handle.flush()
            while True:
                try:
                    self.handle.seek(0)
                    if os.name == "nt":
                        import msvcrt
                        msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    return True
                except OSError:
                    if time.monotonic() >= deadline:
                        self.handle.close()
                        self.handle = None
                        self.thread_lock.release()
                        return False
                    time.sleep(0.1)
        except BaseException:
            if self.handle is not None:
                self.handle.close()
                self.handle = None
            self.thread_lock.release()
            raise

    def release(self) -> None:
        try:
            if self.handle is not None:
                try:
                    self.handle.seek(0)
                    if os.name == "nt":
                        import msvcrt
                        msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
                finally:
                    self.handle.close()
                    self.handle = None
        finally:
            self.thread_lock.release()

class SessionExpiredException(RuntimeError):
    """Raised when social account cookies no longer provide an authenticated session."""


class RetryablePostingException(RuntimeError):
    """Raised when a task should return to the queue instead of becoming failed."""


class PostingDeadlineExceeded(RetryablePostingException):
    """Raised when Selenium exceeds the safe proxy rotation window."""


class ProxyNetworkException(RetryablePostingException):
    """Raised when proxy/network transport fails during a browser task."""

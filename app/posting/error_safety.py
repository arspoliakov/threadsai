"""Redact credentials in connection diagnostics before storage or logging."""
import re


def redact_connection_secrets(message: str) -> str:
    value = re.sub(r"(?i)(https?|socks5h?)://[^\s/@]+(?::[^\s/@]*)?@", r"\1://[redacted]@", message)
    value = re.sub(r"(?i)(password|passwd|authorization)(\s*[:=]\s*)[^\s,;]+", r"\1\2[redacted]", value)
    return value

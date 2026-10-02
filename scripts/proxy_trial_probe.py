"""Two-session trial probe; isolated from application settings, DB and browser login.

No network is used unless --live and --trial-only are both supplied. Proxy URLs
come only from PROXY_TRIAL_URL_A/B; their provider-specific syntax is not inferred.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

ENDPOINT = "https://api.ipify.org/"
ALLOWED_ENDPOINTS = frozenset({ENDPOINT})
RESPONSE_CAP = 512


class ProbeValidationError(ValueError):
    pass


@dataclass(frozen=True)
class Config:
    samples: int = 3
    interval: float = 2
    max_runtime: float = 45
    response_budget: int = 4096

    def validate(self) -> None:
        if not 2 <= self.samples <= 5:
            raise ProbeValidationError("samples must be between 2 and 5")
        if not 0 <= self.interval <= 10 or not 5 <= self.max_runtime <= 60:
            raise ProbeValidationError("interval must be 0..10; runtime must be 5..60 seconds")
        if not 2 * self.samples * RESPONSE_CAP <= self.response_budget <= 65536:
            raise ProbeValidationError("response budget must cover 512 bytes per request and be at most 65536")


def validate_proxy(value: str | None, label: str) -> str:
    # Error messages intentionally do not interpolate credentials or URLs.
    try:
        parsed = urlsplit(value or "")
        valid = parsed.scheme in {"http", "https"} and parsed.hostname and parsed.port
        valid = valid and not parsed.query and not parsed.fragment and parsed.path in {"", "/"}
        if not valid:
            raise ProbeValidationError
    except ValueError:
        raise ProbeValidationError(f"{label}: provide a complete HTTP(S) trial proxy URL with an explicit port") from None
    return value or ""


async def probe(config: Config, proxies: tuple[str, str] | None, fixture=None) -> dict:
    config.validate()
    if ENDPOINT not in ALLOWED_ENDPOINTS or not ENDPOINT.startswith("https://"):
        raise ProbeValidationError("endpoint must be on the fixed HTTPS allowlist")
    salt = secrets.token_bytes(32)  # Per-run identifiers cannot track an IP across runs.
    began = time.monotonic()
    body_bytes = 0
    outcomes = {"A": [], "B": []}
    lock = asyncio.Lock()
    start_barrier = asyncio.Barrier(2)

    async def consume(chunk: bytes) -> None:
        nonlocal body_bytes
        async with lock:
            body_bytes += len(chunk)
            if body_bytes > config.response_budget:
                raise ProbeValidationError("application response budget exhausted")

    async def session(label: str, proxy: str | None) -> None:
        options = dict(timeout=httpx.Timeout(5), trust_env=False,
                       follow_redirects=False, limits=httpx.Limits(max_connections=1, max_keepalive_connections=0),
                       headers={"Accept-Encoding": "identity", "User-Agent": "ThreadsGo-Proxy-Trial/1.0"})
        if fixture is not None:
            options["transport"] = httpx.MockTransport(lambda request: fixture(label, request))
        else:
            options["proxy"] = proxy
        # Each session reuses its exact URL. New TCP connections challenge sticky
        # retention across sockets rather than only HTTP keep-alive behavior.
        async with httpx.AsyncClient(**options) as client:
            await start_barrier.wait()
            for index in range(config.samples):
                if index:
                    await asyncio.sleep(config.interval)
                started = time.monotonic()
                sample = {"request": index + 1, "success": False, "application_response_bytes": 0}
                outcomes[label].append(sample)
                try:
                    content = bytearray()
                    async with client.stream("GET", ENDPOINT) as response:
                        sample["http_status"] = response.status_code
                        # Read error response bodies too, within the same hard body cap.
                        async for chunk in response.aiter_raw(chunk_size=128):
                            await consume(chunk)
                            sample["application_response_bytes"] += len(chunk)
                            content.extend(chunk)
                            if len(content) >= RESPONSE_CAP:
                                raise ProbeValidationError("response body cap reached")
                        response.raise_for_status()
                    ip = str(ipaddress.ip_address(content.decode("ascii").strip()))
                    sample["ip_id"] = hmac.new(salt, ip.encode(), hashlib.sha256).hexdigest()[:16]
                    sample["success"] = True
                except asyncio.CancelledError:
                    sample["error"] = "runtime_limit"
                    raise
                except Exception as exc:
                    # Do not serialize exception strings: proxy exceptions can contain auth.
                    sample["error"] = type(exc).__name__
                finally:
                    sample["elapsed_ms"] = round((time.monotonic() - started) * 1000)

    timed_out = False
    try:
        await asyncio.wait_for(asyncio.gather(session("A", proxies[0] if proxies else None),
                                              session("B", proxies[1] if proxies else None)), config.max_runtime)
    except TimeoutError:
        timed_out = True
    sessions = {}
    for label, samples in outcomes.items():
        ids = {sample["ip_id"] for sample in samples if sample["success"]}
        complete = len(samples) == config.samples and all(sample["success"] for sample in samples)
        sessions[label] = {"samples": samples, "complete": complete,
                           "ip_stable_in_observation": len(ids) == 1 if complete else None,
                           "observed_distinct_ip_count": len(ids)}
    a_ids = {s["ip_id"] for s in outcomes["A"] if s["success"]}
    b_ids = {s["ip_id"] for s in outcomes["B"] if s["success"]}
    return {"mode": "offline_fixture" if fixture else "live_trial", "endpoint": ENDPOINT,
            "elapsed_seconds": round(time.monotonic() - began, 2), "runtime_limit_reached": timed_out,
            "application_response_bytes": body_bytes, "application_response_budget_bytes": config.response_budget,
            "provider_billed_bytes": None, "provider_budget_enforced_by_probe": False,
            "same_exit_ip_observed": bool(a_ids & b_ids) if a_ids and b_ids else None, "sessions": sessions,
            "limitation": "Small HTTP samples do not prove provider billing, sticky TTL, browser compatibility or Threads reliability."}


async def offline_check() -> dict:
    counts = {"A": 0, "B": 0}

    def fixture(label, request):
        assert str(request.url) == ENDPOINT and request.method == "GET"
        counts[label] += 1
        address = "198.51.100.10" if label == "A" else "198.51.100.20"
        return httpx.Response(200, stream=httpx.ByteStream(address.encode()))

    config = Config(interval=0)
    stable = await probe(config, None, fixture)
    assert all(s["complete"] and s["ip_stable_in_observation"] for s in stable["sessions"].values())
    assert not stable["same_exit_ip_observed"]
    counts.update(A=0, B=0)

    def rotating_fixture(label, request):
        response = fixture(label, request)
        return httpx.Response(200, stream=httpx.ByteStream(b"198.51.100.10")) if label == "B" and counts[label] >= 2 else response

    rotating = await probe(config, None, rotating_fixture)
    assert rotating["sessions"]["B"]["ip_stable_in_observation"] is False
    assert rotating["same_exit_ip_observed"] is True
    def missing_ip_fixture(label, request):
        return fixture(label, request) if label == "A" else httpx.Response(503, stream=httpx.ByteStream(b"unavailable"))

    missing = await probe(config, None, missing_ip_fixture)
    assert missing["same_exit_ip_observed"] is None
    assert missing["sessions"]["B"]["ip_stable_in_observation"] is None
    assert stable["provider_billed_bytes"] is None
    assert stable["application_response_bytes"] == 3 * (len("198.51.100.10") + len("198.51.100.20"))
    return {"offline_check": "passed", "network_used": False,
            "cases": ["two stable independent sessions", "rotation and shared exit detection", "missing IP stays unknown", "body-byte accounting"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline-check", action="store_true")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--trial-only", action="store_true", help="Attest both URLs are authorized trial credentials, not production")
    parser.add_argument("--traffic-budget-bytes", type=int, help="Explicit cap for application response BODY bytes only")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--interval", type=float, default=2)
    parser.add_argument("--max-runtime", type=float, default=45)
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)  # Even a debug-configured embedding must not expose proxy auth.
    try:
        if args.offline_check:
            if args.live or args.trial_only:
                raise ProbeValidationError("offline-check cannot be combined with live flags")
            result = asyncio.run(offline_check())
        else:
            if not (args.live and args.trial_only and args.traffic_budget_bytes is not None):
                raise ProbeValidationError("network requires --live --trial-only and --traffic-budget-bytes")
            config = Config(args.samples, args.interval, args.max_runtime, args.traffic_budget_bytes)
            config.validate()
            proxies = (validate_proxy(os.environ.get("PROXY_TRIAL_URL_A"), "PROXY_TRIAL_URL_A"),
                       validate_proxy(os.environ.get("PROXY_TRIAL_URL_B"), "PROXY_TRIAL_URL_B"))
            if proxies[0] == proxies[1]:
                raise ProbeValidationError("provide two different provider-issued sticky session URLs")
            result = asyncio.run(probe(config, proxies))
        print(json.dumps(result, indent=2))
        return 0 if result.get("offline_check") or all(s["complete"] for s in result["sessions"].values()) else 2
    except (ProbeValidationError, KeyboardInterrupt) as exc:
        # Only local validation messages use ValueError; no proxy transport exception strings are printed.
        print(json.dumps({"error": str(exc) if isinstance(exc, ProbeValidationError) else "interrupted"}))
        return 2
    except Exception as exc:
        print(json.dumps({"error": type(exc).__name__}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

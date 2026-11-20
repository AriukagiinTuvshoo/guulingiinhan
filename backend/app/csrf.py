"""Signed double-submit CSRF tokens for cookie-authenticated browser requests."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime
from urllib.parse import urlsplit

from app.config import Settings

CSRF_COOKIE_NAME = "guulingiinhan_csrf"
CSRF_HEADER_NAME = "X-CSRF-Token"
CSRF_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
_CSRF_DEV_SECRET = secrets.token_bytes(32)


def _secret(settings: Settings) -> bytes:
    if settings.csrf_secret:
        return settings.csrf_secret.encode()
    if settings.app_env.lower() == "production":
        raise RuntimeError("CSRF_SECRET is required")
    return _CSRF_DEV_SECRET


def issue_csrf_token(settings: Settings, now: int | None = None) -> str:
    issued_at = int(datetime.now(UTC).timestamp()) if now is None else now
    nonce = secrets.token_urlsafe(32)
    payload = f"v1.{issued_at}.{nonce}"
    signature = base64.urlsafe_b64encode(
        hmac.new(_secret(settings), payload.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"{payload}.{signature}"


def valid_csrf_token(token: str | None, settings: Settings, now: int | None = None) -> bool:
    if not token or len(token) > 256:
        return False
    parts = token.split(".")
    if len(parts) != 4 or parts[0] != "v1":
        return False
    _, issued_raw, nonce, supplied_signature = parts
    if not issued_raw.isdigit() or not nonce or not supplied_signature:
        return False
    try:
        issued_at = int(issued_raw)
        current_time = int(datetime.now(UTC).timestamp()) if now is None else now
        if issued_at > current_time + 60 or current_time - issued_at > CSRF_TOKEN_MAX_AGE_SECONDS:
            return False
        payload = f"v1.{issued_raw}.{nonce}"
        expected_signature = base64.urlsafe_b64encode(
            hmac.new(_secret(settings), payload.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
    except (OverflowError, ValueError, RuntimeError):
        return False
    return hmac.compare_digest(expected_signature, supplied_signature)


def valid_double_submit(cookie_token: str | None, header_token: str | None, settings: Settings) -> bool:
    return bool(
        cookie_token
        and header_token
        and hmac.compare_digest(cookie_token, header_token)
        and valid_csrf_token(cookie_token, settings)
    )


def _normalized_origin(value: str, *, origin_header: bool) -> str | None:
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme.lower() not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or (origin_header and (parsed.path not in {"", "/"} or parsed.query))
        ):
            return None
        port = parsed.port
        scheme = parsed.scheme.lower()
        hostname = parsed.hostname.lower()
        if ":" in hostname:
            hostname = f"[{hostname}]"
        if port is not None and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
            hostname = f"{hostname}:{port}"
        return f"{scheme}://{hostname}"
    except ValueError:
        return None


def request_origin_allowed(
    origin_header: str | None, referer_header: str | None, allowed_origins: list[str]
) -> bool:
    """Require an allowlisted Origin, or an allowlisted Referer when Origin is absent."""
    source = origin_header if origin_header is not None else referer_header
    if not source or source.strip().lower() == "null":
        return False
    normalized_source = _normalized_origin(source.strip(), origin_header=origin_header is not None)
    if normalized_source is None:
        return False
    allowed = {
        normalized
        for candidate in allowed_origins
        if (normalized := _normalized_origin(candidate.strip(), origin_header=True)) is not None
    }
    return normalized_source in allowed

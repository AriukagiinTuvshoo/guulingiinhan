"""Small JSON logging and request context helpers for the API."""

from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import UTC, datetime

request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)


class JsonLogFormatter(logging.Formatter):
    """Serialize an allowlist of safe fields; never serialize exception text."""

    SAFE_FIELDS = (
        "event", "method", "route", "status_code", "duration_ms", "error_code",
        "error_type", "operation", "photo_id", "memory_id", "family_id", "provider",
        "attempt", "max_attempts", "rate_limit_namespace", "storage_duration_ms",
    )

    def __init__(self, environment: str = "development") -> None:
        super().__init__()
        self.environment = environment

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "service": "guulingiinhan-api",
            "environment": self.environment,
            "event": getattr(record, "event", "application_log"),
            "logger": record.name,
        }
        request_id = getattr(record, "request_id", None) or request_id_context.get()
        if request_id:
            payload["request_id"] = request_id
        for name in self.SAFE_FIELDS:
            value = getattr(record, name, None)
            if value is not None:
                payload[name] = value
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging(level: str, environment: str) -> None:
    """Install one JSON handler for app logs, leaving third-party levels alone."""
    root = logging.getLogger()
    root.setLevel(level.upper())
    for handler in root.handlers:
        handler.setFormatter(JsonLogFormatter(environment))
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonLogFormatter(environment))
        root.addHandler(handler)


def error_classification(error: Exception) -> tuple[str, int]:
    """Return a stable public error code/status without exposing error details."""
    from sqlalchemy.exc import SQLAlchemyError

    if isinstance(error, SQLAlchemyError):
        return "DATABASE_UNAVAILABLE", 503
    return "INTERNAL_ERROR", 500

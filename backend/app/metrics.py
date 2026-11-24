"""Bounded, process-local operational metrics; no request or user data is stored."""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from collections import defaultdict, deque

from app.config import get_settings

logger = logging.getLogger("guulingiinhan.metrics")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _send_alert(url: str) -> None:
    """Best-effort, no secrets or request data in payload or logs."""
    body = json.dumps({"service": "guulingiinhan-api", "event": "http_5xx_spike", "window_seconds": 60}).encode()
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=3):
            logger.info("Alert delivered", extra={"event": "alert_dispatched"})
    except Exception as error:  # noqa: BLE001 - alerting cannot interrupt requests
        logger.warning("Alert delivery failed", extra={"event": "alert_dispatch_failed", "error_type": type(error).__name__})


class MetricsRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._requests: dict[tuple[str, str, str], int] = defaultdict(int)
        self._durations: dict[tuple[str, str], float] = defaultdict(float)
        self._started = time.monotonic()
        self._errors: deque[float] = deque(maxlen=1000)
        self._last_alert: float | None = None

    def record(self, method: str, route: str, status: int, duration: float) -> None:
        # Only framework route templates (or the fixed 'unmatched') are accepted
        # from middleware, never raw paths, query strings or request identifiers.
        key = (method if method in {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} else "OTHER", route, f"{status // 100}xx")
        now = time.monotonic()
        alert = False
        with self._lock:
            self._requests[key] += 1
            self._durations[key[:2]] += max(0, duration)
            if status >= 500:
                self._errors.append(now)
                while self._errors and self._errors[0] < now - 60:
                    self._errors.popleft()
                if len(self._errors) >= 10 and (self._last_alert is None or now - self._last_alert >= 300):
                    self._last_alert = now
                    alert = True
        if alert:
            logger.warning("HTTP 5xx spike detected", extra={"event": "http_5xx_spike"})
            webhook = get_settings().alert_webhook_url
            if webhook:
                threading.Thread(target=_send_alert, args=(webhook,), daemon=True).start()

    @staticmethod
    def _label(value: str) -> str:
        return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")

    def render(self) -> str:
        with self._lock:
            requests = sorted(self._requests.items())
            durations = sorted(self._durations.items())
            uptime = time.monotonic() - self._started
        lines = ["# HELP guulin_http_requests_total HTTP requests by route and status class.",
                 "# TYPE guulin_http_requests_total counter"]
        for (method, route, status_class), count in requests:
            lines.append(f'guulin_http_requests_total{{method="{method}",route="{self._label(route)}",status_class="{status_class}"}} {count}')
        lines.extend(["# HELP guulin_http_request_duration_seconds_total Total request duration.",
                      "# TYPE guulin_http_request_duration_seconds_total counter"])
        for (method, route), seconds in durations:
            lines.append(f'guulin_http_request_duration_seconds_total{{method="{method}",route="{self._label(route)}"}} {seconds:.6f}')
        lines.extend(["# HELP guulin_process_uptime_seconds Process uptime.",
                      "# TYPE guulin_process_uptime_seconds gauge",
                      f"guulin_process_uptime_seconds {uptime:.3f}"])
        return "\n".join(lines) + "\n"


metrics_registry = MetricsRegistry()

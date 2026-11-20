import logging

from fastapi.testclient import TestClient

from app.main import app, settings
from app.metrics import MetricsRegistry


def test_metrics_require_operator_token_and_do_not_include_raw_unmatched_path(monkeypatch):
    monkeypatch.setattr(settings, "metrics_token", "m" * 40)
    client = TestClient(app)
    assert client.get("/metrics").status_code == 404
    assert client.get("/metrics", headers={"Authorization": "Bearer incorrect"}).status_code == 404
    client.get("/private-path-that-must-not-appear?email=secret@example.com")
    response = client.get("/metrics", headers={"Authorization": "Bearer " + "m" * 40})
    assert response.status_code == 200
    assert "guulin_http_requests_total" in response.text
    assert "private-path-that-must-not-appear" not in response.text
    assert "secret@example.com" not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_ready_alias_checks_database():
    response = TestClient(app).get("/ready")
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


def test_webhook_requires_https():
    import pytest
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError, match="ALERT_WEBHOOK_URL"):
        Settings(alert_webhook_url="http://example.com/hook")


def test_optional_webhook_dispatch_is_gated(monkeypatch):
    from app import metrics
    from app.config import Settings

    calls = []
    class FakeThread:
        def __init__(self, *, target, args, daemon):
            calls.append((target, args, daemon))
        def start(self):
            pass

    monkeypatch.setattr(metrics.threading, "Thread", FakeThread)
    monkeypatch.setattr(metrics, "get_settings", lambda: Settings(alert_webhook_url="https://alerts.example/hook"))
    registry = MetricsRegistry()
    for _ in range(12):
        registry.record("GET", "/health", 503, 0.1)
    assert len(calls) == 1
    assert calls[0][1] == ("https://alerts.example/hook",)


def test_5xx_alert_is_rate_limited(caplog):
    registry = MetricsRegistry()
    caplog.set_level(logging.WARNING, logger="guulingiinhan.metrics")
    for _ in range(12):
        registry.record("GET", "/health", 503, 0.1)
    alerts = [r for r in caplog.records if getattr(r, "event", None) == "http_5xx_spike"]
    assert len(alerts) == 1

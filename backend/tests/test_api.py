import json
import logging
import time
from uuid import UUID

from conftest import register_verified
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.main import app
from app.models import AuditLog
from app.observability import JsonLogFormatter


def test_root_is_public_backend_entrypoint():
    response = TestClient(app).get("/")
    assert response.status_code == 200
    assert response.json() == {"service": "guulingiinhan-api", "status": "ok"}
    assert response.headers["x-request-id"]


def test_health_is_liveness_and_sets_request_id():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "guulingiinhan-api"}
    assert response.headers["x-request-id"]


def test_readiness_checks_database():
    response = TestClient(app).get("/health/ready")
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


def test_request_id_is_server_generated_and_completed_request_is_logged(caplog):
    caplog.set_level(logging.INFO)
    response = TestClient(app).get("/health", headers={"X-Request-ID": "caller-value"})
    request_id = response.headers["x-request-id"]
    assert request_id != "caller-value"
    record = next(record for record in caplog.records if getattr(record, "event", None) == "request_completed")
    payload = json.loads(JsonLogFormatter("test").format(record))
    assert payload["request_id"] == request_id
    assert payload["route"] == "/health"
    assert payload["status_code"] == 200
    assert isinstance(payload["duration_ms"], (int, float))


def test_request_ids_ignore_valid_and_malformed_client_values():
    client = TestClient(app)
    first = client.get("/health").headers["x-request-id"]
    for supplied in ("123e4567-e89b-12d3-a456-426614174000", "bad/id", "x" * 2000):
        response = client.get("/health", headers={"X-Request-ID": supplied})
        request_id = response.headers["x-request-id"]
        assert request_id != supplied
        assert len(request_id) == 36
    assert first != response.headers["x-request-id"]


def test_readiness_failure_is_safe_and_correlated(monkeypatch, caplog):
    def unavailable():
        raise SQLAlchemyError("postgresql://user:password@private-host/db")

    monkeypatch.setattr("app.main.engine.connect", unavailable)
    caplog.set_level(logging.ERROR)
    response = TestClient(app).get("/health/ready")
    assert response.status_code == 503
    assert response.json()["error_code"] == "DATABASE_UNAVAILABLE"
    assert response.json()["request_id"] == response.headers["x-request-id"]
    assert "private-host" not in response.text
    assert "password" not in caplog.text


def test_unexpected_database_error_returns_safe_classified_response():
    def database_failure():
        raise SQLAlchemyError("private database detail")

    app.add_api_route("/__test/database-error", database_failure, methods=["GET"])
    try:
        response = TestClient(app, raise_server_exceptions=False).get("/__test/database-error")
    finally:
        app.router.routes = [
            route for route in app.router.routes
            if getattr(route, "path", None) != "/__test/database-error"
        ]
    assert response.status_code == 503
    assert response.json()["error_code"] == "DATABASE_UNAVAILABLE"
    assert response.json()["request_id"] == response.headers["x-request-id"]
    assert "private database detail" not in response.text


def test_validation_response_does_not_echo_submitted_credentials():
    response = TestClient(app).post(
        "/api/v1/auth/register", json={"email": "not-an-email", "password": "private-secret"}
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "VALIDATION_ERROR"
    assert response.json()["request_id"] == response.headers["x-request-id"]
    assert "private-secret" not in response.text


def test_slow_request_emits_warning_event(monkeypatch, caplog):
    from app import main

    original_threshold = main.settings.slow_request_threshold_ms
    main.settings.slow_request_threshold_ms = 1

    def deliberately_slow():
        time.sleep(0.02)
        return {"status": "ok"}

    app.add_api_route("/__test/slow", deliberately_slow, methods=["GET"])
    try:
        caplog.set_level(logging.WARNING)
        response = TestClient(app).get("/__test/slow")
    finally:
        main.settings.slow_request_threshold_ms = original_threshold
        app.router.routes = [
            route for route in app.router.routes if getattr(route, "path", None) != "/__test/slow"
        ]
    assert response.status_code == 200
    assert any(getattr(record, "event", None) == "slow_request" for record in caplog.records)


def test_family_audit_log_carries_request_correlation_id(client, database):
    register_verified(client, "audit-correlation@example.com")
    response = client.post("/api/v1/families", json={"name": "Correlation"})
    assert response.status_code == 201
    request_id = response.headers["x-request-id"]
    with database() as db:
        audit = db.scalar(select(AuditLog).where(AuditLog.action == "family.created"))
        assert audit is not None
        assert audit.request_id == request_id
        UUID(audit.request_id)

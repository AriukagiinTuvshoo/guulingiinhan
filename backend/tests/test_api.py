from fastapi.testclient import TestClient

from app.main import app


def test_health_is_liveness_and_sets_request_id():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "guulingiinhan-api"}
    assert response.headers["x-request-id"]


def test_readiness_checks_database():
    response = TestClient(app).get("/health/ready")
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


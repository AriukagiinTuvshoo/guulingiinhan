from conftest import register_verified
from sqlalchemy import func, select
from test_config import staging_settings

from app import auth, email, sms
from app import main as main_module
from app.email import get_email_provider
from app.models import PasswordResetToken, PhoneOtpChallenge, User


def test_staging_verified_login_and_disabled_provider_routes(client, database, monkeypatch):
    email_address = "staging-verified@example.com"
    password = "strong-passphrase-123"
    assert register_verified(client, email_address, password).status_code == 201
    assert client.post("/api/v1/auth/logout").status_code == 204

    settings = staging_settings()
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    monkeypatch.setattr(email, "get_settings", lambda: settings)
    monkeypatch.setattr(sms, "get_settings", lambda: settings)
    monkeypatch.setattr(main_module, "settings", settings)
    monkeypatch.setattr(main_module, "engine", database.kw["bind"])
    main_module.app.dependency_overrides.pop(get_email_provider)
    client.base_url = "https://testserver"

    assert client.get("/health").status_code == 200
    assert client.get("/health/ready").json()["database"] == "ok"
    assert client.get("/api/v1/auth/google/config").json() == {"enabled": False}
    assert client.get("/api/v1/auth/email/config").json() == {"enabled": False}
    assert client.get("/api/v1/auth/phone/config").json() == {"enabled": False}

    login = client.post(
        "/api/v1/auth/login",
        json={"email": email_address, "password": password},
    )
    assert login.status_code == 200
    cookie = login.headers["set-cookie"].lower()
    assert "secure" in cookie and "httponly" in cookie and "samesite=none" in cookie
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.get("/api/v1/families").status_code == 200

    for route, body in (
        ("/api/v1/auth/register", {"email": "new@example.com", "password": password}),
        ("/api/v1/auth/email/verification/request", {"email": email_address}),
        ("/api/v1/auth/password-reset/request", {"email": email_address}),
        ("/api/v1/auth/phone/login/request", {"phone": "+819012345678"}),
        ("/api/v1/auth/phone/login/verify", {
            "phone": "+819012345678",
            "challenge_id": "00000000-0000-4000-8000-000000000001",
            "code": "123456",
        }),
    ):
        response = client.post(route, json=body)
        assert response.status_code == 503
        assert response.json()["error_code"] == "SERVICE_UNAVAILABLE"
        assert "боломжгүй" in response.json()["detail"]

    with database() as db:
        assert db.scalar(select(func.count()).select_from(PhoneOtpChallenge)) == 0
        assert db.scalar(select(func.count()).select_from(PasswordResetToken)) == 0
        assert db.scalar(select(func.count()).select_from(User).where(User.email == "new@example.com")) == 0

    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401

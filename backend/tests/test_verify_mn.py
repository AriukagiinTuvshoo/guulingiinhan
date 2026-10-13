from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from conftest import register_verified
from sqlalchemy import select

from app.main import app
from app.models import LoginIdentity, LoginThrottle, PhoneOtpChallenge, UserSession
from app.verify_mn import (
    ProviderSession,
    ProviderStatus,
    VerifyMNProvider,
    get_verification_provider,
)

PASSWORD = "strong-passphrase-123"


class FakeVerification:
    def __init__(self):
        self.sessions = {}
        self.states = {}
        self.calls = 0

    def create(self, phone, text):
        sid = uuid4()
        self.sessions[str(sid)] = (phone, text)
        self.states[str(sid)] = "PENDING"
        return ProviderSession(sessionId=sid, phone=phone[4:], shortcode="144773", text=text,
            displayInstruction="Send the displayed SMS from your phone.",
            expiresAt=datetime.now(UTC) + timedelta(minutes=5))

    def status(self, session_id):
        self.calls += 1
        return ProviderStatus(sessionId=UUID(session_id), sessionStatus=self.states[session_id],
            verifiedAt=datetime.now(UTC) - timedelta(seconds=1),
            expiresAt=datetime.now(UTC) + timedelta(minutes=5))


@pytest.fixture
def provider(client):
    value = FakeVerification()
    app.dependency_overrides[get_verification_provider] = lambda: value
    return value


def session_body(output):
    return {"challenge_id": output["challenge_id"], "challenge_token": output["challenge_token"]}


def verified(provider, database, output):
    with database() as db:
        row = db.get(PhoneOtpChallenge, UUID(output["challenge_id"]))
        provider.states[row.provider_session_id] = "VERIFIED"
        row.provider_checked_at = None
        db.commit()


def start(client, phone="99112233"):
    result = client.post("/api/v1/auth/me/phone/verification/request",
        json={"phone": phone, "current_password": PASSWORD})
    assert result.status_code == 202, result.text
    return result.json()


def test_phone_password_registration_login_does_not_call_sms(client, database, provider):
    result = client.post("/api/v1/auth/register/phone", json={
        "phone": "99112233", "password": PASSWORD, "display_name": "Local test account",
    })
    assert result.status_code == 201
    assert client.get("/api/v1/auth/me").status_code == 401
    login = client.post("/api/v1/auth/login", json={"identifier": "99112233", "password": PASSWORD})
    assert login.status_code == 200
    assert not provider.sessions
    with database() as db:
        identity = db.scalar(select(LoginIdentity).where(LoginIdentity.provider == "phone"))
        assert identity.verified_at is None
        assert not db.scalar(select(PhoneOtpChallenge.id))
    assert client.post("/api/v1/auth/login", json={"identifier": "99112233", "password": "wrong"}).status_code == 401


def test_password_spray_across_identifiers_hits_shared_ip_limit(client, database, provider):
    from app.auth import _otp_rate_key
    with database() as db:
        db.add(LoginThrottle(key_hash=_otp_rate_key("password-login-ip", "unknown"),
                            window_started=datetime.now(UTC), attempts=60))
        db.commit()
    result = client.post("/api/v1/auth/login", json={
        "identifier": "unrelated@example.com", "password": "wrong-passphrase",
    })
    assert result.status_code == 429
    assert not provider.sessions


def test_forwarded_ip_is_trusted_only_for_configured_private_ingress(monkeypatch):
    from fastapi import Request

    from app import auth
    from app.config import Settings
    request = Request({"type": "http", "headers": [(b"cf-connecting-ip", b"203.0.113.7")],
                       "client": ("127.0.0.1", 1234)})
    monkeypatch.setattr(auth, "get_settings", lambda: Settings(trust_cloudflare_proxy_ip=False))
    assert auth._normalized_ip(request) == "127.0.0.1"
    monkeypatch.setattr(auth, "get_settings", lambda: Settings(trust_cloudflare_proxy_ip=True))
    assert auth._normalized_ip(request) == "203.0.113.7"


def test_pending_wrong_capability_verified_reuse_and_no_extra_sms(client, database, provider):
    register_verified(client, "verify@example.com")
    output = start(client)
    assert "provider_session_id" not in output
    assert output["sms_uri"].startswith("sms:144773?body=")
    route = "/api/v1/auth/me/phone/verification/confirm"
    bad = session_body(output) | {"challenge_token": "X" * 43}
    assert client.post(route, json=bad).status_code == 400
    assert provider.calls == 0
    assert client.post(route, json=session_body(output)).json() == {"status": "pending"}
    assert client.post(route, json=session_body(output)).status_code == 429
    verified(provider, database, output)
    assert client.post(route, json=session_body(output)).json() == {"status": "verified"}
    assert client.post(route, json=session_body(output)).json() == {"status": "expired"}
    assert client.post("/api/v1/auth/me/phone/verification/request", json={
        "phone": "99112233", "current_password": PASSWORD}).status_code == 409
    assert len(provider.sessions) == 1


def test_expiry_and_cross_account_capability_denied(client, database, provider):
    register_verified(client, "verify-a@example.com")
    output = start(client)
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/auth/me/phone/verification/confirm", json=session_body(output)).status_code == 401
    register_verified(client, "verify-b@example.com")
    route = "/api/v1/auth/me/phone/verification/confirm"
    assert client.post(route, json=session_body(output)).status_code == 400
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={"email": "verify-a@example.com", "password": PASSWORD})
    with database() as db:
        row = db.get(PhoneOtpChallenge, UUID(output["challenge_id"]))
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert client.post(route, json=session_body(output)).json() == {"status": "expired"}
    assert provider.calls == 0


def test_phone_change_old_identifier_stays_until_new_is_verified(client, database, provider):
    register_verified(client, "change@example.com")
    first = start(client)
    verified(provider, database, first)
    route = "/api/v1/auth/me/phone/verification/confirm"
    assert client.post(route, json=session_body(first)).status_code == 200
    second = start(client, "88112233")
    assert client.post("/api/v1/auth/login", json={"identifier": "99112233", "password": PASSWORD}).status_code == 200
    assert client.post("/api/v1/auth/login", json={"identifier": "88112233", "password": PASSWORD}).status_code == 401
    verified(provider, database, second)
    assert client.post(route, json=session_body(second)).json() == {"status": "verified"}
    assert client.post("/api/v1/auth/login", json={"identifier": "99112233", "password": PASSWORD}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"identifier": "88112233", "password": PASSWORD}).status_code == 200


def test_phone_reset_revokes_sessions_is_single_use_and_unknown_is_generic(client, database, provider):
    register_verified(client, "recover@example.com")
    first = start(client)
    verified(provider, database, first)
    client.post("/api/v1/auth/me/phone/verification/confirm", json=session_body(first))
    known = client.post("/api/v1/auth/password-reset/phone/verification/request", json={"phone": "99112233"})
    unknown = client.post("/api/v1/auth/password-reset/phone/verification/request", json={"phone": "77112233"})
    assert known.status_code == unknown.status_code == 202
    assert set(known.json()) == set(unknown.json())
    reset = known.json()
    verified(provider, database, reset)
    body = session_body(reset) | {"new_password": "new-strong-passphrase-456"}
    route = "/api/v1/auth/password-reset/phone/verification/confirm"
    assert client.post(route, json=body).status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.post(route, json=body).status_code == 400
    assert client.post("/api/v1/auth/login", json={"identifier": "99112233", "password": body["new_password"]}).status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": "recover@example.com", "password": body["new_password"]}).status_code == 200
    unknown_reset = unknown.json()
    verified(provider, database, unknown_reset)
    assert client.post(route, json=session_body(unknown_reset) | {"new_password": PASSWORD}).status_code == 400


def test_reauthentication_limits_and_password_change(client, database, provider):
    register_verified(client, "reauth@example.com")
    assert client.post("/api/v1/auth/me/phone/verification/request", json={
        "phone": "99112233", "current_password": "wrong"}).status_code == 401
    assert not provider.sessions
    assert client.post("/api/v1/auth/me/password", json={
        "current_password": PASSWORD, "new_password": "new-password-123"}).status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401
    with database() as db:
        assert not db.scalar(select(UserSession.id))
    assert client.post("/api/v1/auth/login", json={"email": "reauth@example.com", "password": "new-password-123"}).status_code == 200


@pytest.mark.parametrize("status", [401, 409, 500])
def test_provider_errors_do_not_leak_credentials_or_response(monkeypatch, status):
    class Client:
        def __init__(self, **kwargs):
            assert kwargs["follow_redirects"] is False
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def post(self, url, **kwargs):
            assert url == "https://api.verify.mn/sessions"
            assert kwargs["json"] == {"phone": "99112233", "text": "123456"}
            return httpx.Response(status, request=httpx.Request("POST", url), text="private-provider-detail")
    monkeypatch.setattr(httpx, "Client", Client)
    with pytest.raises(Exception) as caught:
        VerifyMNProvider("private-test-key").create("+97699112233", "123456")
    assert caught.value.status_code == 503
    assert "private" not in str(caught.value)

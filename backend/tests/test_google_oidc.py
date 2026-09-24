from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import func, select

from app import auth
from app.config import get_settings
from app.models import LoginIdentity, Person, User


class FakeGoogle:
    def __init__(self, email="google@example.com", subject="google-subject"):
        self.email = email
        self.subject = subject

    def authorization_url(self, state, nonce):
        return "https://accounts.google.com/authorize?" + f"state={state}&nonce={nonce}"

    def exchange(self, code):
        assert code == "test-code"
        return "fake-id-token"

    def verify(self, token, expected_nonce):
        assert token == "fake-id-token"
        assert expected_nonce
        return {
            "iss": "https://accounts.google.com",
            "sub": self.subject,
            "email": self.email,
            "email_verified": True,
            "name": "Google User",
        }


@pytest.fixture
def google_enabled(monkeypatch):
    monkeypatch.setenv("GOOGLE_OIDC_ENABLED", "true")
    monkeypatch.setenv("GOOGLE_OIDC_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_OIDC_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_OIDC_REDIRECT_URI", "http://localhost:8000/api/v1/auth/google/callback")
    monkeypatch.setenv("GOOGLE_OIDC_STATE_SECRET", "test-state-secret-with-enough-randomness")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def callback(client, start_response):
    query = parse_qs(urlparse(start_response.headers["location"]).query)
    return client.get(
        f"/api/v1/auth/google/callback?code=test-code&state={query['state'][0]}",
        follow_redirects=False,
    )


def test_google_oidc_creates_one_user_and_session_without_person(client, database, monkeypatch, google_enabled):
    monkeypatch.setattr(auth, "_google_provider", lambda: FakeGoogle())
    start = client.get("/api/v1/auth/google/start", follow_redirects=False)
    assert start.status_code == 303
    assert "guulingiinhan_google_state" in start.cookies

    result = callback(client, start)
    assert result.status_code == 303
    assert "google=success" in result.headers["location"]
    assert client.get("/api/v1/auth/me").status_code == 200
    with database() as db:
        assert db.scalar(select(func.count(User.id))) == 1
        assert db.scalar(select(func.count(LoginIdentity.id)).where(LoginIdentity.provider == "google")) == 1
        assert db.scalar(select(func.count(Person.id))) == 0


def test_google_state_is_single_use(client, monkeypatch, google_enabled):
    monkeypatch.setattr(auth, "_google_provider", lambda: FakeGoogle())
    start = client.get("/api/v1/auth/google/start", follow_redirects=False)
    first = callback(client, start)
    second = callback(client, start)
    assert "google=success" in first.headers["location"]
    assert "google=failed" in second.headers["location"]


def test_google_email_does_not_auto_link_existing_account(client, database, monkeypatch, google_enabled):
    monkeypatch.setattr(auth, "_google_provider", lambda: FakeGoogle(email="person@example.com"))
    registered = client.post(
        "/api/v1/auth/register",
        json={"email": "person@example.com", "password": "safe-password-123"},
    )
    assert registered.status_code == 201
    client.post("/api/v1/auth/logout")
    start = client.get("/api/v1/auth/google/start", follow_redirects=False)
    result = callback(client, start)
    assert "google=failed" in result.headers["location"]
    with database() as db:
        assert db.scalar(select(func.count(User.id))) == 1
        assert db.scalar(select(func.count(LoginIdentity.id)).where(LoginIdentity.provider == "google")) == 0


def test_google_link_requires_existing_session(client, monkeypatch, google_enabled):
    monkeypatch.setattr(auth, "_google_provider", lambda: FakeGoogle())
    response = client.post("/api/v1/auth/me/google/start", follow_redirects=False)
    assert response.status_code == 401


def test_google_identity_can_be_linked_to_authenticated_account(client, database, monkeypatch, google_enabled):
    monkeypatch.setattr(auth, "_google_provider", lambda: FakeGoogle())
    registered = client.post(
        "/api/v1/auth/register",
        json={"email": "existing@example.com", "password": "safe-password-123"},
    )
    assert registered.status_code == 201
    start = client.post("/api/v1/auth/me/google/start", follow_redirects=False)
    assert start.status_code == 303
    result = callback(client, start)
    assert "google=success" in result.headers["location"]
    identities = client.get("/api/v1/auth/me/identities").json()
    assert [item["provider"] for item in identities] == ["email", "google"]
    with database() as db:
        assert db.scalar(select(func.count(User.id))) == 1
        assert db.scalar(select(func.count(LoginIdentity.id)).where(LoginIdentity.provider == "google")) == 1

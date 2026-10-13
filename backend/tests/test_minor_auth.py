from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import pytest
from conftest import register_verified
from sqlalchemy import select

from app import auth
from app.config import get_settings
from app.main import app
from app.models import LoginIdentity, Person, UserPersonLink
from app.sms import get_sms_provider

PASSWORD = "strong-passphrase-123"


class CapturingSms:
    def __init__(self):
        self.messages: list[tuple[str, str, str]] = []

    def send_otp(self, phone: str, code: str, purpose: str) -> None:
        self.messages.append((phone, code, purpose))


class FakeGoogle:
    def __init__(self, email="minor-google@example.com", subject="minor-google-subject"):
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
    monkeypatch.setenv(
        "GOOGLE_OIDC_REDIRECT_URI",
        "http://localhost:8000/api/v1/auth/google/callback",
    )
    monkeypatch.setenv("GOOGLE_OIDC_STATE_SECRET", "test-state-secret-with-enough-randomness")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def create_minor(client, *, birth_date="2015-06-12"):
    family = client.post("/api/v1/families", json={"name": "Minor Login Test Family"}).json()
    person = client.post(
        f"/api/v1/families/{family['id']}/persons",
        json={"first_name": "Болд", "birth_date": birth_date},
    ).json()
    return family, person


def link_user_to_person(database, user_id, person_id):
    with database() as db:
        db.add(
            UserPersonLink(
                user_id=UUID(user_id),
                person_id=UUID(person_id),
                linked_by=UUID(user_id),
            )
        )
        db.commit()


def google_callback(client, start_response):
    query = parse_qs(urlparse(start_response.headers["location"]).query)
    return client.get(
        f"/api/v1/auth/google/callback?code=test-code&state={query['state'][0]}",
        follow_redirects=False,
    )


def test_minor_email_login_is_rejected_but_adult_login_still_succeeds(client, database):
    register_verified(client, "adult-login@example.com", PASSWORD)
    client.post("/api/v1/auth/logout")
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "adult-login@example.com", "password": PASSWORD},
        ).status_code
        == 200
    )
    user_id = client.get("/api/v1/auth/me").json()["id"]
    family, person = create_minor(client)
    link_user_to_person(database, user_id, person["id"])
    # A session created before this correction must also fail closed.
    assert client.get("/api/v1/auth/me").status_code == 401
    client.post("/api/v1/auth/logout")

    rejected = client.post(
        "/api/v1/auth/login",
        json={"email": "adult-login@example.com", "password": PASSWORD},
    )
    assert rejected.status_code == 401
    assert client.get("/api/v1/auth/me").status_code == 401
    with database() as db:
        assert db.scalar(
            select(UserPersonLink).where(UserPersonLink.user_id == UUID(user_id))
        ) is not None
        assert db.get(Person, UUID(person["id"])).birth_date is not None
    assert family["id"]


def test_linked_adult_login_succeeds(client, database):
    register_verified(client, "linked-adult@example.com", PASSWORD)
    user_id = client.get("/api/v1/auth/me").json()["id"]
    _, person = create_minor(client, birth_date="2000-01-01")
    link_user_to_person(database, user_id, person["id"])
    client.post("/api/v1/auth/logout")

    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "linked-adult@example.com", "password": PASSWORD},
        ).status_code
        == 200
    )


def test_linked_person_with_unknown_birth_date_is_not_assumed_minor(client, database):
    register_verified(client, "unknown-birth@example.com", PASSWORD)
    user_id = client.get("/api/v1/auth/me").json()["id"]
    _, person = create_minor(client, birth_date=None)
    link_user_to_person(database, user_id, person["id"])
    client.post("/api/v1/auth/logout")

    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "unknown-birth@example.com", "password": PASSWORD},
        ).status_code
        == 200
    )


def test_minor_person_cannot_be_linked_to_an_account(client, database):
    register_verified(client, "link-minor@example.com", PASSWORD)
    user_id = client.get("/api/v1/auth/me").json()["id"]
    family, person = create_minor(client)

    response = client.post(
        f"/api/v1/families/{family['id']}/persons/{person['id']}/link-me"
    )
    assert response.status_code == 403
    with database() as db:
        assert db.scalar(
            select(UserPersonLink).where(UserPersonLink.user_id == UUID(user_id))
        ) is None


def test_minor_phone_otp_login_is_rejected(client, database):
    sms = CapturingSms()
    app.dependency_overrides[get_sms_provider] = lambda: sms
    try:
        created = client.post(
            "/api/v1/auth/phone/register/request",
            json={"phone": "+97699112255", "display_name": "Minor Phone"},
        )
        assert created.status_code == 202
        verified = client.post(
            "/api/v1/auth/phone/register/verify",
            json={
                "phone": "+97699112255",
                "challenge_id": created.json()["challenge_id"],
                "code": sms.messages[-1][1],
                "display_name": "Minor Phone",
            },
        )
        assert verified.status_code == 200
        user_id = verified.json()["id"]
        _, person = create_minor(client)
        link_user_to_person(database, user_id, person["id"])
        client.post("/api/v1/auth/logout")

        request = client.post(
            "/api/v1/auth/phone/login/request",
            json={"phone": "+97699112255"},
        )
        assert request.status_code == 202
        rejected = client.post(
            "/api/v1/auth/phone/login/verify",
            json={
                "phone": "+97699112255",
                "challenge_id": request.json()["challenge_id"],
                "code": sms.messages[-1][1],
            },
        )
        assert rejected.status_code == 401
        assert client.get("/api/v1/auth/me").status_code == 401
    finally:
        app.dependency_overrides.pop(get_sms_provider, None)


def test_minor_google_oidc_login_is_rejected(client, database, monkeypatch, google_enabled):
    register_verified(client, "minor-google-login@example.com", PASSWORD)
    user_id = client.get("/api/v1/auth/me").json()["id"]
    _, person = create_minor(client)
    link_user_to_person(database, user_id, person["id"])
    client.post("/api/v1/auth/logout")

    with database() as db:
        db.add(
            LoginIdentity(
                user_id=UUID(user_id),
                provider="google",
                issuer="https://accounts.google.com",
                subject="minor-google-subject",
                display_identifier="minor-google@example.com",
                verified_at=datetime.now(UTC),
            )
        )
        db.commit()

    monkeypatch.setattr(auth, "_google_provider", lambda: FakeGoogle())
    start = client.get("/api/v1/auth/google/start", follow_redirects=False)
    assert start.status_code == 303
    result = google_callback(client, start)
    assert "google=failed" in result.headers["location"]
    assert client.get("/api/v1/auth/me").status_code == 401


def test_minor_google_oidc_link_is_rejected(client, database, monkeypatch, google_enabled):
    register_verified(client, "minor-google-link@example.com", PASSWORD)
    user_id = client.get("/api/v1/auth/me").json()["id"]
    monkeypatch.setattr(auth, "_google_provider", lambda: FakeGoogle(subject="minor-google-link"))
    start = client.post("/api/v1/auth/me/google/start", follow_redirects=False)
    assert start.status_code == 303
    _, person = create_minor(client)
    link_user_to_person(database, user_id, person["id"])
    assert client.post("/api/v1/auth/me/google/start", follow_redirects=False).status_code == 401
    # An already-issued OAuth state is also rejected after the minor correction.
    result = google_callback(client, start)
    assert "google=failed" in result.headers["location"]

    with database() as db:
        assert db.scalar(
            select(LoginIdentity).where(
                LoginIdentity.user_id == UUID(user_id),
                LoginIdentity.provider == "google",
            )
        ) is None


def test_minor_person_record_remains_without_an_account_link(client, database):
    register_verified(client, "minor-record@example.com", PASSWORD)
    family, person = create_minor(client)
    client.post("/api/v1/auth/logout")

    with database() as db:
        record = db.get(Person, UUID(person["id"]))
        assert record is not None
        assert record.birth_date is not None
        assert db.scalar(
            select(UserPersonLink).where(UserPersonLink.person_id == UUID(person["id"]))
        ) is None

    assert client.post(
        "/api/v1/auth/login",
        json={"email": "minor-record@example.com", "password": PASSWORD},
    ).status_code == 200
    assert family["id"]

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from app.auth import get_sms_provider
from app.main import app
from app.models import AuditLog, LoginIdentity, PhoneOtpChallenge, UserSession


class CapturingSms:
    def __init__(self):
        self.messages: list[tuple[str, str, str]] = []

    def send_otp(self, phone: str, code: str, purpose: str) -> None:
        self.messages.append((phone, code, purpose))


def test_phone_link_is_verified_once_and_secret_is_not_in_api_or_database(client, database):
    sms = CapturingSms()
    app.dependency_overrides[get_sms_provider] = lambda: sms
    try:
        assert (
            client.post(
                "/api/v1/auth/register",
                json={"email": "owner@example.com", "password": "strong-passphrase-123"},
            ).status_code
            == 201
        )
        response = client.post("/api/v1/auth/me/phone/request", json={"phone": "+819012345678"})
        assert response.status_code == 202
        assert set(response.json()) == {"challenge_id", "expires_in", "resend_after"}
        code = sms.messages[0][1]
        assert len(code) == 6
        assert code not in response.text
        with database() as db:
            challenge = db.get(PhoneOtpChallenge, UUID(response.json()["challenge_id"]))
            assert challenge is not None
            assert challenge.code_hash != code
            assert len(challenge.code_hash) == 64

        body = {
            "phone": "+819012345678",
            "challenge_id": response.json()["challenge_id"],
            "code": code,
        }
        linked = client.post("/api/v1/auth/me/phone/verify", json=body)
        assert linked.status_code == 200
        assert linked.json()["provider"] == "phone"
        assert linked.json()["verified"] is True
        assert client.post("/api/v1/auth/me/phone/verify", json=body).status_code == 400
        with database() as db:
            challenge = db.get(PhoneOtpChallenge, UUID(body["challenge_id"]))
            assert challenge.status == "consumed"
            assert db.scalar(select(LoginIdentity).where(LoginIdentity.provider == "phone"))
            actions = set(db.scalars(select(AuditLog.action)).all())
            assert {"phone.otp_requested", "phone.otp_verified", "phone.identity_linked"} <= actions
    finally:
        app.dependency_overrides.pop(get_sms_provider, None)


def test_wrong_code_locks_challenge_after_five_attempts(client, database):
    sms = CapturingSms()
    app.dependency_overrides[get_sms_provider] = lambda: sms
    try:
        client.post(
            "/api/v1/auth/register",
            json={"email": "owner@example.com", "password": "strong-passphrase-123"},
        )
        requested = client.post("/api/v1/auth/me/phone/request", json={"phone": "+819012345678"})
        challenge_id = requested.json()["challenge_id"]
        body = {"phone": "+819012345678", "challenge_id": challenge_id, "code": "000000"}
        for _ in range(5):
            assert client.post("/api/v1/auth/me/phone/verify", json=body).status_code == 400
        with database() as db:
            challenge = db.get(PhoneOtpChallenge, UUID(challenge_id))
            assert challenge.attempt_count == 5
            assert challenge.status == "locked"
    finally:
        app.dependency_overrides.pop(get_sms_provider, None)


def test_phone_link_request_has_resend_cooldown(client):
    sms = CapturingSms()
    app.dependency_overrides[get_sms_provider] = lambda: sms
    try:
        client.post(
            "/api/v1/auth/register",
            json={"email": "owner@example.com", "password": "strong-passphrase-123"},
        )
        payload = {"phone": "+819012345678"}
        assert client.post("/api/v1/auth/me/phone/request", json=payload).status_code == 202
        assert client.post("/api/v1/auth/me/phone/request", json=payload).status_code == 429
        assert len(sms.messages) == 1
    finally:
        app.dependency_overrides.pop(get_sms_provider, None)


def test_phone_login_and_recovery_are_generic_and_recovery_revokes_sessions(client, database):
    sms = CapturingSms()
    app.dependency_overrides[get_sms_provider] = lambda: sms
    try:
        email, password = "owner@example.com", "strong-passphrase-123"
        assert (
            client.post(
                "/api/v1/auth/register", json={"email": email, "password": password}
            ).status_code
            == 201
        )
        challenge = client.post(
            "/api/v1/auth/me/phone/request", json={"phone": "+819012345678"}
        ).json()
        client.post(
            "/api/v1/auth/me/phone/verify",
            json={
                "phone": "+819012345678",
                "challenge_id": challenge["challenge_id"],
                "code": sms.messages[-1][1],
            },
        )
        client.post("/api/v1/auth/logout")

        login_challenge = client.post(
            "/api/v1/auth/phone/login/request", json={"phone": "+819012345678"}
        )
        unknown_challenge = client.post(
            "/api/v1/auth/phone/login/request", json={"phone": "+819012345679"}
        )
        assert login_challenge.status_code == unknown_challenge.status_code == 202
        assert set(login_challenge.json()) == set(unknown_challenge.json())
        logged_in = client.post(
            "/api/v1/auth/phone/login/verify",
            json={
                "phone": "+819012345678",
                "challenge_id": login_challenge.json()["challenge_id"],
                "code": sms.messages[-2][1],
            },
        )
        assert logged_in.status_code == 200
        assert client.get("/api/v1/auth/me").status_code == 200

        recovery = client.post(
            "/api/v1/auth/password-reset/phone/request", json={"phone": "+819012345678"}
        )
        reset_code = sms.messages[-1][1]
        reset = client.post(
            "/api/v1/auth/password-reset/phone/confirm",
            json={
                "phone": "+819012345678",
                "challenge_id": recovery.json()["challenge_id"],
                "code": reset_code,
                "new_password": "new-strong-password-456",
            },
        )
        assert reset.status_code == 204
        assert client.get("/api/v1/auth/me").status_code == 401
        assert (
            client.post(
                "/api/v1/auth/login", json={"email": email, "password": password}
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": "new-strong-password-456"},
            ).status_code
            == 200
        )
        with database() as db:
            assert db.scalar(select(UserSession)) is not None
            assert (
                db.scalar(select(AuditLog).where(AuditLog.action == "password.reset_completed"))
                is not None
            )
    finally:
        app.dependency_overrides.pop(get_sms_provider, None)


def test_expired_and_phone_mismatched_challenges_cannot_be_used(client, database):
    sms = CapturingSms()
    app.dependency_overrides[get_sms_provider] = lambda: sms
    try:
        client.post(
            "/api/v1/auth/register",
            json={"email": "owner@example.com", "password": "strong-passphrase-123"},
        )
        response = client.post("/api/v1/auth/me/phone/request", json={"phone": "+819012345678"})
        code = sms.messages[-1][1]
        with database() as db:
            challenge = db.get(PhoneOtpChallenge, UUID(response.json()["challenge_id"]))
            challenge.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            db.commit()
        mismatch = client.post(
            "/api/v1/auth/me/phone/verify",
            json={
                "phone": "+819012345679",
                "challenge_id": response.json()["challenge_id"],
                "code": code,
            },
        )
        expired = client.post(
            "/api/v1/auth/me/phone/verify",
            json={
                "phone": "+819012345678",
                "challenge_id": response.json()["challenge_id"],
                "code": code,
            },
        )
        assert mismatch.status_code == expired.status_code == 400
        with database() as db:
            assert (
                db.get(PhoneOtpChallenge, UUID(response.json()["challenge_id"])).status == "expired"
            )
    finally:
        app.dependency_overrides.pop(get_sms_provider, None)

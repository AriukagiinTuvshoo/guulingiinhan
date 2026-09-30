from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from sqlalchemy import func, select, update

from app.email import EmailDeliveryError, FakeEmailProvider
from app.models import (
    AuditLog,
    EmailVerificationToken,
    LoginIdentity,
    LoginThrottle,
    PasswordResetToken,
    User,
    UserSession,
)

PASSWORD = "strong-passphrase-123"


def mailed_token(email_provider, recipient, subject):
    delivery = next(
        item
        for item in reversed(email_provider.deliveries)
        if item.recipient == recipient and item.subject.startswith(subject)
    )
    token = urlsplit(delivery.text.rsplit(" ", 1)[-1]).fragment.removeprefix("token=")
    assert len(token) >= 40
    return token


def register(client, email):
    return client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": PASSWORD},
    )


def verify(client, email_provider, email):
    token = mailed_token(email_provider, email, "Гуулингийнхан — имэйл")
    response = client.post("/api/v1/auth/email/verification/confirm", json={"token": token})
    assert response.status_code == 200
    return token


def test_registration_verification_hashes_token_and_consumes_once(client, database, email_provider):
    email = "verify@example.com"
    result = register(client, email)
    assert result.status_code == 201
    assert "token" not in result.text
    raw_token = mailed_token(email_provider, email, "Гуулингийнхан — имэйл")
    with database() as db:
        user = db.scalar(select(User).where(User.email == email))
        identity = db.scalar(select(LoginIdentity).where(LoginIdentity.user_id == user.id))
        token_row = db.scalar(
            select(EmailVerificationToken).where(EmailVerificationToken.user_id == user.id)
        )
        assert user.email_verified_at is None
        assert identity.verified_at is None
        assert token_row.token_hash != raw_token
        assert token_row.consumed_at is None

    confirmed = client.post("/api/v1/auth/email/verification/confirm", json={"token": raw_token})
    assert confirmed.status_code == 200
    assert (
        client.post(
            "/api/v1/auth/email/verification/confirm", json={"token": raw_token}
        ).status_code
        == 400
    )
    with database() as db:
        user = db.scalar(select(User).where(User.email == email))
        identity = db.scalar(select(LoginIdentity).where(LoginIdentity.user_id == user.id))
        actions = set(db.scalars(select(AuditLog.action)).all())
        assert user.email_verified_at is not None
        assert identity.verified_at == user.email_verified_at
        assert {
            "email_verification_requested",
            "email_verified",
            "email_verification_failed",
        } <= actions


def test_verification_request_is_generic_and_resend_limited(client, email_provider):
    email = "resend@example.com"
    register(client, email)
    initial_count = len(email_provider.deliveries)
    known = client.post("/api/v1/auth/email/verification/request", json={"email": email})
    unknown = client.post(
        "/api/v1/auth/email/verification/request", json={"email": "missing@example.com"}
    )
    throttled = client.post("/api/v1/auth/email/verification/request", json={"email": email})
    assert known.status_code == unknown.status_code == throttled.status_code == 202
    assert known.json() == unknown.json() == throttled.json()
    assert len(email_provider.deliveries) == initial_count + 1
    assert "email" not in known.json()
    assert "token" not in known.text


def test_email_password_reset_requires_verified_identity_and_is_enumeration_safe(
    client, database, email_provider
):
    unverified = "unverified-reset@example.com"
    register(client, unverified)
    unverified_result = client.post(
        "/api/v1/auth/password-reset/request", json={"email": unverified}
    )
    unknown_result = client.post(
        "/api/v1/auth/password-reset/request", json={"email": "absent-reset@example.com"}
    )
    assert unverified_result.status_code == unknown_result.status_code == 202
    assert unverified_result.json() == unknown_result.json()
    with database() as db:
        assert db.scalar(select(func.count(PasswordResetToken.id))) == 0

    email = "reset@example.com"
    client.post("/api/v1/auth/logout")
    register(client, email)
    verify(client, email_provider, email)
    assert (
        client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).status_code
        == 200
    )
    reset = client.post("/api/v1/auth/password-reset/request", json={"email": email})
    assert reset.status_code == 202
    raw_token = mailed_token(email_provider, email, "Гуулингийнхан — нууц үг")
    with database() as db:
        token_row = db.scalar(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id
                == select(User.id).where(User.email == email).scalar_subquery()
            )
        )
        assert token_row.token_hash != raw_token
        assert db.scalar(select(func.count(UserSession.id))) >= 1

    changed = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": raw_token, "new_password": "updated-passphrase-456"},
    )
    assert changed.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401
    with database() as db:
        assert db.scalar(select(func.count(UserSession.id))) == 0
    assert (
        client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": raw_token, "new_password": "updated-passphrase-456"},
        ).status_code
        == 400
    )
    assert (
        client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": email, "password": "updated-passphrase-456"}
        ).status_code
        == 200
    )


def test_reset_tokens_expire_and_newest_request_invalidates_previous(
    client, database, email_provider
):
    email = "newest-reset@example.com"
    register(client, email)
    verify(client, email_provider, email)
    client.post("/api/v1/auth/password-reset/request", json={"email": email})
    first = mailed_token(email_provider, email, "Гуулингийнхан — нууц үг")
    with database() as db:
        db.execute(
            update(LoginThrottle).values(window_started=datetime.now(UTC) - timedelta(minutes=2))
        )
        db.commit()
    client.post("/api/v1/auth/password-reset/request", json={"email": email})
    second = mailed_token(email_provider, email, "Гуулингийнхан — нууц үг")
    assert first != second
    assert (
        client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": first, "new_password": "updated-passphrase-456"},
        ).status_code
        == 400
    )
    with database() as db:
        row = db.scalar(select(PasswordResetToken).order_by(PasswordResetToken.created_at.desc()))
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert (
        client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": second, "new_password": "updated-passphrase-456"},
        ).status_code
        == 400
    )


def test_email_provider_failure_logs_no_message_or_token(client, monkeypatch, caplog):
    class FailingEmailProvider(FakeEmailProvider):
        def send_verification_email(self, recipient, link):
            raise EmailDeliveryError(f"failure with secret {link}")

    from app.email import get_email_provider
    from app.main import app

    provider = FailingEmailProvider()
    app.dependency_overrides[get_email_provider] = lambda: provider
    try:
        response = register(client, "mail-failure@example.com")
        assert response.status_code == 201
        assert "token" not in response.text
        assert "secret" not in caplog.text
        assert "#token=" not in caplog.text
    finally:
        app.dependency_overrides.pop(get_email_provider, None)


def test_email_provider_failure_logs_safe_cause_type(caplog):
    from app.email import send_email_safely

    class FailingProvider:
        def send_verification_email(self, recipient, link):
            try:
                raise TimeoutError("private SMTP diagnostic")
            except TimeoutError as cause:
                raise EmailDeliveryError("Email delivery failed") from cause

    send_email_safely(FailingProvider(), "send_verification_email", ("a@example.com", "secret"), None)
    assert "private SMTP diagnostic" not in caplog.text
    assert caplog.records[-1].cause_type == "TimeoutError"

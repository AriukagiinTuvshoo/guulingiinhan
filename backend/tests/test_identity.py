import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from conftest import confirm_registration_email, register_verified
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import LoginIdentity, User

PASSWORD = "strong-passphrase-123"


def register(client, email="owner@example.com"):
    return register_verified(client, email, PASSWORD)


def login(client, email="owner@example.com", password=PASSWORD):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def test_registration_email_identity_normalization_login_and_safe_output(client, email_provider):
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "Owner@Example.com", "password": PASSWORD},
    )
    assert response.status_code == 201
    assert "password_hash" not in response.json()
    assert login(client, " OWNER@example.com ").status_code == 403
    assert client.get("/api/v1/auth/me").status_code == 401
    assert confirm_registration_email(client, email_provider, "Owner@Example.com").status_code == 200
    assert login(client, " OWNER@example.com ").status_code == 200
    identities = client.get("/api/v1/auth/me/identities")
    assert identities.status_code == 200
    assert identities.json()[0]["provider"] == "email"
    assert identities.json()[0]["display_identifier"] == "Owner@example.com"
    assert identities.json()[0]["verified"] is True
    assert "normalized_identifier" not in identities.json()[0]
    assert "subject" not in identities.json()[0]
    assert login(client, "owner@example.com", "wrong-password").status_code == 401
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_case_variant_registration_is_generic_without_creating_duplicate_user(client, database):
    first = client.post(
        "/api/v1/auth/register",
        json={"email": "User@example.com", "password": PASSWORD},
    )
    assert first.status_code == 201
    assert first.json() == {
        "message": "Бүртгэлийн хүсэлтийг хүлээн авлаа. Шаардлагатай бол баталгаажуулах холбоосыг имэйлээр илгээнэ."
    }
    client.post("/api/v1/auth/logout")

    duplicate = client.post(
        "/api/v1/auth/register",
        json={"email": "user@example.com", "password": PASSWORD},
    )
    assert duplicate.status_code == 201
    assert duplicate.json() == first.json()

    with database() as db:
        assert len(db.scalars(select(User)).all()) == 1
        assert len(db.scalars(select(LoginIdentity)).all()) == 1


def test_provider_specific_identity_uniqueness(database):
    with database() as db:
        first = User(email="a@example.com", display_name="A", password_hash="hash")
        second = User(email="b@example.com", display_name="B", password_hash="hash")
        db.add_all([first, second])
        db.flush()
        db.add_all(
            [
                LoginIdentity(
                    user_id=first.id,
                    provider="email",
                    normalized_identifier="same@example.com",
                    display_identifier="same@example.com",
                ),
                LoginIdentity(
                    user_id=second.id,
                    provider="phone",
                    normalized_identifier="same@example.com",
                    display_identifier="same@example.com",
                ),
                LoginIdentity(
                    user_id=first.id,
                    provider="google",
                    issuer="https://accounts.google.com",
                    subject="subject-1",
                ),
                LoginIdentity(
                    user_id=second.id,
                    provider="google",
                    issuer="https://other.example/issuer",
                    subject="subject-1",
                ),
            ]
        )
        db.commit()
        db.add(
            LoginIdentity(
                user_id=second.id,
                provider="email",
                normalized_identifier="same@example.com",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_identity_link_requests_are_inert_account_scoped_and_cancellable(client):
    assert register(client).status_code == 201
    request = client.post(
        "/api/v1/auth/me/identity-link-requests",
        json={"provider": "phone", "identifier": "+819012345678"},
    )
    assert request.status_code == 201
    data = request.json()
    assert data["status"] == "pending"
    assert data["provider"] == "phone"
    assert "token" not in data
    assert client.get("/api/v1/auth/me/identities").json()[0]["provider"] == "email"

    assert client.post("/api/v1/auth/logout").status_code == 204
    assert register(client, "other@example.com").status_code == 201
    assert client.delete(
        f"/api/v1/auth/me/identity-link-requests/{data['id']}"
    ).status_code == 404
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert login(client).status_code == 200
    assert client.delete(
        f"/api/v1/auth/me/identity-link-requests/{data['id']}"
    ).status_code == 204
    assert client.get("/api/v1/auth/me/identity-link-requests").json()[0]["status"] == "cancelled"


def test_identity_link_request_validation_does_not_normalize_phone_country(client):
    assert register(client).status_code == 201
    assert client.post(
        "/api/v1/auth/me/identity-link-requests",
        json={"provider": "phone", "identifier": "09012345678"},
    ).status_code == 422
    assert client.post(
        "/api/v1/auth/me/identity-link-requests",
        json={"provider": "email", "identifier": "not-an-email"},
    ).status_code == 422
    assert client.post(
        "/api/v1/auth/me/identity-link-requests",
        json={"provider": "google", "issuer": "https://accounts.google.com", "subject": "s"},
    ).status_code == 201


def test_email_lookup_fails_closed_for_ambiguous_legacy_case_collision(database):
    with database() as db:
        db.add_all(
            [
                User(email="User@example.com", display_name="A", password_hash="hash"),
                User(email="user@example.com", display_name="B", password_hash="hash"),
            ]
        )
        db.commit()

    from app.identity import find_email_user

    with database() as db:
        assert find_email_user(db, "USER@example.com") is None


def test_registration_does_not_claim_ambiguous_legacy_email(client, database):
    with database() as db:
        db.add_all(
            [
                User(email="Taken@example.com", display_name="A", password_hash="hash"),
                User(email="taken@example.com", display_name="B", password_hash="hash"),
            ]
        )
        db.commit()
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "TAKEN@example.com", "password": PASSWORD},
    )
    assert response.status_code == 201
    assert "email" not in response.json()
    assert "user_id" not in response.json()


def test_migration_backfills_unique_emails_and_preserves_user_security_state(tmp_path):
    backend_dir = Path(__file__).resolve().parents[1]
    database_path = tmp_path / "legacy.sqlite"
    database_url = f"sqlite:///{database_path}"
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url

    def upgrade(revision: str):
        completed = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", revision],
            cwd=backend_dir,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        assert completed.returncode == 0, completed.stderr

    upgrade("b762e4a19d30")
    engine = create_engine(database_url)
    verified_user_id, unverified_user_id = uuid4(), uuid4()
    collision_one_id, collision_two_id = uuid4(), uuid4()
    verified_at = datetime(2025, 4, 3, tzinfo=UTC)
    with engine.begin() as connection:
        legacy_users = [
            {
                "id": verified_user_id,
                "email": "Verified@Example.com",
                "display_name": "Verified",
                "password_hash": "legacy-password-hash",
                "email_verified_at": verified_at,
                "is_active": True,
            },
            {
                "id": unverified_user_id,
                "email": "unverified@example.com",
                "display_name": "Unverified",
                "password_hash": "legacy-password-hash-2",
                "email_verified_at": None,
                "is_active": True,
            },
            {
                "id": collision_one_id,
                "email": "Conflict@example.com",
                "display_name": "Conflict A",
                "password_hash": "legacy-password-hash-3",
                "email_verified_at": None,
                "is_active": True,
            },
            {
                "id": collision_two_id,
                "email": "conflict@example.com",
                "display_name": "Conflict B",
                "password_hash": "legacy-password-hash-4",
                "email_verified_at": None,
                "is_active": True,
            },
        ]
        for legacy_user in legacy_users:
            connection.execute(User.__table__.insert().values(**legacy_user))
        connection.execute(
            User.__table__.insert().values(
                id=UUID(str(uuid4())),
                email="sessionowner@example.com",
                display_name="Session owner",
                password_hash="preserved-hash",
                is_active=True,
            )
        )
        preserved_user = connection.execute(
            select(User.id).where(User.email == "sessionowner@example.com")
        ).scalar_one()
        from app.models import UserSession

        connection.execute(
            UserSession.__table__.insert().values(
                id=uuid4(),
                user_id=preserved_user,
                token_hash="a" * 64,
                expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            )
        )

    upgrade("head")
    with Session(engine) as db:
        identities = db.scalars(select(LoginIdentity)).all()
        by_user = {item.user_id: item for item in identities}
        assert by_user[verified_user_id].normalized_identifier == "verified@example.com"
        assert by_user[verified_user_id].verified_at.replace(tzinfo=UTC) == verified_at
        assert by_user[unverified_user_id].verified_at is None
        assert collision_one_id not in by_user
        assert collision_two_id not in by_user
        assert db.get(User, verified_user_id).password_hash == "legacy-password-hash"
        assert db.scalar(select(UserSession.id).where(UserSession.user_id == preserved_user))
    engine.dispose()


def test_email_password_requires_eight_characters_not_ten(client, database):
    too_short = client.post(
        "/api/v1/auth/register",
        json={"email": "short@example.com", "password": "1234567"},
    )
    assert too_short.status_code == 422

    accepted = client.post(
        "/api/v1/auth/register",
        json={"email": "eight@example.com", "password": "12345678"},
    )
    assert accepted.status_code == 201
    assert accepted.json()["message"]
    assert "display_name" not in accepted.json()
    with database() as db:
        user = db.scalar(select(User).where(User.email == "eight@example.com"))
        assert user is not None
        assert user.password_hash is not None

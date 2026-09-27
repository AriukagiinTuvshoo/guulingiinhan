import hashlib
from datetime import UTC, datetime, timedelta
from uuid import UUID

from conftest import register_verified

from app.models import FamilyMember, Invitation, User


def test_invitation_pending_lifecycle_is_family_scoped(client, database):
    assert register_verified(client, "membership-owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Гишүүдийн гэр бүл"}).json()
    family_id = family["id"]

    created = client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "pending-member@example.com", "role": "member"},
    )
    assert created.status_code == 201
    invitation = created.json()
    assert "token" not in invitation
    assert invitation["role"] == "member"

    duplicate = client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "pending-member@example.com", "role": "editor"},
    )
    assert duplicate.status_code == 409

    pending = client.get(f"/api/v1/families/{family_id}/invitations")
    assert pending.status_code == 200
    assert [item["id"] for item in pending.json()] == [invitation["id"]]
    assert "token" not in pending.json()[0]

    client.post("/api/v1/auth/logout")
    assert register_verified(client, "other-user@example.com").status_code == 201
    assert client.get(f"/api/v1/families/{family_id}/invitations").status_code == 403

    client.post("/api/v1/auth/logout")
    assert register_verified(client, "membership-owner@example.com").status_code == 201
    revoked = client.delete(
        f"/api/v1/families/{family_id}/invitations/{invitation['id']}"
    )
    assert revoked.status_code == 204
    assert client.get(f"/api/v1/families/{family_id}/invitations").json() == []


def test_invitation_acceptance_preserves_role_and_prevents_cross_family_access(client, database):
    assert register_verified(client, "accept-owner@example.com").status_code == 201
    family_a = client.post("/api/v1/families", json={"name": "А гэр бүл"}).json()
    family_b = client.post("/api/v1/families", json={"name": "Б гэр бүл"}).json()

    client.post("/api/v1/auth/logout")
    assert register_verified(client, "accept-member@example.com").status_code == 201
    invitee = client.get("/api/v1/auth/me").json()

    raw_token = "a" * 48
    with database() as db:
        db.add(
            Invitation(
                family_id=UUID(family_a["id"]),
                invited_email="accept-member@example.com",
                role="editor",
                token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
                invited_by=UUID(family_a["created_by"]) if "created_by" in family_a else db.query(User).filter(User.email == "accept-owner@example.com").one().id,
                expires_at=datetime.now(UTC) + timedelta(days=7),
            )
        )
        db.commit()

    accepted = client.post("/api/v1/invitations/accept", json={"token": raw_token})
    assert accepted.status_code == 200
    assert accepted.json()["family_id"] == family_a["id"]
    assert accepted.json()["role"] == "editor"

    with database() as db:
        membership = (
            db.query(FamilyMember)
            .filter(
                FamilyMember.family_id == UUID(family_a["id"]),
                FamilyMember.user_id == UUID(invitee["id"]),
            )
            .one()
        )
        assert membership.role == "editor"

    assert client.get(f"/api/v1/families/{family_a['id']}").status_code == 200
    assert client.get(f"/api/v1/families/{family_b['id']}").status_code == 403

    duplicate_accept = client.post(
        "/api/v1/invitations/accept", json={"token": raw_token}
    )
    assert duplicate_accept.status_code == 404

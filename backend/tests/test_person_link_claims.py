from uuid import UUID

from conftest import register_verified
from sqlalchemy import select

from app.models import FamilyMember, UserPersonLink


def login(client, email):
    client.post("/api/v1/auth/logout")
    response = client.post("/api/v1/auth/login", json={
        "email": email, "password": "strong-passphrase-123",
    })
    assert response.status_code == 200


def test_existing_person_claim_requires_owner_approval(client, database):
    assert register_verified(client, "owner@example.com").status_code == 201
    owner = client.get("/api/v1/auth/me").json()
    family = client.post("/api/v1/families", json={"name": "Удам"}).json()
    fid = family["id"]
    person = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Хүн"}).json()

    client.post("/api/v1/auth/logout")
    assert register_verified(client, "member@example.com").status_code == 201
    member = client.get("/api/v1/auth/me").json()
    with database() as db:
        db.add(FamilyMember(family_id=UUID(fid), user_id=UUID(member["id"]), role="member"))
        db.commit()

    path = f"/api/v1/families/{fid}/persons/{person['id']}"
    assert client.post(path + "/link-me").status_code == 403
    request = client.post(path + "/link-request")
    assert request.status_code == 201
    request_id = request.json()["id"]
    assert client.post(path + "/link-request").status_code == 409
    assert client.get(f"/api/v1/families/{fid}/link-requests").status_code == 403
    assert client.post(f"/api/v1/families/{fid}/link-requests/{request_id}/approve").status_code == 403

    login(client, "owner@example.com")
    pending = client.get(f"/api/v1/families/{fid}/link-requests")
    assert pending.status_code == 200 and len(pending.json()) == 1
    assert client.post(f"/api/v1/families/{fid}/link-requests/{request_id}/approve").status_code == 204
    assert client.get(f"/api/v1/families/{fid}/link-requests").json() == []
    with database() as db:
        link = db.scalar(select(UserPersonLink).where(UserPersonLink.user_id == UUID(member["id"])))
        assert link is not None and str(link.person_id) == person["id"]
        assert link.linked_by == UUID(owner["id"])

    login(client, "member@example.com")
    assert client.post(path + "/link-request").status_code == 409


def test_owner_can_reject_without_linking(client, database):
    assert register_verified(client, "owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Удам"}).json()
    fid = family["id"]
    person = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Хүн"}).json()
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "member@example.com").status_code == 201
    member = client.get("/api/v1/auth/me").json()
    with database() as db:
        db.add(FamilyMember(family_id=UUID(fid), user_id=UUID(member["id"]), role="member"))
        db.commit()
    request = client.post(f"/api/v1/families/{fid}/persons/{person['id']}/link-request")
    assert request.status_code == 201
    request_id = request.json()["id"]
    login(client, "owner@example.com")
    assert client.post(f"/api/v1/families/{fid}/link-requests/{request_id}/reject").status_code == 204
    assert client.post(f"/api/v1/families/{fid}/link-requests/{request_id}/approve").status_code == 404
    with database() as db:
        assert db.scalar(select(UserPersonLink).where(UserPersonLink.user_id == UUID(member["id"]))) is None

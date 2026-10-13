"""Disposable API regressions for atomic self registration and invited identity reuse."""

from datetime import UTC, date, datetime
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import pytest
from conftest import register_verified
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from app.models import (
    AuditLog,
    Family,
    FamilyMember,
    FamilyPerson,
    ParentChildRelationship,
    Person,
    PersonLinkRequest,
    UserPersonLink,
)

BASE = "/api/v1/families"


def register(client, email):
    client.post("/api/v1/auth/logout")
    assert register_verified(client, email).status_code == 201
    return client.get("/api/v1/auth/me").json()["id"]


def login(client, email):
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/auth/login", json={
        "email": email, "password": "strong-passphrase-123",
    }).status_code == 200


def onboard(client, **fields):
    return client.post(f"{BASE}/onboarding", json={"request_key": str(uuid4()), **fields})


def counts(database):
    with database() as db:
        return tuple(db.scalar(select(func.count()).select_from(model)) for model in (
            Family, FamilyMember, Person, FamilyPerson, UserPersonLink,
        ))


def invite(client, email_provider, family_id, email):
    result = client.post(f"{BASE}/{family_id}/invitations", json={
        "email": email, "role": "member",
    })
    assert result.status_code == 201, result.text
    delivery = next(item for item in reversed(email_provider.deliveries)
                    if item.recipient == email and "/invite#" in item.text)
    return urlsplit(delivery.text.rsplit(" ", 1)[-1]).fragment.removeprefix("token=")


def test_new_onboarding_atomic_retry_and_global_identity_reuse(client, database):
    register(client, "atomic-owner@example.com")
    key = str(uuid4())
    payload = {"request_key": key, "family_name": " Өрх ", "first_name": " Нэр ",
               "last_name": " Овог ", "gender": "male"}
    response = client.post(f"{BASE}/onboarding", json=payload)
    assert response.status_code == 200, response.text
    first = response.json()
    assert first["role"] == "owner" and first["reused"] is False
    assert counts(database) == (1, 1, 1, 1, 1)
    repeat = client.post(f"{BASE}/onboarding", json=payload)
    assert repeat.status_code == 200 and repeat.json()["reused"] is True
    assert repeat.json()["person_id"] == first["person_id"]
    other_key = onboard(client, family_name="Must not create", first_name="Must not rename")
    assert other_key.status_code == 200 and other_key.json()["family_id"] == first["family_id"]
    assert counts(database) == (1, 1, 1, 1, 1)
    with database() as db:
        person = db.get(Person, UUID(first["person_id"]))
        assert (person.first_name, person.last_name, person.search_first_name) == ("Нэр", "Овог", "нэр")
        assert db.get(Family, UUID(first["family_id"])).name == "Өрх"
        assert db.scalar(select(func.count()).select_from(AuditLog).where(
            AuditLog.action == "onboarding.completed", AuditLog.request_id == key,
        )) == 1


@pytest.mark.parametrize("fields", [
    {"family_name": " ", "first_name": "Name"},
    {"family_name": "Family", "first_name": " "},
    {"family_name": "Family", "first_name": "Name", "person_id": str(uuid4())},
    {"family_name": "Family", "first_name": "Name", "gender": "invalid"},
])
def test_invalid_onboarding_leaves_no_partial_records(client, database, fields):
    register(client, "invalid-self@example.com")
    assert onboard(client, **fields).status_code == 422
    assert counts(database) == (0, 0, 0, 0, 0)


def test_database_failure_rolls_back_family_person_and_membership(client, database):
    register(client, "failed-atomic@example.com")

    def fail_link(mapper, connection, target):
        raise IntegrityError("synthetic link failure", {}, Exception("disposable test"))

    event.listen(UserPersonLink, "before_insert", fail_link)
    try:
        response = onboard(client, family_name="Rollback", first_name="Self")
        assert response.status_code == 409
    finally:
        event.remove(UserPersonLink, "before_insert", fail_link)
    assert counts(database) == (0, 0, 0, 0, 0)
    assert onboard(client, family_name="Retry", first_name="Self").status_code == 200
    assert counts(database) == (1, 1, 1, 1, 1)


def test_invited_member_self_setup_parent_owner_edit_and_no_implicit_sharing(
    client, database, email_provider,
):
    owner_id = register(client, "inviting-owner@example.com")
    owner = onboard(client, family_name="Invited family", first_name="Parent").json()
    fid = owner["family_id"]
    token = invite(client, email_provider, fid, "new-invitee@example.com")
    member_id = register(client, "new-invitee@example.com")
    response = client.post("/api/v1/invitations/accept", json={"token": token})
    assert response.status_code == 200
    assert counts(database) == (1, 2, 1, 1, 1)
    assert client.post("/api/v1/invitations/accept", json={"token": token}).json() == response.json()
    key = str(uuid4())
    self_response = client.post(f"{BASE}/onboarding", json={
        "request_key": key, "family_id": fid, "first_name": "Child",
    })
    assert self_response.status_code == 200, self_response.text
    child = self_response.json()
    assert child["role"] == "member"
    assert counts(database) == (1, 2, 2, 2, 2)
    assert client.post(f"{BASE}/{fid}/persons", json={"first_name": "Another"}).status_code == 403
    edge_body = {"parent_id": owner["person_id"], "child_id": child["person_id"],
                 "relationship_type": "biological"}
    assert client.post(f"{BASE}/{fid}/relationships/parent-child", json=edge_body).status_code == 403
    login(client, "inviting-owner@example.com")
    edge = client.post(f"{BASE}/{fid}/relationships/parent-child", json=edge_body)
    assert edge.status_code == 201, edge.text
    members = client.get(f"{BASE}/{fid}/members").json()
    assert {row["user_id"]: row["person_id"] for row in members} == {
        owner_id: owner["person_id"], member_id: child["person_id"],
    }
    with database() as db:
        assert db.scalar(select(func.count()).select_from(ParentChildRelationship)) == 1
        member = db.scalar(select(FamilyMember).where(
            FamilyMember.family_id == UUID(fid), FamilyMember.user_id == UUID(member_id),
        ))
        db.delete(member)
        db.commit()
    login(client, "new-invitee@example.com")
    assert client.post("/api/v1/invitations/accept", json={"token": token}).status_code == 409
    assert client.post(f"{BASE}/onboarding", json={
        "request_key": key, "family_id": fid, "first_name": "Child",
    }).status_code == 403
    assert counts(database) == (1, 1, 2, 2, 2)


@pytest.mark.parametrize("visibility,birth_date,expected", [
    ("family", None, 200), ("private", None, 403), ("family", date(2020, 1, 1), 401),
])
def test_explicit_existing_identity_reuse_preserves_source_and_blocks_private_minor(
    client, database, email_provider, visibility, birth_date, expected,
):
    register(client, "target-owner@example.com")
    target = onboard(client, family_name="Target family", first_name="Owner").json()
    token = invite(client, email_provider, target["family_id"], "linked-invitee@example.com")
    register(client, "linked-invitee@example.com")
    source = onboard(client, family_name="Original family", first_name="Original", last_name="Identity").json()
    with database() as db:
        person = db.get(Person, UUID(source["person_id"]))
        person.visibility = visibility
        db.commit()
    assert client.post("/api/v1/invitations/accept", json={"token": token}).status_code == 200
    assert counts(database) == (2, 3, 2, 2, 2)
    assert onboard(client, family_id=target["family_id"], first_name="Must not replace").status_code == 409
    # Eligibility is checked again after consent. The existing session must not
    # let a freshly restricted minor record become visible in another family.
    with database() as db:
        db.get(Person, UUID(source["person_id"])).birth_date = birth_date
        db.commit()
    response = onboard(client, family_id=target["family_id"], first_name="Must not replace",
                        reuse_existing_person=True)
    assert response.status_code == expected, response.text
    if expected == 200:
        assert response.json()["person_id"] == source["person_id"]
        assert response.json()["reused"] is True
    with database() as db:
        person = db.get(Person, UUID(source["person_id"]))
        assert (person.first_name, person.last_name, person.visibility, person.birth_date) == (
            "Original", "Identity", visibility, birth_date,
        )
    assert counts(database) == (2, 3, 2, 3 if expected == 200 else 2, 2)


def test_selected_family_requires_membership_and_retry_cannot_reattach_withdrawn_identity(
    client, database,
):
    register(client, "private-family-owner@example.com")
    existing = onboard(client, family_name="Private family", first_name="Owner").json()
    register(client, "intruder@example.com")
    before = counts(database)
    assert onboard(client, family_id=existing["family_id"], first_name="Intruder").status_code == 403
    assert counts(database) == before
    own_key = str(uuid4())
    response = client.post(f"{BASE}/onboarding", json={
        "request_key": own_key, "family_name": "Own family", "first_name": "Self",
    }).json()
    with database() as db:
        association = db.scalar(select(FamilyPerson).where(
            FamilyPerson.family_id == UUID(response["family_id"]),
            FamilyPerson.person_id == UUID(response["person_id"]),
        ))
        db.delete(association)
        db.commit()
    assert client.post(f"{BASE}/onboarding", json={
        "request_key": own_key, "family_id": response["family_id"],
        "reuse_existing_person": True,
    }).status_code == 409
    assert counts(database) == (2, 2, 2, 1, 2)


def test_own_claim_status_owner_approval_and_privacy_revalidation(client, database, email_provider):
    register(client, "claim-owner@example.com")
    owner = onboard(client, family_name="Claim family", first_name="Owner").json()
    fid = owner["family_id"]
    existing = client.post(f"{BASE}/{fid}/persons", json={"first_name": "Recorded child"}).json()
    token = invite(client, email_provider, fid, "claim-member@example.com")
    register(client, "claim-member@example.com")
    client.post("/api/v1/invitations/accept", json={"token": token})
    requested = client.post(f"{BASE}/{fid}/persons/{existing['id']}/link-request")
    assert requested.status_code == 201
    request_id = requested.json()["id"]
    own = client.get(f"{BASE}/{fid}/link-requests/me")
    assert own.status_code == 200 and own.json()[0]["status"] == "pending"
    assert onboard(client, family_id=fid, first_name="Duplicate").status_code == 409
    assert counts(database) == (1, 2, 2, 2, 1)
    assert client.get(f"{BASE}/{fid}/link-requests").status_code == 403
    with database() as db:
        db.get(Person, UUID(existing["id"])).visibility = "private"
        db.commit()
    own = client.get(f"{BASE}/{fid}/link-requests/me").json()
    assert own[0]["person_name"] == "Хүний мэдээлэл хязгаарлагдсан"
    login(client, "claim-owner@example.com")
    assert client.get(f"{BASE}/{fid}/link-requests/me").json() == []
    assert client.post(f"{BASE}/{fid}/link-requests/{request_id}/approve").status_code == 404
    with database() as db:
        assert db.get(PersonLinkRequest, UUID(request_id)).status == "pending"
        db.get(Person, UUID(existing["id"])).visibility = "family"
        db.commit()
    assert client.post(f"{BASE}/{fid}/link-requests/{request_id}/approve").status_code == 204
    login(client, "claim-member@example.com")
    assert client.get(f"{BASE}/{fid}/link-requests/me").json()[0]["status"] == "approved"
    assert onboard(client, family_id=fid, first_name="No new name").json()["person_id"] == existing["id"]
    assert client.post(f"{BASE}/{fid}/persons/{existing['id']}/link-me").status_code == 204
    assert counts(database) == (1, 2, 2, 2, 2)


def test_member_person_ids_hide_foreign_private_and_minor_records(client, database):
    owner_id = register(client, "directory-owner@example.com")
    family = onboard(client, family_name="Directory", first_name="Owner").json()
    other_id = register(client, "directory-other@example.com")
    other = onboard(client, family_name="Other family", first_name="Other").json()
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family["family_id"]), user_id=UUID(other_id), role="member"))
        db.commit()
    login(client, "directory-owner@example.com")

    def member_ids():
        return {row["user_id"]: row["person_id"] for row in
                client.get(f"{BASE}/{family['family_id']}/members").json()}

    assert member_ids() == {owner_id: family["person_id"], other_id: None}
    with database() as db:
        db.add(FamilyPerson(family_id=UUID(family["family_id"]), person_id=UUID(other["person_id"]),
                            added_by=UUID(other_id)))
        db.get(Person, UUID(other["person_id"])).visibility = "private"
        db.commit()
    assert member_ids()[other_id] is None
    with database() as db:
        person = db.get(Person, UUID(other["person_id"]))
        person.visibility = "family"
        person.birth_date = date(2020, 1, 1)
        db.commit()
    assert member_ids()[other_id] is None


@pytest.mark.parametrize("abandoned", ["membership_removed", "family_archived"])
def test_abandoned_claim_does_not_block_new_atomic_self_setup(client, database, abandoned):
    register(client, "abandoned-owner@example.com")
    owner = onboard(client, family_name="Previous family", first_name="Owner").json()
    fid = UUID(owner["family_id"])
    recorded = client.post(f"{BASE}/{fid}/persons", json={"first_name": "Recorded adult"}).json()
    member_id = UUID(register(client, "abandoned-member@example.com"))
    with database() as db:
        db.add(FamilyMember(family_id=fid, user_id=member_id, role="member"))
        db.commit()
    request = client.post(f"{BASE}/{fid}/persons/{recorded['id']}/link-request")
    assert request.status_code == 201
    with database() as db:
        if abandoned == "membership_removed":
            member = db.scalar(select(FamilyMember).where(
                FamilyMember.family_id == fid, FamilyMember.user_id == member_id,
            ))
            db.delete(member)
        else:
            db.get(Family, fid).archived_at = datetime.now(UTC)
        db.commit()
    response = onboard(client, family_name="New own family", first_name="Self")
    assert response.status_code == 200, response.text
    assert response.json()["person_id"] != recorded["id"]
    with database() as db:
        assert db.get(PersonLinkRequest, UUID(request.json()["id"])).status == "pending"
        assert db.get(Person, UUID(recorded["id"])).first_name == "Recorded adult"
        assert db.scalar(select(UserPersonLink.person_id).where(
            UserPersonLink.user_id == member_id,
        )) == UUID(response.json()["person_id"])

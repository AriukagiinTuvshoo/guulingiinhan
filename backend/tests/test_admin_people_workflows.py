"""Admin console workflows: delegated profile edits, marriage status and lineage assignment."""

from uuid import UUID

from conftest import register_verified
from sqlalchemy import select

from app.models import FamilyMember, Marriage, Person, PersonLineageAssignment


def login(client, email):
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login", json={"email": email, "password": "strong-passphrase-123"}
    ).status_code == 200


def delegate(client, database, family, email, scopes):
    register_verified(client, email)
    user_id = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family), user_id=UUID(user_id), role="member"))
        db.commit()
    login(client, email)
    return user_id


def test_delegated_profile_edit_respects_privacy_and_minor_rules(client, database):
    register_verified(client, "profile-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "F"}).json()["id"]
    base = f"/api/v1/families/{family}"
    adult = client.post(base + "/persons", json={"first_name": "Adult", "gender": "male"}).json()
    minor = client.post(
        base + "/persons", json={"first_name": "Minor", "birth_date": "2018-05-05"}
    ).json()["id"]
    secret = client.post(
        base + "/persons", json={"first_name": "Secret", "visibility": "private"}
    ).json()["id"]
    member_id = delegate(client, database, family, "profile-member@example.com", [])
    login(client, "profile-owner@example.com")
    assert client.put(f"{base}/admin-grants/{member_id}", json={"scopes": ["manage_people"]}).status_code == 204

    login(client, "profile-member@example.com")
    updated = client.patch(f"{base}/persons/{adult['id']}", json={
        "first_name": "Renamed", "middle_name": "Mid", "visibility": "family", "is_alive": True,
    })
    assert updated.status_code == 200
    assert updated.json()["first_name"] == "Renamed"
    with database() as db:
        row = db.get(Person, UUID(adult["id"]))
        assert row is not None and row.search_first_name == "renamed"

    # A minor's profile stays closed without a guardian grant, even for an admin.
    assert client.patch(f"{base}/persons/{minor}", json={"first_name": "Nope"}).status_code == 403
    # A private person of somebody else is invisible rather than forbidden.
    assert client.patch(f"{base}/persons/{secret}", json={"first_name": "Nope"}).status_code == 404
    # Invalid dates are rejected before any write.
    assert client.patch(f"{base}/persons/{adult['id']}", json={"death_date": "1800-01-01"}).status_code == 422
    with database() as db:
        row = db.get(Person, UUID(adult["id"]))
        assert row is not None and row.death_date is None

    login(client, "profile-owner@example.com")
    assert client.put(f"{base}/admin-grants/{member_id}", json={"scopes": []}).status_code == 204
    login(client, "profile-member@example.com")
    assert client.patch(f"{base}/persons/{adult['id']}", json={"nickname": "x"}).status_code == 403


def test_marriage_status_and_lineage_assignment_round_trip(client, database):
    register_verified(client, "marriage-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "F"}).json()["id"]
    base = f"/api/v1/families/{family}"
    first = client.post(base + "/persons", json={"first_name": "First"}).json()["id"]
    second = client.post(base + "/persons", json={"first_name": "Second"}).json()["id"]
    outsider = client.post(base + "/persons", json={"first_name": "Hidden", "visibility": "private"}).json()["id"]
    lineage = client.post(base + "/lineages", json={"name": "Lineage"}).json()["id"]
    branch = client.post(f"/api/v1/lineages/{lineage}/branches", json={"name": "Branch"}).json()["id"]

    member_id = delegate(client, database, family, "marriage-member@example.com", [])
    login(client, "marriage-owner@example.com")
    assert client.put(f"{base}/admin-grants/{member_id}", json={"scopes": ["manage_people"]}).status_code == 204

    login(client, "marriage-member@example.com")
    marriage = client.post(base + "/marriages", json={
        "person_1_id": first, "person_2_id": second, "start_date": "1990-06-01",
    })
    assert marriage.status_code == 201
    marriage_id = marriage.json()["id"]
    assert client.post(base + "/marriages", json={"person_1_id": first, "person_2_id": second}).status_code == 409
    assert client.post(base + "/marriages", json={
        "person_1_id": first, "person_2_id": outsider,
    }).status_code == 404

    listed = client.get(base + "/marriages").json()
    assert [row["id"] for row in listed] == [marriage_id]
    dissolved = client.patch(f"{base}/marriages/{marriage_id}", json={"status": "divorced"})
    assert dissolved.status_code == 200 and dissolved.json()["status"] == "divorced"
    # Re-opening the same active marriage is now allowed only as a new row.
    assert client.patch(f"{base}/marriages/{marriage_id}", json={"status": "married"}).status_code == 200

    assert client.put(f"{base}/persons/{first}/lineage-assignment", json={
        "lineage_id": lineage, "branch_id": branch,
    }).status_code == 200
    directory = client.get(f"{base}/people?page=1&page_size=25").json()
    row = next(item for item in directory["items"] if item["id"] == first)
    assert row["lineage_id"] == lineage and row["branch_id"] == branch
    assert client.get(base + f"/persons/{first}/lineage-assignment").json()["branch_id"] == branch
    assert client.delete(base + f"/persons/{first}/lineage-assignment").status_code == 204
    with database() as db:
        assert db.scalars(select(PersonLineageAssignment)).all() == []
        assert len(db.scalars(select(Marriage)).all()) == 1
    assert client.get(base + f"/persons/{first}/lineage-assignment").status_code == 404


def test_revoked_delegate_cannot_touch_marriages_or_lineage(client, database):
    register_verified(client, "revoke-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "F"}).json()["id"]
    base = f"/api/v1/families/{family}"
    first = client.post(base + "/persons", json={"first_name": "First"}).json()["id"]
    second = client.post(base + "/persons", json={"first_name": "Second"}).json()["id"]
    lineage = client.post(base + "/lineages", json={"name": "Lineage"}).json()["id"]
    marriage_id = client.post(base + "/marriages", json={
        "person_1_id": first, "person_2_id": second,
    }).json()["id"]

    member_id = delegate(client, database, family, "revoke-member@example.com", [])
    login(client, "revoke-owner@example.com")
    grants = f"{base}/admin-grants/{member_id}"
    assert client.put(grants, json={"scopes": ["manage_people"]}).status_code == 204
    login(client, "revoke-member@example.com")
    assert client.put(f"{base}/persons/{first}/lineage-assignment", json={"lineage_id": lineage}).status_code == 200
    login(client, "revoke-owner@example.com")
    assert client.put(grants, json={"scopes": []}).status_code == 204

    login(client, "revoke-member@example.com")
    assert client.patch(f"{base}/marriages/{marriage_id}", json={"status": "divorced"}).status_code == 403
    assert client.delete(f"{base}/persons/{first}/lineage-assignment").status_code == 403
    assert client.post(base + "/marriages", json={"person_1_id": first, "person_2_id": second}).status_code == 403
    with database() as db:
        row = db.get(Marriage, UUID(marriage_id))
        assert row is not None and row.status == "married"

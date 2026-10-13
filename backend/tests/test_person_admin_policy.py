"""Family membership does not confer administration of other people's records."""

from uuid import UUID

import pytest
from conftest import register_verified
from sqlalchemy import select

from app.models import AdminGrant, FamilyMember, Lineage, Person, UserPersonLink


def setup_records(client, database, *, role="owner", admin_role=None):
    register_verified(client, f"policy-{role}-{admin_role or 'family'}@example.com")
    user_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_id = client.post("/api/v1/families", json={"name": "Local policy test"}).json()["id"]
    endpoint = f"/api/v1/families/{family_id}/persons"
    own = client.post(endpoint, json={"first_name": "Own test profile", "birth_date": "1980-01-01"}).json()["id"]
    other = client.post(endpoint, json={"first_name": "Other test profile", "birth_date": "1980-01-01"}).json()["id"]
    with database() as db:
        member = db.scalar(select(FamilyMember).where(FamilyMember.user_id == user_id, FamilyMember.family_id == UUID(family_id)))
        member.role = role
        db.add(UserPersonLink(user_id=user_id, person_id=UUID(own), linked_by=user_id))
        lineage = Lineage(family_id=UUID(family_id), name="Local branch")
        db.add(lineage)
        if admin_role:
            db.add(AdminGrant(user_id=user_id, role=admin_role))
        db.commit()
        lineage_id = str(lineage.id)
    return family_id, own, other, lineage_id


@pytest.mark.parametrize("role", ["owner", "editor", "member"])
def test_family_roles_cannot_administer_other_people_but_keep_context_read(client, database, role):
    family, own, other, lineage = setup_records(client, database, role=role)
    base = f"/api/v1/families/{family}"
    person = f"{base}/persons/{other}"
    assert client.get(f"{base}/people").status_code == 403
    assert client.get(f"{base}/persons").status_code == 200
    profile = client.get(person)
    assert profile.status_code == 200
    assert profile.json()["can_edit_profile"] is False
    assert client.patch(person, json={"first_name": "Forbidden change"}).status_code == 403
    assert client.post(f"{person}/profile-photo", content=b"fake", headers={"Content-Type": "image/png"}).status_code == 403
    assert client.delete(f"{person}/profile-photo").status_code == 403
    assert client.put(f"{person}/biography", json={"content": "Forbidden change"}).status_code == 403
    assert client.post(f"{person}/events", json={"event_type": "other", "title": "Forbidden change", "event_date": "2000-01-01"}).status_code == 403
    assert client.put(f"{person}/lineage-assignment", json={"lineage_id": lineage}).status_code == 403
    assert client.delete(f"{person}/lineage-assignment").status_code == 403
    assert client.put(f"{base}/featured-person", json={"person_id": other}).status_code == 403
    assert client.delete(person).status_code == 403
    assert client.get(person).json()["first_name"] == "Other test profile"
    # The same role may edit its own linked adult profile.
    own_endpoint = f"{base}/persons/{own}"
    assert client.get(own_endpoint).json()["can_edit_profile"] is True
    assert client.patch(own_endpoint, json={"first_name": "Updated own profile"}).status_code == 200
    assert client.put(f"{own_endpoint}/biography", json={"content": "Own biography"}).status_code == 200
    assert client.post(f"{own_endpoint}/events", json={"event_type": "other", "title": "Own event", "event_date": "2000-01-01"}).status_code == 201
    assert client.delete(f"{own_endpoint}/profile-photo").status_code == 204


@pytest.mark.parametrize("admin_role", ["ADMIN", "MODERATOR", "SUPER_ADMIN"])
def test_global_admin_directory_does_not_grant_operator_person_writes(client, database, admin_role):
    family, _, other, lineage = setup_records(client, database, role="member", admin_role=admin_role)
    base = f"/api/v1/families/{family}"
    person = f"{base}/persons/{other}"
    assert client.get(f"{base}/people").status_code == 200
    expected = 200 if admin_role == "SUPER_ADMIN" else 403
    assert client.patch(person, json={"first_name": "Admin edit"}).status_code == expected
    assert client.put(f"{person}/lineage-assignment", json={"lineage_id": lineage}).status_code == expected
    assert client.put(f"{base}/featured-person", json={"person_id": other}).status_code == expected
    assert client.delete(f"{person}/profile-photo").status_code == (204 if admin_role == "SUPER_ADMIN" else 403)
    with database() as db:
        assert db.get(Person, UUID(other)).first_name == ("Admin edit" if admin_role == "SUPER_ADMIN" else "Other test profile")


def test_directory_admin_grant_does_not_bypass_family_membership(client, database):
    family, _, _, _ = setup_records(client, database)
    register_verified(client, "unrelated-directory-admin@example.com")
    user_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    with database() as db:
        db.add(AdminGrant(user_id=user_id, role="SUPER_ADMIN"))
        db.commit()
    assert client.get(f"/api/v1/families/{family}/people").status_code == 403


def test_self_edit_does_not_allow_turning_profile_into_minor_without_guardian_scope(client, database):
    family, own, _, _ = setup_records(client, database)
    endpoint = f"/api/v1/families/{family}/persons/{own}"
    assert client.patch(endpoint, json={"birth_date": "2020-01-01"}).status_code == 403
    assert client.get(endpoint).json()["birth_date"] == "1980-01-01"

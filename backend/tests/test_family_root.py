from uuid import UUID

from conftest import register_verified

from app.models import FamilyMember, Person


def test_owner_designates_and_protects_existing_root_without_deleting_person(client, database):
    register_verified(client, "root-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Root test"}).json()
    family_id = family["id"]
    person = client.post(f"/api/v1/families/{family_id}/persons", json={
        "first_name": "Ancestor", "last_name": "Test", "is_alive": False,
        "visibility": "family",
    })
    assert person.status_code == 201
    person_id = person.json()["id"]

    assert client.get(f"/api/v1/families/{family_id}/root").json()["person_id"] is None
    designated = client.put(f"/api/v1/families/{family_id}/root", json={"person_id": person_id})
    assert designated.status_code == 200
    assert client.get(f"/api/v1/families/{family_id}/tree?depth=0").json()["root_person_id"] == person_id
    assert client.delete(f"/api/v1/families/{family_id}/persons/{person_id}").status_code == 409

    cleared = client.delete(f"/api/v1/families/{family_id}/root")
    assert cleared.status_code == 200 and cleared.json()["person_id"] is None
    assert client.delete(f"/api/v1/families/{family_id}/persons/{person_id}").status_code == 204
    with database() as db:
        assert db.get(Person, UUID(person_id)) is not None


def test_non_owner_cannot_change_family_root_or_other_family_root(client, database):
    register_verified(client, "root-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Owner family"}).json()
    person = client.post(f"/api/v1/families/{family['id']}/persons", json={
        "first_name": "Existing", "last_name": "Person",
    }).json()

    client.post("/api/v1/auth/logout")
    register_verified(client, "root-member@example.com")
    member = client.get("/api/v1/auth/me").json()
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family["id"]), user_id=UUID(member["id"]), role="member"))
        db.commit()
    assert client.put(f"/api/v1/families/{family['id']}/root", json={"person_id": person["id"]}).status_code == 403
    assert client.put(f"/api/v1/families/{family['id']}/root", json={"person_id": "00000000-0000-0000-0000-000000000000"}).status_code == 403

from uuid import UUID

from app.models import FamilyMember
from tests.conftest import register_verified


def test_owner_selects_canonical_root_without_losing_people(client, email_provider):
    assert register_verified(client, "root-owner@example.com", "strong-password-123", email_provider).status_code == 201
    family = client.post("/api/v1/families", json={"name": "Recorded lineage"}).json()
    family_id = family["id"]
    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Recorded ancestor", "last_name": "", "gender": "unknown"},
    )
    assert person.status_code == 201, person.text
    person_id = person.json()["id"]
    assert client.get(f"/api/v1/families/{family_id}/root").json()["person_id"] is None
    assert client.put(f"/api/v1/families/{family_id}/root", json={"person_id": person_id}).status_code == 200
    tree = client.get(f"/api/v1/families/{family_id}/tree").json()
    assert tree["lineage_root_person_id"] == person_id
    assert tree["root_person_id"] == person_id
    assert any(item["id"] == person_id for item in tree["persons"])
    assert client.delete(f"/api/v1/families/{family_id}/persons/{person_id}").status_code == 409
    assert client.put(f"/api/v1/families/{family_id}/root", json={"person_id": person_id}).status_code == 200


def test_existing_person_link_requires_owner_approval(client, database, email_provider):
    password = "strong-password-123"
    owner_email, member_email = "claim-owner@example.com", "claim-member@example.com"
    assert register_verified(client, owner_email, password, email_provider).status_code == 201
    family_id = client.post("/api/v1/families", json={"name": "Established family"}).json()["id"]
    person_id = client.post(f"/api/v1/families/{family_id}/persons", json={
        "first_name": "Existing adult", "last_name": "", "gender": "unknown",
    }).json()["id"]
    assert register_verified(client, member_email, password, email_provider).status_code == 201
    member_id = client.get("/api/v1/auth/me").json()["id"]
    with database.begin() as db:
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(member_id), role="member"))
    assert client.post(f"/api/v1/families/{family_id}/persons/{person_id}/link-me").status_code == 403
    assert client.get(f"/api/v1/families/{family_id}/tree").status_code == 200
    requested = client.post(f"/api/v1/families/{family_id}/persons/{person_id}/link-request")
    assert requested.status_code == 201
    assert client.post(f"/api/v1/families/{family_id}/persons/{person_id}/link-request").status_code == 409
    assert client.get(f"/api/v1/families/{family_id}/link-requests").status_code == 403
    client.post("/api/v1/auth/login", json={"email": owner_email, "password": password})
    listed = client.get(f"/api/v1/families/{family_id}/link-requests")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == requested.json()["id"]
    approved = client.post(f"/api/v1/families/{family_id}/link-requests/{requested.json()['id']}/approve")
    assert approved.status_code == 204
    client.post("/api/v1/auth/login", json={"email": member_email, "password": password})
    assert client.get("/api/v1/auth/me").json()["person_id"] == person_id
    assert client.get(f"/api/v1/families/{family_id}/tree").json()["linked_person_id"] == person_id


def test_detach_preserves_historical_relationships(client, email_provider):
    assert register_verified(client, "history-owner@example.com", "strong-password-123", email_provider).status_code == 201
    family_id = client.post("/api/v1/families", json={"name": "Historical family"}).json()["id"]
    people = [client.post(f"/api/v1/families/{family_id}/persons", json={
        "first_name": name, "last_name": "", "gender": "unknown",
    }).json()["id"] for name in ("Ancestor", "Child", "Spouse")]
    assert client.post(f"/api/v1/families/{family_id}/relationships/parent-child", json={
        "parent_id": people[0], "child_id": people[1],
    }).status_code == 201
    assert client.post(f"/api/v1/families/{family_id}/marriages", json={
        "person_1_id": people[0], "person_2_id": people[2],
    }).status_code == 201
    for person_id in people:
        assert client.delete(f"/api/v1/families/{family_id}/persons/{person_id}").status_code == 409
    tree = client.get(f"/api/v1/families/{family_id}/tree?person_id={people[0]}&depth=2").json()
    assert len(tree["persons"]) == 3
    assert len(tree["parent_child_relationships"]) == 1
    assert len(tree["marriages"]) == 1


def test_full_family_tree_includes_unconnected_authorized_people(client, email_provider):
    assert register_verified(client, "full-tree-owner@example.com", "strong-password-123", email_provider).status_code == 201
    family_id = client.post("/api/v1/families", json={"name": "Бүтэн мод"}).json()["id"]
    people = [client.post(
        f"/api/v1/families/{family_id}/persons", json={"first_name": name}
    ).json()["id"] for name in ("Эх", "Хүүхэд", "Салангид хүн")]
    assert client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": people[0], "child_id": people[1]},
    ).status_code == 201
    context = client.get(f"/api/v1/families/{family_id}/tree?person_id={people[0]}&depth=2")
    full = client.get(f"/api/v1/families/{family_id}/tree?person_id={people[0]}&scope=all")
    assert context.status_code == full.status_code == 200
    assert {person["id"] for person in context.json()["persons"]} == set(people[:2])
    assert {person["id"] for person in full.json()["persons"]} == set(people)
    assert len(full.json()["parent_child_relationships"]) == 1

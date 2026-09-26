from uuid import UUID

from conftest import register_verified

from app.models import FamilyMember


def test_tree_and_relationships_remain_family_scoped(client, database):
    register_verified(client, "tree-owner@example.com")
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_a_id = UUID(client.post("/api/v1/families", json={"name": "A гэр бүл"}).json()["id"])
    family_b_id = UUID(client.post("/api/v1/families", json={"name": "B гэр бүл"}).json()["id"])

    person_a = client.post(
        f"/api/v1/families/{family_a_id}/persons",
        json={"first_name": "A хүн", "last_name": "Удам"},
    )
    assert person_a.status_code == 201
    person_a_id = UUID(person_a.json()["id"])

    person_b = client.post(
        f"/api/v1/families/{family_b_id}/persons",
        json={"first_name": "B хүн", "last_name": "Удам"},
    )
    assert person_b.status_code == 201
    person_b_id = UUID(person_b.json()["id"])

    register_verified(client, "tree-member@example.com")
    member_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    with database() as db:
        db.add(FamilyMember(family_id=family_b_id, user_id=member_id, role="editor"))
        db.commit()

    tree_other_family = client.get(
        f"/api/v1/families/{family_a_id}/tree?person_id={person_a_id}&depth=1"
    )
    assert tree_other_family.status_code == 403

    cross_family_relationship = client.post(
        f"/api/v1/families/{family_b_id}/relationships/parent-child",
        json={"parent_id": str(person_a_id), "child_id": str(person_b_id)},
    )
    assert cross_family_relationship.status_code == 404

    # The member still receives the legitimate B-family tree and only B-family people.
    tree_b = client.get(f"/api/v1/families/{family_b_id}/tree?person_id={person_b_id}&depth=0")
    assert tree_b.status_code == 200
    assert {person["id"] for person in tree_b.json()["persons"]} == {str(person_b_id)}

    # Owner identity is intentionally unused after the scope checks above; keep the
    # assertion to make the fixture setup explicit and prevent accidental broadening.
    assert owner_id != member_id

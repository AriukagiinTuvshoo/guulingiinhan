from uuid import UUID

from conftest import register_verified

from app.models import FamilyMember, FamilyPerson, Marriage, ParentChildRelationship, Person


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


def test_new_authorized_member_sees_existing_lineage_without_person_link_and_other_family_is_denied(client, database):
    register_verified(client, "lineage-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Гуулингийн удам"}).json()
    family_id = family["id"]
    ancestor = client.post(f"/api/v1/families/{family_id}/persons", json={
        "first_name": "Бодит", "last_name": "Өвөг", "visibility": "family",
    }).json()
    descendant = client.post(f"/api/v1/families/{family_id}/persons", json={
        "first_name": "Бодит", "last_name": "Үр", "visibility": "family",
    }).json()
    relationship = client.post(f"/api/v1/families/{family_id}/relationships/parent-child", json={
        "parent_id": ancestor["id"], "child_id": descendant["id"],
        "relationship_type": "biological",
    })
    assert relationship.status_code == 201
    assert client.put(f"/api/v1/families/{family_id}/root", json={"person_id": ancestor["id"]}).status_code == 200

    client.post("/api/v1/auth/logout")
    register_verified(client, "new-member@example.com")
    member = client.get("/api/v1/auth/me").json()
    assert member["person_id"] is None
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(member["id"]), role="member"))
        db.commit()

    tree = client.get(f"/api/v1/families/{family_id}/tree?depth=5")
    assert tree.status_code == 200
    assert tree.json()["family_root_person_id"] == ancestor["id"]
    assert {person["id"] for person in tree.json()["persons"]} == {ancestor["id"], descendant["id"]}
    assert len(tree.json()["parent_child_relationships"]) == 1

    client.post("/api/v1/auth/logout")
    register_verified(client, "outsider@example.com")
    assert client.get(f"/api/v1/families/{family_id}/tree?person_id={ancestor['id']}").status_code == 403
    assert client.get(f"/api/v1/families/{family_id}/persons/{ancestor['id']}").status_code == 403


def test_removing_parent_child_edge_preserves_people_and_other_history(client, database):
    register_verified(client, "relationship-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Relationship removal"}).json()
    family_id = family["id"]
    parent = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "Parent"}).json()
    child = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "Child"}).json()
    grandchild = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "Grandchild"}).json()
    spouse = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "Spouse"}).json()
    first = client.post(f"/api/v1/families/{family_id}/relationships/parent-child", json={
        "parent_id": parent["id"], "child_id": child["id"], "relationship_type": "biological",
    }).json()
    second = client.post(f"/api/v1/families/{family_id}/relationships/parent-child", json={
        "parent_id": child["id"], "child_id": grandchild["id"], "relationship_type": "biological",
    }).json()
    marriage = client.post(f"/api/v1/families/{family_id}/marriages", json={
        "person_1_id": parent["id"], "person_2_id": spouse["id"], "status": "divorced",
    })
    assert marriage.status_code == 201

    removed = client.delete(
        f"/api/v1/families/{family_id}/relationships/parent-child/{first['id']}"
    )
    assert removed.status_code == 204
    with database() as db:
        assert db.get(Person, UUID(parent["id"])) is not None
        assert db.get(Person, UUID(child["id"])) is not None
        assert db.get(Person, UUID(grandchild["id"])) is not None
        assert db.get(Person, UUID(spouse["id"])) is not None
        assert db.get(ParentChildRelationship, UUID(first["id"])) is None
        assert db.get(ParentChildRelationship, UUID(second["id"])) is not None
        assert db.get(Marriage, UUID(marriage.json()["id"])) is not None


def test_member_cannot_remove_another_users_relationship(client, database):
    register_verified(client, "relationship-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Protected relationship"}).json()
    family_id = family["id"]
    parent = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "Parent"}).json()
    child = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "Child"}).json()
    edge = client.post(f"/api/v1/families/{family_id}/relationships/parent-child", json={
        "parent_id": parent["id"], "child_id": child["id"], "relationship_type": "biological",
    }).json()

    client.post("/api/v1/auth/logout")
    register_verified(client, "relationship-member@example.com")
    member = client.get("/api/v1/auth/me").json()
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(member["id"]), role="member"))
        db.commit()
    assert client.delete(
        f"/api/v1/families/{family_id}/relationships/parent-child/{edge['id']}"
    ).status_code == 403


def test_parent_child_edge_shared_with_another_family_cannot_be_removed_here(client, database):
    register_verified(client, "shared-edge-owner@example.com")
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family = client.post("/api/v1/families", json={"name": "Family one"}).json()
    family_id = family["id"]
    parent = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "Parent"}).json()
    child = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "Child"}).json()
    edge = client.post(f"/api/v1/families/{family_id}/relationships/parent-child", json={
        "parent_id": parent["id"], "child_id": child["id"], "relationship_type": "biological",
    }).json()
    other_family = client.post("/api/v1/families", json={"name": "Family two"}).json()
    with database() as db:
        db.add_all([
            FamilyPerson(
                family_id=UUID(other_family["id"]), person_id=UUID(parent["id"]), added_by=owner_id,
            ),
            FamilyPerson(
                family_id=UUID(other_family["id"]), person_id=UUID(child["id"]),
                added_by=owner_id,
            ),
        ])
        db.commit()
    assert client.delete(
        f"/api/v1/families/{family_id}/relationships/parent-child/{edge['id']}"
    ).status_code == 409
    with database() as db:
        assert db.get(ParentChildRelationship, UUID(edge["id"])) is not None

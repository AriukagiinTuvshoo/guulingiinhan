from uuid import UUID

from conftest import register_verified
from sqlalchemy import func, select

from app.models import Branch, Lineage, Marriage, ParentChildRelationship, Person


def test_authorized_family_member_can_create_and_list_lineage(client):
    register_verified(client, "lineage-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Удам A"})
    assert family.status_code == 201
    family_id = family.json()["id"]

    created = client.post(
        f"/api/v1/families/{family_id}/lineages",
        json={"name": "Эцгийн удам", "description": "Үндсэн удам"},
    )
    assert created.status_code == 201
    assert created.json()["family_id"] == family_id
    assert created.json()["name"] == "Эцгийн удам"
    assert created.json()["description"] == "Үндсэн удам"

    listed = client.get(f"/api/v1/families/{family_id}/lineages")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [created.json()["id"]]


def test_unauthorized_family_cannot_create_or_read_lineage(client):
    register_verified(client, "lineage-private-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Нууц удам"})
    family_id = family.json()["id"]
    lineage = client.post(
        f"/api/v1/families/{family_id}/lineages",
        json={"name": "Удам A"},
    )
    lineage_id = lineage.json()["id"]

    assert client.post("/api/v1/auth/logout").status_code == 204
    register_verified(client, "lineage-outsider@example.com")

    assert client.get(f"/api/v1/families/{family_id}/lineages").status_code == 403
    assert (
        client.post(
            f"/api/v1/families/{family_id}/lineages",
            json={"name": "Удам B"},
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/lineages/{lineage_id}/branches").status_code == 404


def test_authorized_family_member_can_create_and_list_branch(client):
    register_verified(client, "branch-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Салаа"})
    family_id = family.json()["id"]
    lineage = client.post(
        f"/api/v1/families/{family_id}/lineages",
        json={"name": "Удам A"},
    ).json()

    created = client.post(
        f"/api/v1/lineages/{lineage['id']}/branches",
        json={"name": "A1", "description": "Эхний салаа"},
    )
    assert created.status_code == 201
    assert created.json()["lineage_id"] == lineage["id"]
    assert created.json()["name"] == "A1"

    listed = client.get(f"/api/v1/lineages/{lineage['id']}/branches")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == created.json()["id"]


def test_cross_family_branch_access_is_blocked(client):
    register_verified(client, "family-a@example.com")
    family_a = client.post("/api/v1/families", json={"name": "A"}).json()
    lineage_a = client.post(
        f"/api/v1/families/{family_a['id']}/lineages",
        json={"name": "A lineage"},
    ).json()

    client.post("/api/v1/auth/logout")
    register_verified(client, "family-b@example.com")
    family_b = client.post("/api/v1/families", json={"name": "B"})
    assert family_b.status_code == 201

    assert client.get(f"/api/v1/lineages/{lineage_a['id']}/branches").status_code == 404
    assert (
        client.post(
            f"/api/v1/lineages/{lineage_a['id']}/branches",
            json={"name": "Should not exist"},
        ).status_code
        == 404
    )


def test_existing_person_remains_valid_without_lineage_assignment(client, database):
    register_verified(client, "person-no-lineage@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Хүн"}).json()["id"]

    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Бат"},
    )
    assert person.status_code == 201

    with database() as db:
        assert db.scalar(select(Person).where(Person.id == UUID(person.json()["id"]))) is not None
        assert db.scalar(select(func.count(Lineage.id))) == 0
        assert db.scalar(select(func.count(Branch.id))) == 0


def test_marriage_does_not_create_lineage(client, database):
    register_verified(client, "marriage-no-lineage@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Гэрлэлт"}).json()["id"]
    people = [
        client.post(
            f"/api/v1/families/{family_id}/persons",
            json={"first_name": name},
        ).json()
        for name in ["А", "Б"]
    ]

    marriage = client.post(
        f"/api/v1/families/{family_id}/marriages",
        json={"person_1_id": people[0]["id"], "person_2_id": people[1]["id"]},
    )
    assert marriage.status_code == 201

    with database() as db:
        assert db.scalar(select(func.count(Lineage.id))) == 0
        assert db.scalar(select(Marriage.id).where(Marriage.id == UUID(marriage.json()["id"]))) is not None


def test_parent_child_does_not_create_lineage(client, database):
    register_verified(client, "parent-no-lineage@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Эцэг эх"}).json()["id"]
    parent = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Эцэг"},
    ).json()
    child = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Хүүхэд"},
    ).json()

    relationship = client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": parent["id"], "child_id": child["id"]},
    )
    assert relationship.status_code == 201

    with database() as db:
        assert db.scalar(select(func.count(Lineage.id))) == 0
        assert (
            db.scalar(
                select(ParentChildRelationship.id).where(
                    ParentChildRelationship.id == UUID(relationship.json()["id"])
                )
            )
            is not None
        )


def test_lineage_and_branch_names_are_unique_within_their_parent(client):
    register_verified(client, "lineage-unique@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Unique"}).json()["id"]

    first = client.post(
        f"/api/v1/families/{family_id}/lineages",
        json={"name": "Удам"},
    )
    assert first.status_code == 201

    duplicate = client.post(
        f"/api/v1/families/{family_id}/lineages",
        json={"name": "Удам"},
    )
    assert duplicate.status_code == 409

    branch = client.post(
        f"/api/v1/lineages/{first.json()['id']}/branches",
        json={"name": "A1"},
    )
    assert branch.status_code == 201

    duplicate_branch = client.post(
        f"/api/v1/lineages/{first.json()['id']}/branches",
        json={"name": "A1"},
    )
    assert duplicate_branch.status_code == 409

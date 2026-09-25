from datetime import date
from uuid import UUID, uuid4

from conftest import register_verified
from app.models import FamilyPerson, Person, User
from app.person_search import normalize_search_name


def test_person_profile_returns_canonical_identity_lineage_and_relationship_summary(client):
    register_verified(client, "profile-foundation@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Профайлын гэр бүл"}).json()["id"]

    parent = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Эцэг", "last_name": "Хүн"},
    ).json()
    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Төв", "last_name": "Хүн"},
    ).json()
    spouse = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Хань", "last_name": "Хүн"},
    ).json()
    child = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Хүүхэд", "last_name": "Хүн", "birth_date": "1980-01-01"},
    ).json()

    lineage = client.post(
        f"/api/v1/families/{family_id}/lineages",
        json={"name": "Дээд удам"},
    ).json()
    branch = client.post(
        f"/api/v1/lineages/{lineage['id']}/branches",
        json={"name": "Баруун салаа"},
    ).json()
    assignment = client.put(
        f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment",
        json={"lineage_id": lineage["id"], "branch_id": branch["id"]},
    )
    assert assignment.status_code == 200

    assert client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": parent["id"], "child_id": person["id"]},
    ).status_code == 201
    assert client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": person["id"], "child_id": child["id"]},
    ).status_code == 201
    assert client.post(
        f"/api/v1/families/{family_id}/marriages",
        json={"person_1_id": person["id"], "person_2_id": spouse["id"]},
    ).status_code == 201

    response = client.get(
        f"/api/v1/families/{family_id}/persons/{person['id']}"
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["id"] == person["id"]
    assert payload["lineage_id"] == lineage["id"]
    assert payload["lineage_name"] == "Дээд удам"
    assert payload["branch_id"] == branch["id"]
    assert payload["branch_name"] == "Баруун салаа"
    assert [item["id"] for item in payload["parents"]] == [parent["id"]]
    assert [item["id"] for item in payload["children"]] == [child["id"]]
    assert [item["id"] for item in payload["spouses"]] == [spouse["id"]]


def test_person_profile_is_family_scoped_and_rejects_unknown_ids(client):
    register_verified(client, "profile-scope@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Нэг"}).json()["id"]
    other_family_id = client.post("/api/v1/families", json={"name": "Хоёр"}).json()["id"]
    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Нэгийн", "last_name": "Хүн"},
    ).json()
    outsider = client.post(
        f"/api/v1/families/{other_family_id}/persons",
        json={"first_name": "Хоёрын", "last_name": "Хүн"},
    ).json()

    wrong_family = client.get(
        f"/api/v1/families/{family_id}/persons/{outsider['id']}"
    )
    assert wrong_family.status_code == 404

    unknown = client.get(
        f"/api/v1/families/{family_id}/persons/{uuid4()}"
    )
    assert unknown.status_code == 404

    assert client.get(
        f"/api/v1/families/{family_id}/persons/{person['id']}"
    ).status_code == 200

    register_verified(client, "profile-non-member@example.com")
    assert client.get(
        f"/api/v1/families/{family_id}/persons/{person['id']}"
    ).status_code == 403


def test_person_profile_does_not_leak_minor_relationship_without_guardian_scope(client):
    register_verified(client, "profile-minor@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Насанд хүрээгүй"}).json()["id"]
    adult = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Насанд хүрсэн", "birth_date": "1980-01-01"},
    ).json()
    minor = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Хүүхэд", "birth_date": date.today().replace(year=date.today().year - 10).isoformat()},
    ).json()
    assert client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": adult["id"], "child_id": minor["id"]},
    ).status_code == 201

    response = client.get(
        f"/api/v1/families/{family_id}/persons/{adult['id']}"
    )
    assert response.status_code == 200
    assert response.json()["children"] == []


def test_person_profile_private_person_is_not_exposed_across_creator_boundary(client, database):
    register_verified(client, "profile-private-owner@example.com")
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_id = UUID(
        client.post("/api/v1/families", json={"name": "Нууц профайл"}).json()["id"]
    )
    private_creator_id = uuid4()
    private_person_id = uuid4()

    with database() as db:
        db.add(
            User(
                id=private_creator_id,
                email="profile-private-creator@example.com",
                display_name="Нууц бүтээгч",
                password_hash=None,
                is_active=True,
            )
        )
        db.flush()
        db.add(
            Person(
                id=private_person_id,
                first_name="Нууц",
                last_name="Хүн",
                search_first_name=normalize_search_name("Нууц"),
                search_last_name=normalize_search_name("Хүн"),
                search_middle_name="",
                visibility="private",
                created_by=private_creator_id,
            )
        )
        db.add(
            FamilyPerson(
                id=uuid4(),
                family_id=family_id,
                person_id=private_person_id,
                added_by=owner_id,
            )
        )
        db.commit()

    response = client.get(
        f"/api/v1/families/{family_id}/persons/{private_person_id}"
    )
    assert response.status_code == 404

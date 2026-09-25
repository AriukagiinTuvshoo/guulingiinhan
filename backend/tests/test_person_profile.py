from datetime import UTC, datetime
from uuid import uuid4

from app.models import Person
from conftest import database, register_verified


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
        json={"first_name": "Хүүхэд", "birth_date": (datetime.now(UTC).date().replace(year=datetime.now(UTC).year - 10)).isoformat()},
    ).json()

    with database() as db:
        minor_record = db.get(Person, minor["id"])
        assert minor_record is not None
        minor_record.profile_photo_url = "https://example.invalid/minor-photo.jpg"
        db.commit()
    assert client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": adult["id"], "child_id": minor["id"]},
    ).status_code == 201

    response = client.get(
        f"/api/v1/families/{family_id}/persons/{adult['id']}"
    )
    assert response.status_code == 200
    assert response.json()["children"] == []
    assert response.json()["profile_photo_url"] is None


def test_person_profile_private_person_is_not_exposed_across_creator_boundary(client, email_provider):
    owner_email = "profile-private-owner@example.com"
    private_creator_email = "profile-private-creator@example.com"
    password = "strong-passphrase-123"
    register_verified(client, owner_email, password)
    family_id = client.post(
        "/api/v1/families", json={"name": "Нууц профайл"}
    ).json()["id"]

    invitation = client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": private_creator_email, "role": "editor"},
    )
    assert invitation.status_code == 201
    delivery = next(
        item
        for item in reversed(email_provider.deliveries)
        if item.recipient == private_creator_email
    )
    token = delivery.text.rsplit(" ", 1)[-1].split("#token=", 1)[1]

    register_verified(client, private_creator_email)
    assert client.post("/api/v1/invitations/accept", json={"token": token}).status_code == 200
    private_person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Нууц", "last_name": "Хүн", "visibility": "private"},
    ).json()

    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login",
        json={"email": owner_email, "password": password},
    ).status_code == 200

    response = client.get(
        f"/api/v1/families/{family_id}/persons/{private_person['id']}"
    )
    assert response.status_code == 404


def test_person_profile_unknown_id_is_not_resolvable(client):
    register_verified(client, "profile-unknown@example.com")
    family_id = client.post(
        "/api/v1/families", json={"name": "UUID"}
    ).json()["id"]
    assert client.get(
        f"/api/v1/families/{family_id}/persons/{uuid4()}"
    ).status_code == 404

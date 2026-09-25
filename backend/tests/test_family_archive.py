from uuid import UUID

from conftest import register_verified

from app.models import FamilyMember, User


def test_archive_crud_search_person_link_and_genealogy_regression(client):
    register_verified(client, "archive-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Архивийн гэр бүл"}).json()["id"]
    parent = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Дорж", "last_name": "Өвөө"},
    ).json()
    child = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Бат", "last_name": "Хүү"},
    ).json()
    assert client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": parent["id"], "child_id": child["id"]},
    ).status_code == 201

    before = client.get(
        f"/api/v1/families/{family_id}/tree?person_id={child['id']}&depth=2"
    ).json()

    created = client.post(
        f"/api/v1/families/{family_id}/archives",
        json={
            "title": "Дорж өвөөгийн төрсний гэрчилгээ",
            "description": "Хуучин гэр бүлийн баримт",
            "document_date": "1940-05-10",
            "place": "Улаанбаатар",
            "visibility": "family",
            "person_ids": [parent["id"], child["id"]],
            "author_id": "00000000-0000-0000-0000-000000000001",
        },
    )
    assert created.status_code == 201
    archive = created.json()
    assert archive["author_id"] != "00000000-0000-0000-0000-000000000001"
    assert {person["id"] for person in archive["related_people"]} == {
        parent["id"],
        child["id"],
    }

    listed = client.get(
        f"/api/v1/families/{family_id}/archives?page=1&page_size=12&q=төрсний"
    )
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["title"].startswith("Дорж")

    detail = client.get(f"/api/v1/families/{family_id}/archives/{archive['id']}")
    assert detail.status_code == 200
    assert detail.json()["place"] == "Улаанбаатар"

    person_archives = client.get(
        f"/api/v1/families/{family_id}/persons/{parent['id']}/archives?page=1&page_size=5"
    )
    assert person_archives.status_code == 200
    assert person_archives.json()["total"] == 1

    updated = client.put(
        f"/api/v1/families/{family_id}/archives/{archive['id']}",
        json={
            "title": "1940 оны төрсний гэрчилгээ",
            "description": "Шинэ тайлбар",
            "person_ids": [parent["id"]],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "1940 оны төрсний гэрчилгээ"
    assert [item["id"] for item in updated.json()["related_people"]] == [parent["id"]]

    after = client.get(
        f"/api/v1/families/{family_id}/tree?person_id={child['id']}&depth=2"
    ).json()
    assert after["parent_child_relationships"] == before["parent_child_relationships"]
    assert after["marriages"] == before["marriages"]

    assert client.delete(
        f"/api/v1/families/{family_id}/archives/{archive['id']}"
    ).status_code == 204
    assert client.get(
        f"/api/v1/families/{family_id}/archives/{archive['id']}"
    ).status_code == 404


def test_archive_rejects_cross_family_and_duplicate_people(client):
    register_verified(client, "archive-cross-family@example.com")
    family_a = client.post("/api/v1/families", json={"name": "А"}).json()["id"]
    family_b = client.post("/api/v1/families", json={"name": "Б"}).json()["id"]
    person_a = client.post(
        f"/api/v1/families/{family_a}/persons", json={"first_name": "А"}
    ).json()
    person_b = client.post(
        f"/api/v1/families/{family_b}/persons", json={"first_name": "Б"}
    ).json()

    cross = client.post(
        f"/api/v1/families/{family_a}/archives",
        json={"title": "Cross", "person_ids": [person_b["id"]]},
    )
    assert cross.status_code == 404

    duplicate = client.post(
        f"/api/v1/families/{family_a}/archives",
        json={"title": "Duplicate", "person_ids": [person_a["id"], person_a["id"]]},
    )
    assert duplicate.status_code == 422

    assert client.get(
        f"/api/v1/families/{family_b}/archives/00000000-0000-0000-0000-000000000001"
    ).status_code == 404


def test_private_archive_is_visible_only_to_creator_and_members_cannot_mutate(client, database):
    register_verified(client, "archive-private-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Нууц архив"}).json()["id"]
    archive = client.post(
        f"/api/v1/families/{family_id}/archives",
        json={"title": "Нууц баримт", "visibility": "private"},
    ).json()

    register_verified(client, "archive-private-member@example.com")
    with database() as db:
        member = db.query(User).filter(
            User.email == "archive-private-member@example.com"
        ).one()
        db.add(FamilyMember(family_id=UUID(family_id), user_id=member.id, role="member"))
        db.commit()

    assert client.get(
        f"/api/v1/families/{family_id}/archives/{archive['id']}"
    ).status_code == 404
    assert client.get(
        f"/api/v1/families/{family_id}/archives?page=1&page_size=12"
    ).json()["total"] == 0
    assert client.put(
        f"/api/v1/families/{family_id}/archives/{archive['id']}",
        json={"title": "өөр", "person_ids": []},
    ).status_code == 403
    assert client.delete(
        f"/api/v1/families/{family_id}/archives/{archive['id']}"
    ).status_code == 403


def test_archive_validation_pagination_and_family_isolation(client):
    register_verified(client, "archive-validation@example.com")
    family_a = client.post("/api/v1/families", json={"name": "А"}).json()["id"]
    family_b = client.post("/api/v1/families", json={"name": "Б"}).json()["id"]

    whitespace = client.post(
        f"/api/v1/families/{family_a}/archives",
        json={"title": "   "},
    )
    assert whitespace.status_code == 422

    for index in range(3):
        assert client.post(
            f"/api/v1/families/{family_a}/archives",
            json={"title": f"Баримт {index}"},
        ).status_code == 201

    page = client.get(
        f"/api/v1/families/{family_a}/archives?page=1&page_size=2"
    )
    assert page.status_code == 200
    assert page.json()["page_size"] == 2
    assert page.json()["total"] == 3
    assert page.json()["has_next"] is True

    assert client.get(
        f"/api/v1/families/{family_b}/archives?page=1&page_size=50"
    ).json()["total"] == 0

    no_result = client.get(
        f"/api/v1/families/{family_a}/archives?q=байхгүй&page=1&page_size=50"
    )
    assert no_result.status_code == 200
    assert no_result.json()["total"] == 0


def test_archive_authoring_validation_and_editor_update(client, database):
    register_verified(client, "archive-editor-owner@example.com")
    family_id = client.post(
        "/api/v1/families", json={"name": "Authoring validation"}
    ).json()["id"]
    archive = client.post(
        f"/api/v1/families/{family_id}/archives",
        json={"title": "Эх баримт"},
    ).json()

    invalid_visibility = client.post(
        f"/api/v1/families/{family_id}/archives",
        json={"title": "Буруу харагдац", "visibility": "everyone"},
    )
    assert invalid_visibility.status_code == 422

    invalid_date = client.post(
        f"/api/v1/families/{family_id}/archives",
        json={"title": "Буруу огноо", "document_date": "not-a-date"},
    )
    assert invalid_date.status_code == 422

    spoofed = client.put(
        f"/api/v1/families/{family_id}/archives/{archive['id']}",
        json={
            "title": "Шинэ нэр",
            "author_id": "00000000-0000-0000-0000-000000000001",
            "person_ids": [],
        },
    )
    assert spoofed.status_code == 200
    assert spoofed.json()["author_id"] == archive["author_id"]

    register_verified(client, "archive-editor@example.com")
    with database() as db:
        editor = db.query(User).filter(User.email == "archive-editor@example.com").one()
        db.add(
            FamilyMember(
                family_id=UUID(family_id),
                user_id=editor.id,
                role="editor",
            )
        )
        db.commit()

    editor_update = client.put(
        f"/api/v1/families/{family_id}/archives/{archive['id']}",
        json={"title": "Editor шинэчилсэн", "person_ids": []},
    )
    assert editor_update.status_code == 200
    assert editor_update.json()["title"] == "Editor шинэчилсэн"

from uuid import UUID

from conftest import register_verified

from app.models import FamilyMember, User


def test_story_crud_person_links_and_genealogy_are_separate(client, database):
    register_verified(client, "story-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Түүхийн гэр бүл"}).json()["id"]
    parent = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Эцэг", "last_name": "Түүх"},
    ).json()
    child = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Хүүхэд", "last_name": "Түүх"},
    ).json()
    assert client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": parent["id"], "child_id": child["id"]},
    ).status_code == 201
    spouse = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Хань", "last_name": "Түүх"},
    ).json()
    assert client.post(
        f"/api/v1/families/{family_id}/marriages",
        json={"person_1_id": child["id"], "person_2_id": spouse["id"]},
    ).status_code == 201
    lineage = client.post(
        f"/api/v1/families/{family_id}/lineages",
        json={"name": "Үндсэн удам"},
    ).json()
    branch = client.post(
        f"/api/v1/lineages/{lineage['id']}/branches",
        json={"name": "Үндсэн салаа"},
    ).json()
    assert client.put(
        f"/api/v1/families/{family_id}/persons/{child['id']}/lineage-assignment",
        json={"lineage_id": lineage["id"], "branch_id": branch["id"]},
    ).status_code == 200

    before = client.get(f"/api/v1/families/{family_id}/persons/{child['id']}")
    assert before.status_code == 200
    before_parent_ids = [item["id"] for item in before.json()["parents"]]
    before_tree = client.get(f"/api/v1/families/{family_id}/tree?person_id={child['id']}&depth=2").json()
    before_lineage = client.get(f"/api/v1/families/{family_id}/persons/{child['id']}/lineage-assignment").json()

    created = client.post(
        f"/api/v1/families/{family_id}/stories",
        json={
            "title": "Нүүдлийн дурсамж",
            "body": "Манай гэр бүл энэ өдөр хамтдаа аялсан.",
            "event_date": "2020-06-01",
            "place": "Хөвсгөл",
            "person_ids": [parent["id"], child["id"]],
            "visibility": "family",
        },
    )
    assert created.status_code == 201
    story = created.json()
    assert story["author_id"]
    assert {item["id"] for item in story["related_people"]} == {parent["id"], child["id"]}

    listed = client.get(f"/api/v1/families/{family_id}/stories?page=1&page_size=12")
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["excerpt"].startswith("Манай гэр бүл")

    filtered = client.get(
        f"/api/v1/families/{family_id}/stories?page=1&page_size=12&person_id={child['id']}"
    )
    assert filtered.status_code == 200
    assert filtered.json()["total"] == 1

    detail = client.get(f"/api/v1/families/{family_id}/stories/{story['id']}")
    assert detail.status_code == 200
    assert detail.json()["body"] == "Манай гэр бүл энэ өдөр хамтдаа аялсан."

    updated = client.put(
        f"/api/v1/families/{family_id}/stories/{story['id']}",
        json={"title": "Шинэ гарчиг", "body": "Шинэ агуулга", "person_ids": [child["id"]]},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Шинэ гарчиг"
    assert [item["id"] for item in updated.json()["related_people"]] == [child["id"]]

    after = client.get(f"/api/v1/families/{family_id}/persons/{child['id']}")
    assert after.status_code == 200
    assert [item["id"] for item in after.json()["parents"]] == before_parent_ids
    after_tree = client.get(f"/api/v1/families/{family_id}/tree?person_id={child['id']}&depth=2").json()
    after_lineage = client.get(f"/api/v1/families/{family_id}/persons/{child['id']}/lineage-assignment").json()
    assert after_tree["parent_child_relationships"] == before_tree["parent_child_relationships"]
    assert after_tree["marriages"] == before_tree["marriages"]
    assert after_lineage["lineage_id"] == before_lineage["lineage_id"]
    assert after_lineage["branch_id"] == before_lineage["branch_id"]

    deleted = client.delete(f"/api/v1/families/{family_id}/stories/{story['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/families/{family_id}/stories/{story['id']}").status_code == 404

    with database() as db:
        assert db.query(FamilyMember).filter(FamilyMember.family_id == UUID(family_id)).count() == 1


def test_story_rejects_cross_family_people_and_story_ids(client):
    register_verified(client, "story-cross-family@example.com")
    family_a = client.post("/api/v1/families", json={"name": "А"}).json()["id"]
    family_b = client.post("/api/v1/families", json={"name": "Б"}).json()["id"]
    person_a = client.post(
        f"/api/v1/families/{family_a}/persons",
        json={"first_name": "А", "last_name": "Хүн"},
    ).json()
    person_b = client.post(
        f"/api/v1/families/{family_b}/persons",
        json={"first_name": "Б", "last_name": "Хүн"},
    ).json()

    assert client.post(
        f"/api/v1/families/{family_a}/stories",
        json={"title": "Cross", "body": "Cross", "person_ids": [person_b["id"]]},
    ).status_code == 404

    story = client.post(
        f"/api/v1/families/{family_a}/stories",
        json={"title": "A story", "body": "A body", "person_ids": [person_a["id"]]},
    ).json()
    assert client.get(f"/api/v1/families/{family_b}/stories/{story['id']}").status_code == 404


def test_private_story_is_visible_only_to_creator(client, database):
    register_verified(client, "story-private-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Private story"}).json()["id"]
    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Private", "last_name": "Person"},
    ).json()

    story = client.post(
        f"/api/v1/families/{family_id}/stories",
        json={"title": "Нууц", "body": "Зөвхөн надад", "visibility": "private", "person_ids": [person["id"]]},
    ).json()

    register_verified(client, "story-private-member@example.com")
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family_id), user_id=db.query(User).filter(User.email == "story-private-member@example.com").one().id, role="member"))
        db.commit()

    hidden = client.get(f"/api/v1/families/{family_id}/stories/{story['id']}")
    assert hidden.status_code == 404

    client.post(
        "/api/v1/auth/login",
        json={"email": "story-private-owner@example.com", "password": "strong-passphrase-123"},
    )
    visible = client.get(f"/api/v1/families/{family_id}/stories/{story['id']}")
    assert visible.status_code == 200

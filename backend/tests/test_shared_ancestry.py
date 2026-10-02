from uuid import UUID

from app.models import (
    AdminGrant,
    AuditLog,
    Family,
    SharedAncestryPerson,
    SharedAncestryRelationship,
)
from tests.conftest import register_verified

PASSWORD = "shared-ancestry-passphrase-123"


def _login(client, provider, email):
    assert register_verified(client, email, PASSWORD, provider).status_code == 201
    return UUID(client.get("/api/v1/auth/me").json()["id"])


def test_super_admin_sets_shared_root_and_users_opt_in(client, database, email_provider):
    admin_id = _login(client, email_provider, "ancestry-admin@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))

    root_family = client.post("/api/v1/families", json={"name": "Гол удам"}).json()
    root = client.post(f"/api/v1/families/{root_family['id']}/persons", json={
        "first_name": "Бат", "last_name": "Удмын", "birth_date": "1940-01-01",
        "is_alive": False, "death_date": "2010-01-01",
    }).json()
    assert client.get("/api/v1/admin/shared-lineage/candidates").status_code == 200
    set_root = client.put("/api/v1/admin/shared-lineage/root", json={"person_id": root["id"]})
    assert set_root.status_code == 200
    assert set_root.json()["root_person_id"] == root["id"]

    _login(client, email_provider, "ancestry-member@example.com")
    family = client.post("/api/v1/families", json={"name": "Миний салбар"}).json()
    person = client.post(f"/api/v1/families/{family['id']}/persons", json={
        "first_name": "Саруул", "last_name": "Гишүүн", "birth_date": "1990-01-01",
    }).json()
    assert client.post(f"/api/v1/families/{family['id']}/persons/{person['id']}/link-me").status_code == 204

    no_consent = client.post("/api/v1/shared-lineage/join", json={
        "person_id": person["id"], "parent_person_id": root["id"],
        "relationship_type": "biological", "share_consent": False,
    })
    assert no_consent.status_code == 422
    joined = client.post("/api/v1/shared-lineage/join", json={
        "person_id": person["id"], "parent_person_id": root["id"],
        "relationship_type": "biological", "share_consent": True,
    })
    assert joined.status_code == 201
    assert {row["id"] for row in joined.json()["persons"]} == {root["id"], person["id"]}
    assert joined.json()["relationships"][0]["parent_id"] == root["id"]
    with database() as db:
        assert db.get(SharedAncestryPerson, UUID(person["id"])) is not None
        assert db.query(SharedAncestryRelationship).count() == 1

    # The family tree remains separately available, while other accounts see only opted-in people.
    assert client.get(f"/api/v1/families/{family['id']}/tree?scope=all").status_code == 200
    _login(client, email_provider, "ancestry-observer@example.com")
    shared = client.get("/api/v1/shared-lineage").json()
    assert {row["id"] for row in shared["persons"]} == {root["id"], person["id"]}

    signed_in = client.post("/api/v1/auth/login", json={
        "email": "ancestry-member@example.com", "password": PASSWORD,
    })
    assert signed_in.status_code == 200
    unlinked = client.put("/api/v1/shared-lineage/relationships/me", json={
        "parent_person_id": None, "relationship_type": "biological",
    })
    assert unlinked.status_code == 200
    assert unlinked.json()["relationships"] == []
    assert {row["id"] for row in unlinked.json()["persons"]} == {root["id"], person["id"]}
    corrected = client.put("/api/v1/shared-lineage/relationships/me", json={
        "parent_person_id": root["id"], "relationship_type": "adoptive",
    })
    assert corrected.status_code == 200
    assert corrected.json()["relationships"][0]["relationship_type"] == "adoptive"
    assert client.delete("/api/v1/shared-lineage/people/me").status_code == 204
    with database() as db:
        assert db.get(SharedAncestryPerson, UUID(person["id"])) is None
    assert client.get(f"/api/v1/families/{family['id']}/persons/{person['id']}").status_code in {200, 404}


def test_admin_can_correct_consented_shared_branches_without_changing_family_tree(client, database, email_provider):
    admin_id = _login(client, email_provider, "ancestry-editor@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    family = client.post("/api/v1/families", json={"name": "Нэг үндэс"}).json()
    root = client.post(f"/api/v1/families/{family['id']}/persons", json={
        "first_name": "Гуулин", "birth_date": "1940-01-01",
    }).json()
    assert client.put("/api/v1/admin/shared-lineage/root", json={"person_id": root["id"]}).status_code == 200
    _login(client, email_provider, "ancestry-branch@example.com")
    branch_family = client.post("/api/v1/families", json={"name": "Салаа"}).json()
    branch_person = client.post(f"/api/v1/families/{branch_family['id']}/persons", json={
        "first_name": "Хүүхэд", "birth_date": "1980-01-01",
    }).json()
    assert client.post(f"/api/v1/families/{branch_family['id']}/persons/{branch_person['id']}/link-me").status_code == 204
    assert client.post("/api/v1/shared-lineage/join", json={
        "person_id": branch_person["id"], "share_consent": True,
    }).status_code == 201
    assert client.get(f"/api/v1/families/{branch_family['id']}/tree?scope=all").status_code == 200
    assert client.post("/api/v1/admin/shared-lineage/relationships", json={
        "parent_person_id": root["id"], "child_person_id": branch_person["id"],
    }).status_code == 403
    assert client.post("/api/v1/auth/login", json={
        "email": "ancestry-editor@example.com", "password": PASSWORD,
    }).status_code == 200
    added = client.post("/api/v1/admin/shared-lineage/relationships", json={
        "parent_person_id": root["id"], "child_person_id": branch_person["id"],
        "relationship_type": "biological",
    })
    assert added.status_code == 201
    edge_id = added.json()["relationships"][0]["id"]
    assert client.post("/api/v1/admin/shared-lineage/relationships", json={
        "parent_person_id": branch_person["id"], "child_person_id": root["id"],
    }).status_code == 422
    assert client.delete(f"/api/v1/admin/shared-lineage/relationships/{edge_id}").status_code == 200
    assert client.get("/api/v1/shared-lineage").json()["relationships"] == []


def test_shared_ancestry_root_can_be_corrected_without_losing_people_or_edges(client, database, email_provider):
    admin_id = _login(client, email_provider, "ancestry-singleton@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    family = client.post("/api/v1/families", json={"name": "Нэг удам"}).json()
    people = [client.post(f"/api/v1/families/{family['id']}/persons", json={
        "first_name": f"Хүн {index}", "birth_date": "1950-01-01",
    }).json() for index in (1, 2)]
    family_root_id = UUID(family["id"])
    with database() as db:
        family_root_before = db.get(Family, family_root_id).root_person_id
    assert client.put("/api/v1/admin/shared-lineage/root", json={"person_id": people[0]["id"]}).status_code == 200

    _login(client, email_provider, "ancestry-root-member@example.com")
    member_family = client.post("/api/v1/families", json={"name": "Салбар удам"}).json()
    member_person = client.post(f"/api/v1/families/{member_family['id']}/persons", json={
        "first_name": "Салбарын хүн", "birth_date": "1990-01-01",
    }).json()
    assert client.post(f"/api/v1/families/{member_family['id']}/persons/{member_person['id']}/link-me").status_code == 204
    joined = client.post("/api/v1/shared-lineage/join", json={
        "person_id": member_person["id"], "parent_person_id": people[0]["id"],
        "relationship_type": "biological", "share_consent": True,
    })
    assert joined.status_code == 201

    assert client.post("/api/v1/auth/login", json={
        "email": "ancestry-singleton@example.com", "password": PASSWORD,
    }).status_code == 200
    stale = client.put("/api/v1/admin/shared-lineage/root", json={"person_id": people[1]["id"]})
    assert stale.status_code == 409
    replaced = client.put("/api/v1/admin/shared-lineage/root", json={
        "person_id": people[1]["id"], "expected_root_person_id": people[0]["id"],
    })
    assert replaced.status_code == 200
    result = replaced.json()
    assert result["root_person_id"] == people[1]["id"]
    assert {row["id"] for row in result["persons"]} >= {people[0]["id"], people[1]["id"], member_person["id"]}
    assert any(edge["parent_id"] == people[0]["id"] and edge["child_id"] == member_person["id"]
               for edge in result["relationships"])
    with database() as db:
        assert db.get(SharedAncestryPerson, UUID(people[0]["id"])) is not None
        assert db.get(Family, family_root_id).root_person_id == family_root_before
        actions = {row.action for row in db.query(AuditLog).filter(
            AuditLog.action.in_(("shared_ancestry.root_replaced_from", "shared_ancestry.root_replaced_to"))
        )}
        assert actions == {"shared_ancestry.root_replaced_from", "shared_ancestry.root_replaced_to"}


def test_global_donation_details_are_admin_controlled_and_visible_to_all_accounts(client, database, email_provider):
    admin_id = _login(client, email_provider, "shared-fund-admin@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    assert client.get("/api/v1/shared-lineage/donation-info").json() is None
    assert client.put("/api/v1/admin/shared-lineage/donation-info", json={
        "title": "Удмын сан", "purpose": "Модны арчилгаа", "currency": "MNT",
        "bank_name": "", "account_name": "", "account_number": "", "qr_image_url": None,
        "is_published": True,
    }).status_code == 422
    saved = client.put("/api/v1/admin/shared-lineage/donation-info", json={
        "title": "Удмын сан", "purpose": "Модны арчилгаа", "currency": "MNT",
        "bank_name": "Ногоон банк", "account_name": "Гуулингийнхан",
        "account_number": "1234567890", "qr_image_url": "https://example.com/qr.png",
        "is_published": False,
    })
    assert saved.status_code == 200
    assert client.get("/api/v1/shared-lineage/donation-info").json() is None
    payload = {key: saved.json()[key] for key in (
        "title", "purpose", "currency", "bank_name", "account_name", "account_number", "qr_image_url",
    )}
    client.put("/api/v1/admin/shared-lineage/donation-info", json={**payload, "is_published": True})
    assert client.get("/api/v1/shared-lineage/donation-info").json()["account_number"] == "1234567890"
    assert client.put("/api/v1/admin/shared-lineage/donation-info", json={
        **payload, "qr_image_url": "http://example.com/unsafe.png", "is_published": True,
    }).status_code == 422

    _login(client, email_provider, "shared-fund-member@example.com")
    public_info = client.get("/api/v1/shared-lineage/donation-info").json()
    assert public_info["title"] == "Удмын сан"
    assert public_info["qr_image_url"] == "https://example.com/qr.png"

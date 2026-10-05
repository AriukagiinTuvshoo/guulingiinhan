from uuid import UUID, uuid4

from app.models import (
    AdminGrant,
    AuditLog,
    Family,
    ParentChildRelationship,
    SharedAncestryPerson,
    SharedAncestryRelationship,
)
from tests.conftest import register_verified

PASSWORD = "shared-ancestry-passphrase-123"


def test_admin_publishes_existing_ancestor_children_using_canonical_edges(client, database, email_provider):
    admin_id = _login(client, email_provider, "ancestry-canonical-admin@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    family_id = client.post("/api/v1/families", json={"name": "Canonical family"}).json()["id"]
    base = f"/api/v1/admin/families/{family_id}"
    root = client.post(base + "/people", json={
        "first_name": "Ядамсүрэн", "birth_date": "1880-01-01", "is_alive": False,
        "death_date": "1950-01-01",
    }).json()
    partner = client.post(base + "/people", json={
        "first_name": "Гүнд", "birth_date": "1883-01-01", "is_alive": False,
        "death_date": "1955-01-01",
    }).json()
    child_names = ("Долгор", "Нансалмаа", "Баавай", "Бадамдорж")
    children = [client.post(base + "/people", json={
        "first_name": name, "birth_date": "1920-01-01", "is_alive": False,
        "death_date": "1990-01-01",
    }).json() for name in child_names]
    assert client.put("/api/v1/admin/shared-lineage/root", json={
        "person_id": root["id"], "expected_root_person_id": None,
    }).status_code == 200
    candidates = client.get("/api/v1/admin/shared-lineage/candidates").json()
    assert all(any(row["id"] == child["id"] and row["family_id"] == family_id
                   for row in candidates) for child in children)
    partner_published = client.post("/api/v1/admin/shared-lineage/people", json={
        "person_id": partner["id"], "family_id": family_id,
    })
    assert partner_published.status_code == 201, partner_published.text
    partner_link = client.post("/api/v1/admin/shared-lineage/root-partner", json={
        "person_id": partner["id"], "expected_root_person_id": root["id"],
    })
    assert partner_link.status_code == 201, partner_link.text
    assert client.post("/api/v1/admin/shared-lineage/root-partner", json={
        "person_id": partner["id"], "expected_root_person_id": str(uuid4()),
    }).status_code == 409
    for child in children:
        published = client.post("/api/v1/admin/shared-lineage/people", json={
            "person_id": child["id"], "family_id": family_id,
        })
        assert published.status_code == 201, published.text
        linked = client.post("/api/v1/admin/shared-lineage/relationships", json={
            "parent_person_id": root["id"], "child_person_id": child["id"],
        })
        assert linked.status_code == 201, linked.text
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 4
        assert db.query(SharedAncestryRelationship).count() == 0

    _login(client, email_provider, "ancestry-canonical-viewer@example.com")
    shared = client.get("/api/v1/shared-lineage").json()
    assert shared["root_person_id"] == root["id"]
    assert {person["id"] for person in shared["persons"]} == {
        root["id"], partner["id"], *(child["id"] for child in children),
    }
    assert shared["root_partner_person_id"] == partner["id"]
    assert len(shared["spouses"]) == 1
    assert {shared["spouses"][0]["person_1_id"], shared["spouses"][0]["person_2_id"]} == {
        root["id"], partner["id"],
    }
    assert {edge["child_id"] for edge in shared["relationships"]} == {
        child["id"] for child in children
    }
    assert client.get(f"/api/v1/families/{family_id}/tree?scope=all").status_code == 403


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
    request = client.post(f"/api/v1/families/{family['id']}/root-connection", json={
        "person_id": person["id"], "target_person_id": root["id"],
        "relationship_type": "biological", "share_consent": True,
    })
    assert request.status_code == 200, request.text
    assert request.json()["status"] == "pending"
    assert client.post(f"/api/v1/families/{family['id']}/root-connection", json={
        "person_id": person["id"], "target_person_id": root["id"],
        "relationship_type": "biological", "share_consent": True,
    }).json()["status"] == "pending"
    assert client.post("/api/v1/auth/login", json={
        "email": "ancestry-admin@example.com", "password": PASSWORD,
    }).status_code == 200
    approved = client.post(f"/api/v1/admin/shared-lineage/connections/{family['id']}/decision",
                           json={"approve": True})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    with database() as db:
        assert db.get(SharedAncestryPerson, UUID(person["id"])) is not None
        assert db.query(SharedAncestryRelationship).count() == 0
        assert db.query(ParentChildRelationship).count() == 1

    # The family tree remains separately available, while other accounts see only opted-in people.
    assert client.get(f"/api/v1/families/{family['id']}/tree?scope=all").status_code == 403
    _login(client, email_provider, "ancestry-observer@example.com")
    shared = client.get("/api/v1/shared-lineage").json()
    assert {row["id"] for row in shared["persons"]} == {root["id"], person["id"]}
    assert all(len(row["birth_date"]) == 4 for row in shared["persons"])
    assert all("profile_photo" not in row for row in shared["persons"])
    assert client.get(f"/api/v1/families/{family['id']}/root-connection").status_code == 404

    signed_in = client.post("/api/v1/auth/login", json={
        "email": "ancestry-member@example.com", "password": PASSWORD,
    })
    assert signed_in.status_code == 200
    unlinked = client.delete(f"/api/v1/families/{family['id']}/root-connection")
    assert unlinked.status_code == 200
    assert unlinked.json()["status"] == "disconnected"
    assert client.get("/api/v1/shared-lineage").json()["relationships"] == []
    corrected = client.post(f"/api/v1/families/{family['id']}/root-connection", json={
        "person_id": person["id"], "target_person_id": root["id"],
        "relationship_type": "biological", "share_consent": True,
    })
    assert corrected.status_code == 200
    assert corrected.json()["status"] == "pending"
    assert client.post("/api/v1/auth/login", json={
        "email": "ancestry-admin@example.com", "password": PASSWORD,
    }).status_code == 200
    assert client.post(f"/api/v1/admin/shared-lineage/connections/{family['id']}/decision",
                       json={"approve": True}).json()["status"] == "approved"
    assert client.post("/api/v1/auth/login", json={
        "email": "ancestry-member@example.com", "password": PASSWORD,
    }).status_code == 200
    assert client.delete("/api/v1/shared-lineage/people/me").status_code == 204
    with database() as db:
        assert db.get(SharedAncestryPerson, UUID(person["id"])) is None
    assert client.get(f"/api/v1/families/{family['id']}/persons/{person['id']}").status_code in {200, 404}


def test_root_connection_requires_real_person_explicit_consent_and_admin_review(
    client, database, email_provider,
):
    admin_id = _login(client, email_provider, "root-flow-admin@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    ancestor_family = client.post("/api/v1/families", json={"name": "Ancestor"}).json()
    ancestor = client.post(f"/api/v1/families/{ancestor_family['id']}/persons", json={
        "first_name": "Ancestor", "birth_date": "1910-01-01", "is_alive": False,
        "death_date": "1980-01-01",
    }).json()
    assert client.put("/api/v1/admin/shared-lineage/root", json={
        "person_id": ancestor["id"],
    }).status_code == 200

    _login(client, email_provider, "root-flow-member@example.com")
    family = client.post("/api/v1/families", json={"name": "My family"}).json()
    person = client.post(f"/api/v1/families/{family['id']}/persons", json={
        "first_name": "Member", "birth_date": "1990-01-01",
    }).json()
    assert client.post(f"/api/v1/families/{family['id']}/persons/{person['id']}/link-me").status_code == 204
    endpoint = f"/api/v1/families/{family['id']}/root-connection"
    payload = {"person_id": person["id"], "target_person_id": ancestor["id"],
               "relationship_type": "biological", "share_consent": True}
    assert client.get(endpoint).json()["status"] == "not_connected"
    assert client.post(endpoint, json={**payload, "share_consent": False}).status_code == 422
    assert client.post(endpoint, json={**payload, "target_person_id": str(uuid4())}).status_code == 404
    assert client.post(endpoint, json=payload).json()["status"] == "pending"
    assert client.post(endpoint, json=payload).json()["status"] == "pending"
    assert client.post(f"/api/v1/admin/shared-lineage/connections/{family['id']}/decision",
                       json={"approve": True}).status_code == 403

    _login(client, email_provider, "root-flow-outsider@example.com")
    assert client.get(endpoint).status_code == 404
    assert client.post(endpoint, json=payload).status_code == 404
    assert client.get(f"/api/v1/families/{family['id']}/tree?scope=all").status_code == 403

    assert client.post("/api/v1/auth/login", json={
        "email": "root-flow-admin@example.com", "password": PASSWORD,
    }).status_code == 200
    assert len(client.get("/api/v1/admin/shared-lineage/connections").json()) == 1
    assert client.get("/api/v1/admin/shared-lineage/connections?status=invalid").status_code == 422
    decision = f"/api/v1/admin/shared-lineage/connections/{family['id']}/decision"
    assert client.post(decision, json={"approve": False}).json()["status"] == "rejected"
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 0

    assert client.post("/api/v1/auth/login", json={
        "email": "root-flow-member@example.com", "password": PASSWORD,
    }).status_code == 200
    assert client.post(endpoint, json=payload).json()["status"] == "pending"
    assert client.post("/api/v1/auth/login", json={
        "email": "root-flow-admin@example.com", "password": PASSWORD,
    }).status_code == 200
    assert client.post(decision, json={"approve": True}).json()["status"] == "approved"
    assert client.post(decision, json={"approve": True}).status_code == 409
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 1
        assert db.query(SharedAncestryRelationship).count() == 0
        approved_edge_id = db.query(ParentChildRelationship).one().id
    assert client.post(f"/api/v1/admin/shared-lineage/canonical-relationships/{approved_edge_id}/delete",
                       json={"confirmation": "DELETE_CANONICAL_RELATIONSHIP"}).status_code == 409

    approved = client.get("/api/v1/admin/shared-lineage/connections?status=approved").json()
    assert len(approved) == 1
    assert approved[0]["requested_by_name"]
    assert approved[0]["requested_at"]
    assert approved[0]["decided_at"]
    assert client.delete(f"/api/v1/admin/shared-lineage/connections/{family['id']}").json()["status"] == "disconnected"
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 1
    assert client.get("/api/v1/shared-lineage").json()["relationships"] == []

    assert client.post("/api/v1/auth/login", json={
        "email": "root-flow-member@example.com", "password": PASSWORD,
    }).status_code == 200
    assert client.delete(endpoint).json()["status"] == "disconnected"
    assert client.get("/api/v1/shared-lineage").json()["relationships"] == []
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 1


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
    assert client.post(f"/api/v1/admin/shared-lineage/canonical-relationships/{uuid4()}/delete",
                       json={"confirmation": "DELETE_CANONICAL_RELATIONSHIP"}).status_code == 403
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
    assert client.delete(f"/api/v1/admin/shared-lineage/relationships/{edge_id}").status_code == 409
    with database() as db:
        assert db.get(ParentChildRelationship, UUID(edge_id)) is not None
    correction = f"/api/v1/admin/shared-lineage/canonical-relationships/{edge_id}/delete"
    assert client.post(correction, json={"confirmation": "wrong"}).status_code == 422
    assert client.post(correction, json={
        "confirmation": "DELETE_CANONICAL_RELATIONSHIP",
    }).status_code == 200
    with database() as db:
        assert db.get(ParentChildRelationship, UUID(edge_id)) is None


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
    joined = client.post(f"/api/v1/families/{member_family['id']}/root-connection", json={
        "person_id": member_person["id"], "target_person_id": people[0]["id"],
        "relationship_type": "biological", "share_consent": True,
    })
    assert joined.status_code == 200

    assert client.post("/api/v1/auth/login", json={
        "email": "ancestry-singleton@example.com", "password": PASSWORD,
    }).status_code == 200
    assert client.post(
        f"/api/v1/admin/shared-lineage/connections/{member_family['id']}/decision",
        json={"approve": True},
    ).status_code == 200
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

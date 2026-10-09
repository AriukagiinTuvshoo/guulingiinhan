from uuid import UUID, uuid4

import pytest

from app.models import (
    AdminGrant,
    AuditLog,
    Family,
    FamilyMember,
    Marriage,
    ParentChildRelationship,
    Person,
    SharedAncestryPerson,
    SharedAncestryRelationship,
    UserPersonLink,
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


def test_guided_root_couple_and_relationships_are_atomic(client, database, email_provider):
    admin_id = _login(client, email_provider, "guided-root-admin@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    family_id = client.post("/api/v1/families", json={"name": "Гуулингийнхэн"}).json()["id"]
    base = f"/api/v1/admin/families/{family_id}/people"

    def ancestor(name):
        response = client.post(base, json={"first_name": name, "is_alive": False})
        assert response.status_code == 201, response.text
        return response.json()["id"]

    root_id = ancestor("Ядамсүрэн")
    partner_id = ancestor("Гүнд")
    children = {name: ancestor(name) for name in ("Долгор", "Нансалмаа", "Баавай", "Бадамдорж")}
    grandchild_id = ancestor("Долгорын хүүхэд")
    shared = "/api/v1/admin/shared-lineage"
    assert client.put(shared + "/root-couple", json={
        "root_person_id": root_id, "partner_person_id": partner_id,
        "family_id": family_id, "expected_root_person_id": str(uuid4()),
    }).status_code == 409
    assert client.get("/api/v1/shared-lineage").json()["root_person_id"] is None
    couple = client.put(shared + "/root-couple", json={
        "root_person_id": root_id, "partner_person_id": partner_id,
        "family_id": family_id, "expected_root_person_id": None,
    })
    assert couple.status_code == 200, couple.text
    assert couple.json()["root_person_id"] == root_id
    assert couple.json()["root_partner_person_id"] == partner_id
    assert len(couple.json()["spouses"]) == 1
    for name, person_id in children.items():
        linked = client.post(shared + "/connect-person", json={
            "person_id": person_id, "family_id": family_id,
            "related_person_id": root_id, "second_parent_person_id": partner_id,
            "connection_kind": "child", "relationship_type": "biological",
        })
        assert linked.status_code == 201, f"{name}: {linked.text}"
        assert {edge["parent_id"] for edge in linked.json()["relationships"]
                if edge["child_id"] == person_id} == {root_id, partner_id}
    duplicate = client.post(shared + "/connect-person", json={
        "person_id": children["Долгор"], "family_id": family_id,
        "related_person_id": root_id, "second_parent_person_id": partner_id,
        "connection_kind": "child",
    })
    assert duplicate.status_code == 409
    grandchild = client.post(shared + "/connect-person", json={
        "person_id": grandchild_id, "family_id": family_id,
        "related_person_id": children["Долгор"], "connection_kind": "child",
    })
    assert grandchild.status_code == 201, grandchild.text
    assert {edge["parent_id"] for edge in grandchild.json()["relationships"]
            if edge["child_id"] == grandchild_id} == {children["Долгор"]}
    assert client.post(shared + "/connect-person", json={
        "person_id": root_id, "family_id": family_id,
        "related_person_id": grandchild_id, "connection_kind": "child",
    }).status_code == 422
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 9
        assert db.query(SharedAncestryRelationship).count() == 0
        assert db.query(SharedAncestryPerson).count() == 6
    spouse_id = ancestor("Долгорын хань")
    spouse = client.post(shared + "/connect-person", json={
        "person_id": spouse_id, "family_id": family_id,
        "related_person_id": children["Долгор"], "connection_kind": "spouse",
    })
    assert spouse.status_code == 201, spouse.text
    assert not any(edge["child_id"] == spouse_id for edge in spouse.json()["relationships"])
    assert client.post(shared + "/connect-person", json={
        "person_id": spouse_id, "family_id": family_id,
        "related_person_id": children["Долгор"], "connection_kind": "spouse",
    }).status_code == 409
    second_parent = client.post(shared + "/connect-person", json={
        "person_id": grandchild_id, "family_id": family_id,
        "related_person_id": spouse_id, "connection_kind": "child",
    })
    assert second_parent.status_code == 201, second_parent.text
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 10
        assert db.query(Marriage).count() == 2
    assert client.delete(shared + f"/people/{root_id}").status_code == 409
    detached = client.delete(shared + f"/people/{children['Долгор']}")
    assert detached.status_code == 200, detached.text
    assert children["Долгор"] not in {row["id"] for row in detached.json()["persons"]}
    with database() as db:
        assert db.get(Person, UUID(children["Долгор"])) is not None
        assert db.get(Family, UUID(family_id)) is not None
        assert db.query(ParentChildRelationship).count() == 10
        assert db.query(Marriage).count() == 2


def test_guided_linking_enforces_consent_identity_and_connected_targets(client, database, email_provider):
    admin_id = _login(client, email_provider, "guided-safety-admin@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    family_id = client.post("/api/v1/families", json={"name": "Root test family"}).json()["id"]
    base = f"/api/v1/admin/families/{family_id}/people"

    def person(name, **fields):
        response = client.post(base, json={"first_name": name, "is_alive": False, **fields})
        assert response.status_code == 201, response.text
        return response.json()["id"]

    root_id, partner_id = person("Root"), person("Partner")
    shared = "/api/v1/admin/shared-lineage"
    assert client.put(shared + "/root-couple", json={
        "root_person_id": root_id, "partner_person_id": partner_id, "family_id": family_id,
    }).status_code == 200
    unlinked_id = person("Unlinked")
    assert client.post(shared + "/people", json={
        "person_id": unlinked_id, "family_id": family_id,
    }).status_code == 201
    living_id = person("Living", is_alive=True, birth_date="1990-01-01")
    private_id = person("Private", visibility="private")
    minor_id = person("Minor", is_alive=True, birth_date="2020-01-01", visibility="public")
    for invalid_id in (living_id, private_id, minor_id):
        rejected = client.post(shared + "/connect-person", json={
            "person_id": invalid_id, "family_id": family_id,
            "related_person_id": root_id, "connection_kind": "child",
        })
        assert rejected.status_code == 422, rejected.text
    child_id = person("Valid child")
    assert client.post(shared + "/connect-person", json={
        "person_id": child_id, "family_id": family_id,
        "related_person_id": unlinked_id, "connection_kind": "child",
    }).status_code == 422
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 0
        assert db.get(SharedAncestryPerson, UUID(child_id)) is None

    _login(client, email_provider, "guided-safety-member@example.com")
    member_family = client.post("/api/v1/families", json={"name": "Member test family"}).json()["id"]
    member_person = client.post(f"/api/v1/families/{member_family}/persons", json={
        "first_name": "Member", "birth_date": "1990-01-01",
    }).json()["id"]
    assert client.post(f"/api/v1/families/{member_family}/persons/{member_person}/link-me").status_code == 204
    assert client.post(shared + "/connect-person", json={
        "person_id": member_person, "family_id": member_family,
        "related_person_id": root_id, "connection_kind": "child",
    }).status_code == 403
    assert client.post(f"/api/v1/families/{member_family}/root-connection", json={
        "person_id": member_person, "target_person_id": unlinked_id, "share_consent": True,
    }).status_code == 422
    request = client.post(f"/api/v1/families/{member_family}/root-connection", json={
        "person_id": member_person, "target_person_id": root_id, "share_consent": True,
    })
    assert request.status_code == 200, request.text
    assert request.json()["status"] == "pending"
    assert member_person not in {row["id"] for row in client.get("/api/v1/shared-lineage").json()["persons"]}
    assert client.post("/api/v1/auth/login", json={
        "email": "guided-safety-admin@example.com", "password": PASSWORD,
    }).status_code == 200
    assert client.post(shared + "/connect-person", json={
        "person_id": member_person, "family_id": member_family,
        "related_person_id": root_id, "connection_kind": "child",
    }).status_code == 403
    approved = client.post(shared + f"/connections/{member_family}/decision", json={"approve": True})
    assert approved.status_code == 200, approved.text
    assert client.delete(shared + f"/people/{member_person}").status_code == 200
    with database() as db:
        assert db.get(Person, UUID(member_person)) is not None
        assert db.query(UserPersonLink).filter(UserPersonLink.person_id == UUID(member_person)).count() == 1
        assert db.query(ParentChildRelationship).filter(ParentChildRelationship.child_id == UUID(member_person)).count() == 1


def _login(client, provider, email):
    assert register_verified(client, email, PASSWORD, provider).status_code == 201
    return UUID(client.get("/api/v1/auth/me").json()["id"])


def test_guided_linking_reuses_existing_family_relationships(client, database, email_provider):
    admin_id = _login(client, email_provider, "guided-existing-admin@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    family_id = client.post("/api/v1/families", json={"name": "Existing relationship test"}).json()["id"]
    base = f"/api/v1/admin/families/{family_id}/people"
    people = [client.post(base, json={"first_name": name, "is_alive": False}).json()["id"]
              for name in ("Root", "Partner", "Child", "Spouse")]
    root_id, partner_id, child_id, spouse_id = people
    shared = "/api/v1/admin/shared-lineage"
    assert client.put(shared + "/root-couple", json={
        "root_person_id": root_id, "partner_person_id": partner_id, "family_id": family_id,
    }).status_code == 200
    edge_id, marriage_id = uuid4(), uuid4()
    first, second = sorted((UUID(child_id), UUID(spouse_id)))
    with database.begin() as db:
        db.add(ParentChildRelationship(id=edge_id, parent_id=UUID(root_id), child_id=UUID(child_id),
                                       relationship_type="biological", created_by=admin_id))
        db.add(Marriage(id=marriage_id, person_1_id=first, person_2_id=second,
                        status="widowed", created_by=admin_id))
    child_payload = {"person_id": child_id, "related_person_id": root_id,
                     "family_id": family_id, "connection_kind": "child"}
    child = client.post(shared + "/connect-person", json=child_payload)
    assert child.status_code == 201, child.text
    assert any(edge["id"] == str(edge_id) for edge in child.json()["relationships"])
    assert client.post(shared + "/connect-person", json=child_payload).status_code == 409
    spouse_payload = {"person_id": spouse_id, "related_person_id": child_id,
                      "family_id": family_id, "connection_kind": "spouse", "spouse_status": "widowed"}
    assert client.post(shared + "/connect-person", json={
        **spouse_payload, "spouse_status": "married",
    }).status_code == 409
    spouse = client.post(shared + "/connect-person", json=spouse_payload)
    assert spouse.status_code == 201, spouse.text
    assert any(pair["id"] == str(marriage_id) for pair in spouse.json()["spouses"])
    assert client.post(shared + "/connect-person", json=spouse_payload).status_code == 409
    assert client.delete(shared + f"/people/{child_id}").status_code == 200
    assert client.post(shared + "/connect-person", json=child_payload).status_code == 201
    with database() as db:
        assert db.query(Person).count() == 4
        assert db.query(ParentChildRelationship).count() == 1
        assert db.query(Marriage).count() == 2


@pytest.mark.parametrize("role", ["ADMIN", "MODERATOR"])
def test_guided_root_writes_require_super_admin(client, database, email_provider, role):
    user_id = _login(client, email_provider, f"guided-{role.lower()}@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=user_id, role=role))
    root_id, partner_id, family_id = str(uuid4()), str(uuid4()), str(uuid4())
    assert client.put("/api/v1/admin/shared-lineage/root-couple", json={
        "root_person_id": root_id, "partner_person_id": partner_id, "family_id": family_id,
    }).status_code == 403
    assert client.post("/api/v1/admin/shared-lineage/connect-person", json={
        "person_id": partner_id, "related_person_id": root_id,
        "family_id": family_id, "connection_kind": "child",
    }).status_code == 403
    assert client.delete(f"/api/v1/admin/shared-lineage/people/{partner_id}").status_code == 403


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


def test_family_can_connect_an_existing_deceased_anchor_then_members_join_through_real_parents(
    client, database, email_provider,
):
    admin_id = _login(client, email_provider, "root-picker-admin@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    root_family = client.post("/api/v1/families", json={"name": "Үндэс"}).json()
    root = client.post(f"/api/v1/admin/families/{root_family['id']}/people", json={
        "first_name": "Баавай", "birth_date": "1910-01-01", "is_alive": False,
        "death_date": "1980-01-01",
    }).json()
    assert client.put("/api/v1/admin/shared-lineage/root", json={"person_id": root["id"]}).status_code == 200

    _login(client, email_provider, "root-picker-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Ээжийн салбар"}).json()
    base = f"/api/v1/families/{family['id']}"
    mother = client.post(base + "/persons", json={
        "first_name": "Ээж", "last_name": "Салбар", "birth_date": "1960-01-01",
        "is_alive": False, "death_date": "2020-01-01", "visibility": "family",
    }).json()
    me = client.post(base + "/persons", json={
        "first_name": "Охин", "last_name": "Салбар", "birth_date": "1990-01-01",
    }).json()
    living_relative = client.post(base + "/persons", json={
        "first_name": "Амьд", "last_name": "Хамаатан", "birth_date": "1985-01-01",
    }).json()
    private_ancestor = client.post(base + "/persons", json={
        "first_name": "Нууц", "last_name": "Өвөг", "is_alive": False, "visibility": "private",
    }).json()
    assert client.post(base + "/relationships/parent-child", json={
        "parent_id": mother["id"], "child_id": me["id"], "relationship_type": "biological",
    }).status_code == 201
    assert client.post(base + f"/persons/{me['id']}/link-me").status_code == 204

    candidates = client.get(base + "/root-connection/candidates")
    assert candidates.status_code == 200, candidates.text
    candidate_ids = {row["person_id"] for row in candidates.json()}
    assert candidate_ids == {mother["id"], me["id"]}
    mother_candidate = next(row for row in candidates.json() if row["person_id"] == mother["id"])
    assert mother_candidate["is_current_user"] is False
    assert mother_candidate["parent_person_ids"] == []
    assert next(row for row in candidates.json() if row["person_id"] == me["id"])["is_current_user"] is True

    wrong_parent = client.post(base + "/root-connection", json={
        "person_id": me["id"], "target_person_id": root["id"],
        "relationship_type": "biological", "share_consent": True,
    })
    assert wrong_parent.status_code == 409

    connection = client.post(base + "/root-connection", json={
        "person_id": mother["id"], "target_person_id": root["id"],
        "relationship_type": "biological", "share_consent": True,
    })
    assert connection.status_code == 200, connection.text
    assert connection.json()["status"] == "pending"
    assert connection.json()["person_name"] == "Салбар Ээж"

    member_id = _login(client, email_provider, "root-picker-member@example.com")
    with database.begin() as db:
        db.add(FamilyMember(family_id=UUID(family["id"]), user_id=member_id, role="member"))
    assert client.get(base + "/root-connection/candidates").json() == []
    forbidden = client.post(base + "/root-connection", json={
        "person_id": mother["id"], "target_person_id": root["id"],
        "relationship_type": "biological", "share_consent": True,
    })
    assert forbidden.status_code == 403

    assert client.post("/api/v1/auth/login", json={
        "email": "root-picker-admin@example.com", "password": PASSWORD,
    }).status_code == 200
    assert client.post(f"/api/v1/admin/shared-lineage/connections/{family['id']}/decision",
                       json={"approve": True}).status_code == 200
    assert client.post("/api/v1/auth/login", json={
        "email": "root-picker-owner@example.com", "password": PASSWORD,
    }).status_code == 200

    # A second living person joins only through their own linked account and
    # an already recorded direct parent edge; no generation is supplied.
    joined = client.post("/api/v1/shared-lineage/join", json={
        "person_id": me["id"], "parent_person_id": mother["id"],
        "relationship_type": "biological", "share_consent": True,
    })
    assert joined.status_code == 201, joined.text
    shared = joined.json()
    assert {person["id"] for person in shared["persons"]} >= {root["id"], mother["id"], me["id"]}
    assert any(edge["parent_id"] == root["id"] and edge["child_id"] == mother["id"]
               for edge in shared["relationships"])
    assert any(edge["parent_id"] == mother["id"] and edge["child_id"] == me["id"]
               for edge in shared["relationships"])
    with database() as db:
        assert db.query(ParentChildRelationship).filter(
            ParentChildRelationship.parent_id == UUID(mother["id"]),
            ParentChildRelationship.child_id == UUID(me["id"]),
        ).count() == 1
        assert db.get(SharedAncestryPerson, UUID(living_relative["id"])) is None
        assert db.get(SharedAncestryPerson, UUID(private_ancestor["id"])) is None


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

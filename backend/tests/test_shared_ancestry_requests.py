from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import (
    AdminGrant,
    AuditLog,
    Family,
    FamilyMember,
    FamilyPerson,
    Marriage,
    ParentChildRelationship,
    Person,
    RootConnection,
    SharedAncestry,
    SharedAncestryPerson,
    SharedAncestryRelationship,
    SharedAncestryRequest,
    User,
    UserPersonLink,
)
from app.relationships import canonical_pair
from tests.conftest import register_verified

PASSWORD = "review-shared-ancestry-passphrase-123"
ADMIN_EMAIL = "requests-admin@example.com"
OWNER_EMAIL = "requests-owner@example.com"


@pytest.fixture
def ancestry(client, database, email_provider):
    assert register_verified(client, ADMIN_EMAIL, PASSWORD, email_provider).status_code == 201
    admin_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_id = UUID(client.post("/api/v1/families", json={"name": "Recorded clan"}).json()["id"])
    assert register_verified(client, OWNER_EMAIL, PASSWORD, email_provider).status_code == 201
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
        db.add(FamilyMember(family_id=family_id, user_id=owner_id, role="owner"))
        root = Person(first_name="Recorded root", is_alive=False, created_by=admin_id)
        partner = Person(first_name="Recorded partner", is_alive=False, created_by=admin_id)
        target = Person(first_name="Recorded branch", is_alive=False, created_by=admin_id)
        child = Person(first_name="Recorded child", is_alive=False, created_by=owner_id)
        other = Person(first_name="Second recorded child", is_alive=False, created_by=owner_id)
        linked = Person(first_name="Account person", birth_date=date(1980, 1, 1), created_by=owner_id)
        db.add_all([root, partner, target, child, other, linked])
        db.flush()
        for person in (root, partner, target, child, other, linked):
            db.add(FamilyPerson(family_id=family_id, person_id=person.id,
                                added_by=person.created_by))
        db.add(SharedAncestry(id=1, root_person_id=root.id, created_by=admin_id))
        db.add_all([SharedAncestryPerson(person_id=person.id, family_id=family_id, added_by=admin_id)
                    for person in (partner, target)])
        db.add(ParentChildRelationship(parent_id=root.id, child_id=target.id, created_by=admin_id))
        first, second = canonical_pair(root.id, partner.id)
        db.add(Marriage(person_1_id=first, person_2_id=second, created_by=admin_id))
        db.add(UserPersonLink(user_id=owner_id, person_id=linked.id, linked_by=owner_id))
        db.get(Family, family_id).root_person_id = linked.id
        result = {"admin": admin_id, "owner": owner_id, "family": family_id,
                  "root": root.id, "partner": partner.id, "target": target.id,
                  "child": child.id, "other": other.id, "linked": linked.id}
    return result


def _login(client, email):
    assert client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).status_code == 200


def _request(client, ancestry, person="child", kind="child", target="target", **changes):
    body = {"person_id": str(ancestry[person]), "target_person_id": str(ancestry[target]) if target else None,
            "kind": kind, "share_consent": True}
    body.update(changes)
    return client.post(f"/api/v1/families/{ancestry['family']}/shared-ancestry-requests", json=body)


def _decide(client, request_id, approve=True):
    return client.post(f"/api/v1/admin/shared-lineage/requests/{request_id}/decision", json={"approve": approve})


def test_multiple_people_in_one_family_are_reviewed_independently(client, database, ancestry):
    first = _request(client, ancestry)
    second = _request(client, ancestry, person="other")
    assert first.status_code == second.status_code == 201
    assert first.json()["person_name"] == "Recorded child"
    assert first.json()["target_name"] == "Recorded branch"
    assert first.json()["family_name"] == "Recorded clan"
    assert first.json()["status"] == "pending"
    shared = client.get("/api/v1/shared-lineage").json()
    assert str(ancestry["child"]) not in {person["id"] for person in shared["persons"]}
    with database() as db:
        assert db.scalar(select(ParentChildRelationship.id).where(
            ParentChildRelationship.child_id == ancestry["child"],
        )) is None
    assert _request(client, ancestry).status_code == 409
    _login(client, ADMIN_EMAIL)
    pending = client.get("/api/v1/admin/shared-lineage/requests").json()
    assert len(pending) == 2
    approved = _decide(client, first.json()["id"])
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert _decide(client, first.json()["id"]).status_code == 409
    shared = client.get("/api/v1/shared-lineage").json()
    assert str(ancestry["child"]) in {person["id"] for person in shared["persons"]}
    assert str(ancestry["other"]) not in {person["id"] for person in shared["persons"]}
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["child"]).added_by == ancestry["owner"]
        assert db.get(Family, ancestry["family"]).root_person_id == ancestry["linked"]
        assert db.query(RootConnection).count() == 0
        assert db.query(SharedAncestryRequest).filter_by(status="pending").count() == 1
        assert db.query(AuditLog).filter_by(action="shared_ancestry.change_approved").count() == 1
    _login(client, OWNER_EMAIL)
    assert _request(client, ancestry).status_code == 409


def test_spouse_approval_and_detach_preserve_all_canonical_records(client, database, ancestry):
    requested = _request(client, ancestry, kind="spouse")
    assert requested.status_code == 201, requested.text
    _login(client, ADMIN_EMAIL)
    assert _decide(client, requested.json()["id"]).status_code == 200
    _login(client, OWNER_EMAIL)
    detached = _request(client, ancestry, kind="detach", target=None)
    assert detached.status_code == 201, detached.text
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["child"]) is not None
    _login(client, ADMIN_EMAIL)
    approved = _decide(client, detached.json()["id"])
    assert approved.status_code == 200, approved.text
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["child"]) is None
        assert db.get(Person, ancestry["child"]) is not None
        assert db.get(Family, ancestry["family"]) is not None
        assert db.query(FamilyPerson).count() == 6
        assert db.query(ParentChildRelationship).count() == 1
        assert db.query(Marriage).count() == 2
        assert db.query(UserPersonLink).count() == 1


def test_canonical_relationship_can_be_reused_for_opt_in_without_duplication(client, database, ancestry):
    with database.begin() as db:
        db.add(ParentChildRelationship(parent_id=ancestry["target"], child_id=ancestry["linked"],
                                        created_by=ancestry["owner"]))
    requested = _request(client, ancestry, person="linked")
    assert requested.status_code == 201
    _login(client, ADMIN_EMAIL)
    assert _decide(client, requested.json()["id"]).status_code == 200
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 2
        assert db.get(SharedAncestryPerson, ancestry["linked"]).added_by == ancestry["owner"]


@pytest.mark.parametrize("role", [None, "ADMIN", "MODERATOR"])
def test_only_super_admin_can_see_or_decide_requests(client, database, ancestry, role):
    requested = _request(client, ancestry)
    assert requested.status_code == 201
    if role:
        with database.begin() as db:
            db.add(AdminGrant(user_id=ancestry["owner"], role=role))
    assert client.get("/api/v1/admin/shared-lineage/requests").status_code == 403
    assert _decide(client, requested.json()["id"]).status_code == 403


def test_family_requests_are_visible_only_to_their_requester(client, database, email_provider, ancestry):
    requested = _request(client, ancestry)
    assert requested.status_code == 201
    assert len(client.get(f"/api/v1/families/{ancestry['family']}/shared-ancestry-requests").json()) == 1
    assert register_verified(client, "requests-member@example.com", PASSWORD, email_provider).status_code == 201
    member_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    assert client.get(f"/api/v1/families/{ancestry['family']}/shared-ancestry-requests").status_code == 404
    assert _request(client, ancestry).status_code == 404
    with database.begin() as db:
        db.add(FamilyMember(family_id=ancestry["family"], user_id=member_id, role="member"))
    assert client.get(f"/api/v1/families/{ancestry['family']}/shared-ancestry-requests").json() == []
    assert _request(client, ancestry).status_code == 403


@pytest.mark.parametrize("case,expected", [("minor", 422), ("private", 422), ("living", 403), ("account", 403)])
def test_ineligible_people_cannot_be_proposed(client, database, ancestry, case, expected):
    with database.begin() as db:
        person = db.get(Person, ancestry["child"])
        if case == "minor":
            person.birth_date = date(2018, 1, 1)
        elif case == "private":
            person.visibility = "private"
        elif case == "living":
            person.is_alive = True
        else:
            db.add(UserPersonLink(user_id=ancestry["admin"], person_id=person.id, linked_by=ancestry["admin"]))
    assert _request(client, ancestry).status_code == expected
    with database() as db:
        assert db.query(SharedAncestryRequest).count() == 0


@pytest.mark.parametrize("changes", [
    {"share_consent": False}, {"target_person_id": None}, {"relationship_type": "married"},
])
def test_addition_requires_consent_target_and_matching_relationship_type(client, ancestry, changes):
    assert _request(client, ancestry, **changes).status_code == 422
    assert _request(client, ancestry, person="target", target="target").status_code == 422


@pytest.mark.parametrize("changed", ["private", "minor", "account", "inactive", "membership", "target"])
def test_approval_revalidates_privacy_account_and_membership(client, database, ancestry, changed):
    requested = _request(client, ancestry)
    assert requested.status_code == 201
    with database.begin() as db:
        person = db.get(Person, ancestry["child"])
        if changed == "private":
            person.visibility = "private"
        elif changed == "minor":
            person.birth_date = date(2018, 1, 1)
        elif changed == "account":
            db.add(UserPersonLink(user_id=ancestry["admin"], person_id=person.id, linked_by=ancestry["admin"]))
        elif changed == "inactive":
            db.get(User, ancestry["owner"]).is_active = False
        elif changed == "membership":
            member = db.scalar(select(FamilyMember).where(
                FamilyMember.family_id == ancestry["family"], FamilyMember.user_id == ancestry["owner"],
            ))
            db.delete(member)
        else:
            db.get(Person, ancestry["target"]).visibility = "private"
    _login(client, ADMIN_EMAIL)
    assert _decide(client, requested.json()["id"]).status_code in {403, 404, 409, 422}
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["child"]) is None
        assert db.query(ParentChildRelationship).count() == 1
        assert db.get(SharedAncestryRequest, UUID(requested.json()["id"])).status == "pending"


@pytest.mark.parametrize("conflict,expected", [("cycle", 422), ("parents", 409), ("type", 409)])
def test_child_approval_rejects_graph_conflicts_added_after_request(client, database, ancestry, conflict, expected):
    requested = _request(client, ancestry)
    assert requested.status_code == 201
    with database.begin() as db:
        if conflict == "cycle":
            edges = [(ancestry["child"], ancestry["root"], "biological")]
        elif conflict == "parents":
            edges = [(ancestry["root"], ancestry["child"], "biological"),
                     (ancestry["partner"], ancestry["child"], "biological")]
        else:
            edges = [(ancestry["target"], ancestry["child"], "adoptive")]
        for parent, child, kind in edges:
            db.add(ParentChildRelationship(parent_id=parent, child_id=child,
                                            relationship_type=kind, created_by=ancestry["admin"]))
    _login(client, ADMIN_EMAIL)
    assert _decide(client, requested.json()["id"]).status_code == expected
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["child"]) is None


@pytest.mark.parametrize("conflict", ["spouse", "ancestor"])
def test_spouse_approval_rejects_conflicts_added_after_request(client, database, ancestry, conflict):
    requested = _request(client, ancestry, kind="spouse")
    assert requested.status_code == 201
    with database.begin() as db:
        if conflict == "spouse":
            first, second = canonical_pair(ancestry["other"], ancestry["target"])
            db.add(Marriage(person_1_id=first, person_2_id=second, created_by=ancestry["admin"]))
        else:
            db.add(ParentChildRelationship(parent_id=ancestry["target"], child_id=ancestry["child"],
                                            created_by=ancestry["admin"]))
    _login(client, ADMIN_EMAIL)
    assert _decide(client, requested.json()["id"]).status_code in {409, 422}
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["child"]) is None


def test_detach_is_owned_and_root_couple_is_protected(client, database, ancestry):
    assert _request(client, ancestry, person="target", kind="detach", target=None).status_code == 403
    assert _request(client, ancestry, person="root", kind="detach", target=None).status_code == 409
    assert _request(client, ancestry, person="partner", kind="detach", target=None).status_code == 409
    with database.begin() as db:
        db.get(SharedAncestryPerson, ancestry["target"]).added_by = ancestry["owner"]
    detached = _request(client, ancestry, person="target", kind="detach", target=None)
    assert detached.status_code == 201
    _login(client, ADMIN_EMAIL)
    assert _decide(client, detached.json()["id"]).status_code == 200
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["target"]) is None
        assert db.query(ParentChildRelationship).count() == 1
        assert db.get(Person, ancestry["target"]) is not None


def test_rejection_does_not_publish_or_create_relationship_and_allows_retry(client, database, ancestry):
    requested = _request(client, ancestry)
    _login(client, ADMIN_EMAIL)
    rejected = _decide(client, requested.json()["id"], approve=False)
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["child"]) is None
        assert db.query(ParentChildRelationship).count() == 1
    _login(client, OWNER_EMAIL)
    assert _request(client, ancestry).status_code == 201


def test_requester_can_withdraw_pending_consent_but_other_members_cannot(client, database, ancestry):
    requested = _request(client, ancestry)
    assert requested.status_code == 201
    endpoint = f"/api/v1/families/{ancestry['family']}/shared-ancestry-requests/{requested.json()['id']}/cancel"
    _login(client, ADMIN_EMAIL)
    assert client.post(endpoint).status_code == 404
    _login(client, OWNER_EMAIL)
    cancelled = client.post(endpoint)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    _login(client, ADMIN_EMAIL)
    assert _decide(client, requested.json()["id"]).status_code == 409
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["child"]) is None
        assert db.query(ParentChildRelationship).count() == 1


@pytest.mark.parametrize("kind", ["child", "spouse"])
def test_legacy_join_cannot_bypass_root_review_with_existing_canonical_relationship(client, database, ancestry, kind):
    with database.begin() as db:
        if kind == "child":
            db.add(ParentChildRelationship(parent_id=ancestry["target"], child_id=ancestry["linked"],
                                            created_by=ancestry["owner"]))
        else:
            first, second = canonical_pair(ancestry["target"], ancestry["linked"])
            db.add(Marriage(person_1_id=first, person_2_id=second, created_by=ancestry["owner"]))
    # Omitting a parent still must not expose an already-related person.
    bypass = client.post("/api/v1/shared-lineage/join", json={
        "person_id": str(ancestry["linked"]), "share_consent": True,
    })
    assert bypass.status_code == 409, bypass.text
    if kind == "child":
        explicit = client.post("/api/v1/shared-lineage/join", json={
            "person_id": str(ancestry["linked"]), "parent_person_id": str(ancestry["target"]),
            "share_consent": True,
        })
        assert explicit.status_code == 409
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["linked"]) is None
        assert db.query(SharedAncestryRequest).count() == 0
    requested = _request(client, ancestry, person="linked", kind=kind)
    assert requested.status_code == 201
    _login(client, ADMIN_EMAIL)
    assert _decide(client, requested.json()["id"]).status_code == 200


def test_legacy_placement_requires_review_and_withdrawal_preserves_canonical_edges(client, database, ancestry):
    with database.begin() as db:
        db.add(ParentChildRelationship(parent_id=ancestry["target"], child_id=ancestry["linked"],
                                        created_by=ancestry["owner"]))
    requested = _request(client, ancestry, person="linked")
    assert requested.status_code == 201
    _login(client, ADMIN_EMAIL)
    assert _decide(client, requested.json()["id"]).status_code == 200
    with database.begin() as db:
        db.add(SharedAncestryRelationship(parent_id=ancestry["target"], child_id=ancestry["linked"],
                                         created_by=ancestry["admin"]))
    _login(client, OWNER_EMAIL)
    assert client.put("/api/v1/shared-lineage/relationships/me", json={"parent_person_id": None}).status_code == 409
    assert client.put("/api/v1/shared-lineage/relationships/me", json={
        "parent_person_id": str(ancestry["target"]),
    }).status_code == 409
    with database() as db:
        assert db.query(SharedAncestryRelationship).count() == 1
        assert db.query(ParentChildRelationship).count() == 2
    assert client.delete("/api/v1/shared-lineage/people/me").status_code == 204
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["linked"]) is None
        assert db.query(ParentChildRelationship).count() == 2
        assert db.get(Person, ancestry["linked"]) is not None


def test_legacy_unlinked_opt_in_does_not_connect_or_change_canonical_tree(client, database, ancestry):
    response = client.post("/api/v1/shared-lineage/join", json={
        "person_id": str(ancestry["linked"]), "share_consent": True,
    })
    assert response.status_code == 201, response.text
    assert not any(edge["child_id"] == str(ancestry["linked"]) for edge in response.json()["relationships"])
    candidates = client.get(f"/api/v1/families/{ancestry['family']}/root-connection/candidates")
    assert candidates.status_code == 200
    assert str(ancestry["linked"]) in {person["person_id"] for person in candidates.json()}
    assert str(ancestry["target"]) not in {person["person_id"] for person in candidates.json()}
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["linked"]) is not None
        assert db.query(ParentChildRelationship).count() == 1
        assert db.query(SharedAncestryRequest).count() == 0


@pytest.mark.parametrize("kind", ["child", "spouse"])
def test_private_family_api_cannot_root_an_unlinked_shared_person_without_review(client, database, ancestry, kind):
    opted_in = client.post("/api/v1/shared-lineage/join", json={
        "person_id": str(ancestry["linked"]), "share_consent": True,
    })
    assert opted_in.status_code == 201
    base = f"/api/v1/families/{ancestry['family']}"
    if kind == "child":
        bypass = client.post(base + "/relationships/parent-child", json={
            "parent_id": str(ancestry["target"]), "child_id": str(ancestry["linked"]),
        })
    else:
        bypass = client.post(base + "/marriages", json={
            "person_1_id": str(ancestry["target"]), "person_2_id": str(ancestry["linked"]),
        })
    assert bypass.status_code == 409, bypass.text
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 1
        assert db.query(Marriage).count() == 1
    requested = _request(client, ancestry, person="linked", kind=kind)
    assert requested.status_code == 201, requested.text
    _login(client, ADMIN_EMAIL)
    approved = _decide(client, requested.json()["id"])
    assert approved.status_code == 200, approved.text


def test_rooted_relationship_updates_and_deletions_need_admin_review(client, database, ancestry):
    with database() as db:
        edge_id = db.scalar(select(ParentChildRelationship.id).where(
            ParentChildRelationship.parent_id == ancestry["root"],
            ParentChildRelationship.child_id == ancestry["target"],
        ))
        first, second = canonical_pair(ancestry["root"], ancestry["partner"])
        marriage_id = db.scalar(select(Marriage.id).where(
            Marriage.person_1_id == first, Marriage.person_2_id == second,
        ))
    base = f"/api/v1/families/{ancestry['family']}"
    assert client.patch(base + f"/relationships/parent-child/{edge_id}", json={
        "relationship_type": "adoptive",
    }).status_code == 409
    assert client.delete(base + f"/relationships/parent-child/{edge_id}").status_code == 409
    assert client.patch(base + f"/marriages/{marriage_id}", json={"status": "divorced"}).status_code == 409
    assert client.delete(base + f"/marriages/{marriage_id}").status_code == 409
    with database() as db:
        assert db.get(ParentChildRelationship, edge_id).relationship_type == "biological"
        assert db.get(Marriage, marriage_id).status == "married"
        assert db.get(Marriage, marriage_id).deleted_at is None


def test_pure_family_relationships_remain_editable_without_shared_review(client, database, ancestry):
    base = f"/api/v1/families/{ancestry['family']}"
    parent_child = client.post(base + "/relationships/parent-child", json={
        "parent_id": str(ancestry["child"]), "child_id": str(ancestry["other"]),
    })
    assert parent_child.status_code == 201, parent_child.text
    edge_id = parent_child.json()["id"]
    assert client.patch(base + f"/relationships/parent-child/{edge_id}", json={
        "relationship_type": "adoptive",
    }).status_code == 200
    assert client.delete(base + f"/relationships/parent-child/{edge_id}").status_code == 204
    marriage = client.post(base + "/marriages", json={
        "person_1_id": str(ancestry["child"]), "person_2_id": str(ancestry["other"]),
    })
    assert marriage.status_code == 201, marriage.text
    marriage_id = marriage.json()["id"]
    assert client.patch(base + f"/marriages/{marriage_id}", json={"status": "divorced"}).status_code == 200
    assert client.delete(base + f"/marriages/{marriage_id}").status_code == 204
    with database() as db:
        assert db.query(ParentChildRelationship).count() == 1
        assert db.get(Marriage, UUID(marriage_id)).deleted_at is not None


@pytest.mark.parametrize("changed", ["private", "minor"])
def test_request_person_name_respects_changed_privacy(client, database, ancestry, changed):
    requested = _request(client, ancestry)
    assert requested.status_code == 201
    with database.begin() as db:
        person = db.get(Person, ancestry["child"])
        if changed == "private":
            person.visibility = "private"
        else:
            person.birth_date = date(2018, 1, 1)
    listed = client.get(f"/api/v1/families/{ancestry['family']}/shared-ancestry-requests")
    assert listed.status_code == 200
    assert listed.json()[0]["person_name"] == "Харагдах зөвшөөрөл өөрчлөгдсөн"


def test_parent_review_does_not_admit_other_unreviewed_shared_descendants(client, database, ancestry):
    # Own profile can consent to remain unlinked while the historical parent
    # is still outside the shared root. Reviewing that parent must not silently
    # review this other Person too.
    private_edge = client.post(f"/api/v1/families/{ancestry['family']}/relationships/parent-child", json={
        "parent_id": str(ancestry["child"]), "child_id": str(ancestry["linked"]),
    })
    assert private_edge.status_code == 201
    consented = client.post("/api/v1/shared-lineage/join", json={
        "person_id": str(ancestry["linked"]), "share_consent": True,
    })
    assert consented.status_code == 201
    requested = _request(client, ancestry, person="child")
    assert requested.status_code == 201
    _login(client, ADMIN_EMAIL)
    approved = _decide(client, requested.json()["id"])
    assert approved.status_code == 409, approved.text
    from app.shared_ancestry import _shared_reachable_person_ids
    with database() as db:
        assert ancestry["child"] not in _shared_reachable_person_ids(db)
        assert ancestry["linked"] not in _shared_reachable_person_ids(db)
        assert db.get(SharedAncestryPerson, ancestry["linked"]) is not None
        assert db.get(SharedAncestryPerson, ancestry["child"]) is None
        assert db.query(ParentChildRelationship).count() == 2
        assert db.get(SharedAncestryRequest, UUID(requested.json()["id"])).status == "pending"
    # Withdrawing display consent changes no real family relationship. Each
    # Person can now be approved separately with the original edge reused.
    _login(client, OWNER_EMAIL)
    assert client.delete("/api/v1/shared-lineage/people/me").status_code == 204
    _login(client, ADMIN_EMAIL)
    assert _decide(client, requested.json()["id"]).status_code == 200
    _login(client, OWNER_EMAIL)
    own_request = _request(client, ancestry, person="linked", target="child")
    assert own_request.status_code == 201, own_request.text
    _login(client, ADMIN_EMAIL)
    assert _decide(client, own_request.json()["id"]).status_code == 200
    with database() as db:
        assert ancestry["linked"] in _shared_reachable_person_ids(db)
        assert db.query(ParentChildRelationship).count() == 3


def test_reviewed_request_can_reconnect_after_legacy_family_projection_disconnect(client, database, ancestry):
    base = f"/api/v1/families/{ancestry['family']}"
    requested = client.post(base + "/root-connection", json={
        "person_id": str(ancestry["linked"]), "target_person_id": str(ancestry["root"]),
        "share_consent": True,
    })
    assert requested.status_code == 200, requested.text
    _login(client, ADMIN_EMAIL)
    assert client.post(f"/api/v1/admin/shared-lineage/connections/{ancestry['family']}/decision",
                       json={"approve": True}).status_code == 200
    _login(client, OWNER_EMAIL)
    assert client.delete(base + "/root-connection").status_code == 200
    from app.shared_ancestry import _shared_reachable_person_ids
    with database() as db:
        assert ancestry["linked"] not in _shared_reachable_person_ids(db)
        assert db.get(SharedAncestryPerson, ancestry["linked"]) is not None
    requested_again = _request(client, ancestry, person="linked", target="root")
    assert requested_again.status_code == 201, requested_again.text
    _login(client, ADMIN_EMAIL)
    approved = _decide(client, requested_again.json()["id"])
    assert approved.status_code == 200, approved.text
    with database() as db:
        assert ancestry["linked"] in _shared_reachable_person_ids(db)
        assert db.query(ParentChildRelationship).count() == 2
        assert db.get(Family, ancestry["family"]).root_person_id == ancestry["linked"]
    _login(client, OWNER_EMAIL)
    assert client.delete(base + "/root-connection").status_code == 200
    with database() as db:
        assert ancestry["linked"] not in _shared_reachable_person_ids(db)
    detached = _request(client, ancestry, person="linked", kind="detach", target=None)
    assert detached.status_code == 201, detached.text
    _login(client, ADMIN_EMAIL)
    assert _decide(client, detached.json()["id"]).status_code == 200
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["linked"]) is None
        assert db.query(ParentChildRelationship).count() == 2
        assert db.get(Person, ancestry["linked"]) is not None


def test_legacy_approval_revalidates_active_requester(client, database, ancestry):
    base = f"/api/v1/families/{ancestry['family']}"
    requested = client.post(base + "/root-connection", json={
        "person_id": str(ancestry["linked"]), "target_person_id": str(ancestry["root"]),
        "share_consent": True,
    })
    assert requested.status_code == 200
    with database.begin() as db:
        db.get(User, ancestry["owner"]).is_active = False
    _login(client, ADMIN_EMAIL)
    approved = client.post(f"/api/v1/admin/shared-lineage/connections/{ancestry['family']}/decision",
                           json={"approve": True})
    assert approved.status_code == 409, approved.text
    with database() as db:
        assert db.get(RootConnection, ancestry["family"]).status == "pending"
        assert db.get(SharedAncestryPerson, ancestry["linked"]) is None
        assert db.query(ParentChildRelationship).count() == 1


def test_legacy_review_does_not_implicitly_admit_other_shared_people(client, database, ancestry):
    base = f"/api/v1/families/{ancestry['family']}"
    assert client.post(base + "/relationships/parent-child", json={
        "parent_id": str(ancestry["child"]), "child_id": str(ancestry["linked"]),
    }).status_code == 201
    assert client.post("/api/v1/shared-lineage/join", json={
        "person_id": str(ancestry["linked"]), "share_consent": True,
    }).status_code == 201
    requested = client.post(base + "/root-connection", json={
        "person_id": str(ancestry["child"]), "target_person_id": str(ancestry["root"]),
        "share_consent": True,
    })
    assert requested.status_code == 200
    _login(client, ADMIN_EMAIL)
    endpoint = f"/api/v1/admin/shared-lineage/connections/{ancestry['family']}/decision"
    approved = client.post(endpoint, json={"approve": True})
    assert approved.status_code == 409, approved.text
    with database() as db:
        assert db.get(RootConnection, ancestry["family"]).status == "pending"
        assert db.get(SharedAncestryPerson, ancestry["child"]) is None
        assert db.get(SharedAncestryPerson, ancestry["linked"]) is not None
        assert db.query(ParentChildRelationship).count() == 2
    _login(client, OWNER_EMAIL)
    assert client.delete("/api/v1/shared-lineage/people/me").status_code == 204
    _login(client, ADMIN_EMAIL)
    assert client.post(endpoint, json={"approve": True}).status_code == 200


def test_explicit_own_withdrawal_cancels_both_pending_consent_apis(client, database, ancestry):
    modern = _request(client, ancestry, person="linked")
    assert modern.status_code == 201
    base = f"/api/v1/families/{ancestry['family']}"
    legacy = client.post(base + "/root-connection", json={
        "person_id": str(ancestry["linked"]), "target_person_id": str(ancestry["root"]),
        "share_consent": True,
    })
    assert legacy.status_code == 200
    assert client.delete("/api/v1/shared-lineage/people/me").status_code == 204
    with database() as db:
        assert db.get(SharedAncestryRequest, UUID(modern.json()["id"])).status == "cancelled"
        assert db.get(RootConnection, ancestry["family"]).status == "disconnected"
        assert db.get(SharedAncestryPerson, ancestry["linked"]) is None
        assert db.query(ParentChildRelationship).count() == 1
    _login(client, ADMIN_EMAIL)
    assert _decide(client, modern.json()["id"]).status_code == 409
    assert client.post(f"/api/v1/admin/shared-lineage/connections/{ancestry['family']}/decision",
                       json={"approve": True}).status_code == 409


def test_withdrawal_of_unlinked_display_prevents_pending_republication(client, database, ancestry):
    assert client.post("/api/v1/shared-lineage/join", json={
        "person_id": str(ancestry["linked"]), "share_consent": True,
    }).status_code == 201
    requested = _request(client, ancestry, person="linked")
    assert requested.status_code == 201
    assert client.delete("/api/v1/shared-lineage/people/me").status_code == 204
    _login(client, ADMIN_EMAIL)
    assert _decide(client, requested.json()["id"]).status_code == 409
    with database() as db:
        assert db.get(SharedAncestryPerson, ancestry["linked"]) is None
        assert db.query(ParentChildRelationship).count() == 1

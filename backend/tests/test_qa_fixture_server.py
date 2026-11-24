from __future__ import annotations

import secrets
from uuid import UUID

from sqlalchemy import select

from app.models import (
    AdminGrant,
    FamilyMember,
    Person,
    SharedAncestryPerson,
    UserPersonLink,
)
from ops import qa_fixture_server


def test_fixture_seeds_disposable_roles_root_tree_and_reviewable_people(
    client, database
):
    password = f"Qa-{secrets.token_urlsafe(24)}-9!"
    with database() as db:
        fixture = qa_fixture_server.seed_fixture(db, password)
        db.commit()

        root_ids = [
            UUID(fixture["personIds"]["rootFather"]),
            UUID(fixture["personIds"]["rootMother"]),
            *(UUID(person_id) for person_id in fixture["personIds"]["rootChildOrder"]),
        ]
        assert db.get(AdminGrant, UUID(fixture["userIds"]["superAdmin"])).role == "SUPER_ADMIN"
        assert db.get(AdminGrant, UUID(fixture["userIds"]["globalAdmin"])).role == "ADMIN"
        assert db.get(AdminGrant, UUID(fixture["userIds"]["globalModerator"])).role == "MODERATOR"
        assert db.scalar(select(SharedAncestryPerson.person_id).where(
            SharedAncestryPerson.person_id == root_ids[0]
        )) == root_ids[0]
        assert db.scalar(select(UserPersonLink.id).where(
            UserPersonLink.person_id.in_(root_ids)
        )) is None
        owner_person_id = UUID(fixture["personIds"]["familyAOwnerPerson"])
        assert db.scalar(select(UserPersonLink.person_id).where(
            UserPersonLink.user_id == UUID(fixture["userIds"]["familyAOwner"])
        )) == owner_person_id
        candidate_id = UUID(fixture["personIds"]["familyADeceasedChildCandidate"])
        assert db.get(Person, candidate_id).is_alive is False
        assert db.scalar(select(UserPersonLink.id).where(
            UserPersonLink.person_id == candidate_id
        )) is None

        family_a_id = UUID(fixture["familyIds"]["familyA"])
        roles = dict(db.execute(select(FamilyMember.user_id, FamilyMember.role).where(
            FamilyMember.family_id == family_a_id
        )).all())
        assert roles == {
            UUID(fixture["userIds"]["familyAOwner"]): "owner",
            UUID(fixture["userIds"]["familyAEditor"]): "editor",
            UUID(fixture["userIds"]["familyAMember"]): "member",
        }

    admin_email = fixture["emails"]["superAdmin"]
    assert client.post("/api/v1/auth/login", json={
        "email": admin_email, "password": password,
    }).status_code == 200
    tree = client.get("/api/v1/shared-lineage")
    assert tree.status_code == 200, tree.text
    shared_ids = {person["id"] for person in tree.json()["persons"]}
    assert shared_ids == {str(person_id) for person_id in root_ids}

    owner_email = fixture["emails"]["familyAOwner"]
    assert client.post("/api/v1/auth/login", json={
        "email": owner_email, "password": password,
    }).status_code == 200
    request_url = f"/api/v1/families/{fixture['familyIds']['familyA']}/shared-ancestry-requests"
    requests = []
    for person_id, target_person_id, kind, relationship_type in (
        (fixture["personIds"]["familyAOwnerPerson"],
         fixture["personIds"]["rootChildren"]["dolgor"], "child", "biological"),
        (fixture["personIds"]["familyADeceasedChildCandidate"],
         fixture["personIds"]["rootChildren"]["dolgor"], "child", "biological"),
        (fixture["personIds"]["familyASpouseCandidate"],
         fixture["personIds"]["rootChildren"]["nansalmaa"], "spouse", "widowed"),
    ):
        response = client.post(request_url, json={
            "person_id": person_id,
            "target_person_id": target_person_id,
            "kind": kind,
            "relationship_type": relationship_type,
            "share_consent": True,
        })
        assert response.status_code == 201, response.text
        assert response.json()["status"] == "pending"
        requests.append(response.json())
    assert fixture["personIds"]["familyAOwnerPerson"] not in shared_ids
    assert fixture["personIds"]["familyADeceasedChildCandidate"] not in shared_ids
    assert fixture["personIds"]["familyASpouseCandidate"] not in shared_ids

    assert client.post("/api/v1/auth/login", json={
        "email": admin_email, "password": password,
    }).status_code == 200
    pending = client.get("/api/v1/admin/shared-lineage/requests")
    assert pending.status_code == 200, pending.text
    assert {row["id"] for row in pending.json()} >= {row["id"] for row in requests}
    for request in requests:
        decision = client.post(
            f"/api/v1/admin/shared-lineage/requests/{request['id']}/decision",
            json={"approve": True},
        )
        assert decision.status_code == 200, decision.text
    visible_ids = {person["id"] for person in client.get(
        "/api/v1/shared-lineage"
    ).json()["persons"]}
    assert {
        fixture["personIds"]["familyAOwnerPerson"],
        fixture["personIds"]["familyADeceasedChildCandidate"],
        fixture["personIds"]["familyASpouseCandidate"],
    } <= visible_ids
    assert fixture["personIds"]["familyBPrivatePerson"] not in visible_ids


def test_fixture_runner_refuses_non_test_environment_without_creating_files(
    monkeypatch, tmp_path, capsys
):
    qa_root = tmp_path / ".integrated-qa"
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setattr(qa_fixture_server, "QA_ROOT", qa_root)
    monkeypatch.setattr(qa_fixture_server, "FIXTURE_PATH", qa_root / "fixture.json")

    assert qa_fixture_server.main() == 2
    assert not qa_root.exists()
    assert "APP_ENV=test" in capsys.readouterr().err

from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from conftest import register_verified
from sqlalchemy import select

from app.maintenance import prune_expired_trash
from app.models import (
    FamilyAdminGrant,
    FamilyMember,
    FamilyPerson,
    FamilyTrashRecord,
    Person,
    PersonGuardianship,
)


def login(client, email):
    client.post("/api/v1/auth/logout")
    result = client.post("/api/v1/auth/login", json={"email": email, "password": "strong-passphrase-123"})
    assert result.status_code == 200


def test_detach_restore_lineage_and_retention_preserve_person(client, database):
    register_verified(client, "trash-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    person = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "Person"}).json()
    lineage = client.post(f"/api/v1/families/{family_id}/lineages", json={"name": "Lineage"}).json()
    branch = client.post(f"/api/v1/lineages/{lineage['id']}/branches", json={"name": "Branch"}).json()
    assignment = f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment"
    assert client.put(assignment, json={"lineage_id": lineage["id"], "branch_id": branch["id"]}).status_code == 200
    assert client.delete(f"/api/v1/families/{family_id}/persons/{person['id']}").status_code == 204
    assert client.get(f"/api/v1/families/{family_id}/persons/{person['id']}").status_code == 404
    trash = client.get(f"/api/v1/families/{family_id}/trash").json()["items"]
    assert len(trash) == 1
    assert client.post(f"/api/v1/families/{family_id}/trash/{trash[0]['id']}/restore").status_code == 204
    assert client.get(assignment).json()["branch_id"] == branch["id"]
    assert client.post(f"/api/v1/families/{family_id}/trash/{trash[0]['id']}/restore").status_code == 404
    assert client.delete(f"/api/v1/families/{family_id}/persons/{person['id']}").status_code == 204
    with database() as db:
        record = db.scalar(select(FamilyTrashRecord))
        assert record is not None
        record.deleted_at = datetime.now(UTC) - timedelta(days=31)
        db.commit()
        assert prune_expired_trash(db) == 1
        assert db.get(FamilyTrashRecord, record.id) is not None
        assert prune_expired_trash(db, apply=True) == 1
        db.commit()
        assert db.get(Person, UUID(person["id"])) is not None


def test_grants_are_owner_controlled_family_scoped_and_revocable(client, database):
    register_verified(client, "grants-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    other_id = client.post("/api/v1/families", json={"name": "Other"}).json()["id"]
    client.post("/api/v1/auth/logout")
    register_verified(client, "grants-member@example.com")
    member_id = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        membership = FamilyMember(family_id=UUID(family_id), user_id=UUID(member_id), role="member")
        db.add(membership); db.commit()
    assert client.get(f"/api/v1/families/{family_id}/audit").status_code == 403
    assert client.put(f"/api/v1/families/{family_id}/admin-grants/{member_id}", json={"scopes": ["view_audit"]}).status_code == 403
    login(client, "grants-owner@example.com")
    url = f"/api/v1/families/{family_id}/admin-grants/{member_id}"
    assert client.put(url, json={"scopes": ["unrecognized_scope"]}).status_code == 422
    assert client.put(url, json={"scopes": ["view_audit"]}).status_code == 204
    login(client, "grants-member@example.com")
    assert client.get(f"/api/v1/families/{family_id}/audit").status_code == 200
    assert client.get(f"/api/v1/families/{family_id}/trash").status_code == 403
    assert client.get(f"/api/v1/families/{other_id}/audit").status_code == 403
    login(client, "grants-owner@example.com")
    assert client.put(url, json={"scopes": []}).status_code == 204
    with database() as db:
        assert db.scalars(select(FamilyAdminGrant)).all() == []
    login(client, "grants-member@example.com")
    assert client.get(f"/api/v1/families/{family_id}/audit").status_code == 403


def test_trash_never_bypasses_minor_guardian_scopes(client):
    register_verified(client, "minor-trash@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    child = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Child", "birth_date": "2017-01-01"}).json()["id"]
    assert client.delete(f"/api/v1/families/{family}/persons/{child}").status_code == 403
    assert client.get(f"/api/v1/families/{family}/trash").json()["items"] == []


def test_trash_is_private_family_scoped_and_restore_preserves_checks(client, database):
    register_verified(client, "privacy-trash-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "A"}).json()["id"]
    other = client.post("/api/v1/families", json={"name": "B"}).json()["id"]
    client.post("/api/v1/auth/logout")
    register_verified(client, "privacy-trash-editor@example.com")
    editor_id = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family), user_id=UUID(editor_id), role="editor"))
        db.commit()
    secret = client.post(f"/api/v1/families/{family}/persons", json={
        "first_name": "Secret", "visibility": "private"
    }).json()["id"]
    assert client.delete(f"/api/v1/families/{family}/persons/{secret}").status_code == 204
    login(client, "privacy-trash-owner@example.com")
    assert client.get(f"/api/v1/families/{family}/trash").json()["items"] == []
    with database() as db:
        row = db.scalar(select(FamilyTrashRecord).where(FamilyTrashRecord.person_id == UUID(secret)))
        assert row is not None
        trash_id = str(row.id)
    assert client.post(f"/api/v1/families/{family}/trash/{trash_id}/restore").status_code == 404
    assert client.post(f"/api/v1/families/{other}/trash/{trash_id}/restore").status_code == 404


def test_grants_disappear_when_membership_is_removed(client, database):
    register_verified(client, "cascade-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "A"}).json()["id"]
    client.post("/api/v1/auth/logout")
    register_verified(client, "cascade-member@example.com")
    member_id = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family), user_id=UUID(member_id), role="member"))
        db.commit()
    login(client, "cascade-owner@example.com")
    assert client.put(f"/api/v1/families/{family}/admin-grants/{member_id}", json={"scopes": ["view_audit"]}).status_code == 204
    with database() as db:
        membership = db.scalar(select(FamilyMember).where(FamilyMember.family_id == UUID(family), FamilyMember.user_id == UUID(member_id)))
        assert membership is not None
        db.delete(membership)
        db.commit()
        assert db.scalars(select(FamilyAdminGrant)).all() == []
        db.add(FamilyMember(family_id=UUID(family), user_id=UUID(member_id), role="member"))
        db.commit()
    login(client, "cascade-member@example.com")
    assert client.get(f"/api/v1/families/{family}/audit").status_code == 403


def test_delegated_trash_grant_does_not_grant_other_privileges(client, database):
    register_verified(client, "delegation-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    person = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Adult"}).json()["id"]
    assert client.delete(f"/api/v1/families/{family}/persons/{person}").status_code == 204
    client.post("/api/v1/auth/logout")
    register_verified(client, "delegation-member@example.com")
    member = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family), user_id=UUID(member), role="member"))
        db.commit()
    login(client, "delegation-owner@example.com")
    assert client.put(f"/api/v1/families/{family}/admin-grants/{member}", json={"scopes": ["manage_trash"]}).status_code == 204
    login(client, "delegation-member@example.com")
    assert client.get(f"/api/v1/families/{family}/audit").status_code == 403
    trash = client.get(f"/api/v1/families/{family}/trash").json()["items"]
    assert len(trash) == 1
    assert client.post(f"/api/v1/families/{family}/trash/{trash[0]['id']}/restore").status_code == 204
    assert client.post(f"/api/v1/families/{family}/persons", json={"first_name": "No"}).status_code == 403


def test_detach_does_not_cascade_story_or_archive_links(client):
    register_verified(client, "linked-detach@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    person = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Linked"}).json()["id"]
    story = client.post(f"/api/v1/families/{family}/stories", json={"title": "Story", "body": "Body", "person_ids": [person]} )
    archive = client.post(f"/api/v1/families/{family}/archives", json={"title": "Archive", "person_ids": [person]})
    assert story.status_code == 201
    assert archive.status_code == 201
    url = f"/api/v1/families/{family}/persons/{person}"
    assert client.delete(url).status_code == 409
    assert client.get(url).status_code == 200
    assert client.get(f"/api/v1/families/{family}/stories/{story.json()['id']}").json()["related_people"][0]["id"] == person
    assert client.delete(f"/api/v1/families/{family}/stories/{story.json()['id']}").status_code == 204
    assert client.delete(url).status_code == 409
    assert client.get(f"/api/v1/families/{family}/archives/{archive.json()['id']}").json()["related_people"][0]["id"] == person


def test_detach_does_not_destroy_guardian_grants(client, database):
    register_verified(client, "linked-guardian-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    owner = client.get("/api/v1/auth/me").json()["id"]
    person = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Adult"}).json()["id"]
    from app.models import PersonGuardianship
    with database() as db:
        db.add(PersonGuardianship(family_id=UUID(family), person_id=UUID(person), guardian_user_id=UUID(owner), scope="edit_profile", granted_by_user_id=UUID(owner)))
        db.commit()
    assert client.delete(f"/api/v1/families/{family}/persons/{person}").status_code == 409
    with database() as db:
        assert db.scalar(select(PersonGuardianship).where(PersonGuardianship.person_id == UUID(person))) is not None


def test_restore_refuses_deleted_original_branch_and_keeps_trash(client, database):
    from app.models import Branch

    register_verified(client, "restore-branch@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    person = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Test"}).json()["id"]
    lineage = client.post(f"/api/v1/families/{family}/lineages", json={"name": "Lineage"}).json()["id"]
    branch = client.post(f"/api/v1/lineages/{lineage}/branches", json={"name": "Branch"}).json()["id"]
    assert client.put(f"/api/v1/families/{family}/persons/{person}/lineage-assignment", json={"lineage_id": lineage, "branch_id": branch}).status_code == 200
    assert client.delete(f"/api/v1/families/{family}/persons/{person}").status_code == 204
    trash_id = client.get(f"/api/v1/families/{family}/trash").json()["items"][0]["id"]
    with database() as db:
        row = db.get(Branch, UUID(branch))
        assert row is not None
        db.delete(row)
        db.commit()
    assert client.post(f"/api/v1/families/{family}/trash/{trash_id}/restore").status_code == 409
    assert client.get(f"/api/v1/families/{family}/persons/{person}").status_code == 404
    assert len(client.get(f"/api/v1/families/{family}/trash").json()["items"]) == 1


def test_restore_refuses_conflicting_assignment_from_another_family(client, database):
    from app.models import PersonLineageAssignment

    register_verified(client, "restore-conflict@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    other = client.post("/api/v1/families", json={"name": "Other"}).json()["id"]
    person = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Test"}).json()["id"]
    lineage = client.post(f"/api/v1/families/{family}/lineages", json={"name": "Lineage"}).json()["id"]
    other_lineage = client.post(f"/api/v1/families/{other}/lineages", json={"name": "Other lineage"}).json()["id"]
    assert client.put(f"/api/v1/families/{family}/persons/{person}/lineage-assignment", json={"lineage_id": lineage}).status_code == 200
    assert client.delete(f"/api/v1/families/{family}/persons/{person}").status_code == 204
    trash_id = client.get(f"/api/v1/families/{family}/trash").json()["items"][0]["id"]
    with database() as db:
        db.add(PersonLineageAssignment(person_id=UUID(person), lineage_id=UUID(other_lineage)))
        db.commit()
    assert client.post(f"/api/v1/families/{family}/trash/{trash_id}/restore").status_code == 409
    assert len(client.get(f"/api/v1/families/{family}/trash").json()["items"]) == 1


def test_delegated_settings_are_scoped_and_do_not_allow_archive(client, database):
    register_verified(client, "settings-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    other = client.post("/api/v1/families", json={"name": "Other"}).json()["id"]
    client.post("/api/v1/auth/logout")
    register_verified(client, "settings-delegate@example.com")
    delegate = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add_all([FamilyMember(family_id=UUID(family), user_id=UUID(delegate), role="member"), FamilyMember(family_id=UUID(other), user_id=UUID(delegate), role="member")])
        db.commit()
    assert client.patch(f"/api/v1/families/{family}", json={"name": "Denied"}).status_code == 403
    login(client, "settings-owner@example.com")
    grants = f"/api/v1/families/{family}/admin-grants/{delegate}"
    assert client.put(grants, json={"scopes": ["manage_settings"]}).status_code == 204
    login(client, "settings-delegate@example.com")
    assert client.patch(f"/api/v1/families/{family}", json={"name": "Renamed"}).status_code == 200
    assert client.patch(f"/api/v1/families/{other}", json={"name": "Denied"}).status_code == 403
    assert client.delete(f"/api/v1/families/{family}").status_code == 403
    assert client.get(f"/api/v1/families/{family}/audit").status_code == 403
    assert client.put(grants, json={"scopes": ["view_audit"]}).status_code == 403
    login(client, "settings-owner@example.com")
    assert client.put(grants, json={"scopes": []}).status_code == 204
    login(client, "settings-delegate@example.com")
    assert client.patch(f"/api/v1/families/{family}", json={"name": "Denied"}).status_code == 403


def test_memory_list_does_not_leak_tags_of_private_or_detached_people(client, database):
    register_verified(client, "memory-privacy-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    private_person = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Private", "visibility": "private"}).json()["id"]
    adult = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Adult"}).json()["id"]
    private_memory = client.post(f"/api/v1/families/{family}/memories", json={"title": "Private tag", "person_ids": [private_person]}).json()["id"]
    memory = client.post(f"/api/v1/families/{family}/memories", json={"title": "Detached tag", "person_ids": [adult]}).json()["id"]
    assert client.delete(f"/api/v1/families/{family}/persons/{adult}").status_code == 204
    trash = client.get(f"/api/v1/families/{family}/trash").json()["items"][0]["id"]
    client.post("/api/v1/auth/logout")
    register_verified(client, "memory-privacy-member@example.com")
    member = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family), user_id=UUID(member), role="member"))
        db.commit()
    response = client.get(f"/api/v1/families/{family}/memories")
    assert response.status_code == 200
    assert not {private_memory, memory} & {item["id"] for item in response.json()["items"]}
    assert client.get(f"/api/v1/families/{family}/memories/{memory}").status_code == 404
    login(client, "memory-privacy-owner@example.com")
    assert client.post(f"/api/v1/families/{family}/trash/{trash}/restore").status_code == 204
    login(client, "memory-privacy-member@example.com")
    response = client.get(f"/api/v1/families/{family}/memories")
    assert memory in {item["id"] for item in response.json()["items"]}
    assert private_memory not in {item["id"] for item in response.json()["items"]}


def test_member_admin_can_invite_members_but_cannot_escalate_or_change_grants(client, database):
    from app.models import FamilyAdminExtendedGrant

    register_verified(client, "member-admin-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    other = client.post("/api/v1/families", json={"name": "Other"}).json()["id"]
    editor_invite = client.post(f"/api/v1/families/{family}/invitations", json={"email": "editor-invite@example.com", "role": "editor"}).json()["id"]
    client.post("/api/v1/auth/logout")
    register_verified(client, "member-admin-delegate@example.com")
    delegate = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add_all([FamilyMember(family_id=UUID(family), user_id=UUID(delegate), role="member"), FamilyMember(family_id=UUID(other), user_id=UUID(delegate), role="member")]); db.commit()
    login(client, "member-admin-owner@example.com")
    grant_url = f"/api/v1/families/{family}/admin-grants/{delegate}"
    assert client.put(grant_url, json={"scopes": ["manage_members"]}).status_code == 204
    assert "manage_members" in next(x for x in client.get(f"/api/v1/families/{family}/admin-grants").json() if x["user_id"] == delegate)["scopes"]
    login(client, "member-admin-delegate@example.com")
    assert client.get(f"/api/v1/families/{other}/invitations").status_code == 403
    assert client.get(f"/api/v1/families/{family}/invitations").json() == []
    assert client.post(f"/api/v1/families/{family}/invitations", json={"email": "escalation@example.com", "role": "editor"}).status_code == 403
    assert client.delete(f"/api/v1/families/{family}/invitations/{editor_invite}").status_code == 404
    invited = client.post(f"/api/v1/families/{family}/invitations", json={"email": "new-member@example.com", "role": "member"})
    assert invited.status_code == 201
    assert client.delete(f"/api/v1/families/{family}/invitations/{invited.json()['id']}").status_code == 204
    assert client.put(grant_url, json={"scopes": ["view_audit"]}).status_code == 403
    assert client.get(f"/api/v1/families/{family}/audit").status_code == 403
    login(client, "member-admin-owner@example.com")
    assert client.put(grant_url, json={"scopes": []}).status_code == 204
    with database() as db:
        assert db.scalars(select(FamilyAdminExtendedGrant)).all() == []
    login(client, "member-admin-delegate@example.com")
    assert client.get(f"/api/v1/families/{family}/invitations").status_code == 403


def test_membership_deletion_cascades_extended_grant(client, database):
    from app.models import FamilyAdminExtendedGrant

    register_verified(client, "extended-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    client.post("/api/v1/auth/logout")
    register_verified(client, "extended-member@example.com")
    delegate = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family), user_id=UUID(delegate), role="member")); db.commit()
    login(client, "extended-owner@example.com")
    assert client.put(f"/api/v1/families/{family}/admin-grants/{delegate}", json={"scopes": ["manage_members", "view_audit"]}).status_code == 204
    with database() as db:
        membership = db.scalar(select(FamilyMember).where(FamilyMember.family_id == UUID(family), FamilyMember.user_id == UUID(delegate)))
        assert membership is not None
        db.delete(membership); db.commit()
        assert db.scalars(select(FamilyAdminExtendedGrant)).all() == []
        assert db.scalars(select(FamilyAdminGrant)).all() == []


def test_people_and_content_grants_are_scoped_and_preserve_privacy(client, database):
    register_verified(client, "work-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Family"}).json()["id"]
    other = client.post("/api/v1/families", json={"name": "Other"}).json()["id"]
    adult = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Adult"}).json()["id"]
    child = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Child", "birth_date": "2018-01-01"}).json()["id"]
    private = client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Private", "visibility": "private"}).json()["id"]
    private_story = client.post(f"/api/v1/families/{family}/stories", json={"title": "Secret", "body": "Secret", "visibility": "private"}).json()["id"]
    client.post("/api/v1/auth/logout")
    register_verified(client, "work-delegate@example.com")
    delegate = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add_all([FamilyMember(family_id=UUID(family), user_id=UUID(delegate), role="member"), FamilyMember(family_id=UUID(other), user_id=UUID(delegate), role="member")]); db.commit()
    login(client, "work-owner@example.com")
    grant_url = f"/api/v1/families/{family}/admin-grants/{delegate}"
    assert client.put(grant_url, json={"scopes": ["manage_people"]}).status_code == 204
    login(client, "work-delegate@example.com")
    assert client.post(f"/api/v1/families/{family}/persons", json={"first_name": "New"}).status_code == 201
    assert client.patch(f"/api/v1/families/{family}/persons/{adult}", json={"first_name": "Changed"}).status_code == 200
    assert client.patch(f"/api/v1/families/{family}/persons/{child}", json={"first_name": "Denied"}).status_code == 403
    assert client.patch(f"/api/v1/families/{family}/persons/{private}", json={"first_name": "Denied"}).status_code == 404
    assert client.post(f"/api/v1/families/{other}/persons", json={"first_name": "Denied"}).status_code == 403
    assert client.post(f"/api/v1/families/{family}/stories", json={"title": "Denied", "body": "Body"}).status_code == 403
    login(client, "work-owner@example.com")
    assert client.put(grant_url, json={"scopes": ["manage_content"]}).status_code == 204
    login(client, "work-delegate@example.com")
    assert client.post(f"/api/v1/families/{family}/persons", json={"first_name": "Denied"}).status_code == 403
    assert client.post(f"/api/v1/families/{family}/stories", json={"title": "Child", "body": "Body", "person_ids": [child]}).status_code == 403
    assert client.post(f"/api/v1/families/{family}/stories", json={"title": "Private", "body": "Body", "person_ids": [private]}).status_code == 404
    assert client.delete(f"/api/v1/families/{family}/stories/{private_story}").status_code == 404
    story = client.post(f"/api/v1/families/{family}/stories", json={"title": "Public", "body": "Body"})
    assert story.status_code == 201
    assert client.delete(f"/api/v1/families/{family}/stories/{story.json()['id']}").status_code == 204
    assert client.get(f"/api/v1/families/{family}/audit").status_code == 403
    login(client, "work-owner@example.com")
    assert client.put(grant_url, json={"scopes": []}).status_code == 204
    login(client, "work-delegate@example.com")
    assert client.post(f"/api/v1/families/{family}/stories", json={"title": "Denied", "body": "Body"}).status_code == 403


def test_trash_privacy_filter_runs_before_count_and_pagination(client, database):
    """Hidden records must not consume the page window or inflate totals."""
    register_verified(client, "page-owner@example.com")
    client.get("/api/v1/auth/me").json()
    family = UUID(client.post("/api/v1/families", json={"name": "Paging"}).json()["id"])
    client.post("/api/v1/auth/logout")
    register_verified(client, "page-stranger@example.com")
    stranger = UUID(client.get("/api/v1/auth/me").json()["id"])

    base = datetime(2026, 1, 1, tzinfo=UTC)
    hidden, shown = 200, 50
    with database() as db:
        for index in range(hidden + shown):
            # Newest `hidden` rows are private to another user; the older tail
            # is visible, so a limit applied before filtering would drop it.
            is_hidden = index >= shown
            person = Person(
                first_name=f"P{index}",
                visibility="private" if is_hidden else "family",
                created_by=stranger,
            )
            db.add(person)
            db.flush()
            db.add(FamilyTrashRecord(
                family_id=family, person_id=person.id, deleted_by=stranger,
                deleted_at=base + timedelta(minutes=index),
            ))
        db.commit()

    login(client, "page-owner@example.com")
    first = client.get(f"/api/v1/families/{family}/trash?page=1&page_size=25").json()
    assert first["total"] == shown
    assert first["page"] == 1 and first["page_size"] == 25 and first["has_next"] is True
    # Newest visible record first, deterministic across pages.
    assert [item["first_name"] for item in first["items"]] == [f"P{i}" for i in range(shown - 1, 24, -1)]

    second = client.get(f"/api/v1/families/{family}/trash?page=2&page_size=25").json()
    assert [item["first_name"] for item in second["items"]] == [f"P{i}" for i in range(24, -1, -1)]
    assert second["has_next"] is False

    first_ids = {item["id"] for item in first["items"]}
    second_ids = {item["id"] for item in second["items"]}
    assert len(first_ids | second_ids) == shown
    with database() as db:
        private_ids = set(db.scalars(
            select(FamilyTrashRecord.id)
            .join(Person, Person.id == FamilyTrashRecord.person_id)
            .where(FamilyTrashRecord.family_id == family, Person.visibility == "private")
        ).all())
    assert private_ids and not (private_ids & (first_ids | second_ids))
    third = client.get(f"/api/v1/families/{family}/trash?page=3&page_size=25").json()
    assert third["items"] == [] and third["total"] == shown and third["has_next"] is False


def test_trash_minor_visibility_follows_guardian_scope(client, database):
    register_verified(client, "guardian-trash-owner@example.com")
    owner = UUID(client.get("/api/v1/auth/me").json()["id"])
    family = UUID(client.post("/api/v1/families", json={"name": "Guardian"}).json()["id"])

    with database() as db:
        child = Person(first_name="Child", birth_date=date(2017, 5, 1),
                       visibility="family", created_by=owner)
        db.add(child)
        db.flush()
        db.add(FamilyPerson(family_id=family, person_id=child.id, added_by=owner))
        record = FamilyTrashRecord(family_id=family, person_id=child.id, deleted_by=owner)
        db.add(record)
        db.commit()
        person_id, trash_id = child.id, record.id

    login(client, "guardian-trash-owner@example.com")
    page = client.get(f"/api/v1/families/{family}/trash").json()
    assert page["items"] == [] and page["total"] == 0

    with database() as db:
        grant = PersonGuardianship(family_id=family, person_id=person_id,
                                   guardian_user_id=owner, scope="view_profile",
                                   granted_by_user_id=owner)
        db.add(grant)
        db.commit()
        grant_id = grant.id

    allowed = client.get(f"/api/v1/families/{family}/trash").json()
    assert allowed["total"] == 1 and allowed["items"][0]["person_id"] == str(person_id)

    with database() as db:
        row = db.get(PersonGuardianship, grant_id)
        assert row is not None
        row.status = "revoked"
        row.revoked_at = datetime.now(UTC)
        row.revoked_by_user_id = owner
        db.commit()

    revoked = client.get(f"/api/v1/families/{family}/trash").json()
    assert revoked["items"] == [] and revoked["total"] == 0
    # The record still exists but is unreachable: no listing and no restore.
    assert client.post(f"/api/v1/families/{family}/trash/{trash_id}/restore").status_code == 403
    with database() as db:
        assert db.get(FamilyTrashRecord, trash_id) is not None


def test_admin_access_degrades_gracefully_if_grant_table_unavailable(client, database):
    from sqlalchemy import text

    from app.models import FamilyAdminWorkGrant

    register_verified(client, "degrade-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Degrade Family"}).json()["id"]
    client.post("/api/v1/auth/logout")
    register_verified(client, "degrade-member@example.com")
    member_id = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family), user_id=UUID(member_id), role="member"))
        db.commit()
        db.execute(text("DROP TABLE family_admin_work_grants"))
        db.commit()

    try:
        response = client.get(f"/api/v1/families/{family}/admin-access")
        assert response.status_code == 200
        assert response.json() == {"owner": False, "scopes": []}
    finally:
        with database() as db:
            FamilyAdminWorkGrant.__table__.create(bind=db.get_bind(), checkfirst=True)
            db.commit()

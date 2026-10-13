from uuid import UUID

from sqlalchemy import select

from app.models import AdminGrant, Family, FamilyMember, Person, User
from tests.conftest import register_verified

PASSWORD = "cleanup-verification-password"


def super_admin(client, database, email_provider):
    register_verified(client, "cleanup-admin@example.com", PASSWORD, email_provider)
    user_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    with database.begin() as db:
        db.add(AdminGrant(user_id=user_id, role="SUPER_ADMIN"))
    return user_id


def test_legacy_label_cleanup_preserves_people_and_real_relationships(
    client, database, email_provider,
):
    super_admin(client, database, email_provider)
    fid = client.post("/api/v1/families", json={"name": "Label cleanup fixture"}).json()["id"]
    base = f"/api/v1/admin/families/{fid}"
    person = client.post(base + "/people", json={"first_name": "Preserved person"}).json()
    lineage = client.post(base + "/lineages", json={
        "name": "GUULIN", "description": "Example description",
    }).json()
    branch = client.post(base + f"/lineages/{lineage['id']}/branches", json={
        "name": "BADAMJAV",
    }).json()
    assignment = base + f"/people/{person['id']}/lineage-assignment"
    assert client.put(assignment, json={
        "lineage_id": lineage["id"], "branch_id": branch["id"],
    }).status_code == 200
    edited = client.patch(base + f"/lineages/{lineage['id']}", json={"description": None})
    assert edited.status_code == 200
    assert edited.json()["description"] is None
    assert client.patch(base + f"/branches/{branch['id']}", json={"name": "Updated label"}).status_code == 200
    assert client.patch(base + f"/branches/{branch['id']}", json={"name": "   "}).status_code == 422
    assert client.delete(base + f"/lineages/{lineage['id']}").status_code == 409
    assert client.delete(base + f"/branches/{branch['id']}").status_code == 409
    assert client.delete(assignment).status_code == 204
    assert client.delete(base + f"/branches/{branch['id']}").status_code == 204
    assert client.delete(base + f"/lineages/{lineage['id']}").status_code == 204
    workspace = client.get(base + "/workspace").json()
    assert [item["id"] for item in workspace["people"]] == [person["id"]]
    assert workspace["branches"] == workspace["lineages"] == []
    foreign = client.post("/api/v1/families", json={"name": "Other context"}).json()["id"]
    assert client.patch(f"/api/v1/admin/families/{foreign}/branches/{branch['id']}",
                        json={"name": "Denied"}).status_code == 404
    register_verified(client, "cleanup-ordinary@example.com", PASSWORD, email_provider)
    assert client.patch(base + f"/lineages/{lineage['id']}", json={"name": "Denied"}).status_code == 403


def test_family_archive_is_reversible_and_preserves_accounts_and_content(
    client, database, email_provider,
):
    admin_id = super_admin(client, database, email_provider)
    fid = client.post("/api/v1/families", json={"name": "Sample workspace"}).json()["id"]
    base = f"/api/v1/admin/families/{fid}"
    person = client.post(base + "/people", json={"first_name": "Preserved"}).json()
    client.post(f"/api/v1/families/{fid}/stories", json={
        "title": "Published fixture", "body": "Preserved content", "visibility": "public",
    })
    assert client.get(base + "/archive-preview").json()["can_archive"] is True
    assert client.post(base + "/archive", json={"confirm_name": "Wrong family"}).status_code == 409
    assert client.post(base + "/archive", json={"confirm_name": "Sample workspace"}).status_code == 204
    assert client.get(base + "/workspace").status_code == 404
    assert client.get("/api/v1/families").json() == []
    assert client.get("/api/v1/community/feed?kind=story").json()["items"] == []
    assert client.get("/api/v1/admin/archived-families").json()[0]["id"] == fid
    with database() as db:
        assert db.get(Person, UUID(person["id"])) is not None
        assert db.get(User, admin_id) is not None
        assert db.scalar(select(FamilyMember.id).where(FamilyMember.family_id == UUID(fid)))
        assert db.get(Family, UUID(fid)).archived_at is not None
    assert client.post(base + "/restore", json={"confirm_name": "Sample workspace"}).status_code == 204
    restored = client.get(base + "/workspace").json()
    assert restored["family"]["people_count"] == 1
    assert restored["family"]["story_count"] == 1
    register_verified(client, "archive-outsider@example.com", PASSWORD, email_provider)
    assert client.get(base + "/archive-preview").status_code == 403
    assert client.post(base + "/archive", json={"confirm_name": "Sample workspace"}).status_code == 403
    assert client.post(base + "/restore", json={"confirm_name": "Sample workspace"}).status_code == 403


def test_shared_root_family_cannot_be_archived_by_admin_or_owner(
    client, database, email_provider,
):
    super_admin(client, database, email_provider)
    fid = client.post("/api/v1/families", json={"name": "Root family"}).json()["id"]
    base = f"/api/v1/admin/families/{fid}"
    person = client.post(base + "/people", json={
        "first_name": "Root", "birth_date": "1900-01-01", "is_alive": False,
    }).json()
    assert client.put("/api/v1/admin/shared-lineage/root", json={
        "person_id": person["id"], "expected_root_person_id": None,
    }).status_code == 200
    preview = client.get(base + "/archive-preview").json()
    assert preview["shared_root"] is True
    assert preview["can_archive"] is False
    assert client.post(base + "/archive", json={"confirm_name": "Root family"}).status_code == 409
    assert client.delete(f"/api/v1/families/{fid}").status_code == 409
    assert client.get(base + "/workspace").status_code == 200

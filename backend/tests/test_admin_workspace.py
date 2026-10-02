from uuid import UUID

from sqlalchemy import select

from app.models import AdminGrant, AuditLog
from tests.conftest import register_verified

PASSWORD = "admin-workspace-passphrase-123"


def _account(client, provider, email):
    assert register_verified(client, email, PASSWORD, provider).status_code == 201
    return UUID(client.get("/api/v1/auth/me").json()["id"])


def _login(client, email):
    assert client.post(
        "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
    ).status_code == 200


def test_workspace_permissions_and_genealogy_integrity(client, database, email_provider):
    root = _account(client, email_provider, "workspace-root@example.com")
    operator = _account(client, email_provider, "workspace-operator@example.com")
    ordinary = _account(client, email_provider, "workspace-member@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=root, role="SUPER_ADMIN"))
        db.add(AdminGrant(user_id=operator, role="ADMIN"))
    _login(client, "workspace-member@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Private genealogy"}).json()["id"]
    base = f"/api/v1/admin/families/{family_id}"
    assert client.get(base + "/workspace").status_code == 403
    assert client.post(base + "/people", json={"first_name": "Denied"}).status_code == 403
    _login(client, "workspace-operator@example.com")
    assert client.get(base + "/workspace").status_code == 403
    assert client.post(base + "/people", json={"first_name": "Denied"}).status_code == 403
    _login(client, "workspace-root@example.com")
    assert client.get(base + "/workspace").status_code == 200

    parent = client.post(base + "/people", json={
        "first_name": "Ancestor", "birth_date": "1970-01-01"
    })
    child = client.post(base + "/people", json={
        "first_name": "Descendant", "birth_date": "2000-01-01"
    })
    assert parent.status_code == child.status_code == 201
    parent_id, child_id = parent.json()["id"], child.json()["id"]
    assert client.put(base + "/root", json={"person_id": parent_id}).status_code == 200
    edge = client.post(base + "/relationships", json={
        "parent_id": parent_id, "child_id": child_id
    })
    assert edge.status_code == 201
    assert client.post(base + "/relationships", json={
        "parent_id": child_id, "child_id": parent_id
    }).status_code == 422
    lineage = client.post(base + "/lineages", json={"name": "First lineage"})
    assert lineage.status_code == 201
    lineage_id = lineage.json()["id"]
    branch = client.post(base + f"/lineages/{lineage_id}/branches", json={"name": "East branch"})
    assert branch.status_code == 201
    assignment_url = base + f"/people/{child_id}/lineage-assignment"
    assert client.put(assignment_url, json={
        "lineage_id": lineage_id, "branch_id": branch.json()["id"],
    }).status_code == 200
    assert client.put(assignment_url, json={
        "lineage_id": lineage_id, "branch_id": parent_id,
    }).status_code == 404
    assert client.get(base + "/workspace").json()["assignments"][0]["person_id"] == child_id
    assert client.delete(base + f"/people/{parent_id}").status_code == 409
    assert client.delete(base + f"/people/{child_id}").status_code == 409
    assert client.delete(base + f"/relationships/{edge.json()['id']}").status_code == 204
    assert client.delete(base + f"/people/{child_id}").status_code == 409
    assert client.delete(assignment_url).status_code == 204
    assert client.delete(base + f"/people/{child_id}").status_code == 204
    assert client.patch(base + f"/people/{parent_id}", json={
        "first_name": "Updated Ancestor"
    }).json()["first_name"] == "Updated Ancestor"
    workspace = client.get(base + "/workspace").json()
    assert workspace["family"]["root_person_id"] == parent_id
    assert workspace["family"]["people_count"] == 1
    assert workspace["history"]
    with database() as db:
        assert db.scalar(select(AuditLog.id).where(
            AuditLog.action == "admin.family_workspace_viewed"
        )) is not None
    _login(client, "workspace-member@example.com")
    assert client.get(base + "/workspace").status_code == 403
    assert ordinary != root


def test_announcements_profile_and_audit_permissions(client, database, email_provider):
    root = _account(client, email_provider, "notice-root@example.com")
    operator = _account(client, email_provider, "notice-operator@example.com")
    member = _account(client, email_provider, "notice-member@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=root, role="SUPER_ADMIN"))
        db.add(AdminGrant(user_id=operator, role="ADMIN"))
    _login(client, "notice-operator@example.com")
    assert client.get("/api/v1/admin/announcements").status_code == 200
    assert client.get("/api/v1/admin/audit").status_code == 403
    assert client.post("/api/v1/admin/announcements", json={
        "title": "No", "body": "No", "is_published": True
    }).status_code == 403
    assert client.put(f"/api/v1/admin/users/{member}/profile", json={
        "display_name": "No"
    }).status_code == 403
    _login(client, "notice-root@example.com")
    draft = client.post("/api/v1/admin/announcements", json={
        "title": "Service update", "body": "Testing", "is_published": False
    })
    assert draft.status_code == 201
    assert client.get("/api/v1/announcements").json() == []
    published = client.put(f"/api/v1/admin/announcements/{draft.json()['id']}", json={
        "title": "Service update", "body": "Testing", "is_published": True
    })
    assert published.status_code == 200
    assert client.put(f"/api/v1/admin/users/{member}/profile", json={
        "display_name": "  Better Name  "
    }).json()["display_name"] == "Better Name"
    assert client.put(f"/api/v1/admin/users/{member}/profile", json={
        "display_name": "  "
    }).status_code == 422
    assert any(item["action"] == "admin.user_profile_edited"
               for item in client.get("/api/v1/admin/audit").json())
    _login(client, "notice-member@example.com")
    assert len(client.get("/api/v1/announcements").json()) == 1
    assert client.get("/api/v1/admin/announcements").status_code == 403

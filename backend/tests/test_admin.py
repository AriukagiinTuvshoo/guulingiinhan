from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from app import admin
from app.admin import bootstrap_admin_roles
from app.models import AdminBootstrap, AdminGrant, Story, User, UserSession
from tests.conftest import register_verified

PASSWORD = "admin-test-passphrase-123"


def _register(client, email_provider, email):
    assert register_verified(client, email, PASSWORD, email_provider).status_code == 201
    return UUID(client.get("/api/v1/auth/me").json()["id"])


def _login(client, email):
    response = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200


def test_admin_role_matrix_and_family_isolation(client, database, email_provider):
    assert client.get("/api/v1/admin/me").status_code == 401
    emails = [f"{name}@example.com" for name in ("super", "operator", "moderator", "normal")]
    ids = [_register(client, email_provider, email) for email in emails]
    family = client.post("/api/v1/families", json={"name": "Private family"}).json()
    for path in ("/admin/me", "/admin/users", "/admin/families", "/admin/admins"):
        assert client.get("/api/v1" + path).status_code == 403

    with database.begin() as db:
        db.add(AdminGrant(user_id=ids[0], role="SUPER_ADMIN"))
    _login(client, emails[0])
    assert client.get("/api/v1/admin/me").json()["role"] == "SUPER_ADMIN"
    assert client.get("/api/v1/admin/overview").json()["users"] == 4
    assert len(client.get("/api/v1/admin/users").json()) == 4
    assert len(client.get("/api/v1/admin/families").json()) == 1
    assert "password_hash" not in client.get("/api/v1/admin/users").text
    assert client.put(f"/api/v1/admin/admins/{ids[1]}", json={"role": "ADMIN"}).status_code == 200
    assert client.put(f"/api/v1/admin/admins/{ids[2]}", json={"role": "MODERATOR"}).status_code == 200
    assert client.put(f"/api/v1/admin/admins/{ids[3]}", json={"role": "SUPER_ADMIN"}).status_code == 403
    assert client.put(f"/api/v1/admin/admins/{ids[0]}", json={"role": "ADMIN"}).status_code == 403

    for email, role in ((emails[1], "ADMIN"), (emails[2], "MODERATOR")):
        _login(client, email)
        assert client.get("/api/v1/admin/me").json()["role"] == role
        assert client.get("/api/v1/admin/overview").status_code == 200
        assert client.get("/api/v1/admin/users").status_code == 200
        assert client.get("/api/v1/admin/families").status_code == 200
        assert client.get("/api/v1/admin/admins").status_code == 403
        assert client.put(f"/api/v1/admin/admins/{ids[3]}", json={"role": "ADMIN"}).status_code == 403
        assert client.delete(f"/api/v1/admin/admins/{ids[0]}").status_code == 403
        assert client.get(f"/api/v1/families/{family['id']}").status_code == 403

    _login(client, emails[0])
    assert client.delete(f"/api/v1/admin/admins/{ids[2]}").status_code == 204
    _login(client, emails[2])
    assert client.get("/api/v1/admin/me").status_code == 403
    assert client.get("/api/v1/admin/overview").status_code == 403


def test_admin_session_and_target_validation(client, database, email_provider):
    super_email = "root@example.com"
    target_email = "candidate@example.com"
    root_id = _register(client, email_provider, super_email)
    target_id = _register(client, email_provider, target_email)
    with database.begin() as db:
        db.add(AdminGrant(user_id=root_id, role="SUPER_ADMIN"))
    _login(client, super_email)
    assert client.put(f"/api/v1/admin/admins/{target_id}", json={"role": "owner"}).status_code == 422
    assert client.put(f"/api/v1/admin/admins/{target_id}", json={"role": "ADMIN", "user_id": str(root_id)}).status_code == 422
    assert client.put(f"/api/v1/admin/admins/{target_id}", json={"role": "ADMIN"}).status_code == 200
    assert client.get("/api/v1/admin/users/lookup", params={"email": target_email}).json()["id"] == str(target_id)
    with database.begin() as db:
        target = db.get(User, target_id)
        target.is_active = False
    assert client.put(f"/api/v1/admin/admins/{target_id}", json={"role": "MODERATOR"}).status_code == 404
    with database.begin() as db:
        sessions = db.scalars(select(UserSession).where(UserSession.user_id == root_id)).all()
        for session in sessions:
            session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert client.get("/api/v1/admin/me").status_code == 401


def test_bootstrap_is_one_time_and_requires_verified_user(client, database, email_provider, monkeypatch):
    email = "bootstrap@example.com"
    user_id = _register(client, email_provider, email)
    operator_id = _register(client, email_provider, "bootstrap-admin@example.com")
    moderator_id = _register(client, email_provider, "bootstrap-moderator@example.com")
    monkeypatch.setattr(admin, "SessionLocal", database)
    monkeypatch.setattr(admin, "get_settings", lambda: type("Settings", (), {
        "admin_bootstrap_email": email,
        "admin_bootstrap_admin_email": "bootstrap-admin@example.com",
        "admin_bootstrap_moderator_email": "bootstrap-moderator@example.com",
    })())
    bootstrap_admin_roles()
    with database() as db:
        assert db.get(AdminBootstrap, 1).user_id == user_id
        assert db.get(AdminGrant, user_id).role == "SUPER_ADMIN"
        assert db.get(AdminGrant, operator_id).role == "ADMIN"
        assert db.get(AdminGrant, moderator_id).role == "MODERATOR"
    with database.begin() as db:
        db.delete(db.get(AdminGrant, user_id))
    bootstrap_admin_roles()
    with database() as db:
        assert db.get(AdminGrant, user_id) is None


def test_account_inspection_block_and_story_privacy(client, database, email_provider):
    root_email, operator_email, moderator_email, member_email = (
        "inspector@example.com", "operator2@example.com",
        "moderator2@example.com", "member2@example.com",
    )
    root_id = _register(client, email_provider, root_email)
    operator_id = _register(client, email_provider, operator_email)
    moderator_id = _register(client, email_provider, moderator_email)
    member_id = _register(client, email_provider, member_email)
    family = client.post("/api/v1/families", json={"name": "Visible membership"}).json()
    with database.begin() as db:
        db.add_all([
            AdminGrant(user_id=root_id, role="SUPER_ADMIN"),
            AdminGrant(user_id=operator_id, role="ADMIN"),
            AdminGrant(user_id=moderator_id, role="MODERATOR"),
            Story(family_id=UUID(family["id"]), title="Private account story", body="Protected body",
                  created_by=member_id, visibility="private"),
        ])

    _login(client, member_email)
    assert client.get(f"/api/v1/admin/users/{root_id}").status_code == 403
    assert client.get(f"/api/v1/admin/users/{member_id}/stories").status_code == 403
    assert client.put(f"/api/v1/admin/users/{root_id}/status", json={"is_active": False}).status_code == 403

    _login(client, moderator_email)
    assert client.get(f"/api/v1/admin/users/{member_id}").status_code == 200
    assert client.post("/api/v1/admin/users/invite", json={"email": "new-member@example.com"}).status_code == 403
    assert client.get(f"/api/v1/admin/users/{member_id}/stories").status_code == 403
    assert client.put(f"/api/v1/admin/users/{member_id}/status", json={"is_active": False}).status_code == 403

    _login(client, operator_email)
    assert client.get(f"/api/v1/admin/users/{member_id}/stories").status_code == 403
    with database() as db:
        story_id = db.scalar(select(Story.id).where(Story.created_by == member_id))
    assert client.put(f"/api/v1/admin/stories/{story_id}", json={
        "title": "Changed", "body": "Changed body",
    }).status_code == 403
    assert client.put(f"/api/v1/admin/users/{root_id}/status", json={"is_active": False}).status_code == 403
    assert client.put(f"/api/v1/admin/users/{member_id}/status", json={"is_active": False}).status_code == 200

    _login(client, root_email)
    invited = client.post("/api/v1/admin/users/invite", json={"email": "new-member@example.com"})
    assert invited.status_code == 202
    assert any(item.recipient == "new-member@example.com" and "/register" in item.text
               for item in email_provider.deliveries)
    assert client.post("/api/v1/admin/users/invite", json={"email": member_email}).status_code == 409
    response = client.get(f"/api/v1/admin/users/{member_id}")
    assert response.status_code == 200
    assert response.json()["memberships"][0]["family_id"] == family["id"]
    assert "password_hash" not in response.text
    stories = client.get(f"/api/v1/admin/users/{member_id}/stories")
    assert stories.status_code == 200
    assert stories.json()[0]["body"] == "Protected body"
    edited = client.put(f"/api/v1/admin/stories/{story_id}", json={
        "title": "Reviewed story", "body": "Reviewed body",
    })
    assert edited.status_code == 200
    assert edited.json()["body"] == "Reviewed body"
    assert edited.json()["visibility"] == "private"
    assert client.put(f"/api/v1/admin/stories/{story_id}", json={
        "title": "Invalid", "body": "Changed", "family_id": str(root_id),
    }).status_code == 422
    assert client.put(f"/api/v1/admin/users/{root_id}/status", json={"is_active": False}).status_code == 403
    assert client.put(f"/api/v1/admin/users/{operator_id}/status", json={"is_active": False}).status_code == 200
    blocked_login = client.post("/api/v1/auth/login", json={"email": operator_email, "password": PASSWORD})
    assert blocked_login.status_code == 401
    assert client.put(f"/api/v1/admin/users/{member_id}/status", json={"is_active": True}).status_code == 200
    _login(client, member_email)
    assert client.get("/api/v1/auth/me").status_code == 200

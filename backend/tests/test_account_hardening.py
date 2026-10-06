import io
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import UUID

from conftest import register_verified
from PIL import Image
from sqlalchemy import select
from test_profile_photos import PrivateMemoryStorage, png_bytes

from app.main import app
from app.models import AdminGrant, EmailVerificationToken, LoginIdentity, User
from app.storage import get_storage

PASSWORD = "strong-passphrase-123"


def test_email_change_verifies_new_address_revokes_sessions_and_rejects_reuse(client, database, email_provider):
    register_verified(client, "old@example.com")
    body = {"email": "new@example.com", "current_password": PASSWORD}
    assert client.post("/api/v1/auth/me/email/request", json=body | {"current_password": "wrong"}).status_code == 401
    assert client.post("/api/v1/auth/me/email/request", json=body).status_code == 202
    assert client.get("/api/v1/auth/me").json()["email"] == "old@example.com"
    token = urlsplit(email_provider.deliveries[-1].text.rsplit(" ", 1)[-1]).fragment.removeprefix("token=")
    route = "/api/v1/auth/email/verification/confirm"
    assert client.post(route, json={"token": token}).status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.post(route, json={"token": token}).status_code == 400
    assert client.post("/api/v1/auth/login", json={"email": "old@example.com", "password": PASSWORD}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"identifier": "new@example.com", "password": PASSWORD}).status_code == 200
    with database() as db:
        identities = db.scalars(select(LoginIdentity).where(LoginIdentity.provider == "email")).all()
        assert sum(item.disabled_at is None for item in identities) == 1


def test_email_change_expiry_and_other_account_collision_leave_old_email(client, database, email_provider):
    register_verified(client, "taken@example.com")
    register_verified(client, "source@example.com")
    assert client.post("/api/v1/auth/me/email/request", json={
        "email": "taken@example.com", "current_password": PASSWORD}).status_code == 409
    assert client.post("/api/v1/auth/me/email/request", json={
        "email": "expired@example.com", "current_password": PASSWORD}).status_code == 202
    token = urlsplit(email_provider.deliveries[-1].text.rsplit(" ", 1)[-1]).fragment.removeprefix("token=")
    with database() as db:
        row = db.scalar(select(EmailVerificationToken).where(EmailVerificationToken.target_email == "expired@example.com"))
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert client.post("/api/v1/auth/email/verification/confirm", json={"token": token}).status_code == 400
    assert client.get("/api/v1/auth/me").json()["email"] == "source@example.com"


def test_account_photo_private_bounded_exif_free_replace_and_cleanup(client, database):
    class Storage(PrivateMemoryStorage):
        fail_delete = False
        def delete(self, key):
            if self.fail_delete:
                raise RuntimeError("private-storage-detail")
            super().delete(key)
    storage = Storage()
    app.dependency_overrides[get_storage] = lambda: storage
    assert client.get("/api/v1/auth/me/photo").status_code == 401
    register_verified(client, "photo-account@example.com")
    user_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    endpoint = "/api/v1/auth/me/photo"
    headers = {"Content-Type": "image/png", "X-File-Name": "portrait.png"}
    assert client.post(endpoint, content=png_bytes(), headers=headers).status_code == 201
    photo = client.get(endpoint)
    assert photo.status_code == 200
    assert photo.headers["cache-control"] == "private, no-store"
    assert photo.headers["x-content-type-options"] == "nosniff"
    with Image.open(io.BytesIO(photo.content)) as image:
        assert image.size[0] <= 640
        assert not image.getexif()
    storage.fail_delete = True
    replacement = client.post(endpoint, content=png_bytes(), headers=headers)
    assert replacement.status_code == 201
    assert replacement.json()["cleanup_pending"] is True
    with database() as db:
        assert db.get(User, user_id).profile_photo_cleanup
    storage.fail_delete = False
    assert client.post(endpoint + "/cleanup").status_code == 204
    assert len(storage.objects) == 1
    register_verified(client, "unrelated@example.com")
    assert client.get(endpoint).status_code == 404
    assert client.get(f"/api/v1/admin/users/{user_id}/photo").status_code == 403
    assert client.delete(f"/api/v1/admin/users/{user_id}/photo").status_code == 403
    client.post("/api/v1/auth/login", json={"email": "photo-account@example.com", "password": PASSWORD})
    assert client.delete(endpoint).status_code == 204
    assert not storage.objects
    assert client.get(endpoint).status_code == 404
    assert client.post(endpoint, content=b"not-an-image", headers=headers).status_code == 415


def test_admin_recovery_and_phone_verification_do_not_expose_secrets(client, database, email_provider):
    register_verified(client, "admin@example.com")
    admin_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    register_verified(client, "managed@example.com")
    target_id = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
        db.commit()
    assert client.post(f"/api/v1/admin/users/{target_id}/recovery").status_code == 403
    client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": PASSWORD})
    result = client.get(f"/api/v1/admin/users/{target_id}")
    assert result.status_code == 200
    assert "identities" in result.json()
    for secret in ("password_hash", "token_hash", "provider_session_id", "api_key"):
        assert secret not in result.text
    assert client.put(f"/api/v1/admin/users/{target_id}/phone-verification", json={"verified": True}).status_code == 422
    assert client.post(f"/api/v1/admin/users/{target_id}/recovery").status_code == 202
    assert email_provider.deliveries[-1].recipient == "managed@example.com"
    assert client.post(f"/api/v1/admin/users/{target_id}/recovery").status_code == 429

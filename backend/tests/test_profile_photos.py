import io
from uuid import UUID

from conftest import register_verified
from PIL import Image
from sqlalchemy import select

from app.models import AuditLog, Person
from app.storage import get_storage


class PrivateMemoryStorage:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = (data, content_type)

    def get(self, key: str) -> bytes:
        return self.objects[key][0]

    def exists(self, key: str) -> bool:
        return key in self.objects

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    def list_keys(self, prefix: str = "") -> list[str]:
        return sorted(key for key in self.objects if key.startswith(prefix))


def png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (48, 48), "#315b43").save(output, format="PNG")
    return output.getvalue()


def test_profile_photo_upload_get_replace_and_delete(client, database):
    storage = PrivateMemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "portrait-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Хөргийн туршилт"}).json()
    family_id = family["id"]
    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Туршилт", "visibility": "family"},
    ).json()
    endpoint = f"/api/v1/families/{family_id}/persons/{person['id']}/profile-photo"
    headers = {"Content-Type": "image/png", "X-File-Name": "portrait.png"}

    uploaded = client.post(endpoint, content=png_bytes(), headers=headers)
    assert uploaded.status_code == 201, uploaded.text
    url = uploaded.json()["profile_photo_url"]
    assert url.startswith(endpoint.removeprefix("/api/v1") + "?v=")
    tree = client.get(f"/api/v1/families/{family_id}/tree?person_id={person['id']}")
    assert tree.status_code == 200
    assert tree.json()["persons"][0]["profile_photo_url"] == url
    directory = client.get(f"/api/v1/families/{family_id}/people")
    assert directory.status_code == 200
    assert directory.json()["items"][0]["profile_photo_url"] == url
    assert "profile-photos/" not in url
    assert len(storage.objects) == 1
    content = client.get("/api/v1" + url)
    assert content.status_code == 200
    assert content.headers["content-type"] == "image/jpeg"
    assert content.headers["cache-control"] == "private, no-store"
    assert content.headers["x-content-type-options"] == "nosniff"
    assert content.content.startswith(b"\xff\xd8")

    with database() as db:
        saved = db.get(Person, UUID(person["id"]))
        assert saved is not None and saved.profile_photo_key in storage.objects
        assert saved.profile_photo_url is None

    replacement = client.post(endpoint, content=png_bytes(), headers=headers)
    assert replacement.status_code == 201
    assert len(storage.objects) == 1
    assert client.get("/api/v1" + url).status_code == 404
    current_url = replacement.json()["profile_photo_url"]
    assert client.get("/api/v1" + current_url).status_code == 200

    assert client.delete(endpoint).status_code == 204
    tree = client.get(f"/api/v1/families/{family_id}/tree?person_id={person['id']}")
    assert tree.json()["persons"][0]["profile_photo_url"] is None
    assert storage.objects == {}
    assert client.get("/api/v1" + current_url).status_code == 404
    with database() as db:
        saved = db.get(Person, UUID(person["id"]))
        assert saved is not None and saved.profile_photo_key is None
        actions = set(db.scalars(select(AuditLog.action)).all())
        assert {"person.profile_photo_uploaded", "person.profile_photo_deleted"} <= actions


def test_profile_photo_requires_membership_edit_permission_and_valid_image(client):
    storage = PrivateMemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "portrait-owner2@example.com")
    family = client.post("/api/v1/families", json={"name": "Хувийн хөрөг"}).json()
    family_id = family["id"]
    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Нууц", "visibility": "family"},
    ).json()
    endpoint = f"/api/v1/families/{family_id}/persons/{person['id']}/profile-photo"
    invalid = client.post(
        endpoint, content=b"not an image",
        headers={"Content-Type": "image/png", "X-File-Name": "portrait.png"},
    )
    assert invalid.status_code == 415
    assert storage.objects == {}

    client.post("/api/v1/auth/logout")
    register_verified(client, "portrait-outsider@example.com")
    denied = client.post(
        endpoint, content=png_bytes(),
        headers={"Content-Type": "image/png", "X-File-Name": "portrait.png"},
    )
    assert denied.status_code == 403
    assert storage.objects == {}


def test_minor_profile_photo_requires_guardian_edit_scope(client):
    storage = PrivateMemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "minor-portrait-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Хүүхдийн хөрөг"}).json()
    family_id = family["id"]
    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Хүүхэд", "birth_date": "2018-04-06", "visibility": "family"},
    ).json()
    response = client.post(
        f"/api/v1/families/{family_id}/persons/{person['id']}/profile-photo",
        content=png_bytes(),
        headers={"Content-Type": "image/png", "X-File-Name": "portrait.png"},
    )
    assert response.status_code == 403
    assert storage.objects == {}

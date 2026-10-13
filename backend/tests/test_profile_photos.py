import io
from uuid import UUID

from conftest import register_verified
from PIL import Image
from sqlalchemy import select

from app.models import AdminGrant, AuditLog, FamilyMember, Person, PersonGuardianship
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


def test_uploaded_portrait_is_serialized_in_featured_person_and_remains_authorized(client, database):
    from app.main import app

    storage = PrivateMemoryStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "featured-portrait@example.com")
    user_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_id = client.post("/api/v1/families", json={"name": "Featured portrait regression"}).json()["id"]
    person_id = client.post(f"/api/v1/families/{family_id}/persons", json={
        "first_name": "Adult portrait fixture", "birth_date": "1980-01-01",
    }).json()["id"]
    with database.begin() as db:
        db.add(AdminGrant(user_id=user_id, role="SUPER_ADMIN"))
    featured = f"/api/v1/families/{family_id}/featured-person"
    assert client.put(featured, json={"person_id": person_id}).status_code == 200
    assert client.get(featured).json()["profile_photo_url"] is None
    photo = f"/api/v1/families/{family_id}/persons/{person_id}/profile-photo"
    uploaded = client.post(photo, content=png_bytes(), headers={
        "Content-Type": "image/png", "X-File-Name": "portrait.png",
    })
    assert uploaded.status_code == 201
    result = client.get(featured)
    assert result.status_code == 200
    url = result.json()["profile_photo_url"]
    assert url == uploaded.json()["profile_photo_url"]
    assert "profile-photos/" not in url
    assert client.get("/api/v1" + url).status_code == 200
    assert client.get("/api/v1" + url).headers["cache-control"] == "private, no-store"
    assert client.delete(photo).status_code == 204
    assert client.get(featured).json()["profile_photo_url"] is None
    register_verified(client, "featured-portrait-outsider@example.com")
    assert client.get(featured).status_code == 403
    assert client.get("/api/v1" + url).status_code == 403


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
    assert client.post(f"/api/v1/families/{family_id}/persons/{person['id']}/link-me").status_code == 204
    headers = {"Content-Type": "image/png", "X-File-Name": "portrait.png"}

    uploaded = client.post(endpoint, content=png_bytes(), headers=headers)
    assert uploaded.status_code == 201, uploaded.text
    url = uploaded.json()["profile_photo_url"]
    assert url.startswith(endpoint.removeprefix("/api/v1") + "?v=")
    tree = client.get(f"/api/v1/families/{family_id}/tree?person_id={person['id']}")
    assert tree.status_code == 200
    assert tree.json()["persons"][0]["profile_photo_url"] == url
    # Portrait self-service does not confer People administration.
    assert client.get(f"/api/v1/families/{family_id}/people").status_code == 403
    with database() as db:
        db.add(AdminGrant(user_id=UUID(client.get("/api/v1/auth/me").json()["id"]), role="ADMIN"))
        db.commit()
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
    assert client.post(f"/api/v1/families/{family_id}/persons/{person['id']}/link-me").status_code == 204
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


def test_super_admin_person_portrait_uses_private_storage_and_scoped_minor_access(client, database):
    storage = PrivateMemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "portrait-family-owner@example.com")
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family = client.post("/api/v1/families", json={"name": "Удмын хөргийн сан"}).json()
    family_id = UUID(family["id"])
    adult = client.post(
        f"/api/v1/families/{family['id']}/persons",
        json={"first_name": "Ахмад", "visibility": "private"},
    ).json()
    minor = client.post(
        f"/api/v1/families/{family['id']}/persons",
        json={"first_name": "Хүүхэд", "birth_date": "2018-04-06", "visibility": "family"},
    ).json()

    register_verified(client, "portrait-super-admin@example.com")
    admin_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    adult_endpoint = f"/api/v1/admin/families/{family['id']}/people/{adult['id']}/profile-photo"
    photo_headers = {"Content-Type": "image/png", "X-File-Name": "portrait.png"}

    # Global admin can manage a private root portrait without ordinary membership.
    uploaded = client.post(adult_endpoint, content=png_bytes(), headers=photo_headers)
    assert uploaded.status_code == 201, uploaded.text
    first_url = uploaded.json()["profile_photo_url"]
    assert first_url.startswith(adult_endpoint.removeprefix("/api/v1") + "?v=")
    assert "profile-photos/" not in first_url
    assert client.get("/api/v1" + first_url).status_code == 200
    assert client.get(adult_endpoint).status_code == 200
    version = first_url.rsplit("?v=", 1)[1]
    assert client.get(f"/api/v1/families/{family['id']}/persons/{adult['id']}"
                      f"/profile-photo?v={version}").status_code == 403
    replaced = client.post(adult_endpoint, content=png_bytes(), headers=photo_headers)
    assert replaced.status_code == 201
    assert client.get("/api/v1" + first_url).status_code == 404
    assert len(storage.objects) == 1

    # Minor editing and reading need separate active guardian scopes.
    minor_endpoint = f"/api/v1/admin/families/{family['id']}/people/{minor['id']}/profile-photo"
    assert client.post(minor_endpoint, content=png_bytes(), headers=photo_headers).status_code == 403
    assert len(storage.objects) == 1
    with database.begin() as db:
        db.add(FamilyMember(family_id=family_id, user_id=admin_id, role="member"))
        db.add(PersonGuardianship(
            family_id=family_id, person_id=UUID(minor["id"]), guardian_user_id=admin_id,
            scope="edit_profile", granted_by_user_id=owner_id,
        ))
    assert client.post(minor_endpoint, content=png_bytes(), headers=photo_headers).status_code == 201
    assert client.get(minor_endpoint).status_code == 403
    with database.begin() as db:
        db.add(PersonGuardianship(
            family_id=family_id, person_id=UUID(minor["id"]), guardian_user_id=admin_id,
            scope="view_profile", granted_by_user_id=owner_id,
        ))
    minor_photo = client.get(minor_endpoint)
    assert minor_photo.status_code == 200
    assert minor_photo.headers["cache-control"] == "private, no-store"
    assert minor_photo.headers["x-content-type-options"] == "nosniff"

    assert client.delete(adult_endpoint).status_code == 204
    assert client.delete(adult_endpoint).status_code == 204
    with database() as db:
        actions = set(db.scalars(select(AuditLog.action)).all())
        adult_person = db.get(Person, UUID(adult["id"]))
        minor_person = db.get(Person, UUID(minor["id"]))
        assert adult_person is not None and adult_person.profile_photo_key is None
        assert minor_person is not None and minor_person.profile_photo_key in storage.objects
        assert {"person.profile_photo_uploaded", "person.profile_photo_deleted"} <= actions


def test_admin_person_portrait_is_super_admin_only(client, database):
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: PrivateMemoryStorage()
    register_verified(client, "portrait-role-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Admin эрхийн шалгалт"}).json()
    person = client.post(
        f"/api/v1/families/{family['id']}/persons",
        json={"first_name": "Удмын хүн"},
    ).json()
    register_verified(client, "portrait-operator@example.com")
    operator_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    with database.begin() as db:
        db.add(AdminGrant(user_id=operator_id, role="ADMIN"))
    endpoint = f"/api/v1/admin/families/{family['id']}/people/{person['id']}/profile-photo"
    assert client.post(
        endpoint, content=png_bytes(),
        headers={"Content-Type": "image/png", "X-File-Name": "portrait.png"},
    ).status_code == 403
    assert client.get(endpoint).status_code == 403
    assert client.delete(endpoint).status_code == 403

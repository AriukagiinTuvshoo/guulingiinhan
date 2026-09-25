import io
from uuid import UUID

import pytest

from conftest import register_verified
from PIL import Image
from sqlalchemy import select

from app.models import AuditLog, FamilyMember, Memory, Photo, User
from app.memory_photos import _memory_detail
from app.storage import get_storage


class MemoryStorage:
    def __init__(self):
        self.objects = {}
        self.put_count = 0
        self.fail_put_at = None
        self.fail_delete = False
        self.fail_get = False
        self.delete_count = 0

    def put(self, key, data, content_type):
        self.put_count += 1
        if self.put_count == self.fail_put_at:
            raise RuntimeError("private storage details")
        self.objects[key] = (data, content_type)

    def get(self, key):
        if self.fail_get:
            raise RuntimeError("private storage details")
        return self.objects[key][0]

    def exists(self, key):
        return key in self.objects

    def delete(self, key):
        self.delete_count += 1
        if self.fail_delete:
            error = RuntimeError("private storage details")
            if self.fail_delete == "permanent":
                error.response = {"ResponseMetadata": {"HTTPStatusCode": 403}}
            raise error
        self.objects.pop(key, None)


def png_bytes():
    image = Image.new("RGB", (32, 24), "#477a61")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_thumbnail_strips_exif_metadata():
    from app.memory_photos import _image_payload

    image = Image.new("RGB", (12, 9), "#477a61")
    exif = Image.Exif()
    exif[0x010F] = "Sensitive Camera Serial"
    output = io.BytesIO()
    image.save(output, format="JPEG", exif=exif)
    _, _, _, thumbnail = _image_payload("private.jpg", "image/jpeg", output.getvalue())
    with Image.open(io.BytesIO(thumbnail)) as decoded:
        assert not decoded.getexif()


def test_memory_photo_upload_list_content_and_delete(client):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "photo-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Зургийн сан"}).json()
    family_id = family["id"]
    memory = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={"title": "Зуны дурсамж", "visibility": "family", "person_ids": []},
    ).json()

    uploaded = client.post(
        f"/api/v1/families/{family_id}/memories/{memory['id']}/photos",
        content=png_bytes(),
        headers={"Content-Type": "image/png", "X-File-Name": "family.png"},
    )
    assert uploaded.status_code == 201, uploaded.text
    photo = uploaded.json()
    assert set(photo) == {"id", "title", "created_at", "thumbnail_url", "content_url", "person_ids"}
    assert "storage_key" not in photo and "original_filename" not in photo
    assert len(storage.objects) == 2

    listing = client.get(f"/api/v1/families/{family_id}/memories?page=1&page_size=10")
    assert listing.status_code == 200
    assert listing.json()["total"] == 1
    assert len(listing.json()["items"][0]["photos"]) == 1
    content = client.get(f"/api/v1/families/{family_id}/photos/{photo['id']}/content?variant=thumbnail")
    assert content.status_code == 200
    assert content.headers["cache-control"] == "private, no-store"
    assert content.content.startswith(b"\xff\xd8")

    removed = client.delete(f"/api/v1/families/{family_id}/photos/{photo['id']}")
    assert removed.status_code == 204
    assert storage.objects == {}
    assert client.delete(f"/api/v1/families/{family_id}/photos/{photo['id']}").status_code == 404


def test_photo_upload_rejects_invalid_image_and_nonmember(client):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "photo-owner2@example.com")
    family = client.post("/api/v1/families", json={"name": "Хувийн"}).json()
    family_id = family["id"]
    memory = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={"title": "Дурсамж", "visibility": "family", "person_ids": []},
    ).json()
    endpoint = f"/api/v1/families/{family_id}/memories/{memory['id']}/photos"
    rejected = client.post(endpoint, content=b"not an image", headers={
        "Content-Type": "image/png", "X-File-Name": "bad.png",
    })
    assert rejected.status_code == 415
    mismatch = client.post(endpoint, content=png_bytes(), headers={
        "Content-Type": "image/jpeg", "X-File-Name": "family.png",
    })
    assert mismatch.status_code == 415
    disguised = client.post(endpoint, content=png_bytes(), headers={
        "Content-Type": "image/png", "X-File-Name": "family.jpg",
    })
    assert disguised.status_code == 415
    assert storage.objects == {}

    client.post("/api/v1/auth/logout")
    register_verified(client, "photo-outsider@example.com")
    assert client.post(endpoint, content=png_bytes(), headers={
        "Content-Type": "image/png", "X-File-Name": "family.png",
    }).status_code == 403


def test_failed_upload_is_hidden_and_cleanup_retries(client, database):
    storage = MemoryStorage()
    storage.fail_put_at = 2
    storage.fail_delete = True
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "cleanup-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Цэвэрлэгээ"}).json()
    family_id = family["id"]
    memory = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={"title": "Дурсамж", "visibility": "family", "person_ids": []},
    ).json()
    endpoint = f"/api/v1/families/{family_id}/memories/{memory['id']}/photos"
    failed = client.post(endpoint, content=png_bytes(), headers={
        "Content-Type": "image/png", "X-File-Name": "family.png",
    })
    assert failed.status_code == 503
    assert "private storage details" not in failed.text
    with database() as db:
        row = db.scalar(select(Photo).where(Photo.family_id == UUID(family_id)))
        assert row is not None and row.storage_status == "deletion_pending"
        assert row.cleanup_attempts == 1

    storage.fail_delete = False
    listed = client.get(f"/api/v1/families/{family_id}/memories?page=1&page_size=10")
    assert listed.status_code == 200
    assert listed.json()["items"][0]["photos"] == []
    assert storage.objects == {}
    with database() as db:
        assert db.scalar(select(Photo.id).where(Photo.family_id == UUID(family_id))) is None
        actions = set(db.scalars(select(AuditLog.action)).all())
        assert "photo.upload_failed" in actions
        assert "photo.cleanup_retried" in actions


def test_delete_storage_failure_leaves_hidden_retryable_photo(client, database):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "delete-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Устгалын retry"}).json()
    family_id = family["id"]
    memory = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={"title": "Дурсамж", "visibility": "family", "person_ids": []},
    ).json()
    photo = client.post(
        f"/api/v1/families/{family_id}/memories/{memory['id']}/photos",
        content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "family.png"},
    ).json()
    storage.fail_delete = True
    response = client.delete(f"/api/v1/families/{family_id}/photos/{photo['id']}")
    assert response.status_code == 503
    assert "private storage details" not in response.text
    with database() as db:
        row = db.scalar(select(Photo).where(Photo.id == UUID(photo["id"])))
    assert row is not None and row.storage_status == "deletion_pending"
    with database() as db:
        row = db.get(Photo, UUID(photo["id"]))
        assert row is not None and row.cleanup_attempts == 1
    assert client.get(f"/api/v1/families/{family_id}/memories/{memory['id']}/photos").json() == []
    storage.fail_delete = False
    assert client.get(f"/api/v1/families/{family_id}/memories?page=1&page_size=10").status_code == 200
    assert storage.objects == {}
    with database() as db:
        assert db.scalar(select(Photo.id).where(Photo.id == UUID(photo["id"]))) is None


def test_photo_cleanup_retries_stop_at_configured_attempt_limit(client, database):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "exhausted-cleanup@example.com")
    family = client.post("/api/v1/families", json={"name": "Retry дууссан"}).json()
    family_id = family["id"]
    memory = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={"title": "Дурсамж", "visibility": "family", "person_ids": []},
    ).json()
    photo = client.post(
        f"/api/v1/families/{family_id}/memories/{memory['id']}/photos",
        content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "family.png"},
    ).json()
    storage.fail_delete = True
    assert client.delete(f"/api/v1/families/{family_id}/photos/{photo['id']}").status_code == 503
    with database() as db:
        row = db.get(Photo, UUID(photo["id"]))
        assert row is not None
        row.cleanup_attempts = 8
        db.commit()
    storage.fail_delete = False
    client.get(f"/api/v1/families/{family_id}/memories?page=1&page_size=10")
    with database() as db:
        row = db.get(Photo, UUID(photo["id"]))
        assert row is not None and row.cleanup_attempts == 8
    assert storage.objects


def test_permanent_storage_denial_stops_photo_cleanup_retries(client, database):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "permanent-cleanup@example.com")
    family = client.post("/api/v1/families", json={"name": "Permanent error"}).json()
    family_id = family["id"]
    memory = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={"title": "Дурсамж", "visibility": "family", "person_ids": []},
    ).json()
    photo = client.post(
        f"/api/v1/families/{family_id}/memories/{memory['id']}/photos",
        content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "family.png"},
    ).json()
    storage.fail_delete = "permanent"
    assert client.delete(f"/api/v1/families/{family_id}/photos/{photo['id']}").status_code == 503
    attempts_after_denial = storage.delete_count
    with database() as db:
        row = db.get(Photo, UUID(photo["id"]))
        assert row is not None and row.cleanup_attempts == 8
    storage.fail_delete = False
    client.get(f"/api/v1/families/{family_id}/memories?page=1&page_size=10")
    assert storage.delete_count == attempts_after_denial


def test_upload_attempts_are_rate_limited_and_denials_are_audited(client, database):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "rate-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Хязгаар"}).json()
    family_id = family["id"]
    memory = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={"title": "Дурсамж", "visibility": "family", "person_ids": []},
    ).json()
    endpoint = f"/api/v1/families/{family_id}/memories/{memory['id']}/photos"
    for _ in range(20):
        response = client.post(endpoint, content=b"bad", headers={
            "Content-Type": "image/png", "X-File-Name": "bad.png",
        })
        assert response.status_code == 415
    limited = client.post(endpoint, content=b"bad", headers={
        "Content-Type": "image/png", "X-File-Name": "bad.png",
    })
    assert limited.status_code == 429

    client.post("/api/v1/auth/logout")
    register_verified(client, "rate-outsider@example.com")
    denied = client.get(f"/api/v1/families/{family_id}/photos/00000000-0000-0000-0000-000000000001/content")
    assert denied.status_code == 403
    with database() as db:
        assert "photo.access_denied" in set(db.scalars(select(AuditLog.action)).all())


def test_local_storage_rejects_posix_and_windows_traversal(tmp_path):
    import pytest

    from app.storage import LocalObjectStorage

    storage = LocalObjectStorage(tmp_path / "private")
    for key in (
        "../../secret.txt", "..\\..\\secret.txt", "/absolute/path",
        "C:\\Windows\\win.ini", "a//b", "a/./b", "a/../b",
    ):
        with pytest.raises(ValueError):
            storage.put(key, b"secret", "text/plain")


def test_s3_adapter_uses_private_put_without_acl_and_rejects_bad_keys(monkeypatch):
    import boto3
    import pytest

    from app.storage import S3ObjectStorage

    calls = []

    class FakeClient:
        def put_object(self, **kwargs):
            calls.append(kwargs)

        def get_object(self, **kwargs):
            return {"Body": io.BytesIO(b"private")}

        def delete_object(self, **kwargs):
            calls.append(kwargs)

    fake = FakeClient()
    monkeypatch.setattr(boto3, "client", lambda *args, **kwargs: fake)
    storage = S3ObjectStorage("https://objects.example.net", "private-bucket", "auto", "key", "secret")
    storage.put("families/f1/photos/p1/original", b"private", "image/jpeg")
    assert "ACL" not in calls[0]
    assert storage.get("families/f1/photos/p1/original") == b"private"
    storage.delete("families/f1/photos/p1/original")
    with pytest.raises(ValueError):
        storage.get("../../secret")


def test_memory_photo_download_failure_is_generic(client):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "read-fail@example.com")
    family = client.post("/api/v1/families", json={"name": "Уншилт"}).json()
    memory = client.post(
        f"/api/v1/families/{family['id']}/memories",
        json={"title": "Дурсамж", "visibility": "family", "person_ids": []},
    ).json()
    photo = client.post(
        f"/api/v1/families/{family['id']}/memories/{memory['id']}/photos",
        content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "family.png"},
    ).json()
    storage.fail_get = True
    response = client.get(f"/api/v1/families/{family['id']}/photos/{photo['id']}/content")
    assert response.status_code == 503
    assert "private storage details" not in response.text


def test_private_memory_photo_is_not_visible_to_other_family_member(client, database):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "private-photo-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Нууц зураг"}).json()
    family_id = family["id"]
    memory = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={"title": "Зөвхөн миний дурсамж", "visibility": "private", "person_ids": []},
    ).json()
    photo = client.post(
        f"/api/v1/families/{family_id}/memories/{memory['id']}/photos",
        content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "family.png"},
    ).json()
    client.post("/api/v1/auth/logout")
    register_verified(client, "private-photo-member@example.com")
    with database() as db:
        member = db.scalar(select(User).where(User.email == "private-photo-member@example.com"))
        db.add(FamilyMember(family_id=UUID(family_id), user_id=member.id, role="member"))
        db.commit()
    content = client.get(f"/api/v1/families/{family_id}/photos/{photo['id']}/content")
    assert content.status_code == 404
    assert "storage" not in content.text.lower()


def test_photo_tags_are_family_scoped_and_parent_edge_is_not_guardian_authority(client):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "tag-owner@example.com")
    family_a = client.post("/api/v1/families", json={"name": "А салбар"}).json()
    family_b = client.post("/api/v1/families", json={"name": "Б салбар"}).json()
    adult = client.post(
        f"/api/v1/families/{family_a['id']}/persons",
        json={"first_name": "Насанд хүрсэн"},
    ).json()
    child = client.post(
        f"/api/v1/families/{family_a['id']}/persons",
        json={"first_name": "Хүүхэд", "birth_date": "2015-01-01"},
    ).json()
    parent = client.post(
        f"/api/v1/families/{family_a['id']}/persons", json={"first_name": "Эцэг"}
    ).json()
    foreign = client.post(
        f"/api/v1/families/{family_b['id']}/persons", json={"first_name": "Өөр гэр бүл"}
    ).json()
    edge = client.post(
        f"/api/v1/families/{family_a['id']}/relationships/parent-child",
        json={"parent_id": parent["id"], "child_id": child["id"]},
    )
    assert edge.status_code == 201
    memory = client.post(
        f"/api/v1/families/{family_a['id']}/memories",
        json={"title": "Таг шалгах", "visibility": "family", "person_ids": []},
    ).json()
    photo = client.post(
        f"/api/v1/families/{family_a['id']}/memories/{memory['id']}/photos",
        content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "family.png"},
    ).json()
    tags_url = f"/api/v1/families/{family_a['id']}/photos/{photo['id']}/tags"
    assert client.put(tags_url, json={"person_ids": [child["id"]]}).status_code == 403
    assert client.put(tags_url, json={"person_ids": [foreign["id"]]}).status_code == 404
    tagged = client.put(tags_url, json={"person_ids": [adult["id"], adult["id"]]})
    assert tagged.status_code == 200
    assert tagged.json()["person_ids"] == [adult["id"]]
    cleared = client.put(tags_url, json={"person_ids": []})
    assert cleared.status_code == 200


def test_minor_photo_requires_manage_media_and_revoked_view_scope_denies_read(client, database):
    from test_guardianship import grant, setup_family

    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    _, family, child, guardian = setup_family(client, database)
    base = f"/api/v1/families/{family['id']}/persons/{child['id']}"
    profile_and_memory = grant(
        client, family["id"], child["id"], guardian["id"], ["view_profile", "manage_memories"]
    )
    assert profile_and_memory.status_code == 201
    scope_ids = {item["scope"]: item["id"] for item in profile_and_memory.json()}
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "guardian@example.com", "password": "strong-passphrase-123",
    })
    memory = client.post(
        f"/api/v1/families/{family['id']}/memories",
        json={"title": "Хүүхдийн дурсамж", "person_ids": [child["id"]]},
    ).json()
    upload_url = f"/api/v1/families/{family['id']}/memories/{memory['id']}/photos"
    denied = client.post(upload_url, content=png_bytes(), headers={
        "Content-Type": "image/png", "X-File-Name": "family.png",
    })
    assert denied.status_code == 403

    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "owner@example.com", "password": "strong-passphrase-123",
    })
    media_grant = grant(client, family["id"], child["id"], guardian["id"], ["manage_media"])
    assert media_grant.status_code == 201
    media_scope_id = media_grant.json()[0]["id"]
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "guardian@example.com", "password": "strong-passphrase-123",
    })
    uploaded = client.post(upload_url, content=png_bytes(), headers={
        "Content-Type": "image/png", "X-File-Name": "family.png",
    })
    assert uploaded.status_code == 201
    photo_id = uploaded.json()["id"]
    content_url = f"/api/v1/families/{family['id']}/photos/{photo_id}/content"
    assert client.get(content_url).status_code == 200

    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "owner@example.com", "password": "strong-passphrase-123",
    })
    assert client.delete(f"{base}/guardianships/{media_scope_id}").status_code == 204
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "guardian@example.com", "password": "strong-passphrase-123",
    })
    blocked = client.post(upload_url, content=png_bytes(), headers={
        "Content-Type": "image/png", "X-File-Name": "family.png",
    })
    assert blocked.status_code == 403
    assert client.get(content_url).status_code == 200

    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "owner@example.com", "password": "strong-passphrase-123",
    })
    assert client.delete(f"{base}/guardianships/{scope_ids['view_profile']}").status_code == 204
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "guardian@example.com", "password": "strong-passphrase-123",
    })
    assert client.get(content_url).status_code == 404

    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "owner@example.com", "password": "strong-passphrase-123",
    })
    renewed = grant(client, family["id"], child["id"], guardian["id"], ["view_profile"])
    assert renewed.status_code == 201
    from datetime import UTC, datetime, timedelta

    from app.models import PersonGuardianship

    with database() as db:
        db.get(PersonGuardianship, UUID(renewed.json()[0]["id"])).expires_at = (
            datetime.now(UTC) - timedelta(seconds=1)
        )
        db.commit()
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "guardian@example.com", "password": "strong-passphrase-123",
    })
    assert client.get(content_url).status_code == 404


def test_memory_detail_response_contract(client, database):
    register_verified(client, "memory-response-contract@example.com")
    family = client.post("/api/v1/families", json={"name": "Response contract"}).json()
    person = client.post(
        f"/api/v1/families/{family['id']}/persons",
        json={"first_name": "Гэрэл", "last_name": "Бат"},
    ).json()
    response = client.post(
        f"/api/v1/families/{family['id']}/memories",
        json={"title": "Contract", "description": "Response", "person_ids": [person["id"]]},
    )
    assert response.status_code == 201, response.text
    with database() as db:
        user = db.scalar(select(User).where(User.email == "memory-response-contract@example.com"))
        memory = db.scalar(select(Memory).where(Memory.family_id == UUID(family["id"])))
        assert user is not None and memory is not None
        try:
            payload = _memory_detail(db, UUID(family["id"]), memory, user)
        except Exception as error:  # noqa: BLE001 - expose the focused contract failure in pytest.
            pytest.fail(f"MemoryOut response contract failed: {type(error).__name__}: {error}")
        assert payload.id == memory.id
        assert payload.author_id == user.id


def test_memory_crud_family_privacy_author_and_person_relation(client, database):
    register_verified(client, "memory-crud-owner@example.com")
    family_a = client.post("/api/v1/families", json={"name": "Memory A"}).json()
    family_b = client.post("/api/v1/families", json={"name": "Memory B"}).json()
    person_a = client.post(
        f"/api/v1/families/{family_a['id']}/persons",
        json={"first_name": "Холбоотой", "last_name": "Хүн"},
    ).json()
    person_b = client.post(
        f"/api/v1/families/{family_b['id']}/persons",
        json={"first_name": "Өөр", "last_name": "Хүн"},
    ).json()

    invalid = client.post(
        f"/api/v1/families/{family_a['id']}/memories",
        json={"title": "   ", "person_ids": []},
    )
    assert invalid.status_code == 422

    foreign = client.post(
        f"/api/v1/families/{family_a['id']}/memories",
        json={"title": "Cross family", "person_ids": [person_b["id"]]},
    )
    assert foreign.status_code == 404

    created = client.post(
        f"/api/v1/families/{family_a['id']}/memories",
        json={
            "title": "Гэр бүлийн өдөр",
            "description": "Анхны дурсамж",
            "memory_date": "2020-05-14",
            "visibility": "family",
            "person_ids": [person_a["id"], person_a["id"]],
            "author_id": str(UUID(int=1)),
        },
    )
    assert created.status_code == 422

    created = client.post(
        f"/api/v1/families/{family_a['id']}/memories",
        json={
            "title": "Гэр бүлийн өдөр",
            "description": "Анхны дурсамж",
            "memory_date": "2020-05-14",
            "visibility": "family",
            "person_ids": [person_a["id"]],
            "author_id": str(UUID(int=1)),
        },
    )
    assert created.status_code == 201
    memory = created.json()
    assert memory["author_id"] != str(UUID(int=1))
    assert [person["id"] for person in memory["related_people"]] == [person_a["id"]]

    detail = client.get(f"/api/v1/families/{family_a['id']}/memories/{memory['id']}")
    assert detail.status_code == 200
    assert detail.json()["title"] == "Гэр бүлийн өдөр"

    listing = client.get(
        f"/api/v1/families/{family_a['id']}/memories?page=1&page_size=10&q=гэр бүлийн"
    )
    assert listing.status_code == 200
    assert listing.json()["total"] == 1

    updated = client.put(
        f"/api/v1/families/{family_a['id']}/memories/{memory['id']}",
        json={"title": "Шинэ гарчиг", "description": "Шинэ тайлбар", "person_ids": []},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Шинэ гарчиг"
    assert updated.json()["author_id"] == memory["author_id"]

    client.post("/api/v1/auth/logout")
    register_verified(client, "memory-crud-outsider@example.com")
    assert client.get(f"/api/v1/families/{family_a['id']}/memories/{memory['id']}").status_code == 403
    assert client.delete(f"/api/v1/families/{family_a['id']}/memories/{memory['id']}").status_code == 403


def test_memory_member_is_read_only_and_wrong_family_memory_is_hidden(client, database):
    register_verified(client, "memory-owner-readonly@example.com")
    family = client.post("/api/v1/families", json={"name": "Read only"}).json()
    memory = client.post(
        f"/api/v1/families/{family['id']}/memories",
        json={"title": "Харах дурсамж", "person_ids": []},
    ).json()

    register_verified(client, "memory-member-readonly@example.com")
    with database() as db:
        member = db.scalar(select(User).where(User.email == "memory-member-readonly@example.com"))
        db.add(FamilyMember(family_id=UUID(family["id"]), user_id=member.id, role="member"))
        db.commit()

    assert client.get(f"/api/v1/families/{family['id']}/memories/{memory['id']}").status_code == 200
    assert client.post(
        f"/api/v1/families/{family['id']}/memories",
        json={"title": "Denied", "person_ids": []},
    ).status_code == 403
    assert client.put(
        f"/api/v1/families/{family['id']}/memories/{memory['id']}",
        json={"title": "Denied", "person_ids": []},
    ).status_code == 403
    assert client.delete(f"/api/v1/families/{family['id']}/memories/{memory['id']}").status_code == 403


def test_memory_delete_preserves_genealogy_state(client, database):
    register_verified(client, "memory-genealogy@example.com")
    family = client.post("/api/v1/families", json={"name": "Memory genealogy"}).json()
    parent = client.post(
        f"/api/v1/families/{family['id']}/persons",
        json={"first_name": "Эцэг"},
    ).json()
    child = client.post(
        f"/api/v1/families/{family['id']}/persons",
        json={"first_name": "Хүүхэд"},
    ).json()
    spouse = client.post(
        f"/api/v1/families/{family['id']}/persons",
        json={"first_name": "Хань"},
    ).json()
    assert client.post(
        f"/api/v1/families/{family['id']}/relationships/parent-child",
        json={"parent_id": parent["id"], "child_id": child["id"]},
    ).status_code == 201
    assert client.post(
        f"/api/v1/families/{family['id']}/marriages",
        json={"person_1_id": child["id"], "person_2_id": spouse["id"]},
    ).status_code == 201
    lineage = client.post(
        f"/api/v1/families/{family['id']}/lineages", json={"name": "Удам"}
    ).json()
    branch = client.post(
        f"/api/v1/lineages/{lineage['id']}/branches", json={"name": "Салаа"}
    ).json()
    assert client.put(
        f"/api/v1/families/{family['id']}/persons/{child['id']}/lineage-assignment",
        json={"lineage_id": lineage["id"], "branch_id": branch["id"]},
    ).status_code == 200

    before_tree = client.get(
        f"/api/v1/families/{family['id']}/tree?person_id={child['id']}&depth=2"
    ).json()
    before_assignment = client.get(
        f"/api/v1/families/{family['id']}/persons/{child['id']}/lineage-assignment"
    ).json()
    memory = client.post(
        f"/api/v1/families/{family['id']}/memories",
        json={"title": "Regression", "person_ids": [child["id"]]},
    ).json()
    assert client.put(
        f"/api/v1/families/{family['id']}/memories/{memory['id']}",
        json={"title": "Regression update", "person_ids": [child["id"]]},
    ).status_code == 200
    assert client.delete(
        f"/api/v1/families/{family['id']}/memories/{memory['id']}"
    ).status_code == 204

    after_tree = client.get(
        f"/api/v1/families/{family['id']}/tree?person_id={child['id']}&depth=2"
    ).json()
    after_assignment = client.get(
        f"/api/v1/families/{family['id']}/persons/{child['id']}/lineage-assignment"
    ).json()
    assert before_tree == after_tree
    assert before_assignment == after_assignment

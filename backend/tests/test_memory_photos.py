import io
from uuid import UUID

import pytest
from conftest import TEST_PASSWORD, register_verified
from PIL import Image
from sqlalchemy import select

from app.models import AuditLog, FamilyMember, Photo, User
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


def jpeg_with_sensitive_exif():
    image = Image.new("RGB", (48, 32), "#477a61")
    exif = Image.Exif()
    exif[0x010F] = "Sensitive Camera Serial"
    exif[0x8825] = {
        1: "N",
        2: (37.0, 48.0, 12.34),
        3: "W",
        4: (122.0, 25.0, 12.34),
    }
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=92, exif=exif)
    return output.getvalue()


def assert_no_sensitive_exif(data):
    with Image.open(io.BytesIO(data)) as decoded:
        metadata = decoded.getexif()
        assert 0x010F not in metadata
        assert 0x8825 not in metadata
        assert not metadata.get_ifd(0x8825)


def test_original_and_thumbnail_strip_camera_and_gps_metadata():
    from app.memory_photos import _image_payload

    source = jpeg_with_sensitive_exif()
    with Image.open(io.BytesIO(source)) as decoded:
        source_exif = decoded.getexif()
        assert source_exif[0x010F] == "Sensitive Camera Serial"
        assert source_exif.get_ifd(0x8825)[1] == "N"

    _, width, height, original, thumbnail = _image_payload(
        "private.jpg", "image/jpeg", source
    )
    assert (width, height) == (48, 32)
    assert len(original) > 0
    assert_no_sensitive_exif(original)
    assert_no_sensitive_exif(thumbnail)


def test_png_original_reencode_preserves_alpha_and_removes_text_metadata():
    from PIL.PngImagePlugin import PngInfo

    from app.memory_photos import _image_payload

    image = Image.new("RGBA", (4, 3), (12, 34, 56, 0))
    image.putpixel((1, 1), (200, 100, 50, 128))
    metadata = PngInfo()
    metadata.add_text("GPSLocation", "private coordinates")
    output = io.BytesIO()
    image.save(output, format="PNG", pnginfo=metadata)

    _, width, height, sanitized_original, _ = _image_payload(
        "private.png", "image/png", output.getvalue()
    )
    assert (width, height) == (4, 3)
    with Image.open(io.BytesIO(sanitized_original)) as decoded:
        assert decoded.mode == "RGBA"
        assert decoded.getpixel((1, 1)) == (200, 100, 50, 128)
        assert "GPSLocation" not in decoded.info


def test_palette_png_transparency_survives_metadata_removal():
    from app.memory_photos import _image_payload

    image = Image.new("P", (2, 2), 0)
    image.putpalette([255, 0, 0, 0, 255, 0] + [0] * 762)
    image.putpixel((1, 1), 1)
    output = io.BytesIO()
    image.save(output, format="PNG", transparency=0)
    _, _, _, sanitized, _ = _image_payload("image.png", "image/png", output.getvalue())
    with Image.open(io.BytesIO(sanitized)) as decoded:
        assert decoded.convert("RGBA").getpixel((0, 0))[3] == 0
        assert decoded.convert("RGBA").getpixel((1, 1))[3] == 255


def test_animated_png_is_rejected_instead_of_silently_losing_frames():
    from fastapi import HTTPException

    from app.memory_photos import _image_payload

    output = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(
        output, format="PNG", save_all=True,
        append_images=[Image.new("RGB", (4, 4), "blue")], duration=100, loop=0,
    )
    with pytest.raises(HTTPException) as error:
        _image_payload("animated.png", "image/png", output.getvalue())
    assert error.value.status_code == 415


def test_uploaded_original_stored_and_retrieved_without_exif(client):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "photo-exif-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Фото EXIF"}).json()
    family_id = family["id"]
    memory = client.post(
        f"/api/v1/families/{family_id}/memories",
        json={"title": "Metadata privacy", "visibility": "family", "person_ids": []},
    ).json()
    uploaded = client.post(
        f"/api/v1/families/{family_id}/memories/{memory['id']}/photos",
        content=jpeg_with_sensitive_exif(),
        headers={"Content-Type": "image/jpeg", "X-File-Name": "gps-photo.jpg"},
    )
    assert uploaded.status_code == 201, uploaded.text

    original_key = next(key for key in storage.objects if key.endswith("/original"))
    stored_original = storage.objects[original_key][0]
    assert_no_sensitive_exif(stored_original)
    content_url = uploaded.json()["content_url"]
    retrieved_original = client.get(f"/api/v1{content_url}")
    assert retrieved_original.status_code == 200
    assert_no_sensitive_exif(retrieved_original.content)
    retrieved_thumbnail = client.get(
        f"/api/v1{uploaded.json()['thumbnail_url']}"
    )
    assert retrieved_thumbnail.status_code == 200
    assert_no_sensitive_exif(retrieved_thumbnail.content)


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
    assert set(photo) == {
        "id", "title", "description", "photo_date", "created_at", "thumbnail_url",
        "content_url", "person_ids", "person_names",
    }
    assert "storage_key" not in photo and "original_filename" not in photo
    assert len(storage.objects) == 2

    listing = client.get(f"/api/v1/families/{family_id}/memories?page=1&page_size=10")
    assert listing.status_code == 200
    assert listing.json()["total"] == 1
    assert len(listing.json()["items"][0]["photos"]) == 1
    detail = client.get(f"/api/v1/families/{family_id}/memories/{memory['id']}")
    assert detail.status_code == 200
    assert detail.json()["photos_total"] == 1
    assert detail.json()["photos"][0]["id"] == photo["id"]
    assert detail.json()["can_edit"] is True
    page = client.get(
        f"/api/v1/families/{family_id}/memories/{memory['id']}/photos?page=1&page_size=1"
    )
    assert page.status_code == 200
    assert page.json()["items"][0]["id"] == photo["id"]
    assert page.json()["total"] == 1 and page.json()["has_next"] is False
    edited = client.patch(
        f"/api/v1/families/{family_id}/photos/{photo['id']}",
        json={"title": "Наадмын зураг", "description": "Гэр бүлийн тэмдэглэл", "photo_date": "2024-07-11"},
    )
    assert edited.status_code == 200
    assert edited.json()["title"] == "Наадмын зураг"
    assert edited.json()["photo_date"] == "2024-07-11"
    detail = client.get(f"/api/v1/families/{family_id}/memories/{memory['id']}").json()
    assert detail["photos"][0]["description"] == "Гэр бүлийн тэмдэглэл"
    content = client.get(f"/api/v1/families/{family_id}/photos/{photo['id']}/content?variant=thumbnail")
    assert content.status_code == 200
    assert content.headers["cache-control"] == "private, no-store"
    assert content.content.startswith(b"\xff\xd8")

    removed = client.delete(f"/api/v1/families/{family_id}/photos/{photo['id']}")
    assert removed.status_code == 204
    assert storage.objects == {}
    assert client.delete(f"/api/v1/families/{family_id}/photos/{photo['id']}").status_code == 404


def test_memory_photo_page_returns_all_items_across_pages(client):
    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "photo-page@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Зургийн хуудас"}).json()["id"]
    memory = client.post(f"/api/v1/families/{family_id}/memories", json={
        "title": "Гурван зураг", "visibility": "family", "person_ids": [],
    }).json()
    endpoint = f"/api/v1/families/{family_id}/memories/{memory['id']}/photos"
    uploaded_ids = []
    for index in range(3):
        response = client.post(endpoint, content=png_bytes(), headers={
            "Content-Type": "image/png", "X-File-Name": f"family-{index}.png",
        })
        assert response.status_code == 201, response.text
        uploaded_ids.append(response.json()["id"])

    first = client.get(f"{endpoint}?page=1&page_size=2").json()
    second = client.get(f"{endpoint}?page=2&page_size=2").json()
    assert first["total"] == 3 and first["has_next"] is True
    assert len(first["items"]) == 2
    assert second["total"] == 3 and second["has_next"] is False
    assert len(second["items"]) == 1
    assert len({item["id"] for item in first["items"] + second["items"]}) == 3
    assert {item["id"] for item in first["items"] + second["items"]} == set(uploaded_ids)
    detail = client.get(f"/api/v1/families/{family_id}/memories/{memory['id']}").json()
    assert detail["photos_total"] == 3 and len(detail["photos"]) == 3


def test_memory_list_openapi_has_one_paginated_contract():
    from app.main import app

    app.openapi_schema = None
    operation = app.openapi()["paths"]["/api/v1/families/{family_id}/memories"]["get"]
    parameter_names = {item["name"] for item in operation["parameters"]}
    assert {"page", "page_size", "q", "year", "memory_date", "person_id", "branch_id"} <= parameter_names


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
    assert client.get(f"/api/v1/families/{family_id}/memories/{memory['id']}/photos").json()["items"] == []
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
        "email": "guardian@example.com", "password": TEST_PASSWORD,
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
        "email": "owner@example.com", "password": TEST_PASSWORD,
    })
    media_grant = grant(client, family["id"], child["id"], guardian["id"], ["manage_media"])
    assert media_grant.status_code == 201
    media_scope_id = media_grant.json()[0]["id"]
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "guardian@example.com", "password": TEST_PASSWORD,
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
        "email": "owner@example.com", "password": TEST_PASSWORD,
    })
    assert client.delete(f"{base}/guardianships/{media_scope_id}").status_code == 204
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "guardian@example.com", "password": TEST_PASSWORD,
    })
    blocked = client.post(upload_url, content=png_bytes(), headers={
        "Content-Type": "image/png", "X-File-Name": "family.png",
    })
    assert blocked.status_code == 403
    assert client.get(content_url).status_code == 200

    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "owner@example.com", "password": TEST_PASSWORD,
    })
    assert client.delete(f"{base}/guardianships/{scope_ids['view_profile']}").status_code == 204
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "guardian@example.com", "password": TEST_PASSWORD,
    })
    assert client.get(content_url).status_code == 404

    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": "owner@example.com", "password": TEST_PASSWORD,
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
        "email": "guardian@example.com", "password": TEST_PASSWORD,
    })
    assert client.get(content_url).status_code == 404


def test_memory_pagination_counts_only_visible_records_and_updates_on_guardian_revocation(client, database):
    from test_guardianship import grant, setup_family

    from app.models import FamilyPerson, Memory, MemoryPersonTag, Person

    storage = MemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    owner, family, child, guardian = setup_family(client, database)
    family_id, owner_id, child_id = map(UUID, (family['id'], owner['id'], child['id']))
    with database() as db:
        private_person = Person(first_name='Private', visibility='private', created_by=owner_id)
        detached_person = Person(first_name='Detached', created_by=owner_id)
        db.add_all([private_person, detached_person]); db.flush()
        db.add(FamilyPerson(family_id=family_id, person_id=private_person.id, added_by=owner_id))
        visible = [Memory(family_id=family_id, title=f'Visible {i}', created_by=owner_id) for i in range(3)]
        hidden = [Memory(family_id=family_id, title=f'Hidden {i}', created_by=owner_id) for i in range(3)]
        db.add_all(visible + hidden); db.flush()
        db.add_all([MemoryPersonTag(memory_id=item.id, person_id=person_id) for item, person_id in zip(hidden, (child_id, private_person.id, detached_person.id), strict=True)])
        db.commit()
    login = lambda email: client.post('/api/v1/auth/login', json={'email': email, 'password': 'strong-passphrase-123'})
    client.post('/api/v1/auth/logout'); assert login('guardian@example.com').status_code == 200
    url = f'/api/v1/families/{family_id}/memories'
    from sqlalchemy import event

    statements = []
    engine = database.kw['bind']
    def record_sql(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement.lower())
    event.listen(engine, 'before_cursor_execute', record_sql)
    try:
        first = client.get(url, params={'page': 1, 'page_size': 2}).json()
    finally:
        event.remove(engine, 'before_cursor_execute', record_sql)
    assert any('from memories' in sql and ' limit ' in sql.replace('\n', ' ') for sql in statements)
    second = client.get(url, params={'page': 2, 'page_size': 2}).json()
    assert (first['total'], first['has_next'], second['total'], second['has_next']) == (3, True, 3, False)
    assert len(first['items']) == 2 and len(second['items']) == 1
    assert len({item['id'] for item in first['items'] + second['items']}) == 3
    client.post('/api/v1/auth/logout'); assert login('owner@example.com').status_code == 200
    result = grant(client, family['id'], child['id'], guardian['id'], ['manage_memories'])
    assert result.status_code == 201
    grant_id = result.json()[0]['id']
    client.post('/api/v1/auth/logout'); assert login('guardian@example.com').status_code == 200
    assert client.get(url, params={'page_size': 2}).json()['total'] == 4
    client.post('/api/v1/auth/logout'); assert login('owner@example.com').status_code == 200
    assert client.delete(f"/api/v1/families/{family_id}/persons/{child_id}/guardianships/{grant_id}").status_code == 204
    client.post('/api/v1/auth/logout'); assert login('guardian@example.com').status_code == 200
    assert client.get(url).json()['total'] == 3


@pytest.mark.parametrize('today', ['2026-02-27', '2026-02-28', '2026-03-01', '2024-02-29', '2026-11-20'])
def test_sql_adult_cutoff_matches_guardian_age_policy(today):
    from datetime import date, timedelta

    from app.memory_photos import _adult_cutoff
    from app.privacy import is_minor

    current = date.fromisoformat(today)
    cutoff = _adult_cutoff(current)
    for offset in (-2, -1, 0, 1, 2):
        birth = cutoff + timedelta(days=offset)
        assert (birth > cutoff) == is_minor(birth, current)

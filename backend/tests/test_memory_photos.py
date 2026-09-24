import io

from conftest import register_verified
from PIL import Image

from app.storage import get_storage


class MemoryStorage:
    def __init__(self):
        self.objects = {}

    def put(self, key, data, content_type):
        self.objects[key] = (data, content_type)

    def get(self, key):
        return self.objects[key][0]

    def exists(self, key):
        return key in self.objects

    def delete(self, key):
        self.objects.pop(key, None)


def png_bytes():
    image = Image.new("RGB", (32, 24), "#477a61")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


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
    assert photo["mime_type"] == "image/png"
    assert photo["width"] == 32 and photo["height"] == 24
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
    assert storage.objects == {}

    client.post("/api/v1/auth/logout")
    register_verified(client, "photo-outsider@example.com")
    assert client.post(endpoint, content=png_bytes(), headers={
        "Content-Type": "image/png", "X-File-Name": "family.png",
    }).status_code == 403

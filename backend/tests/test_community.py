from uuid import UUID

from app.main import app
from app.models import Family
from app.storage import get_storage
from tests.conftest import register_verified
from tests.test_memory_photos import MemoryStorage, png_bytes

PASSWORD = "community-test-passphrase-123"


def _login(client, email):
    assert client.post("/api/v1/auth/login", json={
        "email": email, "password": PASSWORD,
    }).status_code == 200


def test_public_feed_is_cross_account_and_respects_visibility(client, database, email_provider):
    assert client.get("/api/v1/community/feed").status_code == 401
    assert client.get("/api/v1/community/story/00000000-0000-0000-0000-000000000001").status_code == 401
    assert register_verified(client, "community-a@example.com", PASSWORD, email_provider).status_code == 201
    family_a = client.post("/api/v1/families", json={"name": "First family"}).json()["id"]
    base_a = f"/api/v1/families/{family_a}"
    public_records = {}
    hidden_records = {}
    for kind, payload in (
        ("stories", {"title": "Public story", "body": "Shared text"}),
        ("memories", {"title": "Public memory", "description": "Shared moment"}),
        ("archives", {"title": "Public archive", "description": "Shared source"}),
    ):
        response = client.post(f"{base_a}/{kind}", json={**payload, "visibility": "public"})
        assert response.status_code == 201, response.text
        route_kind = {"stories": "story", "memories": "memory", "archives": "archive"}[kind]
        public_records[route_kind] = response.json()["id"]
        response = client.post(f"{base_a}/{kind}", json={
            **payload, "title": f"Hidden {kind}", "visibility": "family",
        })
        assert response.status_code == 201, response.text
        hidden_records[route_kind] = response.json()["id"]
    assert client.post(f"{base_a}/stories", json={
        "title": "Private story", "body": "Secret", "visibility": "private",
    }).status_code == 201

    assert register_verified(client, "community-b@example.com", PASSWORD, email_provider).status_code == 201
    family_b = client.post("/api/v1/families", json={"name": "Second family"}).json()["id"]
    assert client.post(f"/api/v1/families/{family_b}/stories", json={
        "title": "Second public", "body": "Another family", "visibility": "public",
    }).status_code == 201
    feed = client.get("/api/v1/community/feed?page=1&page_size=2")
    assert feed.status_code == 200, feed.text
    assert feed.json()["total"] == 4
    assert feed.json()["has_next"] is True
    second_page = client.get("/api/v1/community/feed?page=2&page_size=2").json()
    assert second_page["has_next"] is False
    all_items = feed.json()["items"] + second_page["items"]
    assert {item["title"] for item in all_items} == {
        "Public story", "Public memory", "Public archive", "Second public",
    }
    assert {item["family_name"] for item in all_items} == {"First family", "Second family"}
    assert {item["kind"] for item in all_items} == {"story", "memory", "archive"}
    stories_only = client.get("/api/v1/community/feed?kind=story").json()
    assert stories_only["total"] == 2
    assert {item["title"] for item in stories_only["items"]} == {"Public story", "Second public"}
    memories_only = client.get("/api/v1/community/feed?kind=memory").json()
    assert memories_only["total"] == 1
    assert memories_only["items"][0]["title"] == "Public memory"
    assert client.get("/api/v1/community/feed?kind=unknown").status_code == 422
    assert client.get(f"{base_a}/stories").status_code == 403
    for kind in ("story", "memory", "archive"):
        detail = client.get(f"/api/v1/community/{kind}/{public_records[kind]}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["family_name"] == "First family"
        assert client.get(f"/api/v1/community/{kind}/{hidden_records[kind]}").status_code == 404

    # An archived family is removed from the shared feed without deleting content.
    with database.begin() as db:
        family = db.get(Family, UUID(family_a))
        from datetime import UTC, datetime
        family.archived_at = datetime.now(UTC)
    after_archive = client.get("/api/v1/community/feed").json()
    assert after_archive["total"] == 1
    assert after_archive["items"][0]["title"] == "Second public"


def test_public_memory_thumbnail_requires_public_adult_photo_tags(client, email_provider):
    storage = MemoryStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    assert register_verified(client, "public-photo-owner@example.com", PASSWORD, email_provider).status_code == 201
    family_id = client.post("/api/v1/families", json={"name": "Photo family"}).json()["id"]
    person = client.post(f"/api/v1/families/{family_id}/persons", json={
        "first_name": "Adult", "birth_date": "1980-01-01", "visibility": "public",
    }).json()
    memory = client.post(f"/api/v1/families/{family_id}/memories", json={
        "title": "Shared photograph", "visibility": "public", "person_ids": [person["id"]],
    }).json()
    uploaded = client.post(
        f"/api/v1/families/{family_id}/memories/{memory['id']}/photos",
        content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "adult.png"},
    )
    assert uploaded.status_code == 201, uploaded.text
    photo_id = uploaded.json()["id"]
    assert client.put(f"/api/v1/families/{family_id}/photos/{photo_id}/tags", json={
        "person_ids": [person["id"]],
    }).status_code == 200
    story = client.post(f"/api/v1/families/{family_id}/stories", json={
        "title": "Shared illustrated history",
        "body": f"An account of the day.\n\n[[photo:{photo_id}|Family portrait]]",
        "visibility": "public",
    })
    assert story.status_code == 201, story.text
    assert client.post(f"/api/v1/families/{family_id}/stories", json={
        "title": "Bad reference", "body": "[[photo:00000000-0000-0000-0000-000000000001]]",
        "visibility": "public",
    }).status_code == 422
    assert client.post(f"/api/v1/families/{family_id}/stories", json={
        "title": "Malformed photo token", "body": "[[photo:------------------------------------]]",
        "visibility": "family",
    }).status_code == 422

    family_only_memory = client.post(f"/api/v1/families/{family_id}/memories", json={
        "title": "Гэр бүлийн хүрээний зураг", "visibility": "family", "person_ids": [person["id"]],
    }).json()
    family_only_photo = client.post(
        f"/api/v1/families/{family_id}/memories/{family_only_memory['id']}/photos",
        content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "family-only.png"},
    ).json()
    private_photo_story = client.post(f"/api/v1/families/{family_id}/stories", json={
        "title": "Private photo reference",
        "body": f"[[photo:{family_only_photo['id']}|Private family photo]]",
        "visibility": "public",
    })
    assert private_photo_story.status_code == 422

    other_family = client.post("/api/v1/families", json={"name": "Other family"}).json()
    cross_family_photo_story = client.post(f"/api/v1/families/{other_family['id']}/stories", json={
        "title": "Cross-family photo reference",
        "body": f"[[photo:{photo_id}|Foreign photo]]",
        "visibility": "family",
    })
    assert cross_family_photo_story.status_code == 422
    assert register_verified(client, "public-photo-viewer@example.com", PASSWORD, email_provider).status_code == 201
    item = next(item for item in client.get("/api/v1/community/feed").json()["items"] if item["kind"] == "memory")
    assert item["thumbnail_url"] == f"/community/photos/{photo_id}/thumbnail"
    detail = client.get(f"/api/v1/community/memory/{memory['id']}").json()
    assert detail["photos"] == [f"/community/photos/{photo_id}/thumbnail"]
    story_detail = client.get(f"/api/v1/community/story/{story.json()['id']}")
    assert story_detail.status_code == 200
    assert story_detail.json()["photos"] == [f"/community/photos/{photo_id}/thumbnail"]
    public_story = next(item for item in client.get("/api/v1/community/feed").json()["items"] if item["kind"] == "story")
    assert public_story["thumbnail_url"] == f"/community/photos/{photo_id}/thumbnail"
    image = client.get("/api/v1" + item["thumbnail_url"])
    assert image.status_code == 200
    assert image.headers["cache-control"] == "private, no-store"

    _login(client, "public-photo-owner@example.com")
    assert client.patch(f"/api/v1/families/{family_id}/persons/{person['id']}", json={
        "visibility": "private",
    }).status_code == 200
    _login(client, "public-photo-viewer@example.com")
    hidden = next(item for item in client.get("/api/v1/community/feed").json()["items"] if item["kind"] == "memory")
    assert hidden["thumbnail_url"] is None
    assert client.get(f"/api/v1/community/memory/{memory['id']}").json()["photos"] == []
    assert client.get(f"/api/v1/community/story/{story.json()['id']}").json()["photos"] == []
    assert client.get(f"/api/v1/community/photos/{photo_id}/thumbnail").status_code == 404

from uuid import UUID

from conftest import register_verified
from test_memory_photos import MemoryStorage, png_bytes

from app.main import app
from app.models import FamilyMember, MemoryPersonTag
from app.storage import get_storage


def login(client, email):
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "strong-passphrase-123"}).status_code == 200


def test_people_grant_relationships_and_biography_preserve_privacy(client, database):
    register_verified(client, "people-work-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "F"}).json()["id"]
    base = f"/api/v1/families/{family}"
    a = client.post(base + "/persons", json={"first_name": "A"}).json()["id"]
    b = client.post(base + "/persons", json={"first_name": "B"}).json()["id"]
    child = client.post(base + "/persons", json={"first_name": "Minor", "birth_date": "2018-01-01"}).json()["id"]
    secret = client.post(base + "/persons", json={"first_name": "Secret", "visibility": "private"}).json()["id"]
    client.post("/api/v1/auth/logout")
    register_verified(client, "people-work-member@example.com")
    member = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family), user_id=UUID(member), role="member")); db.commit()
    login(client, "people-work-owner@example.com")
    grants = f"{base}/admin-grants/{member}"
    assert client.put(grants, json={"scopes": ["manage_people"]}).status_code == 204
    login(client, "people-work-member@example.com")
    assert client.put(f"{base}/persons/{a}/biography", json={"content": "Adult biography"}).status_code == 200
    assert client.put(f"{base}/persons/{child}/biography", json={"content": "Denied"}).status_code == 403
    assert client.put(f"{base}/persons/{secret}/biography", json={"content": "Denied"}).status_code == 404
    assert client.post(base + "/relationships/parent-child", json={"parent_id": a, "child_id": child}).status_code == 403
    assert client.post(base + "/relationships/parent-child", json={"parent_id": a, "child_id": secret}).status_code == 404
    assert client.post(base + "/relationships/parent-child", json={"parent_id": a, "child_id": b}).status_code == 201
    marriage = client.post(base + "/marriages", json={"person_1_id": a, "person_2_id": b})
    assert marriage.status_code == 201
    assert client.patch(f"{base}/marriages/{marriage.json()['id']}", json={"location": "Test"}).status_code == 200
    assert client.delete(f"{base}/marriages/{marriage.json()['id']}").status_code == 204
    assert client.post(f"{base}/persons/{a}/events", json={"title": "Denied", "event_type": "other"}).status_code == 403
    login(client, "people-work-owner@example.com")
    assert client.put(grants, json={"scopes": []}).status_code == 204
    login(client, "people-work-member@example.com")
    assert client.put(f"{base}/persons/{a}/biography", json={"content": "Denied"}).status_code == 403


def test_content_grant_memory_photos_and_guardian_checks(client, database):
    storage = MemoryStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    register_verified(client, "content-work-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "F"}).json()["id"]
    base = f"/api/v1/families/{family}"
    child = client.post(base + "/persons", json={"first_name": "Minor", "birth_date": "2018-01-01"}).json()["id"]
    secret = client.post(base + "/persons", json={"first_name": "Secret", "visibility": "private"}).json()["id"]
    memory = client.post(base + "/memories", json={"title": "Memory", "person_ids": []}).json()["id"]
    private = client.post(base + "/memories", json={"title": "Private", "visibility": "private", "person_ids": []}).json()["id"]
    photo = client.post(f"{base}/memories/{memory}/photos", content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "test.png"}).json()["id"]
    assert client.put(f"{base}/photos/{photo}/tags", json={"person_ids": [secret]}).status_code == 200
    client.post("/api/v1/auth/logout")
    register_verified(client, "content-work-member@example.com")
    member = client.get("/api/v1/auth/me").json()["id"]
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family), user_id=UUID(member), role="member")); db.commit()
    login(client, "content-work-owner@example.com")
    grants = f"{base}/admin-grants/{member}"
    assert client.put(grants, json={"scopes": ["manage_content"]}).status_code == 204
    login(client, "content-work-member@example.com")
    assert client.patch(f"{base}/memories/{memory}", json={"title": "Updated", "person_ids": []}).status_code == 200
    assert client.patch(f"{base}/memories/{private}", json={"title": "Denied", "person_ids": []}).status_code == 404
    assert client.put(f"{base}/photos/{photo}/tags", json={"person_ids": []}).status_code == 404
    assert client.delete(f"{base}/photos/{photo}").status_code == 404
    uploaded = client.post(f"{base}/memories/{memory}/photos", content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "new.png"})
    assert uploaded.status_code == 201
    assert client.delete(f"{base}/photos/{uploaded.json()['id']}").status_code == 204
    with database() as db:
        db.add(MemoryPersonTag(memory_id=UUID(memory), person_id=UUID(child))); db.commit()
    assert client.patch(f"{base}/memories/{memory}", json={"title": "Denied", "person_ids": []}).status_code == 403
    assert client.post(f"{base}/memories/{memory}/photos", content=png_bytes(), headers={"Content-Type": "image/png", "X-File-Name": "new.png"}).status_code == 404
    login(client, "content-work-owner@example.com")
    assert client.put(grants, json={"scopes": []}).status_code == 204
    login(client, "content-work-member@example.com")
    assert client.patch(f"{base}/memories/{private}", json={"title": "Denied", "person_ids": []}).status_code == 404

"""Release authorization and canonical ancestry integrity regressions.

All records are disposable local fixtures. No staging data is used.
"""
from uuid import UUID

import pytest
from sqlalchemy import select

from app.main import app
from app.models import (
    AdminGrant,
    Archive,
    FamilyPerson,
    LifeEvent,
    Memory,
    ParentChildRelationship,
    Person,
    Photo,
    Story,
)
from app.storage import get_storage
from tests.conftest import register_verified
from tests.test_memory_photos import MemoryStorage, png_bytes


@pytest.mark.parametrize("admin_workspace", [False, True])
def test_family_write_cannot_close_cycle_through_another_family(
    client, database, email_provider, admin_workspace,
):
    register_verified(client, "graph-gate@example.com", email_provider=email_provider)
    user_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_a = UUID(client.post("/api/v1/families", json={"name": "Graph A"}).json()["id"])
    family_b = UUID(client.post("/api/v1/families", json={"name": "Graph B"}).json()["id"])
    with database.begin() as db:
        db.add(AdminGrant(user_id=user_id, role="SUPER_ADMIN"))
        people = [Person(first_name=f"Fixture {i}", created_by=user_id) for i in range(3)]
        db.add_all(people)
        db.flush()
        first, second, outside = [person.id for person in people]
        db.add_all([
            FamilyPerson(family_id=family_a, person_id=first, added_by=user_id),
            FamilyPerson(family_id=family_a, person_id=second, added_by=user_id),
            FamilyPerson(family_id=family_b, person_id=outside, added_by=user_id),
            ParentChildRelationship(parent_id=first, child_id=outside, created_by=user_id),
            ParentChildRelationship(parent_id=outside, child_id=second, created_by=user_id),
        ])
    path = (f"/api/v1/admin/families/{family_a}/relationships" if admin_workspace
            else f"/api/v1/families/{family_a}/relationships/parent-child")
    response = client.post(path, json={"parent_id": str(second), "child_id": str(first)})
    assert response.status_code == 422
    with database() as db:
        assert len(db.scalars(select(ParentChildRelationship)).all()) == 2


@pytest.mark.parametrize("admin_workspace", [False, True])
def test_repeated_canonical_relationship_is_conflict_not_server_error(
    client, database, email_provider, admin_workspace,
):
    register_verified(client, "duplicate-gate@example.com", email_provider=email_provider)
    user_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family = client.post("/api/v1/families", json={"name": "Duplicate fixture"}).json()["id"]
    people = [client.post(f"/api/v1/families/{family}/persons", json={"first_name": f"Fixture {i}"})
              .json()["id"] for i in range(2)]
    with database.begin() as db:
        db.add(AdminGrant(user_id=user_id, role="SUPER_ADMIN"))
    path = (f"/api/v1/admin/families/{family}/relationships" if admin_workspace
            else f"/api/v1/families/{family}/relationships/parent-child")
    body = {"parent_id": people[0], "child_id": people[1]}
    assert client.post(path, json=body).status_code == 201
    response = client.post(path, json=body)
    assert response.status_code == 409
    assert response.json()["error_code"] == "CONFLICT"
    assert response.json()["request_id"]
    with database() as db:
        assert len(db.scalars(select(ParentChildRelationship)).all()) == 1


@pytest.fixture
def isolated_accounts(client, database, email_provider):
    storage = MemoryStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    contexts = []
    for label in ("a", "b"):
        client.cookies.clear()
        register_verified(client, f"isolation-{label}@example.com", email_provider=email_provider)
        user = UUID(client.get("/api/v1/auth/me").json()["id"])
        family = UUID(client.post("/api/v1/families", json={"name": f"Fixture {label}"}).json()["id"])
        with database.begin() as db:
            person = Person(first_name=f"Person {label}", created_by=user)
            db.add(person)
            db.flush()
            db.add(FamilyPerson(family_id=family, person_id=person.id, added_by=user))
            memory = Memory(family_id=family, title="Memory", created_by=user, visibility="family")
            story = Story(family_id=family, title="Story", body="Private heritage", created_by=user)
            archive = Archive(family_id=family, title="Archive", created_by=user)
            event = LifeEvent(person_id=person.id, event_type="other", title="Event", created_by=user)
            db.add_all([memory, story, archive, event])
            db.flush()
            photo = Photo(family_id=family, memory_id=memory.id, object_key="pending",
                          uploaded_by=user, mime_type="image/png")
            db.add(photo)
            db.flush()
            prefix = f"families/{family}/memories/{memory.id}/photos/{photo.id}"
            photo.object_key = f"{prefix}/original"
            photo.thumbnail_object_key = f"{prefix}/thumbnail.jpg"
            storage.put(photo.object_key, png_bytes(), "image/png")
            storage.put(photo.thumbnail_object_key, png_bytes(), "image/jpeg")
            contexts.append({"family": family, "person": person.id, "memory": memory.id,
                             "story": story.id, "archive": archive.id, "event": event.id,
                             "photo": photo.id, "cookies": dict(client.cookies)})
    return contexts


def _object_paths(context):
    base = f"/api/v1/families/{context['family']}"
    return [
        f"{base}/persons/{context['person']}",
        f"{base}/stories/{context['story']}",
        f"{base}/archives/{context['archive']}",
        f"{base}/memories/{context['memory']}",
        f"{base}/persons/{context['person']}/events",
        f"{base}/photos/{context['photo']}/content?variant=thumbnail",
        f"{base}/photos/{context['photo']}/content?variant=original",
        f"{base}/photos/{context['photo']}/content?variant=original&download=true",
        f"{base}/root-connection",
    ]


def test_two_account_object_read_write_and_media_isolation(client, isolated_accounts):
    for own, foreign in (isolated_accounts, list(reversed(isolated_accounts))):
        client.cookies.clear()
        client.cookies.update(own["cookies"])
        for path in _object_paths(own):
            assert client.get(path).status_code == 200, path
        for path in _object_paths(foreign):
            assert client.get(path).status_code in {403, 404}, path
        # A valid own family ID cannot authorize a foreign object ID.
        for path in _object_paths(foreign)[:8]:
            wrong_scope = path.replace(str(foreign["family"]), str(own["family"]))
            assert client.get(wrong_scope).status_code == 404, wrong_scope
        base = f"/api/v1/families/{foreign['family']}"
        mutations = [
            ("PATCH", f"{base}/persons/{foreign['person']}", {"first_name": "Changed"}),
            ("POST", f"{base}/persons/{foreign['person']}/link-me", None),
            ("PUT", f"{base}/stories/{foreign['story']}", {"title": "Changed", "body": "Text"}),
            ("DELETE", f"{base}/stories/{foreign['story']}", None),
            ("PUT", f"{base}/archives/{foreign['archive']}", {"title": "Changed"}),
            ("DELETE", f"{base}/archives/{foreign['archive']}", None),
            ("PATCH", f"{base}/memories/{foreign['memory']}", {"title": "Changed"}),
            ("DELETE", f"{base}/memories/{foreign['memory']}", None),
            ("DELETE", f"{base}/photos/{foreign['photo']}", None),
            ("DELETE", f"{base}/persons/{foreign['person']}/events/{foreign['event']}", None),
            ("DELETE", f"{base}/root-connection", None),
        ]
        for method, path, body in mutations:
            assert client.request(method, path, json=body).status_code in {403, 404}, path
        assert client.get("/api/v1/admin/me").status_code == 403
        assert client.get(f"/api/v1/memories/{foreign['memory']}/comments").status_code == 404
        assert client.put(f"/api/v1/memories/{foreign['memory']}/like", json={"liked": True}).status_code == 404
    client.cookies.clear()
    for context in isolated_accounts:
        for path in _object_paths(context):
            assert client.get(path).status_code == 401, path


def test_private_api_cache_policy_survives_denial_and_session_revocation(client, isolated_accounts):
    own, foreign = isolated_accounts
    client.cookies.clear()
    client.cookies.update(own["cookies"])

    # Both private representations and denial responses can be retained by a
    # cache unless the common API boundary explicitly prevents storage.
    for context, statuses in ((own, {200}), (foreign, {403, 404})):
        for path in _object_paths(context):
            response = client.get(path)
            assert response.status_code in statuses, path
            assert response.headers["cache-control"] == "private, no-store", path
            assert "cookie" in response.headers["vary"].lower(), path

    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 204
    assert response.headers["cache-control"] == "private, no-store"
    client.cookies.clear()
    client.cookies.update(own["cookies"])
    for path in _object_paths(own):
        response = client.get(path)
        assert response.status_code == 401, path
        assert response.headers["cache-control"] == "private, no-store", path

    response = client.post("/api/v1/auth/login", json={"email": "invalid", "password": ""})
    assert response.status_code == 422
    assert response.headers["cache-control"] == "private, no-store"
    response = client.post("/api/v1/auth/logout", headers={"Origin": "https://foreign.invalid"})
    assert response.status_code == 403
    assert response.headers["cache-control"] == "private, no-store"

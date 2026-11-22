from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.auth import get_current_user
from app.main import app
from app.models import AdminGrant, Family, FamilyMember, Memory, MemoryComment, MemoryLike, User


@pytest.fixture
def interaction_context(client, database):
    with database() as db:
        owner = User(display_name="Owner", email="owner@tests.invalid")
        outsider = User(display_name="Other", email="other@tests.invalid")
        db.add_all([owner, outsider]); db.flush()
        family = Family(name="Test context", created_by=owner.id)
        db.add(family); db.flush()
        db.add(FamilyMember(family_id=family.id, user_id=owner.id, role="owner"))
        memory = Memory(family_id=family.id, title="1998 summer", memory_date=date(1998, 7, 2), created_by=owner.id)
        db.add(memory); db.commit()
        context = {"owner": owner, "other": outsider, "family": family.id, "memory": memory.id}
    app.dependency_overrides[get_current_user] = lambda: owner
    return context


def test_like_desired_state_and_comment_idempotence(client, database, interaction_context):
    base = f"/api/v1/memories/{interaction_context['memory']}"
    for _ in range(2):
        result = client.put(base + "/like", json={"liked": True})
        assert result.status_code == 200, result.text
        assert result.json() == {"liked": True, "like_count": 1, "comment_count": 0}
    payload = {"body": "<script>alert(1)</script>", "request_key": str(uuid4())}
    comment = client.post(base + "/comments", json=payload)
    assert comment.status_code == 201, comment.text
    retry = client.post(base + "/comments", json=payload)
    assert retry.json()["id"] == comment.json()["id"]
    assert retry.json()["body"] == payload["body"]
    conflict = client.post(base + "/comments", json={**payload, "body": "changed"})
    assert conflict.status_code == 409
    assert client.get(base + "/comments").json()["total"] == 1
    cid = comment.json()["id"]
    assert client.patch(base + f"/comments/{cid}", json={"body": "Edited"}).json()["body"] == "Edited"
    assert client.delete(base + f"/comments/{cid}").status_code == 204
    assert client.put(base + "/like", json={"liked": False}).json()["like_count"] == 0
    with database() as db:
        assert db.scalar(select(func.count()).select_from(MemoryComment)) == 0
        assert db.scalar(select(func.count()).select_from(MemoryLike)) == 0


def test_private_family_boundary_public_access_and_revocation(client, database, interaction_context):
    c = interaction_context
    base = f"/api/v1/memories/{c['memory']}"
    app.dependency_overrides[get_current_user] = lambda: c["other"]
    for endpoint in ("/interactions", "/comments"):
        assert client.get(base + endpoint).status_code == 404
    assert client.put(base + "/like", json={"liked": True}).status_code == 404
    with database() as db:
        db.get(Memory, c["memory"]).visibility = "public"; db.commit()
    assert client.put(base + "/like", json={"liked": True}).status_code == 200
    comment = client.post(base + "/comments", json={"body": "A memory", "request_key": str(uuid4())}).json()
    app.dependency_overrides[get_current_user] = lambda: c["owner"]
    assert client.patch(base + f"/comments/{comment['id']}", json={"body": "Hijack"}).status_code == 403
    assert client.get(base + "/comments").json()["items"][0]["can_delete"] is True
    with database() as db:
        db.get(Memory, c["memory"]).visibility = "private"; db.commit()
    app.dependency_overrides[get_current_user] = lambda: c["other"]
    assert client.get(base + "/comments").status_code == 404
    assert client.delete(base + f"/comments/{comment['id']}").status_code == 404
    with database() as db:
        db.get(Family, c["family"]).archived_at = datetime.now(UTC); db.commit()
    app.dependency_overrides[get_current_user] = lambda: c["owner"]
    assert client.get(base + "/interactions").status_code == 404


def test_comment_validation_filters_and_cascade(client, database, interaction_context):
    c = interaction_context; base = f"/api/v1/memories/{c['memory']}"
    for body in ("  ", "x" * 2001):
        assert client.post(base + "/comments", json={"body": body, "request_key": str(uuid4())}).status_code == 422
    listing = f"/api/v1/families/{c['family']}/memories"
    assert client.get(listing + "?year=1998&q=summer&memory_date=1998-07-02").json()["total"] == 1
    assert client.get(listing + "?year=1999").json()["total"] == 0
    assert client.get(listing + "?person_id=" + str(uuid4())).status_code == 404
    client.put(base + "/like", json={"liked": True})
    client.post(base + "/comments", json={"body": "Good", "request_key": str(uuid4())})
    with database() as db:
        db.delete(db.get(Memory, c["memory"])); db.commit()
        assert db.scalar(select(func.count()).select_from(MemoryComment)) == 0
        assert db.scalar(select(func.count()).select_from(MemoryLike)) == 0


def test_featured_person_is_persisted_and_family_scoped(client, database, interaction_context):
    from app.models import FamilyPerson, Person
    c = interaction_context
    endpoint = f"/api/v1/families/{c['family']}/featured-person"
    assert client.get(endpoint).json() is None
    with database() as db:
        adult = Person(first_name="Adult", birth_date=date(1950, 1, 1), created_by=c["owner"].id)
        db.add(AdminGrant(user_id=c["owner"].id, role="SUPER_ADMIN"))
        minor = Person(first_name="Child", birth_date=datetime.now(UTC).date(), created_by=c["owner"].id)
        db.add_all([adult, minor]); db.flush()
        db.add_all([FamilyPerson(family_id=c["family"], person_id=p.id, added_by=c["owner"].id) for p in (adult, minor)])
        db.commit(); adult_id = str(adult.id); minor_id = str(minor.id)
    assert client.put(endpoint, json={"person_id": minor_id}).status_code == 422
    assert client.put(endpoint, json={"person_id": adult_id}).status_code == 200
    assert client.get(endpoint).json()["id"] == adult_id
    assert client.put(endpoint, json={"person_id": str(uuid4())}).status_code == 404
    app.dependency_overrides[get_current_user] = lambda: c["other"]
    assert client.get(endpoint).status_code == 403
    assert client.put(endpoint, json={"person_id": adult_id}).status_code == 403
    with database() as db:
        db.add(FamilyMember(family_id=c["family"], user_id=c["other"].id, role="member")); db.commit()
    assert client.get(endpoint).json()["id"] == adult_id
    assert client.put(endpoint, json={"person_id": None}).status_code == 403
    with database() as db:
        db.get(Person, UUID(adult_id)).visibility = "private"; db.commit()
    assert client.get(endpoint).json() is None


def test_unauthenticated_interaction_requires_session(client, interaction_context):
    app.dependency_overrides.pop(get_current_user)
    base = f"/api/v1/memories/{interaction_context['memory']}"
    assert client.get(base + "/interactions").status_code == 401
    assert client.put(base + "/like", json={"liked": True}).status_code == 401
    assert client.post(base + "/comments", json={"body": "Text", "request_key": str(uuid4())}).status_code == 401


def test_archive_photo_preview_uses_authorized_memory_media(client, database, interaction_context):
    from app.models import FamilyPerson, Person
    from app.storage import get_storage
    from tests.test_memory_photos import MemoryStorage, png_bytes
    c = interaction_context; fid = c["family"]; mid = c["memory"]
    app.dependency_overrides[get_storage] = lambda: MemoryStorage()
    photo = client.post(f"/api/v1/families/{fid}/memories/{mid}/photos", content=png_bytes(),
                        headers={"Content-Type": "image/png", "X-File-Name": "local.png"})
    assert photo.status_code == 201, photo.text
    token = f"[[photo:{photo.json()['id']}|Caption]]"
    endpoint = f"/api/v1/families/{fid}/archives"
    payload = {"title": "Photo source", "description": token, "document_date": "1998-07-02", "visibility": "family"}
    saved = client.post(endpoint, json=payload)
    assert saved.status_code == 201, saved.text
    assert client.get(endpoint + "?year=1998&media_type=image").json()["total"] == 1
    assert client.get(endpoint + "?year=1998&media_type=text").json()["total"] == 0
    assert client.post(endpoint, json={**payload, "visibility": "public"}).status_code == 422
    with database() as db:
        person = Person(first_name="Adult", birth_date=date(1950,1,1), visibility="public", created_by=c["owner"].id)
        db.add(person); db.flush(); pid=person.id
        db.add(FamilyPerson(family_id=fid, person_id=pid, added_by=c["owner"].id))
        db.get(Memory, mid).visibility = "public"; db.commit()
    assert client.put(f"/api/v1/families/{fid}/photos/{photo.json()['id']}/tags", json={"person_ids": [str(pid)]}).status_code == 200
    public = client.post(endpoint, json={**payload, "visibility": "public"})
    assert public.status_code == 201, public.text
    app.dependency_overrides[get_current_user] = lambda: c["other"]
    public_post = client.get(f"/api/v1/community/archive/{public.json()['id']}")
    assert public_post.status_code == 200
    assert len(public_post.json()["photos"]) == 1
    assert client.get(f"/api/v1/families/{fid}/archives/{saved.json()['id']}").status_code == 403


def test_global_moderation_cannot_access_family_private_memory(client, database, interaction_context):
    from app.models import AdminGrant
    c=interaction_context; base=f"/api/v1/memories/{c['memory']}"
    comment=client.post(base + "/comments", json={"body": "Family comment", "request_key": str(uuid4())}).json()
    with database() as db:
        db.add(AdminGrant(user_id=c["other"].id, role="MODERATOR", granted_by=c["owner"].id)); db.commit()
    app.dependency_overrides[get_current_user] = lambda: c["other"]
    assert client.delete(base + f"/comments/{comment['id']}").status_code == 404
    with database() as db:
        db.get(Memory,c["memory"]).visibility="public";db.commit()
    assert client.patch(base + f"/comments/{comment['id']}",json={"body":"changed"}).status_code == 403
    assert client.delete(base + f"/comments/{comment['id']}").status_code == 204


def test_branch_memory_filter_scoped_to_family(client, database, interaction_context):
    from app.models import (
        Branch,
        FamilyPerson,
        Lineage,
        MemoryPersonTag,
        Person,
        PersonLineageAssignment,
    )
    c = interaction_context
    with database() as db:
        lineage = Lineage(name="Local branch context", family_id=c["family"])
        db.add(lineage); db.flush()
        branch = Branch(name="Explicit branch", lineage_id=lineage.id)
        db.add(branch); db.flush(); bid = branch.id
        person = Person(first_name="Adult", birth_date=date(1950,1,1), created_by=c["owner"].id)
        db.add(person); db.flush()
        db.add(FamilyPerson(family_id=c["family"], person_id=person.id, added_by=c["owner"].id))
        db.add(PersonLineageAssignment(person_id=person.id, lineage_id=lineage.id, branch_id=branch.id))
        db.add(MemoryPersonTag(memory_id=c["memory"], person_id=person.id)); db.commit()
    endpoint = f"/api/v1/families/{c['family']}/memories"
    assert client.get(endpoint + f"?branch_id={bid}").json()["total"] == 1
    assert client.get(endpoint + f"?branch_id={uuid4()}").status_code == 404
    app.dependency_overrides[get_current_user] = lambda: c["other"]
    assert client.get(endpoint + f"?branch_id={bid}").status_code == 403


def test_minor_interactions_require_guardian_scope(client, database, interaction_context):
    from app.models import FamilyPerson, MemoryPersonTag, Person
    c = interaction_context
    with database() as db:
        person = Person(first_name="Minor", birth_date=datetime.now(UTC).date(), created_by=c["owner"].id)
        db.add(person); db.flush()
        db.add(FamilyPerson(family_id=c["family"], person_id=person.id, added_by=c["owner"].id))
        db.add(MemoryPersonTag(memory_id=c["memory"], person_id=person.id)); db.commit()
    base = f"/api/v1/memories/{c['memory']}"
    assert client.get(base + "/interactions").status_code == 404
    assert client.put(base + "/like", json={"liked": True}).status_code == 404


def test_corrupt_png_reports_supported_client_error():
    import base64

    from fastapi import HTTPException

    from app.memory_photos import _image_payload
    data = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCr8AAAAASUVORK5CYII=")
    with pytest.raises(HTTPException) as error:
        _image_payload("invalid.png", "image/png", data)
    assert error.value.status_code == 415

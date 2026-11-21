"""P12.4 fixtures are local and disposable; no real family records are used."""
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import pytest

from app.heritage_discovery import relationship_paths
from app.models import (
    AdminGrant,
    Archive,
    ArchivePerson,
    Family,
    FamilyMember,
    FamilyPerson,
    Invitation,
    LifeEvent,
    Marriage,
    Memory,
    MemoryPersonTag,
    ParentChildRelationship,
    Person,
    PersonGuardianship,
    Story,
    StoryPerson,
)
from tests.conftest import register_verified


@pytest.fixture
def heritage(client, database, email_provider):
    register_verified(client, "heritage-owner@example.com", email_provider=email_provider)
    owner = UUID(client.get("/api/v1/auth/me").json()["id"])
    cookies = dict(client.cookies)
    family = UUID(client.post("/api/v1/families", json={"name": "Local heritage"}).json()["id"])
    client.cookies.clear()
    register_verified(client, "heritage-other@example.com", email_provider=email_provider)
    other = UUID(client.get("/api/v1/auth/me").json()["id"])
    other_cookies = dict(client.cookies)
    foreign = UUID(client.post("/api/v1/families", json={"name": "Local foreign"}).json()["id"])
    with database.begin() as db:
        people = [Person(first_name=f"Fixture {n}", search_first_name=f"fixture {n}", birth_date=date(1940 + n * 5, 1, 1),
                         visibility="family", created_by=owner) for n in range(7)]
        people[5].created_by = other
        people[5].visibility = "private"
        people[6].birth_date = datetime.now(UTC).date() - timedelta(days=365 * 5)
        db.add_all(people); db.flush()
        ids = [person.id for person in people]
        db.add_all([FamilyPerson(family_id=family, person_id=pid, added_by=owner) for pid in ids])
        edges = [(0, 1), (0, 2), (1, 3), (2, 3), (4, 5), (5, 2)]
        db.add_all([ParentChildRelationship(parent_id=ids[p], child_id=ids[c], created_by=owner) for p, c in edges])
        db.add(Marriage(person_1_id=min(ids[3], ids[4]), person_2_id=max(ids[3], ids[4]), status="divorced", created_by=owner, start_date=date(1980, 1, 1), end_date=date(1990, 1, 1)))
        story = Story(family_id=family, title="Fixture story", body="Text", event_date=date(1995, 1, 1), created_by=owner)
        archive = Archive(family_id=family, title="Fixture archive", document_date=date(1960, 1, 1), created_by=owner)
        memory = Memory(family_id=family, title="Fixture memory", memory_date=date(2000, 1, 1), created_by=owner)
        private = Story(family_id=family, title="Hidden story", body="Hidden", visibility="private", created_by=other)
        minor_memory = Memory(family_id=family, title="Hidden minor memory", created_by=owner)
        db.add_all([story, archive, memory, private, minor_memory]); db.flush()
        db.add_all([StoryPerson(story_id=story.id, person_id=ids[3], family_id=family),
                    ArchivePerson(archive_id=archive.id, person_id=ids[3], family_id=family),
                    MemoryPersonTag(memory_id=memory.id, person_id=ids[3]),
                    MemoryPersonTag(memory_id=minor_memory.id, person_id=ids[6]),
                    LifeEvent(person_id=ids[6], event_type="school", title="Hidden school", created_by=owner),
                    LifeEvent(person_id=ids[3], event_type="school", title="Fixture school", event_date=date(1970, 1, 1), created_by=owner)])
        resources = {"story": story.id, "archive": archive.id, "memory": memory.id, "private": private.id}
    client.cookies.clear(); client.cookies.update(cookies)
    return {"family": family, "foreign": foreign, "owner": owner, "other_cookies": other_cookies, "ids": ids, **resources}


def test_relationship_paths_authorization_remarriage_and_disconnected(client, heritage):
    f, ids = heritage["family"], heritage["ids"]
    path = f"/api/v1/families/{f}/relationship-path"
    result = client.get(path, params={"first": str(ids[3]), "second": str(ids[0])})
    assert result.status_code == 200
    assert len(result.json()["paths"]) == 2
    assert {p["generation_distance"] for p in result.json()["paths"]} == {-2}
    assert result.json()["common_ancestors"][0]["id"] == str(ids[0])
    assert client.get(path, params={"first": str(ids[3]), "second": str(ids[3])}).json()["status"] == "same"
    assert client.get(path, params={"first": str(ids[4]), "second": str(ids[2])}).json()["status"] == "not_found"
    assert client.get(path, params={"first": str(ids[3]), "second": str(ids[4]), "include_former": "true"}).json()["paths"][0]["steps"][0]["status"] == "divorced"
    assert client.get(path, params={"first": str(ids[3]), "second": str(ids[5])}).status_code == 404
    assert client.get(path, params={"first": str(ids[3]), "second": str(ids[6])}).status_code == 403
    foreign_path = path.replace(str(f), str(heritage["foreign"]))
    assert client.get(foreign_path, params={"first": str(ids[3]), "second": str(ids[0])}).status_code == 403
    client.cookies.clear()
    assert client.get(path, params={"first": str(ids[3]), "second": str(ids[0])}).status_code == 401


def test_graph_traversal_terminates_on_cycle_and_marks_limits():
    ids = [uuid4() for _ in range(4)]
    people = [SimpleNamespace(id=pid, first_name="Fixture", last_name="", middle_name=None) for pid in ids]
    graph = {"persons": people, "parent_child_relationships": [SimpleNamespace(id=uuid4(), parent_id=ids[p], child_id=ids[c], relationship_type="biological") for p, c in [(0, 1), (1, 2), (2, 0)]], "marriages": [], "meta": {"truncated": False}}
    assert relationship_paths(graph, ids[0], ids[2], False)["status"] == "found"
    assert relationship_paths(graph, ids[0], ids[3], False)["status"] == "not_found"
    graph["meta"]["truncated"] = True
    assert relationship_paths(graph, ids[0], ids[3], False)["status"] == "limited"


def test_timeline_sorted_canonical_and_scoped(client, heritage):
    f, ids = heritage["family"], heritage["ids"]
    path = f"/api/v1/families/{f}/persons/{ids[3]}/timeline"
    response = client.get(path)
    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["date"] for item in items] == sorted(item["date"] for item in items)
    assert {item["kind"] for item in items} >= {"birth", "marriage", "divorced", "event", "story", "memory", "archive"}
    assert client.get(path, params={"page_size": 2}).json()["has_next"] is True
    assert client.get(path.replace(str(f), str(heritage["foreign"]))).status_code == 403
    assert client.get(path.replace(str(ids[3]), str(ids[5]))).status_code == 404
    assert client.get(path.replace(str(ids[3]), str(ids[6]))).status_code == 403


def test_minor_profile_scope_does_not_unlock_events_or_memories(client, heritage, database):
    f, pid = heritage["family"], heritage["ids"][6]
    with database.begin() as db:
        db.add(PersonGuardianship(family_id=f, person_id=pid, guardian_user_id=heritage["owner"], scope="view_profile", granted_by_user_id=heritage["owner"]))
    result = client.get(f"/api/v1/families/{f}/persons/{pid}/timeline")
    assert result.status_code == 200
    assert {item["kind"] for item in result.json()["items"]} == {"birth"}


def test_search_existing_resource_queries_preserve_family_private_minor_scope(client, heritage, database):
    with database.begin() as db:
        db.add(AdminGrant(user_id=heritage["owner"], role="ADMIN"))
    base = f"/api/v1/families/{heritage['family']}"
    people = client.get(base + "/people?q=Fixture").json()["items"]
    assert str(heritage["ids"][5]) not in {person["id"] for person in people}
    minor = next(person for person in people if person["id"] == str(heritage["ids"][6]))
    assert minor["birth_date"] is None
    assert client.get(base + "/stories?q=Hidden").json()["total"] == 0
    assert client.get(base + "/memories?q=Hidden").json()["total"] == 0
    for resource in ("people", "stories", "memories", "archives"):
        assert client.get(base.replace(str(heritage["family"]), str(heritage["foreign"])) + f"/{resource}?q=Fixture").status_code == 403


def test_cross_links_validate_scope_and_resolve_without_private_titles(client, heritage, database):
    base = f"/api/v1/families/{heritage['family']}"
    body = f"Source\n[[link:memory:{heritage['memory']}]]\n[[link:archive:{heritage['archive']}]]"
    response = client.post(base + "/stories", json={"title": "Linked source", "body": body})
    assert response.status_code == 201
    source = response.json()["id"]
    links = client.get(base + f"/content-links/story/{source}")
    assert links.status_code == 200
    assert len(links.json()["items"]) == 2
    assert client.post(base + "/stories", json={"title": "Rejected", "body": f"[[link:story:{heritage['private']}]]"}).status_code == 404
    assert client.post(base + "/stories", json={"title": "Rejected", "body": "[[link:story:invalid]]"}).status_code == 422
    with database.begin() as db:
        memory = db.get(Memory, heritage["memory"]); memory.visibility = "private"
        archive = db.get(Archive, heritage["archive"]); archive.visibility = "private"
        other_id = db.get(Story, heritage["private"]).created_by
        db.add(FamilyMember(family_id=heritage["family"], user_id=other_id, role="member"))
    client.cookies.clear(); client.cookies.update(heritage["other_cookies"])
    response = client.get(base + f"/content-links/story/{source}")
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_invitation_preview_recipient_role_expiration_and_archive_safety(client, heritage, database, email_provider):
    base = f"/api/v1/families/{heritage['family']}/invitations"
    assert client.post(base, json={"email": "heritage-other@example.com", "role": "owner"}).status_code == 422
    issued = client.post(base, json={"email": "heritage-other@example.com", "role": "member"})
    assert issued.status_code == 201
    delivery = email_provider.deliveries[-1]
    token = urlsplit(delivery.text.rsplit(" ", 1)[-1]).fragment.removeprefix("token=")
    assert client.post("/api/v1/invitations/preview", json={"token": token}).status_code == 403
    client.cookies.clear(); client.cookies.update(heritage["other_cookies"])
    response = client.post("/api/v1/invitations/preview", json={"token": token})
    assert response.status_code == 200
    assert response.json()["role"] == "member"
    assert response.headers["cache-control"] == "private, no-store"
    assert "token" not in response.json()
    with database.begin() as db:
        db.get(Family, heritage["family"]).archived_at = datetime.now(UTC)
    assert client.post("/api/v1/invitations/preview", json={"token": token}).status_code == 404
    assert client.post("/api/v1/invitations/accept", json={"token": token}).status_code == 404
    with database.begin() as db:
        db.get(Family, heritage["family"]).archived_at = None
        db.get(Invitation, UUID(issued.json()["id"])).expires_at = datetime.now(UTC) - timedelta(days=1)
    assert client.post("/api/v1/invitations/preview", json={"token": token}).status_code == 404

from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from conftest import register_verified

from app.models import (
    Family,
    FamilyPerson,
    ParentChildRelationship,
    Person,
    RootConnection,
    SharedAncestry,
    SharedAncestryPerson,
)
from app.profile_photos import _object_key
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


def _seed_shared_people(client, database, email_provider, storage):
    owner_email = "shared-portrait-owner@example.com"
    assert register_verified(client, owner_email, email_provider=email_provider).status_code == 201
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    root_family_id, branch_family_id = uuid4(), uuid4()
    root_id = uuid4()
    people = {
        "public_adult": Person(
            id=uuid4(), first_name="Public", birth_date=date(1980, 1, 1),
            is_alive=True, visibility="public", created_by=owner_id,
        ),
        "family_only": Person(
            id=uuid4(), first_name="Family", birth_date=date(1970, 1, 1),
            is_alive=True, visibility="family", created_by=owner_id,
        ),
        "unshared": Person(
            id=uuid4(), first_name="Unshared", birth_date=date(1970, 1, 1),
            is_alive=True, visibility="public", created_by=owner_id,
        ),
        "minor": Person(
            id=uuid4(), first_name="Minor", birth_date=datetime.now(UTC).date() - timedelta(days=5 * 365),
            is_alive=True, visibility="public", created_by=owner_id,
        ),
        "unknown_living": Person(
            id=uuid4(), first_name="Unknown age", birth_date=None,
            is_alive=True, visibility="public", created_by=owner_id,
        ),
        "private": Person(
            id=uuid4(), first_name="Private", birth_date=date(1970, 1, 1),
            is_alive=True, visibility="private", created_by=owner_id,
        ),
    }
    root = Person(
        id=root_id, first_name="Historical root", birth_date=date(1880, 1, 1),
        is_alive=False, visibility="public", created_by=owner_id,
    )
    people["root"] = root
    portrait_versions: dict[str, str] = {}
    for name, person in people.items():
        version = str(uuid4())
        person.profile_photo_key = _object_key(person.id, version)
        portrait_versions[name] = version

    with database.begin() as db:
        db.add_all([
            Family(id=root_family_id, name="Root family", created_by=owner_id),
            Family(id=branch_family_id, name="Branch family", created_by=owner_id),
            *people.values(),
        ])
        db.flush()
        db.add_all([
            FamilyPerson(family_id=root_family_id, person_id=root.id, added_by=owner_id),
            *(FamilyPerson(family_id=branch_family_id, person_id=person.id, added_by=owner_id)
              for key, person in people.items() if key != "root"),
            SharedAncestry(id=1, root_person_id=root.id, created_by=owner_id),
        ])
        edges = []
        for key, person in people.items():
            if key == "root":
                continue
            edges.append(ParentChildRelationship(
                parent_id=root.id, child_id=person.id, relationship_type="biological",
                created_by=owner_id,
            ))
            if key != "unshared":
                db.add(SharedAncestryPerson(
                    person_id=person.id, family_id=branch_family_id, added_by=owner_id,
                ))
        db.add_all(edges)
        db.flush()
        approved_edge = next(edge for edge in edges if edge.child_id == people["public_adult"].id)
        db.add(RootConnection(
            family_id=branch_family_id,
            person_id=people["public_adult"].id,
            target_person_id=root.id,
            relationship_type="biological",
            status="approved",
            requested_by=owner_id,
            decided_by=owner_id,
            canonical_edge_id=approved_edge.id,
            consented_at=datetime.now(UTC),
            decided_at=datetime.now(UTC),
        ))
    for person in people.values():
        storage.put(person.profile_photo_key, b"\xff\xd8portrait-bytes\xff\xd9", "image/jpeg")
    assert register_verified(client, "shared-portrait-viewer@example.com",
                             email_provider=email_provider).status_code == 201
    return {
        "family_id": branch_family_id,
        "people": {name: person.id for name, person in people.items()},
        "versions": portrait_versions,
    }


def test_shared_tree_exposes_only_public_reachable_adult_portrait_to_other_family(
    client, database, email_provider
):
    storage = PrivateMemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    seeded = _seed_shared_people(client, database, email_provider, storage)
    tree_response = client.get("/api/v1/shared-lineage")
    assert tree_response.status_code == 200, tree_response.text
    rows = {row["id"]: row for row in tree_response.json()["persons"]}
    public_id = str(seeded["people"]["public_adult"])
    portrait_url = rows[public_id]["profile_photo_url"]
    assert portrait_url == (
        f"/shared-lineage/people/{public_id}/profile-photo?v="
        f"{seeded['versions']['public_adult']}"
    )
    assert "profile-photos/" not in portrait_url
    assert "https://" not in portrait_url

    for name in ("family_only", "unknown_living"):
        assert "profile_photo_url" not in rows[str(seeded["people"][name])]
    assert str(seeded["people"]["private"]) not in rows
    assert str(seeded["people"]["minor"]) not in rows
    assert str(seeded["people"]["unshared"]) not in rows

    response = client.get("/api/v1" + portrait_url)
    assert response.status_code == 200, response.text
    assert response.content == b"\xff\xd8portrait-bytes\xff\xd9"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_shared_portrait_requires_auth_and_rejects_nonpublic_unshared_minor_and_unknown_age(
    client, database, email_provider
):
    storage = PrivateMemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    seeded = _seed_shared_people(client, database, email_provider, storage)
    for name in ("family_only", "unknown_living", "minor", "private", "unshared"):
        path = (f"/api/v1/shared-lineage/people/{seeded['people'][name]}/profile-photo"
                f"?v={seeded['versions'][name]}")
        response = client.get(path)
        assert response.status_code in {404, 422}, f"{name}: {response.status_code} {response.text}"

    public_id = seeded["people"]["public_adult"]
    public_version = seeded["versions"]["public_adult"]
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get(
        f"/api/v1/shared-lineage/people/{public_id}/profile-photo?v={public_version}"
    ).status_code == 401


def test_shared_portrait_stale_version_and_withdrawn_public_or_root_consent_are_denied(
    client, database, email_provider
):
    storage = PrivateMemoryStorage()
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: storage
    seeded = _seed_shared_people(client, database, email_provider, storage)
    person_id = seeded["people"]["public_adult"]
    current_version = seeded["versions"]["public_adult"]
    old_url = f"/api/v1/shared-lineage/people/{person_id}/profile-photo?v={current_version}"
    assert client.get(old_url).status_code == 200

    replacement_version = str(uuid4())
    with database.begin() as db:
        person = db.get(Person, person_id)
        assert person is not None
        person.profile_photo_key = _object_key(person.id, replacement_version)
    assert client.get(old_url).status_code == 404

    replacement_url = (
        f"/api/v1/shared-lineage/people/{person_id}/profile-photo?v={replacement_version}"
    )
    with database.begin() as db:
        person = db.get(Person, person_id)
        assert person is not None
        person.visibility = "family"
    assert client.get(replacement_url).status_code == 404

    with database.begin() as db:
        person = db.get(Person, person_id)
        assert person is not None
        person.visibility = "public"
        connection = db.get(RootConnection, seeded["family_id"])
        assert connection is not None
        connection.status = "disconnected"
    assert client.get(replacement_url).status_code == 422

    with database.begin() as db:
        db.delete(db.get(SharedAncestryPerson, person_id))
    assert client.get(replacement_url).status_code == 404

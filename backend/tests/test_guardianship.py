from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from conftest import register_verified
from sqlalchemy import select

from app.models import AuditLog, FamilyMember, PersonGuardianship
from app.privacy import is_minor


def register(client, email):
    return register_verified(client, email)


def setup_family(client, database, *, birth_date="2015-06-12"):
    assert register(client, "owner@example.com").status_code == 201
    owner = client.get("/api/v1/auth/me").json()
    family = client.post("/api/v1/families", json={"name": "Гэр бүл"}).json()
    child = client.post(
        f"/api/v1/families/{family['id']}/persons",
        json={
            "first_name": "Болд",
            "last_name": "Бат",
            "birth_date": birth_date,
            "birth_place": "Улаанбаатар",
        },
    ).json()

    client.post("/api/v1/auth/logout")
    assert register(client, "guardian@example.com").status_code == 201
    guardian = client.get("/api/v1/auth/me").json()
    with database() as db:
        db.add(
            FamilyMember(
                family_id=UUID(family["id"]),
                user_id=UUID(guardian["id"]),
                role="member",
            )
        )
        db.commit()
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "strong-passphrase-123"},
    ).status_code == 200
    return owner, family, child, guardian


def grant(client, family_id, person_id, guardian_id, scopes, expires_at=None):
    return client.post(
        f"/api/v1/families/{family_id}/persons/{person_id}/guardianships",
        json={
            "guardian_user_id": guardian_id,
            "scopes": scopes,
            "expires_at": expires_at,
        },
    )


def test_minor_detection_is_calendar_aware_and_unknown_is_explicit():
    today = date(2026, 9, 24)
    assert is_minor(date(2008, 9, 25), today) is True
    assert is_minor(date(2008, 9, 24), today) is False
    assert is_minor(date(2000, 1, 1), today) is False
    assert is_minor(None, today) is None
    assert is_minor(date(2008, 2, 29), date(2026, 2, 27)) is True
    assert is_minor(date(2008, 2, 29), date(2026, 2, 28)) is False


def test_parent_edge_alone_does_not_authorize_minor_sensitive_access(client, database):
    owner, family, child, _ = setup_family(client, database)
    parent = client.post(
        f"/api/v1/families/{family['id']}/persons", json={"first_name": "Эцэг"}
    ).json()
    assert client.post(
        f"/api/v1/families/{family['id']}/relationships/parent-child",
        json={"parent_id": parent["id"], "child_id": child["id"]},
    ).status_code == 201

    profile = client.get(f"/api/v1/families/{family['id']}/persons/{child['id']}")
    assert profile.status_code == 200
    assert profile.json()["birth_date"] is None
    assert profile.json()["birth_place"] is None
    assert profile.json()["short_description"] is None
    assert client.patch(
        f"/api/v1/families/{family['id']}/persons/{child['id']}",
        json={"first_name": "Өөрчилсөн"},
    ).status_code == 403
    assert client.get(
        f"/api/v1/families/{family['id']}/persons/{child['id']}/biography"
    ).status_code == 403
    assert client.get(
        f"/api/v1/families/{family['id']}/persons/{child['id']}/events"
    ).status_code == 403
    assert client.post(
        f"/api/v1/families/{family['id']}/memories",
        json={"title": "Дурсамж", "person_ids": [child["id"]]},
    ).status_code == 403
    assert owner["id"] != child["id"]


def test_guardian_grants_are_scoped_independent_and_revocable(client, database):
    owner, family, child, guardian = setup_family(client, database)
    created = grant(client, family["id"], child["id"], guardian["id"], ["view_profile"])
    assert created.status_code == 201
    grant_id = created.json()[0]["id"]
    assert created.json()[0]["scope"] == "view_profile"
    assert grant(
        client, family["id"], child["id"], guardian["id"], ["view_profile"]
    ).status_code == 409

    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "guardian@example.com", "password": "strong-passphrase-123"},
    ).status_code == 200
    base = f"/api/v1/families/{family['id']}/persons/{child['id']}"
    profile = client.get(base)
    assert profile.status_code == 200
    assert profile.json()["birth_date"] == "2015-06-12"
    assert client.get(f"{base}/biography").status_code == 403
    assert client.put(f"{base}/biography", json={"content": "Намтар"}).status_code == 403
    assert client.patch(base, json={"birth_place": "Дархан"}).status_code == 403
    assert client.patch(base, json={"first_name": "Өөрчилсөн"}).status_code == 403

    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "strong-passphrase-123"},
    )
    extra = grant(
        client,
        family["id"],
        child["id"],
        guardian["id"],
        ["manage_biography", "manage_events", "manage_memories"],
    )
    assert extra.status_code == 201
    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": "guardian@example.com", "password": "strong-passphrase-123"},
    )
    assert client.put(f"{base}/biography", json={"content": "Хүүхдийн намтар"}).status_code == 200
    event = client.post(
        f"{base}/events",
        json={"event_type": "school", "title": "Сургуульд орсон"},
    )
    assert event.status_code == 201
    memory = client.post(
        f"/api/v1/families/{family['id']}/memories",
        json={"title": "Гэр бүлийн дурсамж", "person_ids": [child["id"]]},
    )
    assert memory.status_code == 201
    scoped_memory = client.get(
        f"/api/v1/families/{family['id']}/persons/{child['id']}/memories"
    )
    assert scoped_memory.status_code == 200
    assert scoped_memory.json()[0]["id"] == memory.json()["id"]
    assert client.get(f"/api/v1/families/{family['id']}/memories").status_code == 200

    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "strong-passphrase-123"},
    )
    assert client.delete(
        f"{base}/guardianships/{grant_id}"
    ).status_code == 204
    assert client.delete(
        f"{base}/guardianships/{extra.json()[0]['id']}"
    ).status_code == 204
    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": "guardian@example.com", "password": "strong-passphrase-123"},
    )
    assert client.get(base).json()["birth_date"] is None
    assert client.get(f"{base}/biography").status_code == 403
    with database() as db:
        actions = [row.action for row in db.scalars(select(AuditLog)).all()]
    assert "person.guardianship.granted" in actions
    assert "person.guardianship.revoked" in actions
    assert owner["id"] != guardian["id"]


def test_only_family_owner_can_manage_grants_and_foreign_targets_are_hidden(client, database):
    _, family, child, guardian = setup_family(client, database)
    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": "guardian@example.com", "password": "strong-passphrase-123"},
    )
    assert grant(client, family["id"], child["id"], guardian["id"], ["view_profile"]).status_code == 403
    assert client.get(
        f"/api/v1/families/{family['id']}/persons/{child['id']}/guardianships"
    ).status_code == 403

    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "strong-passphrase-123"},
    )
    assert grant(client, family["id"], child["id"], "00000000-0000-0000-0000-000000000001", ["view_profile"]).status_code == 404
    assert grant(client, family["id"], child["id"], guardian["id"], ["admin", "view_profile"]).status_code == 422
    assert grant(
        client,
        family["id"],
        child["id"],
        guardian["id"],
        ["view_profile"],
        (datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
    ).status_code == 422


def test_expired_grants_are_inactive_and_can_be_reissued(client, database):
    _, family, child, guardian = setup_family(client, database)
    created = grant(client, family["id"], child["id"], guardian["id"], ["view_profile"])
    assert created.status_code == 201
    grant_id = UUID(created.json()[0]["id"])
    with database() as db:
        db.get(PersonGuardianship, grant_id).expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": "guardian@example.com", "password": "strong-passphrase-123"},
    )
    profile = client.get(f"/api/v1/families/{family['id']}/persons/{child['id']}")
    assert profile.status_code == 200
    assert profile.json()["birth_date"] is None

    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "strong-passphrase-123"},
    )
    renewed = grant(client, family["id"], child["id"], guardian["id"], ["view_profile"])
    assert renewed.status_code == 201
    with database() as db:
        old = db.get(PersonGuardianship, grant_id)
        assert old.status == "revoked"
        assert old.revoked_by_user_id == UUID(client.get("/api/v1/auth/me").json()["id"])


def test_minor_profile_projection_applies_to_search_and_tree(client, database):
    _, family, child, _ = setup_family(client, database)
    for path in (
        f"/api/v1/families/{family['id']}/persons",
        f"/api/v1/families/{family['id']}/persons/search?q=Болд",
        f"/api/v1/families/{family['id']}/tree",
    ):
        response = client.get(path)
        assert response.status_code == 200
        if path.endswith("/tree"):
            result = next(item for item in response.json()["persons"] if item["id"] == child["id"])
        elif "/search?" in path:
            result = next(item for item in response.json()["items"] if item["id"] == child["id"])
            assert result["birth_year"] is None
            assert "birth_place" not in result
            continue
        else:
            result = next(item for item in response.json() if item["id"] == child["id"])
        assert result["birth_date"] is None
        if path.endswith("/tree"):
            assert "birth_place" not in result
        else:
            assert result["birth_place"] is None
    protected_year = client.get(
        f"/api/v1/families/{family['id']}/persons/search?q=Болд&birth_year=2015"
    )
    assert protected_year.status_code == 200
    assert protected_year.json()["total"] == 0


def test_owner_self_grant_requires_linked_parent_and_explicit_action(client, database):
    _, family, child, _ = setup_family(client, database)
    blocked = grant(client, family["id"], child["id"], client.get("/api/v1/auth/me").json()["id"], ["view_profile"])
    assert blocked.status_code == 403

    parent = client.post(
        f"/api/v1/families/{family['id']}/persons", json={"first_name": "Эцэг"}
    ).json()
    assert client.post(
        f"/api/v1/families/{family['id']}/persons/{parent['id']}/link-me"
    ).status_code == 204
    assert client.post(
        f"/api/v1/families/{family['id']}/relationships/parent-child",
        json={"parent_id": parent["id"], "child_id": child["id"]},
    ).status_code == 201
    allowed = grant(
        client,
        family["id"],
        child["id"],
        client.get("/api/v1/auth/me").json()["id"],
        ["view_profile"],
    )
    assert allowed.status_code == 201

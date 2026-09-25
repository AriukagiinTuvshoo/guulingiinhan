from urllib.parse import urlsplit
from uuid import UUID

from conftest import confirm_registration_email, register_verified
from sqlalchemy import select

from app.models import AuditLog, FamilyMember, User


def register(client, email):
    return register_verified(client, email)


def test_register_login_logout_me_and_email_normalization(client, email_provider):
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "Tree.Owner@example.com", "password": "strong-passphrase-123"},
    )
    assert response.status_code == 201
    assert response.json()["message"]
    assert "email" not in response.json()
    assert "set-cookie" not in response.headers
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "tree.owner@example.com", "password": "strong-passphrase-123"},
    ).status_code == 403

    duplicate = client.post(
        "/api/v1/auth/register",
        json={"email": "tree.owner@example.com", "password": "strong-passphrase-123"},
    )
    assert duplicate.status_code == 201
    assert duplicate.json() == response.json()
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "TREE.OWNER@example.com", "password": "wrong-password"},
        ).status_code
        == 401
    )
    assert confirm_registration_email(
        client, email_provider, "Tree.Owner@example.com"
    ).status_code == 200
    logged_in = client.post(
        "/api/v1/auth/login",
        json={"email": "tree.owner@example.com", "password": "strong-passphrase-123"},
    )
    assert logged_in.status_code == 200
    assert "httponly" in logged_in.headers["set-cookie"].lower()
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_mutation_rejects_untrusted_browser_origin(client):
    response = client.post(
        "/api/v1/auth/register",
        headers={"Origin": "https://attacker.invalid"},
        json={"email": "blocked@example.com", "password": "strong-passphrase-123"},
    )
    assert response.status_code == 403


def test_private_person_is_not_exposed_to_other_family_members(client, database):
    register(client, "owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Нууцлал"}).json()["id"]
    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Private", "visibility": "private"},
    ).json()
    client.post("/api/v1/auth/logout")
    register(client, "member@example.com")
    with database() as db:
        member = db.scalar(select(User).where(User.email == "member@example.com"))
        db.add(FamilyMember(family_id=UUID(family_id), user_id=member.id, role="member"))
        db.commit()
    assert client.get(f"/api/v1/families/{family_id}/persons").json() == []
    assert client.get(f"/api/v1/families/{family_id}/persons/{person['id']}").status_code == 404
    assert client.get(f"/api/v1/families/{family_id}/tree").json()["persons"] == []


def _token_from_mail(email_provider, recipient, subject_prefix):
    delivery = next(
        item
        for item in reversed(email_provider.deliveries)
        if item.recipient == recipient and item.subject.startswith(subject_prefix)
    )
    link = delivery.text.rsplit(" ", 1)[-1]
    return urlsplit(link).fragment.removeprefix("token=")


def test_invitation_is_single_use_email_bound_and_revocable(client, database, email_provider):
    register(client, "owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Урилга"}).json()["id"]
    invite = client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "new.member@example.com", "role": "editor"},
    )
    assert invite.status_code == 201
    assert "token" not in invite.json()
    token = _token_from_mail(email_provider, "new.member@example.com", "Урилга")
    client.post("/api/v1/auth/logout")
    register(client, "wrong.member@example.com")
    assert client.post("/api/v1/invitations/accept", json={"token": token}).status_code == 403
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/register",
        json={"email": "new.member@example.com", "password": "strong-passphrase-123"},
    ).status_code == 201
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "new.member@example.com", "password": "strong-passphrase-123"},
    ).status_code == 403
    verification = _token_from_mail(
        email_provider, "new.member@example.com", "Гуулингийнхан — имэйл"
    )
    assert (
        client.post(
            "/api/v1/auth/email/verification/confirm", json={"token": verification}
        ).status_code
        == 200
    )
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "new.member@example.com", "password": "strong-passphrase-123"},
    ).status_code == 200
    accepted = client.post("/api/v1/invitations/accept", json={"token": token})
    assert accepted.status_code == 200
    assert accepted.json() == {"family_id": family_id, "role": "editor"}
    assert client.post("/api/v1/invitations/accept", json={"token": token}).status_code == 404
    assert client.get(f"/api/v1/families/{family_id}").status_code == 200


def test_invitation_revocation_invalidates_email_link(client, database, email_provider):
    register(client, "revoker@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Цуцлах"}).json()["id"]
    created = client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": "revoked@example.com", "role": "member"},
    )
    token = _token_from_mail(email_provider, "revoked@example.com", "Цуцлах")
    assert created.status_code == 201
    assert (
        client.delete(
            f"/api/v1/families/{family_id}/invitations/{created.json()['id']}"
        ).status_code
        == 204
    )
    client.post("/api/v1/auth/logout")
    register(client, "revoked@example.com")
    assert client.post("/api/v1/invitations/accept", json={"token": token}).status_code == 404
    with database() as db:
        actions = set(db.scalars(select(AuditLog.action)).all())
        assert "invitation.revoked" in actions


def test_family_person_relationship_tree_and_family_isolation(client):
    assert register(client, "owner@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Гуулингийнхан"})
    assert family.status_code == 201
    family_id = family.json()["id"]
    assert family.json()["role"] == "owner"

    child = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Бат", "last_name": "Дорж", "visibility": "family"},
    ).json()
    parent = client.post(
        f"/api/v1/families/{family_id}/persons", json={"first_name": "Дорж"}
    ).json()
    child_id, parent_id = child["id"], parent["id"]
    edge = client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": parent_id, "child_id": child_id},
    )
    assert edge.status_code == 201
    assert (
        client.post(
            f"/api/v1/families/{family_id}/relationships/parent-child",
            json={"parent_id": child_id, "child_id": parent_id},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/v1/families/{family_id}/relationships/parent-child",
            json={"parent_id": parent_id, "child_id": parent_id},
        ).status_code
        == 422
    )

    tree = client.get(f"/api/v1/families/{family_id}/tree")
    assert tree.status_code == 200
    assert len(tree.json()["persons"]) == 2
    assert len(tree.json()["parent_child_relationships"]) == 1
    assert client.get(f"/api/v1/families/{family_id}/persons/search?q=Дорж").status_code == 200

    client.post("/api/v1/auth/logout")
    assert register(client, "other@example.com").status_code == 201
    assert client.get(f"/api/v1/families/{family_id}/persons").status_code == 403
    assert (
        client.get(f"/api/v1/families/{family_id}/persons/search?q=Дорж").status_code == 403
    )
    assert client.get(f"/api/v1/families/{family_id}/tree").status_code == 403


def test_spouse_divorce_keeps_parent_relationship(client):
    register(client, "owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Гэр бүл"}).json()["id"]
    people = [
        client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": name}).json()
        for name in ["Бат", "Сар", "Болд"]
    ]
    marriage = client.post(
        f"/api/v1/families/{family_id}/marriages",
        json={
            "person_1_id": people[0]["id"],
            "person_2_id": people[1]["id"],
            "start_date": "2010-01-01",
        },
    )
    assert marriage.status_code == 201
    parent_child = f"/api/v1/families/{family_id}/relationships/parent-child"
    for parent in people[:2]:
        assert (
            client.post(
                parent_child,
                json={"parent_id": parent["id"], "child_id": people[2]["id"]},
            ).status_code
            == 201
        )
    divorce = client.patch(
        f"/api/v1/families/{family_id}/marriages/{marriage.json()['id']}",
        json={"status": "divorced", "end_date": "2018-01-01"},
    )
    assert divorce.status_code == 200
    assert divorce.json()["status"] == "divorced"
    remarriage = client.post(
        f"/api/v1/families/{family_id}/marriages",
        json={"person_1_id": people[0]["id"], "person_2_id": people[2]["id"]},
    )
    assert remarriage.status_code == 201
    tree = client.get(f"/api/v1/families/{family_id}/tree").json()
    assert len(tree["parent_child_relationships"]) == 2
    assert {marriage["status"] for marriage in tree["marriages"]} == {"divorced", "married"}


def test_same_pair_remarriage_keeps_each_marriage_occurrence(client):
    register(client, "remarriage@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Дахин гэрлэлт"}).json()["id"]
    base = f"/api/v1/families/{family_id}"
    first = client.post(
        f"{base}/persons", json={"first_name": "Бат", "birth_date": "1980-01-01"}
    ).json()
    second = client.post(f"{base}/persons", json={"first_name": "Сар"}).json()
    child = client.post(f"{base}/persons", json={"first_name": "Болд"}).json()
    body = {"person_1_id": first["id"], "person_2_id": second["id"], "start_date": "2000-01-01"}

    initial = client.post(f"{base}/marriages", json=body)
    assert initial.status_code == 201
    duplicate_active = client.post(f"{base}/marriages", json=body)
    assert duplicate_active.status_code == 409
    assert client.post(
        f"{base}/relationships/parent-child",
        json={"parent_id": first["id"], "child_id": child["id"]},
    ).status_code == 201

    ended = client.patch(
        f"{base}/marriages/{initial.json()['id']}",
        json={"status": "divorced", "end_date": "2010-01-01"},
    )
    assert ended.status_code == 200
    repeated = client.post(
        f"{base}/marriages",
        json={**body, "start_date": "2015-01-01", "location": "Улаанбаатар"},
    )
    assert repeated.status_code == 201
    second_end = client.patch(
        f"{base}/marriages/{repeated.json()['id']}",
        json={"status": "divorced", "end_date": None},
    )
    assert second_end.status_code == 200
    third = client.post(
        f"{base}/marriages", json={**body, "start_date": None, "description": "Дахин нийлсэн"}
    )
    assert third.status_code == 201

    history = client.get(f"{base}/persons/{first['id']}/marriages")
    assert history.status_code == 200
    assert [item["status"] for item in history.json()] == ["divorced", "divorced", "married"]
    assert [item["start_date"] for item in history.json()] == ["2000-01-01", "2015-01-01", None]
    assert all(item["other_person"]["id"] == second["id"] for item in history.json())
    assert client.get(f"{base}/marriages/{initial.json()['id']}").json()["id"] == initial.json()["id"]
    tree = client.get(f"{base}/tree").json()
    assert len(tree["marriages"]) == 3
    assert len(tree["parent_child_relationships"]) == 1


def test_marriage_validation_and_family_scoping(client):
    register(client, "marriage-scope@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Нэг"}).json()["id"]
    other_family = client.post("/api/v1/families", json={"name": "Хоёр"}).json()["id"]
    person_a = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "А"}).json()
    person_b = client.post(f"/api/v1/families/{family_id}/persons", json={"first_name": "Б"}).json()
    outsider = client.post(
        f"/api/v1/families/{other_family}/persons", json={"first_name": "Г"}
    ).json()
    base = f"/api/v1/families/{family_id}"
    self_marriage = client.post(
        f"{base}/marriages", json={"person_1_id": person_a["id"], "person_2_id": person_a["id"]}
    )
    assert self_marriage.status_code == 422
    reverse_dates = client.post(
        f"{base}/marriages",
        json={
            "person_1_id": person_a["id"],
            "person_2_id": person_b["id"],
            "start_date": "2010-01-01",
            "end_date": "2009-01-01",
        },
    )
    assert reverse_dates.status_code == 422
    cross_family = client.post(
        f"{base}/marriages", json={"person_1_id": person_a["id"], "person_2_id": outsider["id"]}
    )
    assert cross_family.status_code == 404


def test_biography_timeline_and_memory_round_trip(client):
    register(client, "archive@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Архив"}).json()["id"]
    person = client.post(
        f"/api/v1/families/{family_id}/persons", json={"first_name": "Оюун"}
    ).json()
    person_id = person["id"]
    base = f"/api/v1/families/{family_id}"
    bio = client.put(f"{base}/persons/{person_id}/biography", json={"content": "Амьдралын намтар."})
    assert bio.status_code == 200 and bio.json()["content"] == "Амьдралын намтар."

    event = client.post(
        f"{base}/persons/{person_id}/events",
        json={"event_type": "school", "title": "Сургуульд орсон", "event_date": "1990-09-01"},
    )
    assert event.status_code == 201
    assert client.get(f"{base}/persons/{person_id}/events").json()[0]["title"] == "Сургуульд орсон"

    memory = client.post(
        f"{base}/memories",
        json={"title": "Зуны дурсамж", "description": "Нуурын эрэг", "person_ids": [person_id]},
    )
    assert memory.status_code == 201
    detail = client.get(f"{base}/memories/{memory.json()['id']}")
    assert detail.status_code == 200
    assert detail.json()["person_ids"] == [person_id]


def test_login_rate_limit_and_audit_records(client):
    register(client, "limit@example.com")
    client.post("/api/v1/auth/logout")
    wrong = {"email": "limit@example.com", "password": "incorrect-password"}
    for _ in range(5):
        assert client.post("/api/v1/auth/login", json=wrong).status_code == 401
    assert client.post("/api/v1/auth/login", json=wrong).status_code == 429

    # Registration and the family mutations write audit events within their transactions.
    assert client.post("/api/v1/auth/logout").status_code == 204
    # A fresh account/IP pair is not blocked by the previous user's bucket.
    assert register(client, "audit@example.com").status_code == 201
    family = client.post("/api/v1/families", json={"name": "Бүртгэлтэй"})
    assert family.status_code == 201
    audit = client.get(f"/api/v1/families/{family.json()['id']}/audit")
    assert audit.status_code == 200
    assert {entry["action"] for entry in audit.json()} >= {"family.created"}

from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import select

from app.models import AuditLog, FamilyMember, User


def register(client, email):
    return client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "strong-passphrase-123"},
    )


def test_register_login_logout_me_and_email_normalization(client):
    response = register(client, "Tree.Owner@example.com")
    assert response.status_code == 201
    assert response.json()["email"] == "tree.owner@example.com"
    assert "httponly" in response.headers["set-cookie"].lower()
    assert client.get("/api/v1/auth/me").status_code == 200

    assert register(client, "tree.owner@example.com").status_code == 409
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "TREE.OWNER@example.com", "password": "wrong-password"},
        ).status_code
        == 401
    )
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "tree.owner@example.com", "password": "strong-passphrase-123"},
        ).status_code
        == 200
    )


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
    register(client, "new.member@example.com")
    assert client.post("/api/v1/invitations/accept", json={"token": token}).status_code == 403
    verification = _token_from_mail(
        email_provider, "new.member@example.com", "Гуулингийнхан — имэйл"
    )
    assert (
        client.post(
            "/api/v1/auth/email/verification/confirm", json={"token": verification}
        ).status_code
        == 200
    )
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

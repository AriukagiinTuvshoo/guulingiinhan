"""Cross-route privacy regressions found during the domain-readiness audit."""

from uuid import UUID

import pytest
from conftest import register_verified
from sqlalchemy import select

from app.models import FamilyMember, FamilyPerson


@pytest.mark.parametrize("restriction", ["private", "detached"])
def test_memory_lists_follow_detail_tag_visibility(client, database, restriction):
    register_verified(client, "memory-privacy-owner@example.com")
    family = client.post("/api/v1/families", json={"name": "Disposable audit family"}).json()
    base = f"/api/v1/families/{family['id']}"
    subject = client.post(base + "/persons", json={
        "first_name": "Restricted subject", "birth_date": "1950-01-01",
        "visibility": "private" if restriction == "private" else "family",
    }).json()
    visible_subject = client.post(base + "/persons", json={
        "first_name": "Visible subject", "birth_date": "1950-01-01",
    }).json()
    restricted = client.post(base + "/memories", json={
        "title": "Restricted recollection", "description": "Sensitive tagged recollection",
        "visibility": "family", "person_ids": [subject["id"], visible_subject["id"]],
    })
    assert restricted.status_code == 201, restricted.text
    memory_id = restricted.json()["id"]
    allowed = client.post(base + "/memories", json={"title": "Ordinary family memory"}).json()
    assert client.get(base + f"/memories/{memory_id}").status_code == 200
    assert memory_id in {item["id"] for item in client.get(base + "/memories").json()["items"]}

    client.post("/api/v1/auth/logout")
    register_verified(client, "memory-privacy-member@example.com")
    member_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family["id"]), user_id=member_id, role="member"))
        if restriction == "detached":
            association = db.scalar(select(FamilyPerson).where(
                FamilyPerson.family_id == UUID(family["id"]),
                FamilyPerson.person_id == UUID(subject["id"]),
            ))
            db.delete(association)
        db.commit()

    assert client.get(base + f"/memories/{memory_id}").status_code == 404
    listed = client.get(base + "/memories")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["items"]] == [allowed["id"]]
    assert listed.json()["total"] == 1
    person_memories = client.get(base + f"/persons/{visible_subject['id']}/memories")
    assert person_memories.status_code == 200 and person_memories.json() == []
    assert client.get(f"/api/v1/memories/{memory_id}/comments").status_code == 404

    if restriction == "private":
        signed_in = client.post("/api/v1/auth/login", json={
            "email": "memory-privacy-owner@example.com", "password": "strong-passphrase-123",
        })
        assert signed_in.status_code == 200
        assert client.get(base + f"/memories/{memory_id}").status_code == 200
        assert memory_id in {item["id"] for item in client.get(base + "/memories").json()["items"]}

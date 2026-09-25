from uuid import UUID

from conftest import register_verified
from sqlalchemy import select

from app.models import (
    Branch,
    Lineage,
    Marriage,
    ParentChildRelationship,
    Person,
    PersonLineageAssignment,
)


def _setup_family(client, name="Assignment"):
    family = client.post("/api/v1/families", json={"name": name})
    assert family.status_code == 201
    family_id = family.json()["id"]
    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Бат", "last_name": "Гуулингийн"},
    )
    assert person.status_code == 201
    lineage = client.post(
        f"/api/v1/families/{family_id}/lineages",
        json={"name": "Удам A"},
    )
    assert lineage.status_code == 201
    branch_a1 = client.post(
        f"/api/v1/lineages/{lineage.json()['id']}/branches",
        json={"name": "A1"},
    )
    assert branch_a1.status_code == 201
    branch_a2 = client.post(
        f"/api/v1/lineages/{lineage.json()['id']}/branches",
        json={"name": "A2"},
    )
    assert branch_a2.status_code == 201
    return family_id, person.json(), lineage.json(), branch_a1.json(), branch_a2.json()


def test_create_lineage_only_assignment(client):
    register_verified(client, "assignment-create@example.com")
    family_id, person, lineage, _, _ = _setup_family(client)

    response = client.put(
        f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment",
        json={"lineage_id": lineage["id"], "branch_id": None},
    )
    assert response.status_code == 200
    assert response.json() == {
        "person_id": person["id"],
        "lineage_id": lineage["id"],
        "branch_id": None,
    }
    fetched = client.get(
        f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment"
    )
    assert fetched.status_code == 200
    assert fetched.json()["lineage_id"] == lineage["id"]
    assert fetched.json()["branch_id"] is None


def test_create_lineage_and_branch_assignment(client):
    register_verified(client, "assignment-branch@example.com")
    family_id, person, lineage, branch_a1, _ = _setup_family(client)

    response = client.put(
        f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment",
        json={"lineage_id": lineage["id"], "branch_id": branch_a1["id"]},
    )
    assert response.status_code == 200
    assert response.json()["branch_id"] == branch_a1["id"]


def test_update_assignment_keeps_one_current_row(client, database):
    register_verified(client, "assignment-update@example.com")
    family_id, person, lineage, branch_a1, branch_a2 = _setup_family(client)
    url = f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment"

    first = client.put(url, json={"lineage_id": lineage["id"], "branch_id": branch_a1["id"]})
    assert first.status_code == 200
    second = client.put(url, json={"lineage_id": lineage["id"], "branch_id": branch_a2["id"]})
    assert second.status_code == 200
    assert second.json()["branch_id"] == branch_a2["id"]

    with database() as db:
        rows = db.scalars(
            select(PersonLineageAssignment).where(
                PersonLineageAssignment.person_id == UUID(person["id"])
            )
        ).all()
        assert len(rows) == 1
        assert rows[0].branch_id == UUID(branch_a2["id"])


def test_delete_assignment_keeps_person_and_relationships(client, database):
    register_verified(client, "assignment-delete@example.com")
    family_id, person, lineage, branch_a1, _ = _setup_family(client)
    other = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Сар"},
    ).json()
    parent_edge = client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": other["id"], "child_id": person["id"]},
    )
    marriage = client.post(
        f"/api/v1/families/{family_id}/marriages",
        json={"person_1_id": person["id"], "person_2_id": other["id"]},
    )
    assert parent_edge.status_code == 201
    assert marriage.status_code == 201

    url = f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment"
    assert (
        client.put(url, json={"lineage_id": lineage["id"], "branch_id": branch_a1["id"]}).status_code
        == 200
    )
    assert client.delete(url).status_code == 204

    assert client.get(url).status_code == 404
    assert client.get(f"/api/v1/families/{family_id}/persons/{person['id']}").status_code == 200
    tree = client.get(f"/api/v1/families/{family_id}/tree").json()
    assert len(tree["parent_child_relationships"]) == 1
    assert len(tree["marriages"]) == 1


def test_cross_family_lineage_assignment_is_rejected(client):
    register_verified(client, "assignment-cross-family@example.com")
    family_a, person, _, _, _ = _setup_family(client, "A")
    family_b = client.post("/api/v1/families", json={"name": "B"}).json()
    lineage_b = client.post(
        f"/api/v1/families/{family_b['id']}/lineages",
        json={"name": "Удам B"},
    ).json()

    response = client.put(
        f"/api/v1/families/{family_a}/persons/{person['id']}/lineage-assignment",
        json={"lineage_id": lineage_b["id"]},
    )
    assert response.status_code == 404


def test_cross_lineage_branch_assignment_is_rejected(client):
    register_verified(client, "assignment-cross-branch@example.com")
    family_id, person, lineage, _, _ = _setup_family(client)
    other_lineage = client.post(
        f"/api/v1/families/{family_id}/lineages",
        json={"name": "Удам B"},
    ).json()
    other_branch = client.post(
        f"/api/v1/lineages/{other_lineage['id']}/branches",
        json={"name": "B1"},
    ).json()

    response = client.put(
        f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment",
        json={"lineage_id": lineage["id"], "branch_id": other_branch["id"]},
    )
    assert response.status_code == 404


def test_person_not_in_supplied_family_is_rejected(client):
    register_verified(client, "assignment-person-scope@example.com")
    family_a, person, _, _, _ = _setup_family(client, "A")
    family_b = client.post("/api/v1/families", json={"name": "B"}).json()
    lineage_b = client.post(
        f"/api/v1/families/{family_b['id']}/lineages",
        json={"name": "Удам B"},
    ).json()

    response = client.put(
        f"/api/v1/families/{family_b['id']}/persons/{person['id']}/lineage-assignment",
        json={"lineage_id": lineage_b["id"]},
    )
    assert response.status_code == 404


def test_member_can_read_but_cannot_mutate_assignment(client, database):
    register_verified(client, "assignment-member-owner@example.com")
    family_id, person, lineage, _, _ = _setup_family(client, "Roles")
    assignment_url = (
        f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment"
    )
    assert client.put(
        assignment_url,
        json={"lineage_id": lineage["id"], "branch_id": None},
    ).status_code == 200
    client.post("/api/v1/auth/logout")
    register_verified(client, "assignment-member@example.com")
    with database() as db:
        from app.models import FamilyMember, User

        member = db.scalar(select(User).where(User.email == "assignment-member@example.com"))
        db.add(FamilyMember(family_id=UUID(family_id), user_id=member.id, role="member"))
        db.commit()

    assert client.get(
        f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment"
    ).status_code == 200
    assert (
        client.put(
            f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment",
            json={"lineage_id": lineage["id"]},
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment"
        ).status_code
        == 403
    )


def test_existing_person_can_remain_without_assignment(client, database):
    register_verified(client, "assignment-none@example.com")
    family_id = client.post("/api/v1/families", json={"name": "No assignment"}).json()["id"]
    person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Бат"},
    ).json()

    url = f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment"
    assert client.get(url).status_code == 404
    with database() as db:
        assert db.scalar(
            select(PersonLineageAssignment.id).where(
                PersonLineageAssignment.person_id == UUID(person["id"])
            )
        ) is None


def test_assignment_does_not_mutate_genealogy_counts(client):
    register_verified(client, "assignment-no-side-effect@example.com")
    family_id, person, lineage, branch_a1, _ = _setup_family(client)
    other = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Ээж"},
    ).json()
    child = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Хүүхэд"},
    ).json()
    assert client.post(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        json={"parent_id": other["id"], "child_id": child["id"]},
    ).status_code == 201
    assert client.post(
        f"/api/v1/families/{family_id}/marriages",
        json={"person_1_id": person["id"], "person_2_id": other["id"]},
    ).status_code == 201

    before = client.get(f"/api/v1/families/{family_id}/tree").json()
    response = client.put(
        f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment",
        json={"lineage_id": lineage["id"], "branch_id": branch_a1["id"]},
    )
    assert response.status_code == 200
    after = client.get(f"/api/v1/families/{family_id}/tree").json()
    assert len(after["parent_child_relationships"]) == len(before["parent_child_relationships"])
    assert len(after["marriages"]) == len(before["marriages"])
    assert after["persons"] == before["persons"]


def test_assignment_is_removed_when_person_is_detached_from_family(client, database):
    register_verified(client, "assignment-detach@example.com")
    family_id, person, lineage, branch_a1, _ = _setup_family(client, "Detach")
    url = f"/api/v1/families/{family_id}/persons/{person['id']}/lineage-assignment"
    assert (
        client.put(url, json={"lineage_id": lineage["id"], "branch_id": branch_a1["id"]}).status_code
        == 200
    )

    assert client.delete(f"/api/v1/families/{family_id}/persons/{person['id']}").status_code == 204

    with database() as db:
        assert db.scalar(
            select(PersonLineageAssignment.id).where(
                PersonLineageAssignment.person_id == UUID(person["id"])
            )
        ) is None
        assert db.scalar(select(Person.id).where(Person.id == UUID(person["id"]))) is not None
        assert db.scalar(select(Lineage.id).where(Lineage.id == UUID(lineage["id"]))) is not None


def test_duplicate_current_assignment_is_db_protected(client, database):
    register_verified(client, "assignment-duplicate@example.com")
    family_id, person, lineage, branch_a1, _ = _setup_family(client, "Duplicate")

    with database() as db:
        db.add(
            PersonLineageAssignment(
                person_id=UUID(person["id"]),
                lineage_id=UUID(lineage["id"]),
                branch_id=UUID(branch_a1["id"]),
            )
        )
        db.commit()
        duplicate = PersonLineageAssignment(
            person_id=UUID(person["id"]),
            lineage_id=UUID(lineage["id"]),
            branch_id=UUID(branch_a1["id"]),
        )
        db.add(duplicate)
        failed = False
        try:
            db.flush()
        except Exception:
            db.rollback()
            failed = True
        assert failed


def test_assignment_target_ids_do_not_allow_unauthorized_combinations(client):
    register_verified(client, "assignment-mass@example.com")
    family_a, person, lineage, branch_a1, _ = _setup_family(client, "Mass")
    family_b = client.post("/api/v1/families", json={"name": "Other"}).json()["id"]
    lineage_b = client.post(
        f"/api/v1/families/{family_b}/lineages",
        json={"name": "B lineage"},
    ).json()
    branch_b = client.post(
        f"/api/v1/lineages/{lineage_b['id']}/branches",
        json={"name": "B1"},
    ).json()

    url = f"/api/v1/families/{family_a}/persons/{person['id']}/lineage-assignment"
    assert client.put(
        url,
        json={"lineage_id": lineage_b["id"], "branch_id": branch_a1["id"]},
    ).status_code == 404
    assert client.put(
        url,
        json={"lineage_id": lineage["id"], "branch_id": branch_b["id"]},
    ).status_code == 404

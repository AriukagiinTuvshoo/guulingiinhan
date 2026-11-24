from datetime import date
from uuid import UUID, uuid4

from conftest import register_verified
from sqlalchemy import event

from app.models import (
    Branch,
    FamilyPerson,
    Lineage,
    Marriage,
    ParentChildRelationship,
    Person,
    PersonLineageAssignment,
    User,
)
from app.person_search import normalize_search_name


def test_normalized_person_search_is_paginated_and_family_scoped(client, database):
    register_verified(client, "search-scale@example.com")
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_id = UUID(client.post("/api/v1/families", json={"name": "Хайлтын гэр бүл"}).json()["id"])
    rows = []
    memberships = []
    for index in range(1001):
        person_id = uuid4()
        person = Person(
            id=person_id,
            first_name=f"Түвшин{index:03}",
            last_name="Удам",
            middle_name="Гол",
            search_first_name=normalize_search_name(f"Түвшин{index:03}"),
            search_last_name="удам",
            search_middle_name="гол",
            birth_date=date(2000 if index < 501 else 1999, 1, 1),
            created_by=owner_id,
            visibility="family",
        )
        rows.append(person)
        memberships.append(
            FamilyPerson(
                id=uuid4(), family_id=family_id, person_id=person_id, added_by=owner_id
            )
        )
    private_creator_id = uuid4()
    private_person = Person(
        id=uuid4(),
        first_name="Түвшин Нууц",
        last_name="Удам",
        search_first_name="түвшин нууц",
        search_last_name="удам",
        search_middle_name="",
        created_by=private_creator_id,
        visibility="private",
    )
    hidden_family_person = FamilyPerson(
        id=uuid4(), family_id=family_id, person_id=private_person.id, added_by=owner_id
    )
    other_family_person = Person(
        id=uuid4(),
        first_name="Түвшин Өөр",
        last_name="Удам",
        search_first_name="түвшин өөр",
        search_last_name="удам",
        search_middle_name="",
        created_by=owner_id,
        visibility="family",
    )
    other_family_id = UUID(
        client.post("/api/v1/families", json={"name": "Өөр гэр бүл"}).json()["id"]
    )
    with database() as db:
        db.add(User(id=private_creator_id, email="private-creator@example.com", display_name="Нууц"))
        db.flush()
        db.add_all(rows + [private_person, other_family_person])
        db.flush()
        memberships.append(hidden_family_person)
        memberships.append(
            FamilyPerson(
                id=uuid4(),
                family_id=other_family_id,
                person_id=other_family_person.id,
                added_by=owner_id,
            )
        )
        db.add_all(memberships)
        db.commit()

    url = f"/api/v1/families/{family_id}/persons/search?q=%20%20ТҮВШИН%20%20удам%20"
    first = client.get(url)
    assert first.status_code == 200
    payload = first.json()
    assert payload["total"] == 1001
    assert len(payload["items"]) == 25
    assert payload["has_next"] is True
    assert "birth_place" not in payload["items"][0]
    second = client.get(url + "&page=2&page_size=25")
    assert second.status_code == 200
    assert len(second.json()["items"]) == 25
    assert not {item["id"] for item in payload["items"]} & {
        item["id"] for item in second.json()["items"]
    }
    selected_year = client.get(url + "&birth_year=2000&page_size=100")
    assert selected_year.status_code == 200
    assert selected_year.json()["total"] == 501
    assert all(item["birth_year"] == 2000 for item in selected_year.json()["items"])
    assert client.get(url + "&page_size=101").status_code == 422
    assert client.get(url.replace("ТҮВШИН", "ӨӨР")).json()["total"] == 0


def test_tree_context_is_bounded_cycle_safe_and_constant_query_count(client, database):
    register_verified(client, "tree-scale@example.com")
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_id = UUID(client.post("/api/v1/families", json={"name": "Том мод"}).json()["id"])
    persons = [
        Person(
            id=uuid4(),
            first_name=f"Хүн{index:03}",
            last_name="Мод",
            search_first_name=normalize_search_name(f"Хүн{index:03}"),
            search_last_name="мод",
            search_middle_name="",
            created_by=owner_id,
            visibility="family",
        )
        for index in range(120)
    ]
    memberships = [
        FamilyPerson(id=uuid4(), family_id=family_id, person_id=p.id, added_by=owner_id)
        for p in persons
    ]
    parent_edges = [
        ParentChildRelationship(
            id=uuid4(),
            parent_id=persons[index].id,
            child_id=persons[index + 1].id,
            created_by=owner_id,
        )
        for index in range(119)
    ]
    # A malformed cycle must terminate and never duplicate nodes.
    parent_edges.append(
        ParentChildRelationship(
            id=uuid4(), parent_id=persons[-1].id, child_id=persons[0].id, created_by=owner_id
        )
    )
    divorced = Marriage(
        id=uuid4(),
        person_1_id=min(persons[50].id, persons[51].id, key=str),
        person_2_id=max(persons[50].id, persons[51].id, key=str),
        status="divorced",
        start_date=date(2000, 1, 1),
        end_date=date(2010, 1, 1),
        created_by=owner_id,
    )
    with database() as db:
        db.add_all(persons)
        db.flush()
        db.add_all(memberships + parent_edges + [divorced])
        db.commit()

    queries = []
    engine = database.kw["bind"]
    listener = lambda conn, cursor, statement, parameters, context, executemany: queries.append(statement)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        response = client.get(
            f"/api/v1/families/{family_id}/tree?person_id={persons[60].id}&depth=5"
        )
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert response.status_code == 200
    tree = response.json()
    assert tree["root_person_id"] == str(persons[60].id)
    assert tree["meta"]["depth"] == 5
    assert len(tree["persons"]) <= 11
    assert len({person["id"] for person in tree["persons"]}) == len(tree["persons"])
    assert "short_description" not in tree["persons"][0]
    assert "birth_place" not in tree["persons"][0]
    # One constant-query enrichment fetch supplies authorized lineage metadata.
    assert len(queries) <= 31
    assert client.get(
        f"/api/v1/families/{family_id}/tree?person_id={persons[60].id}&depth=11"
    ).status_code == 422
    assert client.get(
        f"/api/v1/families/{family_id}/tree?person_id={uuid4()}&depth=2"
    ).status_code == 404


def test_tree_deep_nine_generation_traversal_and_node_limit_safety(client, database):
    register_verified(client, "tree-deep-9gen@example.com")
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_id = UUID(client.post("/api/v1/families", json={"name": "Есөн үеийн ургийн мод"}).json()["id"])

    # Create an 11-generation linear chain to verify depth=9, depth=10, depth=11 (422),
    # node_limit cap, and direction=descendants (must never fetch ancestors).
    chain = [
        Person(
            id=uuid4(),
            first_name=f"Үе{index + 1:02}",
            last_name="Алтан",
            search_first_name=normalize_search_name(f"Үе{index + 1:02}"),
            search_last_name=normalize_search_name("Алтан"),
            search_middle_name="",
            created_by=owner_id,
        )
        for index in range(11)
    ]
    memberships = [FamilyPerson(family_id=family_id, person_id=p.id, added_by=owner_id) for p in chain]
    edges = [
        ParentChildRelationship(parent_id=chain[i].id, child_id=chain[i + 1].id, created_by=owner_id)
        for i in range(len(chain) - 1)
    ]
    with database() as db:
        db.add_all(chain)
        db.flush()
        db.add_all(memberships + edges)
        db.commit()

    # depth=9 from Gen 1 reaches Gen 10 (10 people total).
    resp_9 = client.get(f"/api/v1/families/{family_id}/tree?person_id={chain[0].id}&depth=9")
    assert resp_9.status_code == 200
    tree_9 = resp_9.json()
    assert tree_9["meta"]["depth"] == 9
    assert tree_9["meta"]["truncated"] is False
    assert len(tree_9["persons"]) == 10

    # depth=10 is accepted and reaches all 11 people.
    resp_10 = client.get(f"/api/v1/families/{family_id}/tree?person_id={chain[0].id}&depth=10")
    assert resp_10.status_code == 200
    assert len(resp_10.json()["persons"]) == 11

    # depth=11 is rejected with 422.
    assert (
        client.get(f"/api/v1/families/{family_id}/tree?person_id={chain[0].id}&depth=11").status_code
        == 422
    )

    # node_limit continues to cap safely even at max depth=10.
    resp_capped = client.get(
        f"/api/v1/families/{family_id}/tree?person_id={chain[0].id}&depth=10&node_limit=6"
    )
    assert resp_capped.status_code == 200
    capped = resp_capped.json()
    assert capped["meta"]["truncated"] is True
    assert capped["meta"]["node_limit"] == 6
    assert len(capped["persons"]) <= 6

    # direction=descendants starting at Gen 5 fetches only Gen 5..8, never Gen 1..4 ancestors.
    resp_desc = client.get(
        f"/api/v1/families/{family_id}/tree?person_id={chain[4].id}&depth=3&direction=descendants"
    )
    assert resp_desc.status_code == 200
    desc_ids = {p["id"] for p in resp_desc.json()["persons"]}
    assert desc_ids == {str(chain[i].id) for i in (4, 5, 6, 7)}
    for ancestor in chain[:4]:
        assert str(ancestor.id) not in desc_ids


def test_tree_node_limit_caps_large_fanout(client, database):
    register_verified(client, "tree-limit@example.com")
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_id = UUID(client.post("/api/v1/families", json={"name": "Олон холбоо"}).json()["id"])
    persons = [
        Person(
            id=uuid4(),
            first_name=f"Зангилаа{index:03}",
            last_name="Салбар",
            search_first_name=normalize_search_name(f"Зангилаа{index:03}"),
            search_last_name="салбар",
            search_middle_name="",
            created_by=owner_id,
            visibility="family",
        )
        for index in range(350)
    ]
    edges = [
        ParentChildRelationship(
            id=uuid4(), parent_id=persons[0].id, child_id=p.id, created_by=owner_id
        )
        for p in persons[1:]
    ]
    with database() as db:
        db.add_all(persons)
        db.flush()
        db.add_all(
            FamilyPerson(id=uuid4(), family_id=family_id, person_id=p.id, added_by=owner_id)
            for p in persons
        )
        db.add_all(edges)
        db.commit()
    response = client.get(f"/api/v1/families/{family_id}/tree?person_id={persons[0].id}&depth=1")
    assert response.status_code == 200
    tree = response.json()
    assert tree["meta"]["node_count"] <= tree["meta"]["node_limit"]
    assert tree["meta"]["truncated"] is True
    expanded = client.get(f"/api/v1/families/{family_id}/tree?scope=all&node_limit=1000")
    assert expanded.status_code == 200
    assert len(expanded.json()["persons"]) == 350
    assert expanded.json()["meta"]["node_limit"] == 1000
    assert client.get(f"/api/v1/families/{family_id}/tree?node_limit=1001").status_code == 422
    client.post("/api/v1/auth/logout")
    assert client.get(f"/api/v1/families/{family_id}/tree?scope=all&node_limit=1000").status_code == 401


def test_tree_includes_authorized_lineage_branch_metadata_and_stays_family_scoped(
    client, database
):
    register_verified(client, "tree-lineage@example.com")
    owner_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    family_a_id = UUID(
        client.post("/api/v1/families", json={"name": "Удмын гэр бүл"}).json()["id"]
    )
    family_b_id = UUID(
        client.post("/api/v1/families", json={"name": "Өөр гэр бүл"}).json()["id"]
    )

    root = Person(
        id=uuid4(),
        first_name="Түвшин",
        last_name="Мод",
        search_first_name=normalize_search_name("Түвшин"),
        search_last_name="мод",
        search_middle_name="",
        created_by=owner_id,
        visibility="family",
    )
    child = Person(
        id=uuid4(),
        first_name="Бадмаа",
        last_name="Мод",
        search_first_name=normalize_search_name("Бадмаа"),
        search_last_name="мод",
        search_middle_name="",
        created_by=owner_id,
        visibility="family",
    )
    spouse = Person(
        id=uuid4(),
        first_name="Дулмаа",
        last_name="Бусад",
        search_first_name=normalize_search_name("Дулмаа"),
        search_last_name="бусад",
        search_middle_name="",
        created_by=owner_id,
        visibility="family",
    )

    with database() as db:
        db.add_all([root, child, spouse])
        db.flush()
        db.add_all(
            [
                FamilyPerson(
                    id=uuid4(), family_id=family_a_id, person_id=person.id, added_by=owner_id
                )
                for person in [root, child, spouse]
            ]
            + [
                FamilyPerson(
                    id=uuid4(), family_id=family_b_id, person_id=root.id, added_by=owner_id
                ),
                ParentChildRelationship(
                    id=uuid4(), parent_id=root.id, child_id=child.id, created_by=owner_id
                ),
                Marriage(
                    id=uuid4(),
                    person_1_id=min(root.id, spouse.id, key=str),
                    person_2_id=max(root.id, spouse.id, key=str),
                    status="married",
                    created_by=owner_id,
                ),
            ]
        )
        db.flush()

        lineage_a = Lineage(
            id=uuid4(),
            family_id=family_a_id,
            name="Удам A",
            description=None,
        )
        lineage_b = Lineage(
            id=uuid4(),
            family_id=family_b_id,
            name="Удам B",
            description=None,
        )
        db.add_all([lineage_a, lineage_b])
        db.flush()

        branch_a = Branch(
            id=uuid4(),
            lineage_id=lineage_a.id,
            name="Салаа A",
            description=None,
        )
        db.add(branch_a)
        db.flush()

        db.add(
            PersonLineageAssignment(
                id=uuid4(),
                person_id=root.id,
                lineage_id=lineage_a.id,
                branch_id=branch_a.id,
            )
        )
        db.commit()

    family_a_tree = client.get(
        f"/api/v1/families/{family_a_id}/tree?person_id={root.id}&depth=1"
    )
    assert family_a_tree.status_code == 200
    payload_a = family_a_tree.json()
    root_a = next(person for person in payload_a["persons"] if person["id"] == str(root.id))
    child_a = next(person for person in payload_a["persons"] if person["id"] == str(child.id))
    spouse_a = next(person for person in payload_a["persons"] if person["id"] == str(spouse.id))

    assert root_a["lineage_id"] == str(lineage_a.id)
    assert root_a["lineage_name"] == "Удам A"
    assert root_a["branch_id"] == str(branch_a.id)
    assert root_a["branch_name"] == "Салаа A"
    assert child_a["lineage_id"] is None
    assert child_a["branch_name"] is None
    assert {
        (edge["parent_id"], edge["child_id"])
        for edge in payload_a["parent_child_relationships"]
    } == {(str(root.id), str(child.id))}
    assert {
        (marriage["person_1_id"], marriage["person_2_id"])
        for marriage in payload_a["marriages"]
    } == {tuple(sorted((str(root.id), str(spouse.id))))}
    assert root_a["id"] == str(root.id)
    assert spouse_a["id"] == str(spouse.id)

    family_b_tree = client.get(
        f"/api/v1/families/{family_b_id}/tree?person_id={root.id}&depth=0"
    )
    assert family_b_tree.status_code == 200
    root_b = family_b_tree.json()["persons"][0]
    assert root_b["id"] == str(root.id)
    assert root_b["lineage_id"] is None
    assert root_b["lineage_name"] is None
    assert root_b["branch_id"] is None
    assert root_b["branch_name"] is None

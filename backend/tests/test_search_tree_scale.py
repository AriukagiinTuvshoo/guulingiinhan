from datetime import date
from uuid import UUID, uuid4

from conftest import register_verified
from sqlalchemy import event

from app.models import FamilyPerson, Marriage, ParentChildRelationship, Person, User
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
    assert len(queries) <= 30
    assert client.get(
        f"/api/v1/families/{family_id}/tree?person_id={persons[60].id}&depth=6"
    ).status_code == 422
    assert client.get(
        f"/api/v1/families/{family_id}/tree?person_id={uuid4()}&depth=2"
    ).status_code == 404


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

from conftest import register_verified


def test_people_directory_is_family_scoped_and_hides_private_people(client, email_provider):
    owner_email = "directory-owner@example.com"
    private_creator_email = "directory-private-creator@example.com"
    owner_password = "strong-passphrase-123"
    register_verified(client, owner_email, owner_password)
    family_id = client.post("/api/v1/families", json={"name": "Нээлттэй гэр бүл"}).json()["id"]
    visible = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Бат", "last_name": "Дорж"},
    ).json()
    other_family = client.post("/api/v1/families", json={"name": "Өөр гэр бүл"}).json()
    outsider = client.post(
        f"/api/v1/families/{other_family['id']}/persons",
        json={"first_name": "Өөр", "last_name": "Хүн"},
    ).json()

    invitation = client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": private_creator_email, "role": "member"},
    )
    assert invitation.status_code == 201
    delivery = next(
        item
        for item in reversed(email_provider.deliveries)
        if item.recipient == private_creator_email
    )
    token = delivery.text.rsplit(" ", 1)[-1].split("#token=", 1)[1]

    register_verified(client, private_creator_email)
    accepted = client.post("/api/v1/invitations/accept", json={"token": token})
    assert accepted.status_code == 200
    private_person = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Нууц", "last_name": "Хүн", "visibility": "private"},
    ).json()

    client.post("/api/v1/auth/logout")
    logged_in = client.post(
        "/api/v1/auth/login",
        json={"email": owner_email, "password": owner_password},
    )
    assert logged_in.status_code == 200

    payload = client.get(f"/api/v1/families/{family_id}/people")
    assert payload.status_code == 200
    ids = {item["id"] for item in payload.json()["items"]}
    assert payload.json()["total"] == 1
    assert visible["id"] in ids
    assert private_person["id"] not in ids
    assert outsider["id"] not in ids

    register_verified(client, "directory-outsider@example.com")
    assert client.get(f"/api/v1/families/{family_id}/people").status_code == 403
    assert client.get(
        f"/api/v1/families/{family_id}/persons/{visible['id']}"
    ).status_code == 403


def test_people_directory_supports_empty_search_case_insensitive_and_no_result(client):
    register_verified(client, "directory-search@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Хайлтын гэр бүл"}).json()["id"]
    first = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Бат", "last_name": "Дорж"},
    ).json()
    second = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Болор", "last_name": "Баяр"},
    ).json()

    empty = client.get(f"/api/v1/families/{family_id}/people")
    assert empty.status_code == 200
    assert empty.json()["total"] == 2

    matching = client.get(f"/api/v1/families/{family_id}/people?q=БАТ")
    assert matching.status_code == 200
    assert {item["id"] for item in matching.json()["items"]} == {first["id"]}

    no_result = client.get(f"/api/v1/families/{family_id}/people?q=Тохирохгүй")
    assert no_result.status_code == 200
    assert no_result.json()["items"] == []
    assert no_result.json()["total"] == 0

    paged = client.get(f"/api/v1/families/{family_id}/people?page_size=1")
    assert paged.status_code == 200
    assert len(paged.json()["items"]) == 1
    assert paged.json()["has_next"] is True
    assert "id" in paged.json()["items"][0]
    assert paged.json()["items"][0]["id"] in {first["id"], second["id"]}


def test_people_directory_lineage_branch_filters_and_unassigned_state(client):
    register_verified(client, "directory-filters@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Шүүлтүүрийн гэр бүл"}).json()["id"]

    unassigned = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Хуваарилаагүй", "last_name": "Хүн"},
    ).json()
    assigned = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Удамтай", "last_name": "Хүн"},
    ).json()

    lineage = client.post(
        f"/api/v1/families/{family_id}/lineages",
        json={"name": "Дээд удам"},
    ).json()
    branch = client.post(
        f"/api/v1/lineages/{lineage['id']}/branches",
        json={"name": "Баруун салаа"},
    ).json()
    assignment = client.put(
        f"/api/v1/families/{family_id}/persons/{assigned['id']}/lineage-assignment",
        json={"lineage_id": lineage["id"], "branch_id": branch["id"]},
    )
    assert assignment.status_code == 200

    all_people = client.get(f"/api/v1/families/{family_id}/people")
    by_id = {item["id"]: item for item in all_people.json()["items"]}
    assert by_id[unassigned["id"]]["lineage_id"] is None
    assert by_id[unassigned["id"]]["branch_id"] is None
    assert by_id[unassigned["id"]]["lineage_name"] is None
    assert by_id[unassigned["id"]]["branch_name"] is None

    lineage_payload = client.get(
        f"/api/v1/families/{family_id}/people?lineage_id={lineage['id']}"
    ).json()
    assert {item["id"] for item in lineage_payload["items"]} == {assigned["id"]}

    branch_payload = client.get(
        f"/api/v1/families/{family_id}/people?branch_id={branch['id']}"
    ).json()
    assert {item["id"] for item in branch_payload["items"]} == {assigned["id"]}
    assert branch_payload["items"][0]["lineage_name"] == "Дээд удам"
    assert branch_payload["items"][0]["branch_name"] == "Баруун салаа"

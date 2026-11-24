"""Tests for Stories RBAC, Member role promotion, and TreeJoinRequest + Smart Match."""

from conftest import register_verified


def _new_client(base_client):
    return type(base_client)(base_client.app, raise_server_exceptions=False)


def _invite_and_accept(owner_client, member_client, family_id: str, email: str, email_provider, role: str = "member"):
    inv = owner_client.post(
        f"/api/v1/families/{family_id}/invitations",
        json={"email": email, "role": role},
    )
    assert inv.status_code == 201, inv.text
    import re
    delivery = next(
        item
        for item in reversed(email_provider.deliveries)
        if item.recipient == email.strip().casefold()
    )
    m = re.search(r"token=([A-Za-z0-9_\-\.]+)", delivery.text)
    assert m, f"No invite token in {delivery.text}"
    acc = member_client.post("/api/v1/invitations/accept", json={"token": m.group(1)})
    assert acc.status_code == 200, acc.text


def test_member_can_create_and_edit_own_story_but_not_others(client, email_provider):
    register_verified(client, "owner-story@example.com", email_provider=email_provider)
    fam_id = client.post("/api/v1/families", json={"name": "Гуулингийнхан"}).json()["id"]

    m1 = _new_client(client)
    register_verified(m1, "m1-story@example.com", email_provider=email_provider)
    _invite_and_accept(client, m1, fam_id, "m1-story@example.com", email_provider)

    m2 = _new_client(client)
    register_verified(m2, "m2-story@example.com", email_provider=email_provider)
    _invite_and_accept(client, m2, fam_id, "m2-story@example.com", email_provider)

    # Member 1 freely creates a story
    s = m1.post(
        f"/api/v1/families/{fam_id}/stories",
        json={"title": "Миний өвөөгийн түүх", "body": "1955 оны зуны наадам.", "person_ids": []},
    )
    assert s.status_code == 201, s.text
    story_id = s.json()["id"]

    # Member 1 can edit their own story
    upd = m1.put(
        f"/api/v1/families/{fam_id}/stories/{story_id}",
        json={"title": "Миний өвөөгийн шинэчилсэн түүх"},
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["title"] == "Миний өвөөгийн шинэчилсэн түүх"

    # Member 2 cannot edit or delete Member 1's story
    assert m2.put(f"/api/v1/families/{fam_id}/stories/{story_id}", json={"title": "Хак"}).status_code == 403
    assert m2.delete(f"/api/v1/families/{fam_id}/stories/{story_id}").status_code == 403

    # Member 1 can delete their own story
    assert m1.delete(f"/api/v1/families/{fam_id}/stories/{story_id}").status_code == 204


def test_owner_promotes_and_demotes_member_role(client, email_provider):
    register_verified(client, "owner-role@example.com", email_provider=email_provider)
    fam_id = client.post("/api/v1/families", json={"name": "Гуулингийнхан"}).json()["id"]
    owner_id = client.get("/api/v1/auth/me").json()["id"]

    m1 = _new_client(client)
    register_verified(m1, "m1-role@example.com", email_provider=email_provider)
    _invite_and_accept(client, m1, fam_id, "m1-role@example.com", email_provider)
    m1_id = m1.get("/api/v1/auth/me").json()["id"]

    # Promote member -> editor
    r = client.patch(f"/api/v1/families/{fam_id}/members/{m1_id}", json={"role": "editor"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "editor"

    # Non-owner cannot change roles
    assert m1.patch(f"/api/v1/families/{fam_id}/members/{owner_id}", json={"role": "member"}).status_code == 403
    # Owner cannot self-demote here
    assert client.patch(f"/api/v1/families/{fam_id}/members/{owner_id}", json={"role": "member"}).status_code == 400

    # Demote editor -> member
    r2 = client.patch(f"/api/v1/families/{fam_id}/members/{m1_id}", json={"role": "member"})
    assert r2.status_code == 200 and r2.json()["role"] == "member"


def test_tree_join_request_with_existing_parent_and_smart_match_later(client, email_provider):
    register_verified(client, "owner-join@example.com", email_provider=email_provider)
    fam_id = client.post("/api/v1/families", json={"name": "Гуулингийнхан"}).json()["id"]

    # Create lineage + branch + existing father on tree
    lin = client.post(f"/api/v1/families/{fam_id}/lineages", json={"name": "Гуулингийнхны Удам"}).json()
    branch = client.post(f"/api/v1/lineages/{lin['id']}/branches", json={"name": "Баавуугийн салбар"}).json()
    father = client.post(
        f"/api/v1/families/{fam_id}/persons",
        json={"first_name": "Батболд", "last_name": "Баавуу", "gender": "male", "birth_date": "1968-03-10"},
    ).json()

    # Path 1: Member 1 submits profile with EXISTING father selected
    m1 = _new_client(client)
    register_verified(m1, "m1-join@example.com", email_provider=email_provider)
    _invite_and_accept(client, m1, fam_id, "m1-join@example.com", email_provider)

    req1 = m1.post(
        f"/api/v1/families/{fam_id}/tree-join-requests",
        json={
            "first_name": "Тэмүүлэн",
            "last_name": "Батболд",
            "gender": "male",
            "birth_date": "1996-07-15",
            "birth_place": "Улаанбаатар хот",
            "biography": "Програм хангамжийн инженер",
            "branch_id": branch["id"],
            "claimed_generation": 4,
            "father_person_id": father["id"],
        },
    )
    assert req1.status_code == 201, req1.text
    req1_id = req1.json()["id"]

    # Duplicate pending request blocked (409)
    dup = m1.post(
        f"/api/v1/families/{fam_id}/tree-join-requests",
        json={"first_name": "Тэмүүлэн", "last_name": "Батболд"},
    )
    assert dup.status_code == 409

    # Non-owner cannot list or approve requests
    assert m1.get(f"/api/v1/families/{fam_id}/tree-join-requests").status_code == 403
    assert m1.post(f"/api/v1/families/{fam_id}/tree-join-requests/{req1_id}/approve").status_code == 403

    # Owner approves -> Person created, linked to user & branch & father!
    app1 = client.post(f"/api/v1/families/{fam_id}/tree-join-requests/{req1_id}/approve")
    assert app1.status_code == 200, app1.text
    created_pid = app1.json()["created_person_id"]
    assert created_pid is not None
    assert app1.json()["status"] == "approved"

    # Verify person exists on tree with parent-child edge under father
    tree = client.get(f"/api/v1/families/{fam_id}/tree?depth=5").json()
    assert any(p["id"] == created_pid and p["first_name"] == "Тэмүүлэн" for p in tree["persons"])
    assert any(
        e["parent_id"] == father["id"] and e["child_id"] == created_pid
        for e in tree["parent_child_relationships"]
    )
    # Verify member is linked to created_pid
    members = client.get(f"/api/v1/families/{fam_id}/members").json()
    m1_uid = m1.get("/api/v1/auth/me").json()["id"]
    assert any(m["user_id"] == m1_uid and m["person_id"] == created_pid for m in members)

    # Path 2: Member 2 submits profile when father is NOT yet on tree (declared_father_name only)
    m2 = _new_client(client)
    register_verified(m2, "m2-join@example.com", email_provider=email_provider)
    _invite_and_accept(client, m2, fam_id, "m2-join@example.com", email_provider)

    req2 = m2.post(
        f"/api/v1/families/{fam_id}/tree-join-requests",
        json={
            "first_name": "Номин",
            "last_name": "Ганзориг",
            "gender": "female",
            "birth_date": "1999-02-20",
            "birth_place": "Дархан-Уул аймаг",
            "branch_id": branch["id"],
            "claimed_generation": 4,
            "declared_father_name": "Ганзориг",
            "declared_mother_name": "Сарантуяа",
        },
    )
    assert req2.status_code == 201, req2.text
    req2_id = req2.json()["id"]

    # Owner approves even though father isn't on tree yet
    app2 = client.post(f"/api/v1/families/{fam_id}/tree-join-requests/{req2_id}/approve")
    assert app2.status_code == 200, app2.text
    child2_pid = app2.json()["created_person_id"]

    # Initially no smart match because Ганзориг is not on tree yet
    sm_before = client.get(f"/api/v1/families/{fam_id}/tree-join-requests/smart-matches").json()
    assert len(sm_before) == 0

    # Later, Admin adds Ганзориг to the tree
    later_father = client.post(
        f"/api/v1/families/{fam_id}/persons",
        json={"first_name": "Ганзориг", "last_name": "Баавуу", "gender": "male", "birth_date": "1972-09-01"},
    ).json()

    # Smart Match immediately surfaces 1-click suggestion!
    sm_after = client.get(f"/api/v1/families/{fam_id}/tree-join-requests/smart-matches").json()
    assert len(sm_after) == 1
    assert sm_after[0]["request_id"] == req2_id
    assert sm_after[0]["child_person_id"] == child2_pid
    assert sm_after[0]["candidate_person_id"] == later_father["id"]
    assert sm_after[0]["parent_role"] == "father"

    # Admin confirms with 1 click -> attach-parent
    attach = client.post(
        f"/api/v1/families/{fam_id}/tree-join-requests/{req2_id}/attach-parent",
        json={"parent_person_id": later_father["id"]},
    )
    assert attach.status_code == 204, attach.text

    # Suggestion is now resolved & cleared!
    sm_final = client.get(f"/api/v1/families/{fam_id}/tree-join-requests/smart-matches").json()
    assert len(sm_final) == 0

    # Outsider strictly blocked (403)
    outsider = _new_client(client)
    register_verified(outsider, "out-join@example.com", email_provider=email_provider)
    assert outsider.post(f"/api/v1/families/{fam_id}/tree-join-requests", json={"first_name": "Хак"}).status_code == 403
    assert outsider.get(f"/api/v1/families/{fam_id}/tree-join-requests").status_code == 403

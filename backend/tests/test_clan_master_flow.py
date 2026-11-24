from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import select

from app.models import (
    AdminGrant,
    Family,
    FamilyMember,
    Marriage,
    ParentChildRelationship,
    Person,
    User,
    UserPersonLink,
)
from tests.conftest import TEST_PASSWORD, register_verified


def _register(client, email_provider, email: str) -> UUID:
    resp = register_verified(client, email, TEST_PASSWORD, email_provider)
    assert resp.status_code == 201, resp.text
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200, me.text
    return UUID(me.json()["id"])


def _login(client, email: str, password: str = TEST_PASSWORD):
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp


def _claim_auto_account_via_reset(client, email_provider, email: str, new_password: str) -> None:
    req = client.post("/api/v1/auth/password-reset/request", json={"email": email})
    assert req.status_code == 202, req.text
    delivery = next(
        item
        for item in reversed(email_provider.deliveries)
        if item.recipient == email.strip().casefold()
        and "нууц үг шинэчлэх" in item.subject
    )
    token = urlsplit(delivery.text.rsplit(" ", 1)[-1]).fragment.removeprefix("token=")
    conf = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": token, "new_password": new_password},
    )
    assert conf.status_code == 204, conf.text


def _setup_unified_clan(client, database, email_provider) -> dict:
    admin_id = _register(client, email_provider, "master@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    _login(client, "master@example.com")

    fam = client.post("/api/v1/families", json={"name": "ГУУЛИНГИЙНХАН"}).json()
    fid = fam["id"]

    yadam = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Ядамсүрэн", "gender": "male"}).json()
    gund = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Гүнд", "gender": "female"}).json()
    m_root = client.post(
        f"/api/v1/families/{fid}/marriages",
        json={"person_1_id": yadam["id"], "person_2_id": gund["id"], "status": "married"},
    )
    assert m_root.status_code == 201, m_root.text

    baavai = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Баавай", "gender": "male"}).json()
    badamdorj = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Бадамдорж", "gender": "male"}).json()
    dolgor = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Долгор", "gender": "female"}).json()
    nansalmaa = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Нансалмаа", "gender": "female"}).json()

    for b in (baavai, badamdorj, dolgor, nansalmaa):
        r = client.post(
            f"/api/v1/families/{fid}/relationships/parent-child",
            json={"parent_id": yadam["id"], "child_id": b["id"]},
        )
        assert r.status_code == 201, r.text

    buuvei = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Бүүвэй", "gender": "male"}).json()
    r_buuvei = client.post(
        f"/api/v1/families/{fid}/relationships/parent-child",
        json={"parent_id": baavai["id"], "child_id": buuvei["id"]},
    )
    assert r_buuvei.status_code == 201, r_buuvei.text

    with database.begin() as db:
        f = db.get(Family, UUID(fid))
        f.root_person_id = UUID(yadam["id"])

    # Create a non-super-admin Family Editor account
    editor_id = _register(client, email_provider, "editor@example.com")
    with database.begin() as db:
        db.add(FamilyMember(family_id=UUID(fid), user_id=editor_id, role="editor"))

    return {
        "fid": fid,
        "admin_id": admin_id,
        "editor_id": editor_id,
        "yadam": yadam,
        "gund": gund,
        "baavai": baavai,
        "buuvei": buuvei,
    }


def test_clan_master_multi_account_e2e_flow(client, database, email_provider):
    clan = _setup_unified_clan(client, database, email_provider)
    fid = clan["fid"]
    baavai = clan["baavai"]
    buuvei = clan["buuvei"]

    # ------------------------------------------------------------------
    # TEST 1: Privacy Gate before onboarding approval
    # ------------------------------------------------------------------
    _register(client, email_provider, "tuvshoo@example.com")
    _login(client, "tuvshoo@example.com")

    assert client.get("/api/v1/families").json() == []
    assert client.get(f"/api/v1/families/{fid}/tree").status_code == 403
    assert client.get(f"/api/v1/families/{fid}/persons").status_code == 403

    status_before = client.get("/api/v1/clan/onboarding/status").json()
    assert status_before["approved"] is False
    assert status_before["can_review"] is False

    opts_resp = client.get("/api/v1/clan/onboarding/options")
    assert opts_resp.status_code == 200
    opts = opts_resp.json()
    assert "Ядамсүрэн" in opts["root_label"]
    assert "Гүнд" in opts["root_label"]
    assert {b["name"] for b in opts["branches"]} == {"Баавай", "Бадамдорж", "Долгор", "Нансалмаа"}
    buuvei_node = next(n for n in opts["nodes"] if n["id"] == buuvei["id"])
    assert buuvei_node["generation"] == 3
    assert buuvei_node["parent_ids"] == [baavai["id"]]
    # Ensure privacy-safe node shape only (no email/phone/bio/birth_date)
    assert set(buuvei_node.keys()) == {"id", "name", "generation", "branch_root_id", "parent_ids"}

    # ------------------------------------------------------------------
    # TEST 2: 5th-gen Guided Onboarding (missing 4th-gen Mom + Spouse + Child)
    #         approved by Family Editor (no global AdminGrant)
    # ------------------------------------------------------------------
    req_resp = client.post(
        "/api/v1/clan/onboarding/requests",
        json={
            "branch_person_id": baavai["id"],
            "anchor_person_id": buuvei["id"],
            "claimed_generation": 5,
            "first_name": "Түвшинтулга",
            "last_name": "Дагмидмаа",
            "gender": "male",
            "relatives": [
                {
                    "relation": "parent",
                    "first_name": "Дагмидмаа",
                    "last_name": "Чермон",
                    "gender": "female",
                    "email": "eej@example.com",
                },
                {
                    "relation": "spouse",
                    "first_name": "Ану",
                    "last_name": "Болд",
                    "gender": "female",
                },
                {
                    "relation": "child",
                    "first_name": "Тэмүүлэн",
                    "last_name": "Түвшинтулга",
                    "gender": "male",
                },
            ],
            "note": "Бүүвэй өвөөгийн 5-р үе, ээж 4-р үед бүртгэгдээгүй байсан.",
        },
    )
    assert req_resp.status_code == 201, req_resp.text
    req_id = req_resp.json()["id"]

    # Non-reviewer still cannot list or approve
    assert client.get("/api/v1/admin/clan/onboarding/requests").status_code == 403

    # Log in as Family Editor (no AdminGrant!) and approve in 1 click
    _login(client, "editor@example.com")
    editor_status = client.get("/api/v1/clan/onboarding/status").json()
    assert editor_status["can_review"] is True

    queue = client.get("/api/v1/admin/clan/onboarding/requests").json()
    assert len(queue) == 1
    assert queue[0]["request_kind"] == "onboarding"

    approve_resp = client.post(f"/api/v1/admin/clan/onboarding/requests/{req_id}/approve", json={})
    assert approve_resp.status_code == 200, approve_resp.text
    approved = approve_resp.json()
    tuvshoo_person_id = approved["self_person_id"]
    assert "eej@example.com" in approved["created_accounts"]

    with database.begin() as db:
        mom_user = db.scalar(select(User).where(User.email == "eej@example.com"))
        assert mom_user is not None
        mom_link = db.scalar(select(UserPersonLink).where(UserPersonLink.user_id == mom_user.id))
        assert mom_link is not None
        mom_person_id = str(mom_link.person_id)

        edges = db.scalars(select(ParentChildRelationship)).all()
        edge_pairs = {(str(e.parent_id), str(e.child_id)) for e in edges}
        assert (buuvei["id"], mom_person_id) in edge_pairs
        assert (mom_person_id, tuvshoo_person_id) in edge_pairs

        # Spouse + Child checks
        anu = db.scalar(select(Person).where(Person.first_name == "Ану"))
        temuulen = db.scalar(select(Person).where(Person.first_name == "Тэмүүлэн"))
        assert anu is not None and temuulen is not None
        assert (tuvshoo_person_id, str(temuulen.id)) in edge_pairs
        marriages = db.scalars(select(Marriage)).all()
        marriage_pairs = {frozenset((str(m.person_1_id), str(m.person_2_id))) for m in marriages}
        assert frozenset((tuvshoo_person_id, str(anu.id))) in marriage_pairs

    # ------------------------------------------------------------------
    # TEST 3: Auto-account Mom claims password via Forgot Password & self-edits
    # ------------------------------------------------------------------
    mom_password = "MomNewPassword!2026"
    _claim_auto_account_via_reset(client, email_provider, "eej@example.com", mom_password)
    _login(client, "eej@example.com", mom_password)

    mom_tree = client.get(f"/api/v1/families/{fid}/tree?scope=all&depth=6")
    assert mom_tree.status_code == 200
    assert any(p["id"] == tuvshoo_person_id for p in mom_tree.json()["persons"])

    # Mom edits her OWN profile without needing admin approval, but gets 403 on Баавай
    assert (
        client.patch(
            f"/api/v1/families/{fid}/persons/{mom_person_id}",
            json={"short_description": "Миний өөрийн шинэчилсэн намтар"},
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/v1/families/{fid}/persons/{baavai['id']}",
            json={"short_description": "Зөвшөөрөлгүй засвар"},
        ).status_code
        == 403
    )

    # ------------------------------------------------------------------
    # TEST 4: Post-approval Multi-Relative Request (Father + Sibling)
    #         Verifies Dad ⚭ Mom marriage & both parents -> Түвшөө & Дүү
    # ------------------------------------------------------------------
    _login(client, "tuvshoo@example.com")
    # Tuvshoo can also self-edit his own profile and Mom's profile (he created Mom's record)
    assert (
        client.patch(
            f"/api/v1/families/{fid}/persons/{tuvshoo_person_id}",
            json={"short_description": "5-р үеийн Түвшинтулга"},
        ).status_code
        == 200
    )

    rel_req = client.post(
        "/api/v1/clan/onboarding/relatives-request",
        json={
            "relatives": [
                {
                    "relation": "parent",
                    "first_name": "АавБат",
                    "last_name": "Дорж",
                    "gender": "male",
                    "email": "aav@example.com",
                },
                {
                    "relation": "sibling",
                    "first_name": "ДүүБолд",
                    "last_name": "Дорж",
                    "gender": "male",
                    "email": "duu@example.com",
                },
            ],
            "note": "Аав ба дүүг нэмж аккаунт үүсгүүлэх хүсэлт",
        },
    )
    assert rel_req.status_code == 201, rel_req.text
    rel_req_id = rel_req.json()["id"]

    my_reqs = client.get("/api/v1/clan/onboarding/my-requests").json()
    assert any(r["id"] == rel_req_id and r["request_kind"] == "relatives" and r["status"] == "pending" for r in my_reqs)

    # Editor reviews & approves the relatives request
    _login(client, "editor@example.com")
    queue2 = client.get("/api/v1/admin/clan/onboarding/requests").json()
    assert len(queue2) == 1
    assert queue2[0]["request_kind"] == "relatives"

    rel_approve = client.post(f"/api/v1/admin/clan/onboarding/requests/{rel_req_id}/approve", json={})
    assert rel_approve.status_code == 200, rel_approve.text
    rel_res = rel_approve.json()
    assert rel_res["request_kind"] == "relatives"
    assert set(rel_res["created_accounts"]) >= {"aav@example.com", "duu@example.com"}

    with database.begin() as db:
        dad = db.scalar(select(Person).where(Person.first_name == "АавБат"))
        sib = db.scalar(select(Person).where(Person.first_name == "ДүүБолд"))
        assert dad is not None and sib is not None
        edges = db.scalars(select(ParentChildRelationship)).all()
        edge_pairs = {(str(e.parent_id), str(e.child_id)) for e in edges}
        # Dad & Mom are NOT parent-child of each other
        assert (mom_person_id, str(dad.id)) not in edge_pairs
        assert (str(dad.id), mom_person_id) not in edge_pairs
        # Both Dad & Mom are parents of both Түвшөө & Дүү
        assert (str(dad.id), tuvshoo_person_id) in edge_pairs
        assert (mom_person_id, str(sib.id)) in edge_pairs
        assert (str(dad.id), str(sib.id)) in edge_pairs
        # Dad & Mom are married
        marriages = db.scalars(select(Marriage)).all()
        marriage_pairs = {frozenset((str(m.person_1_id), str(m.person_2_id))) for m in marriages}
        assert frozenset((str(dad.id), mom_person_id)) in marriage_pairs

    # Dad & Sibling auto-accounts can both claim passwords and see the clan tree
    dad_pass = "DadPass!2026"
    _claim_auto_account_via_reset(client, email_provider, "aav@example.com", dad_pass)
    _login(client, "aav@example.com", dad_pass)
    assert client.get(f"/api/v1/families/{fid}/tree?scope=all&depth=6").status_code == 200

    # ------------------------------------------------------------------
    # TEST 5: Initial onboarding with 2 parents -> married couple, NOT parent-child chain
    # ------------------------------------------------------------------
    _register(client, email_provider, "cousin5@example.com")
    _login(client, "cousin5@example.com")
    c_req = client.post(
        "/api/v1/clan/onboarding/requests",
        json={
            "branch_person_id": baavai["id"],
            "anchor_person_id": buuvei["id"],
            "claimed_generation": 5,
            "first_name": "Үеэл",
            "gender": "female",
            "relatives": [
                {"relation": "parent", "first_name": "Аав2", "gender": "male"},
                {"relation": "parent", "first_name": "Ээж2", "gender": "female"},
            ],
        },
    )
    assert c_req.status_code == 201, c_req.text

    _login(client, "editor@example.com")
    c_app = client.post(f"/api/v1/admin/clan/onboarding/requests/{c_req.json()['id']}/approve", json={})
    assert c_app.status_code == 200, c_app.text
    cousin_pid = c_app.json()["self_person_id"]

    with database.begin() as db:
        dad2 = db.scalar(select(Person).where(Person.first_name == "Аав2"))
        mom2 = db.scalar(select(Person).where(Person.first_name == "Ээж2"))
        assert dad2 is not None and mom2 is not None
        edges = db.scalars(select(ParentChildRelationship)).all()
        edge_pairs = {(str(e.parent_id), str(e.child_id)) for e in edges}
        assert (buuvei["id"], str(dad2.id)) in edge_pairs
        assert (str(dad2.id), str(mom2.id)) not in edge_pairs
        assert (str(mom2.id), str(dad2.id)) not in edge_pairs
        assert (str(dad2.id), cousin_pid) in edge_pairs
        assert (str(mom2.id), cousin_pid) in edge_pairs
        marriages = db.scalars(select(Marriage)).all()
        marriage_pairs = {frozenset((str(m.person_1_id), str(m.person_2_id))) for m in marriages}
        assert frozenset((str(dad2.id), str(mom2.id))) in marriage_pairs

    # ------------------------------------------------------------------
    # TEST 6: Stranger / Impostor fake claim -> Editor bans -> session + re-login blocked
    # ------------------------------------------------------------------
    _register(client, email_provider, "impostor@example.com")
    _login(client, "impostor@example.com")
    impostor_session = client.cookies.get("guulingiinhan_session")
    assert impostor_session

    fake_req = client.post(
        "/api/v1/clan/onboarding/requests",
        json={
            "branch_person_id": baavai["id"],
            "anchor_person_id": baavai["id"],
            "claimed_generation": 4,
            "first_name": "ХуурамчЭтгээд",
        },
    )
    assert fake_req.status_code == 201, fake_req.text

    _login(client, "editor@example.com")
    ban_resp = client.post(
        f"/api/v1/admin/clan/onboarding/requests/{fake_req.json()['id']}/reject",
        json={"ban_user": True, "review_note": "Гадны хуурамч оролдлого"},
    )
    assert ban_resp.status_code == 200
    assert ban_resp.json()["banned"] is True

    # Verify impostor's existing session cookie is immediately invalidated
    client.cookies.clear()
    client.cookies.set("guulingiinhan_session", impostor_session)
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get(f"/api/v1/families/{fid}/tree").status_code == 401

    # Verify impostor cannot log back in
    relogin = client.post("/api/v1/auth/login", json={"email": "impostor@example.com", "password": TEST_PASSWORD})
    assert relogin.status_code in (401, 403)

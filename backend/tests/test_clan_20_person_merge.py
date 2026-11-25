from collections import defaultdict, deque
from urllib.parse import urlsplit
from uuid import UUID

from app.config import get_settings
from app.models import AdminGrant, Family, FamilyMember, UserPersonLink
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


def _claim_via_password_reset(client, email_provider, email: str, new_password: str) -> None:
    req = client.post("/api/v1/auth/password-reset/request", json={"email": email})
    assert req.status_code == 202, req.text
    delivery = next(
        item
        for item in reversed(email_provider.deliveries)
        if item.recipient == email.strip().casefold() and "нууц үг шинэчлэх" in item.subject
    )
    token = urlsplit(delivery.text.rsplit(" ", 1)[-1]).fragment.removeprefix("token=")
    conf = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": token, "new_password": new_password},
    )
    assert conf.status_code == 204, conf.text


def _add_person(client, fid: str, first_name: str, gender: str = "male", **extra) -> dict:
    payload = {"first_name": first_name, "gender": gender, **extra}
    resp = client.post(f"/api/v1/families/{fid}/persons", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _link_pc(client, fid: str, parent_id: str, child_id: str) -> None:
    resp = client.post(
        f"/api/v1/families/{fid}/relationships/parent-child",
        json={"parent_id": parent_id, "child_id": child_id},
    )
    assert resp.status_code == 201, resp.text


def _link_marriage(client, fid: str, p1_id: str, p2_id: str) -> None:
    resp = client.post(
        f"/api/v1/families/{fid}/marriages",
        json={"person_1_id": p1_id, "person_2_id": p2_id, "status": "married"},
    )
    assert resp.status_code == 201, resp.text


def test_csrf_cookie_uses_samesite_none_and_secure_in_staging(client, monkeypatch):
    get_settings.cache_clear()
    try:
        monkeypatch.setenv("APP_ENV", "staging")
        monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/guulin_staging")
        monkeypatch.setenv("CORS_ORIGINS", "https://guulingiinhan-staging.tuvshoo0331.workers.dev")
        monkeypatch.setenv("OTP_HASH_SECRET", "s" * 32)
        monkeypatch.setenv("CSRF_SECRET", "c" * 32)
        monkeypatch.setenv("SMS_PROVIDER", "disabled")
        monkeypatch.setenv("EMAIL_PROVIDER", "disabled")
        monkeypatch.setenv("EMAIL_PUBLIC_BASE_URL", "https://guulingiinhan-staging.tuvshoo0331.workers.dev")
        monkeypatch.setenv("STORAGE_PROVIDER", "s3")
        monkeypatch.setenv("STORAGE_ENDPOINT", "https://s3.example.com")
        monkeypatch.setenv("STORAGE_BUCKET", "test-bucket")
        monkeypatch.setenv("STORAGE_ACCESS_KEY", "test-access-key")
        monkeypatch.setenv("STORAGE_SECRET_KEY", "test-secret-key")
        get_settings.cache_clear()

        resp = client.get("/api/v1/auth/csrf")
        assert resp.status_code == 200
        set_cookie = resp.headers["set-cookie"].lower()
        assert "guulingiinhan_csrf=" in set_cookie
        assert "samesite=none" in set_cookie
        assert "secure" in set_cookie

        # Development environment keeps SameSite=Lax without forcing Secure
        monkeypatch.setenv("APP_ENV", "development")
        monkeypatch.setenv("STORAGE_PROVIDER", "local")
        monkeypatch.setenv("SMS_PROVIDER", "fake")
        monkeypatch.setenv("EMAIL_PROVIDER", "fake")
        get_settings.cache_clear()
        dev_resp = client.get("/api/v1/auth/csrf")
        assert dev_resp.status_code == 200
        dev_cookie = dev_resp.headers["set-cookie"].lower()
        assert "samesite=lax" in dev_cookie
    finally:
        get_settings.cache_clear()


def test_merge_already_registered_families_24_people_unified_tree(client, database, email_provider):
    # 1. Master SUPER_ADMIN sets up Main Clan (ГУУЛИНГИЙНХАН) with 7 people across Gen 1–3
    admin_id = _register(client, email_provider, "master@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    _login(client, "master@example.com")

    clan = client.post("/api/v1/families", json={"name": "ГУУЛИНГИЙНХАН"}).json()
    clan_id = clan["id"]

    yadam = _add_person(client, clan_id, "Ядамсүрэн", "male")
    gund = _add_person(client, clan_id, "Гүнд", "female")
    _link_marriage(client, clan_id, yadam["id"], gund["id"])

    baavai = _add_person(client, clan_id, "Баавай", "male")
    badamdorj = _add_person(client, clan_id, "Бадамдорж", "male")
    dolgor = _add_person(client, clan_id, "Долгор", "female")
    nansalmaa = _add_person(client, clan_id, "Нансалмаа", "female")
    for branch in (baavai, badamdorj, dolgor, nansalmaa):
        _link_pc(client, clan_id, yadam["id"], branch["id"])

    buuvei = _add_person(client, clan_id, "Бүүвэй", "male")
    _link_pc(client, clan_id, baavai["id"], buuvei["id"])

    with database.begin() as db:
        f = db.get(Family, UUID(clan_id))
        f.root_person_id = UUID(yadam["id"])

    # 2. Separate Family B (6 people, 2 accounts, 1 story, 1 archive): Долгор's descendants (attach_child)
    fb_owner_id = _register(client, email_provider, "fb_owner@example.com")
    fb_member_id = _register(client, email_provider, "fb_member@example.com")
    _login(client, "fb_owner@example.com")
    fb_id = client.post("/api/v1/families", json={"name": "Долгорын Салаа"}).json()["id"]
    b_gen3 = _add_person(client, fb_id, "Б3-Оюун", "female")
    b_gen4 = _add_person(client, fb_id, "Б4-Ганбат", "male")
    b_gen4_sp = _add_person(client, fb_id, "Б4-Туяа", "female")
    b_gen5a = _add_person(client, fb_id, "Б5-Анар", "male")
    b_gen5b = _add_person(client, fb_id, "Б5-Саруул", "female")
    b_gen6 = _add_person(client, fb_id, "Б6-Маргад", "female")
    _link_pc(client, fb_id, b_gen3["id"], b_gen4["id"])
    _link_marriage(client, fb_id, b_gen4["id"], b_gen4_sp["id"])
    _link_pc(client, fb_id, b_gen4["id"], b_gen5a["id"])
    _link_pc(client, fb_id, b_gen4["id"], b_gen5b["id"])
    _link_pc(client, fb_id, b_gen5a["id"], b_gen6["id"])

    story_resp = client.post(
        f"/api/v1/families/{fb_id}/stories",
        json={
            "title": "Долгорын салбарын түүх",
            "body": "Хөдөөнөөс хотод ирсэн дурсамж.",
            "person_ids": [b_gen3["id"], b_gen4["id"]],
        },
    )
    assert story_resp.status_code == 201, story_resp.text
    arch_resp = client.post(
        f"/api/v1/families/{fb_id}/archives",
        json={
            "title": "Хуучин гэрчилгээ",
            "description": "1972 оны баримт",
            "person_ids": [b_gen3["id"]],
        },
    )
    assert arch_resp.status_code == 201, arch_resp.text

    with database.begin() as db:
        db.add(FamilyMember(family_id=UUID(fb_id), user_id=fb_member_id, role="member"))
        db.add(UserPersonLink(user_id=fb_owner_id, person_id=UUID(b_gen3["id"]), linked_by=fb_owner_id))
        db.add(UserPersonLink(user_id=fb_member_id, person_id=UUID(b_gen4["id"]), linked_by=fb_owner_id))

    # 3. Separate Family C (6 people incl. duplicate Бадамдорж -> 5 net new, 2 accounts): merge_duplicate
    fc_owner_id = _register(client, email_provider, "fc_owner@example.com")
    fc_member_id = _register(client, email_provider, "fc_member@example.com")
    _login(client, "fc_owner@example.com")
    fc_id = client.post("/api/v1/families", json={"name": "Бадамдоржийнх"}).json()["id"]
    badam_dup = _add_person(
        client,
        fc_id,
        "Бадамдорж",
        "male",
        birth_place="Архангай",
        short_description="2-р үеийн удмын түүх",
    )
    c_gen3 = _add_person(client, fc_id, "Ц3-Дорж", "male")
    c_gen3_sp = _add_person(client, fc_id, "Ц3-Цэцэг", "female")
    c_gen4a = _add_person(client, fc_id, "Ц4-Болд", "male")
    c_gen4b = _add_person(client, fc_id, "Ц4-Нараа", "female")
    c_gen5 = _add_person(client, fc_id, "Ц5-Хүслэн", "female")
    _link_pc(client, fc_id, badam_dup["id"], c_gen3["id"])
    _link_marriage(client, fc_id, c_gen3["id"], c_gen3_sp["id"])
    _link_pc(client, fc_id, c_gen3["id"], c_gen4a["id"])
    _link_pc(client, fc_id, c_gen3["id"], c_gen4b["id"])
    _link_pc(client, fc_id, c_gen4a["id"], c_gen5["id"])

    ev_resp = client.post(
        f"/api/v1/families/{fc_id}/persons/{badam_dup['id']}/events",
        json={"event_type": "birth", "title": "Архангайд мэндэлсэн"},
    )
    assert ev_resp.status_code == 201, ev_resp.text

    with database.begin() as db:
        db.add(FamilyMember(family_id=UUID(fc_id), user_id=fc_member_id, role="member"))
        db.add(UserPersonLink(user_id=fc_owner_id, person_id=UUID(c_gen4a["id"]), linked_by=fc_owner_id))
        db.add(UserPersonLink(user_id=fc_member_id, person_id=UUID(c_gen4b["id"]), linked_by=fc_owner_id))

    # 4. Separate Family D (3 people + 1 bridge parent = 4 net new): bridge_parent under Бүүвэй
    fd_owner_id = _register(client, email_provider, "fd_owner@example.com")
    _login(client, "fd_owner@example.com")
    fd_id = client.post("/api/v1/families", json={"name": "Д5 Өрх"}).json()["id"]
    d_gen5 = _add_person(client, fd_id, "Д5-Мөнх", "male")
    d_gen5_sp = _add_person(client, fd_id, "Д5-Саран", "female")
    d_gen6 = _add_person(client, fd_id, "Д6-Ирээдүй", "male")
    _link_marriage(client, fd_id, d_gen5["id"], d_gen5_sp["id"])
    _link_pc(client, fd_id, d_gen5["id"], d_gen6["id"])
    with database.begin() as db:
        db.add(UserPersonLink(user_id=fd_owner_id, person_id=UUID(d_gen5["id"]), linked_by=fd_owner_id))

    # 5. Separate Family E (2 people, 1 account): attach_spouse to Нансалмаа
    fe_owner_id = _register(client, email_provider, "fe_owner@example.com")
    _login(client, "fe_owner@example.com")
    fe_id = client.post("/api/v1/families", json={"name": "Нансалмаагийн Хань"}).json()["id"]
    e_spouse = _add_person(client, fe_id, "Е2-Төмөр", "male")
    e_child = _add_person(client, fe_id, "Е3-Золбоо", "male")
    _link_pc(client, fe_id, e_spouse["id"], e_child["id"])
    with database.begin() as db:
        db.add(UserPersonLink(user_id=fe_owner_id, person_id=UUID(e_spouse["id"]), linked_by=fe_owner_id))

    # 6. Admin inspects merge-candidates & merges all 4 families into Main Clan (7 + 6 + 5 + 4 + 2 = 24)
    _login(client, "master@example.com")
    cand = client.get("/api/v1/admin/clan/onboarding/merge-candidates")
    assert cand.status_code == 200, cand.text
    cand_json = cand.json()
    assert cand_json["target_family"]["id"] == clan_id
    assert {s["id"] for s in cand_json["source_families"]} == {fb_id, fc_id, fd_id, fe_id}

    m_b = client.post(
        "/api/v1/admin/clan/onboarding/merge-family",
        json={
            "source_family_id": fb_id,
            "target_family_id": clan_id,
            "source_person_id": b_gen3["id"],
            "target_person_id": dolgor["id"],
            "mode": "attach_child",
        },
    )
    assert m_b.status_code == 200, m_b.text
    assert m_b.json()["moved_persons"] == 6
    assert m_b.json()["moved_members"] == 2

    m_c = client.post(
        "/api/v1/admin/clan/onboarding/merge-family",
        json={
            "source_family_id": fc_id,
            "target_family_id": clan_id,
            "source_person_id": badam_dup["id"],
            "target_person_id": badamdorj["id"],
            "mode": "merge_duplicate",
        },
    )
    assert m_c.status_code == 200, m_c.text
    assert m_c.json()["moved_persons"] == 5

    m_d = client.post(
        "/api/v1/admin/clan/onboarding/merge-family",
        json={
            "source_family_id": fd_id,
            "target_family_id": clan_id,
            "source_person_id": d_gen5["id"],
            "target_person_id": buuvei["id"],
            "mode": "bridge_parent",
            "bridge_parent": {
                "relation": "parent",
                "first_name": "Сүрэн",
                "last_name": "Бүүвэй",
                "gender": "male",
                "email": "suren@example.com",
            },
        },
    )
    assert m_d.status_code == 200, m_d.text
    assert "suren@example.com" in m_d.json()["created_accounts"]

    m_e = client.post(
        "/api/v1/admin/clan/onboarding/merge-family",
        json={
            "source_family_id": fe_id,
            "target_family_id": clan_id,
            "source_person_id": e_spouse["id"],
            "target_person_id": nansalmaa["id"],
            "mode": "attach_spouse",
        },
    )
    assert m_e.status_code == 200, m_e.text
    assert m_e.json()["total_clan_persons"] == 24

    # 7. Verify unified 24-person tree graph: 0 orphans, 0 duplicate edges, all merged fields present
    tree_resp = client.get(f"/api/v1/families/{clan_id}/tree?scope=all&depth=10&node_limit=500")
    assert tree_resp.status_code == 200, tree_resp.text
    tree = tree_resp.json()
    assert len(tree["persons"]) == 24

    person_ids = {p["id"] for p in tree["persons"]}
    adj: dict[str, set[str]] = defaultdict(set)
    pc_pairs: list[tuple[str, str]] = []
    for e in tree["parent_child_relationships"]:
        pc_pairs.append((e["parent_id"], e["child_id"]))
        adj[e["parent_id"]].add(e["child_id"])
        adj[e["child_id"]].add(e["parent_id"])
    marriage_pairs: list[frozenset[str]] = []
    for m in tree["marriages"]:
        marriage_pairs.append(frozenset((m["person_1_id"], m["person_2_id"])))
        adj[m["person_1_id"]].add(m["person_2_id"])
        adj[m["person_2_id"]].add(m["person_1_id"])

    # No duplicate edges
    assert len(pc_pairs) == len(set(pc_pairs))
    assert len(marriage_pairs) == len(set(marriage_pairs))

    # BFS from Ядамсүрэн reaches all 24 people (0 orphans!)
    visited: set[str] = {yadam["id"]}
    q: deque[str] = deque([yadam["id"]])
    while q:
        cur = q.popleft()
        for nxt in adj[cur]:
            if nxt not in visited:
                visited.add(nxt)
                q.append(nxt)
    assert visited == person_ids

    # Merged duplicate Бадамдорж inherited birth_place & short_description
    badam_detail = client.get(f"/api/v1/families/{clan_id}/persons/{badamdorj['id']}")
    assert badam_detail.status_code == 200, badam_detail.text
    merged_badam = badam_detail.json()
    assert merged_badam["birth_place"] == "Архангай"
    assert merged_badam["short_description"] == "2-р үеийн удмын түүх"

    # Source families archived & merge-candidates empty
    after_cand = client.get("/api/v1/admin/clan/onboarding/merge-candidates").json()
    assert after_cand["source_families"] == []
    assert len(after_cand["target_family"]["persons"]) == 24

    with database.begin() as db:
        for fid_str in (fb_id, fc_id, fd_id, fe_id):
            fam_row = db.get(Family, UUID(fid_str))
            assert fam_row is not None and fam_row.archived_at is not None

    # 8. Migrated story & archive & accounts (including bridge auto-account) work in unified clan
    _login(client, "fc_owner@example.com")
    assert len(client.get(f"/api/v1/families/{clan_id}/tree?scope=all&depth=10&node_limit=500").json()["persons"]) == 24
    stories = client.get(f"/api/v1/families/{clan_id}/stories").json()
    assert any(s["title"] == "Долгорын салбарын түүх" for s in stories["items"])
    archives = client.get(f"/api/v1/families/{clan_id}/archives").json()
    assert any(a["title"] == "Хуучин гэрчилгээ" for a in archives["items"])

    _claim_via_password_reset(client, email_provider, "suren@example.com", "SurenNewPass!2026")
    _login(client, "suren@example.com", "SurenNewPass!2026")
    assert len(client.get(f"/api/v1/families/{clan_id}/tree?scope=all&depth=10&node_limit=500").json()["persons"]) == 24

    for acc in ("fb_owner@example.com", "fd_owner@example.com", "fe_owner@example.com"):
        _login(client, acc)
        assert len(client.get(f"/api/v1/families/{clan_id}/tree?scope=all&depth=10&node_limit=500").json()["persons"]) == 24


def test_merge_family_safety_invariants(client, database, email_provider):
    admin_id = _register(client, email_provider, "admin2@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    _login(client, "admin2@example.com")

    clan_id = client.post("/api/v1/families", json={"name": "Үндсэн Удам"}).json()["id"]
    root_p = _add_person(client, clan_id, "Өвөг", "male")
    root_sp = _add_person(client, clan_id, "Эмэг", "female")
    _link_marriage(client, clan_id, root_p["id"], root_sp["id"])
    with database.begin() as db:
        f = db.get(Family, UUID(clan_id))
        f.root_person_id = UUID(root_p["id"])
        db.add(UserPersonLink(user_id=admin_id, person_id=UUID(root_p["id"]), linked_by=admin_id))

    other_uid = _register(client, email_provider, "other2@example.com")
    _login(client, "other2@example.com")
    other_fid = client.post("/api/v1/families", json={"name": "Бусад Өрх"}).json()["id"]
    other_p = _add_person(client, other_fid, "ХүнБ", "male")
    p1 = _add_person(client, other_fid, "ЭцэгБ", "male")
    p2 = _add_person(client, other_fid, "ЭхБ", "female")
    _link_pc(client, other_fid, p1["id"], other_p["id"])
    _link_pc(client, other_fid, p2["id"], other_p["id"])
    with database.begin() as db:
        db.add(UserPersonLink(user_id=other_uid, person_id=UUID(other_p["id"]), linked_by=other_uid))

    _login(client, "admin2@example.com")

    # 1. Self-merge rejected (422)
    r_self = client.post(
        "/api/v1/admin/clan/onboarding/merge-family",
        json={
            "source_family_id": clan_id,
            "target_family_id": clan_id,
            "source_person_id": root_p["id"],
            "target_person_id": root_p["id"],
            "mode": "attach_child",
        },
    )
    assert r_self.status_code == 422

    # 2. bridge_parent without payload rejected (422)
    r_bridge = client.post(
        "/api/v1/admin/clan/onboarding/merge-family",
        json={
            "source_family_id": other_fid,
            "target_family_id": clan_id,
            "source_person_id": other_p["id"],
            "target_person_id": root_p["id"],
            "mode": "bridge_parent",
        },
    )
    assert r_bridge.status_code == 422

    # 3. Dual UserPersonLink conflict in merge_duplicate rejected (409)
    r_dup = client.post(
        "/api/v1/admin/clan/onboarding/merge-family",
        json={
            "source_family_id": other_fid,
            "target_family_id": clan_id,
            "source_person_id": other_p["id"],
            "target_person_id": root_p["id"],
            "mode": "merge_duplicate",
        },
    )
    assert r_dup.status_code == 409

    # 4. attach_child when source_person already has 2 distinct parents rejected (409)
    r_2p = client.post(
        "/api/v1/admin/clan/onboarding/merge-family",
        json={
            "source_family_id": other_fid,
            "target_family_id": clan_id,
            "source_person_id": other_p["id"],
            "target_person_id": root_p["id"],
            "mode": "attach_child",
        },
    )
    assert r_2p.status_code == 409


def test_bootstrap_clan_root_creates_4_branches_and_is_idempotent(client, database, email_provider):
    admin_id = _register(client, email_provider, "bootstrap-root@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    _login(client, "bootstrap-root@example.com")

    first = client.post("/api/v1/admin/clan/onboarding/bootstrap-root")
    assert first.status_code == 200, first.text
    first_json = first.json()
    assert first_json["created"] is True
    assert first_json["branches"] == ["Баавай", "Бадамдорж", "Долгор", "Нансалмаа"]

    opts = client.get("/api/v1/clan/onboarding/options")
    assert opts.status_code == 200, opts.text
    branch_names = [b["name"] for b in opts.json()["branches"]]
    assert set(branch_names) == {"Баавай", "Бадамдорж", "Долгор", "Нансалмаа"}

    second = client.post("/api/v1/admin/clan/onboarding/bootstrap-root")
    assert second.status_code == 200, second.text
    assert second.json()["created"] is False
    assert second.json()["clan_family_id"] == first_json["clan_family_id"]

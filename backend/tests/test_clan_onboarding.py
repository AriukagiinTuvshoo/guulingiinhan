from uuid import UUID

from sqlalchemy import select

from app.models import AdminGrant, Family, FamilyMember, Person, User, UserPersonLink
from tests.conftest import TEST_PASSWORD, register_verified


def _register(client, email_provider, email):
    assert register_verified(client, email, TEST_PASSWORD, email_provider).status_code == 201
    return UUID(client.get("/api/v1/auth/me").json()["id"])


def _login(client, email):
    response = client.post("/api/v1/auth/login", json={"email": email, "password": TEST_PASSWORD})
    assert response.status_code == 200


def test_guided_clan_onboarding_approve_auto_account_permissions_and_ban(client, database, email_provider):
    admin_id = _register(client, email_provider, "master@example.com")
    with database.begin() as db:
        db.add(AdminGrant(user_id=admin_id, role="SUPER_ADMIN"))
    _login(client, "master@example.com")

    # Create main clan family with Ядамсүрэн -> Баавай -> Бадам
    fam = client.post("/api/v1/families", json={"name": "ГУУЛИНГИЙНХАН"}).json()
    fid = fam["id"]
    yadam = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Ядамсүрэн", "gender": "male"}).json()
    baavai = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Баавай", "gender": "male"}).json()
    badam = client.post(f"/api/v1/families/{fid}/persons", json={"first_name": "Бадам", "gender": "male"}).json()
    client.post(f"/api/v1/families/{fid}/relationships/parent-child", json={"parent_id": yadam["id"], "child_id": baavai["id"]})
    client.post(f"/api/v1/families/{fid}/relationships/parent-child", json={"parent_id": baavai["id"], "child_id": badam["id"]})
    # Set lineage root to Ядамсүрэн
    with database.begin() as db:
        f = db.get(Family, UUID(fid))
        f.root_person_id = UUID(yadam["id"])

    # New 5th-gen user registers
    user5_id = _register(client, email_provider, "gen5@example.com")
    _login(client, "gen5@example.com")

    # Privacy-safe options return branches
    opts = client.get("/api/v1/clan/onboarding/options")
    assert opts.status_code == 200
    body = opts.json()
    assert "Ядамсүрэн" in body["root_label"]
    assert any(b["name"] == "Баавай" for b in body["branches"])

    # Submit guided onboarding with missing 4th-gen Mom (with email!)
    req = client.post(
        "/api/v1/clan/onboarding/requests",
        json={
            "branch_person_id": baavai["id"],
            "anchor_person_id": badam["id"],
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
                    "email": "mom@example.com",
                }
            ],
        },
    )
    assert req.status_code == 201
    req_id = req.json()["id"]

    # Status shows pending
    st = client.get("/api/v1/clan/onboarding/status").json()
    assert st["approved"] is False
    assert st["pending_request"]["status"] == "pending"

    # Admin lists & approves in 1 click
    _login(client, "master@example.com")
    pending = client.get("/api/v1/admin/clan/onboarding/requests").json()
    assert len(pending) == 1
    approved = client.post(f"/api/v1/admin/clan/onboarding/requests/{req_id}/approve", json={})
    assert approved.status_code == 200
    res = approved.json()
    assert res["status"] == "approved"
    assert "mom@example.com" in res["created_accounts"]

    # Verify Mom's auto-account & UserPersonLink exist
    with database.begin() as db:
        mom_user = db.scalar(select(User).where(User.email == "mom@example.com"))
        assert mom_user is not None
        assert mom_user.email_verified_at is not None
        mom_link = db.scalar(select(UserPersonLink).where(UserPersonLink.user_id == mom_user.id))
        assert mom_link is not None
        mom_person_id = str(mom_link.person_id)

    # 5th-gen user can edit OWN profile AND Mom's profile (created_by == user5_id),
    # but CANNOT edit Баавай!
    _login(client, "gen5@example.com")
    assert client.patch(f"/api/v1/families/{fid}/persons/{res['self_person_id']}", json={"short_description": "Миний намтар"}).status_code == 200
    assert client.patch(f"/api/v1/families/{fid}/persons/{mom_person_id}", json={"short_description": "Ээжийн намтар"}).status_code == 200
    assert client.patch(f"/api/v1/families/{fid}/persons/{baavai['id']}", json={"short_description": "Халдлага"}).status_code == 403

    # Stranger submits fake request -> Admin rejects & bans
    stranger_id = _register(client, email_provider, "stranger@example.com")
    _login(client, "stranger@example.com")
    fake_req = client.post(
        "/api/v1/clan/onboarding/requests",
        json={
            "branch_person_id": baavai["id"],
            "anchor_person_id": baavai["id"],
            "claimed_generation": 4,
            "first_name": "Хуурамч",
        },
    ).json()

    _login(client, "master@example.com")
    ban_res = client.post(
        f"/api/v1/admin/clan/onboarding/requests/{fake_req['id']}/reject",
        json={"ban_user": True, "review_note": "Хуурамч аккаунт"},
    )
    assert ban_res.status_code == 200
    assert ban_res.json()["banned"] is True

    # Stranger cannot log in anymore
    login_banned = client.post("/api/v1/auth/login", json={"email": "stranger@example.com", "password": TEST_PASSWORD})
    assert login_banned.status_code in (401, 403)

    # SUPER_ADMIN deletes stranger account -> email is freed and can re-register!
    _login(client, "master@example.com")
    del_res = client.delete(f"/api/v1/admin/users/{stranger_id}")
    assert del_res.status_code == 204
    re_reg = client.post(
        "/api/v1/auth/register",
        json={"email": "stranger@example.com", "password": TEST_PASSWORD, "display_name": "Шинэ хэрэглэгч"},
    )
    assert re_reg.status_code == 201

    # SUPER_ADMIN deletes/archives a test family
    _login(client, "master@example.com")
    test_fam = client.post("/api/v1/families", json={"name": "BATAA turshilt 1"}).json()
    del_fam = client.delete(f"/api/v1/admin/families/{test_fam['id']}")
    assert del_fam.status_code == 204

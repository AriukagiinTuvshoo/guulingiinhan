from conftest import register_verified


def test_account_display_name_is_self_service_without_creating_person(client):
    assert client.patch("/api/v1/auth/me", json={"display_name": "Other"}).status_code == 401
    assert register_verified(client, "name@example.com").status_code == 201
    before = client.get("/api/v1/auth/me").json()
    assert before["person_id"] is None
    changed = client.patch("/api/v1/auth/me", json={"display_name": "  Удам   Судлаач  "})
    assert changed.status_code == 200
    assert changed.json()["display_name"] == "Удам Судлаач"
    assert changed.json()["person_id"] is None
    assert changed.json()["email"] == before["email"]
    assert client.patch("/api/v1/auth/me", json={"display_name": "   "}).status_code == 422
    assert client.get("/api/v1/auth/me").json()["display_name"] == "Удам Судлаач"

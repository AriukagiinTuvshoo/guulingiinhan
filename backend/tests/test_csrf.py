from conftest import register_verified

ALLOWED_ORIGIN = "http://localhost:3000"


def test_csrf_endpoint_issues_signed_cookie_and_no_store_response(client):
    response = client.get("/api/v1/auth/csrf")

    assert response.status_code == 200
    token = response.json()["csrf_token"]
    assert token.startswith("v1.")
    assert response.headers["X-CSRF-Token"] == token
    assert response.headers["cache-control"] == "no-store"
    cookie = response.cookies.get("guulingiinhan_csrf")
    assert cookie == token
    assert "httponly" not in response.headers["set-cookie"].lower()


def test_unsafe_request_without_token_is_rejected(client):
    response = client.request(
        "POST", "/api/v1/auth/logout", csrf=False,
        headers={"Origin": ALLOWED_ORIGIN},
    )

    assert response.status_code == 403
    assert response.json()["error_code"] == "CSRF_TOKEN_REQUIRED"
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN


def test_unsafe_request_with_invalid_token_is_rejected(client):
    client.get("/api/v1/auth/csrf")
    response = client.request(
        "POST",
        "/api/v1/auth/logout",
        csrf=False,
        headers={"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": "not-a-signed-token"},
    )

    assert response.status_code == 403
    assert response.json()["error_code"] == "CSRF_TOKEN_INVALID"


def test_signed_cookie_cannot_be_forged_and_expired_tokens_are_rejected():
    from app.config import Settings
    from app.csrf import issue_csrf_token, valid_csrf_token

    settings = Settings(app_env="test", csrf_secret="test-secret-with-enough-entropy")
    token = issue_csrf_token(settings, now=1_000_000)
    assert valid_csrf_token(token, settings, now=1_000_001)
    assert not valid_csrf_token(token, settings, now=1_000_000 + 7 * 24 * 60 * 60 + 1)
    forged = f"{token.rsplit('.', 1)[0]}.forged-signature"
    assert not valid_csrf_token(forged, settings, now=1_000_001)


def test_unsafe_request_without_origin_or_referer_is_rejected(client):
    token = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    response = client.request(
        "POST", "/api/v1/auth/logout", csrf=False, headers={"X-CSRF-Token": token}
    )

    assert response.status_code == 403
    assert response.json()["error_code"] == "CSRF_ORIGIN_REQUIRED"


def test_unsafe_request_with_malicious_origin_is_rejected(client):
    token = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    response = client.request(
        "POST",
        "/api/v1/auth/logout",
        csrf=False,
        headers={"Origin": "https://attacker.example", "X-CSRF-Token": token},
    )

    assert response.status_code == 403
    assert response.json()["error_code"] == "CSRF_ORIGIN_INVALID"


def test_csrf_response_exposes_token_to_allowed_cross_origin(client):
    response = client.get("/api/v1/auth/csrf", headers={"Origin": ALLOWED_ORIGIN})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "x-csrf-token" in response.headers["access-control-expose-headers"].lower()
    assert response.headers["x-csrf-token"] == response.json()["csrf_token"]


def test_cors_preflight_allows_csrf_header_from_configured_frontend(client):
    response = client.options(
        "/api/v1/auth/logout",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-csrf-token",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert "x-csrf-token" in response.headers["access-control-allow-headers"].lower()


def test_allowlisted_origin_and_valid_token_work_for_anonymous_mutation(client):
    response = client.post("/api/v1/auth/logout")

    assert response.status_code == 204


def test_allowlisted_referer_is_used_when_origin_is_absent(client):
    token = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    response = client.request(
        "POST",
        "/api/v1/auth/logout",
        csrf=False,
        headers={
            "Referer": f"{ALLOWED_ORIGIN}/login",
            "X-CSRF-Token": token,
        },
    )

    assert response.status_code == 204


def test_csrf_header_remains_valid_through_login_and_logout(client):
    register_verified(client, "csrf-session@example.com")
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401

import base64
from urllib.parse import parse_qs, urlparse, urlsplit

import httpx
import pytest
from conftest import TEST_PASSWORD
from pydantic import ValidationError
from sqlalchemy import select
from test_config import staging_settings
from test_google_oidc import FakeGoogle

from app import auth
from app.config import get_settings
from app.email import (
    AppsScriptEmailProvider,
    BrevoEmailProvider,
    EmailDeliveryError,
    GmailApiEmailProvider,
    ResendEmailProvider,
    get_email_provider,
)
from app.models import AdminGrant, User


def _prod_base(**overrides):
    values = {
        "app_env": "production",
        "csrf_secret": "c" * 40,
        "sms_provider": "twilio",
        "twilio_account_sid": "AC" + "x" * 32,
        "twilio_auth_token": "x" * 32,
        "twilio_from_number": "+12025550100",
        "email_from": "sender@gmail.com",
        "email_public_base_url": "https://guulingiinhan-staging.tuvshoo0331.workers.dev",
    }
    values.update(overrides)
    return staging_settings(**values)


def test_https_email_provider_settings_validation():
    assert staging_settings(
        email_provider="brevo",
        email_from="sender@gmail.com",
        email_api_key="xkeysib-test",
        email_public_base_url="https://staging.example",
    )
    assert staging_settings(
        email_provider="resend",
        email_from="noreply@example.com",
        email_api_key="re_test_123",
        email_public_base_url="https://staging.example",
    )
    assert _prod_base(
        email_provider="gmail_api",
        email_gmail_client_id="cid",
        email_gmail_client_secret="csec",
        email_gmail_refresh_token="rtok",
    )
    assert _prod_base(
        email_provider="apps_script",
        email_webhook_url="https://script.google.com/macros/s/AKfycb123/exec",
        email_webhook_secret="s" * 32,
    )

    for invalid in (
        {"email_provider": "brevo", "email_from": "sender@gmail.com"},
        {"email_provider": "resend", "email_from": "sender@gmail.com"},
        {
            "email_provider": "gmail_api",
            "email_from": "sender@gmail.com",
            "email_gmail_client_id": "cid",
            "email_gmail_client_secret": "csec",
        },
        {
            "email_provider": "apps_script",
            "email_from": "sender@gmail.com",
            "email_webhook_url": "https://evil.example/macros/exec",
            "email_webhook_secret": "s" * 32,
        },
        {
            "email_provider": "apps_script",
            "email_from": "sender@gmail.com",
            "email_webhook_url": "http://script.google.com/macros/s/test/exec",
            "email_webhook_secret": "s" * 32,
        },
        {
            "email_provider": "apps_script",
            "email_from": "sender@gmail.com",
            "email_webhook_url": "https://script.google.com/macros/s/test/exec",
            "email_webhook_secret": "too-short",
        },
    ):
        with pytest.raises(ValidationError):
            staging_settings(**invalid)


def test_email_auth_config_reports_https_providers(client, monkeypatch):
    get_settings.cache_clear()
    try:
        for provider, envs, expected_cls in (
            (
                "brevo",
                {"EMAIL_API_KEY": "xkeysib-abc"},
                BrevoEmailProvider,
            ),
            (
                "resend",
                {"EMAIL_API_KEY": "re_abc"},
                ResendEmailProvider,
            ),
            (
                "gmail_api",
                {
                    "EMAIL_GMAIL_CLIENT_ID": "cid",
                    "EMAIL_GMAIL_CLIENT_SECRET": "csec",
                    "EMAIL_GMAIL_REFRESH_TOKEN": "rtok",
                },
                GmailApiEmailProvider,
            ),
            (
                "apps_script",
                {
                    "EMAIL_WEBHOOK_URL": "https://script.google.com/macros/s/abc/exec",
                    "EMAIL_WEBHOOK_SECRET": "w" * 32,
                },
                AppsScriptEmailProvider,
            ),
        ):
            monkeypatch.setenv("EMAIL_PROVIDER", provider)
            monkeypatch.setenv("EMAIL_FROM", "guulin@gmail.com")
            for k, v in envs.items():
                monkeypatch.setenv(k, v)
            get_settings.cache_clear()

            assert client.get("/api/v1/auth/email/config").json() == {"enabled": True}
            assert isinstance(get_email_provider(), expected_cls)

        monkeypatch.setenv("EMAIL_PROVIDER", "disabled")
        get_settings.cache_clear()
        assert client.get("/api/v1/auth/email/config").json() == {"enabled": False}
    finally:
        get_settings.cache_clear()


def test_brevo_and_resend_providers_send_https_requests(monkeypatch):
    calls: list[dict] = []

    class FakeResp:
        def __init__(self, status_code: int = 200):
            self.status_code = status_code

        def raise_for_status(self):
            if self.status_code >= 400:
                req = httpx.Request("POST", "https://api.example.com")
                resp = httpx.Response(self.status_code, request=req)
                raise httpx.HTTPStatusError("err", request=req, response=resp)

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return FakeResp(201)

    monkeypatch.setattr("app.email.httpx.post", fake_post)

    brevo = BrevoEmailProvider("brevo-key", "tuvshoo@gmail.com", "Гуулингийнхан")
    brevo.send_verification_email("user@gmail.com", "https://example.com/#token=abc&x=1")
    assert calls[0]["url"] == "https://api.brevo.com/v3/smtp/email"
    assert calls[0]["headers"]["api-key"] == "brevo-key"
    assert calls[0]["json"]["sender"] == {"email": "tuvshoo@gmail.com", "name": "Гуулингийнхан"}
    assert calls[0]["json"]["to"] == [{"email": "user@gmail.com"}]
    assert "https://example.com/#token=abc&amp;x=1" in calls[0]["json"]["htmlContent"]

    resend = ResendEmailProvider("re_key", "noreply@guulin.mn", "Гуулингийнхан")
    resend.send_invitation_email("u@gmail.com", "<Батаа>", "https://example.com/inv")
    assert calls[1]["url"] == "https://api.resend.com/emails"
    assert calls[1]["headers"]["Authorization"] == "Bearer re_key"
    assert "&lt;Батаа&gt;" in calls[1]["json"]["html"]


def test_gmail_api_and_apps_script_providers_and_errors(monkeypatch):
    calls: list[dict] = []

    class Resp:
        def __init__(self, status_code: int, body: dict):
            self.status_code = status_code
            self._body = body

        def raise_for_status(self):
            if self.status_code >= 400:
                req = httpx.Request("POST", "https://script.google.com")
                resp = httpx.Response(self.status_code, request=req)
                raise httpx.HTTPStatusError("http error", request=req, response=resp)

        def json(self):
            return self._body

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        if "oauth2.googleapis.com/token" in url:
            return Resp(200, {"access_token": "goog-access-123"})
        if "gmail.googleapis.com" in url:
            return Resp(200, {"id": "msg-1"})
        return Resp(200, {"ok": True})

    monkeypatch.setattr("app.email.httpx.post", fake_post)

    gmail_api = GmailApiEmailProvider("cid", "csec", "rtok", "tuvshoo@gmail.com", "Гуулингийнхан")
    gmail_api.send_password_reset_email("u@gmail.com", "https://example.com/reset#token=t1")
    assert calls[0]["url"] == "https://oauth2.googleapis.com/token"
    assert calls[0]["data"]["refresh_token"] == "rtok"
    assert calls[1]["url"] == "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    assert calls[1]["headers"]["Authorization"] == "Bearer goog-access-123"
    decoded_mime = base64.urlsafe_b64decode(calls[1]["json"]["raw"]).decode("utf-8")
    assert "u@gmail.com" in decoded_mime

    relay = AppsScriptEmailProvider(
        "https://script.google.com/macros/s/test/exec",
        "s" * 32,
        "tuvshoo@gmail.com",
    )
    relay.send_verification_email("u@gmail.com", "https://example.com/verify#token=xyz")
    assert calls[2]["url"] == "https://script.google.com/macros/s/test/exec"
    assert calls[2]["follow_redirects"] is True
    assert calls[2]["json"]["secret"] == "s" * 32
    assert calls[2]["json"]["to"] == "u@gmail.com"

    def fake_fail(url, **kwargs):
        return Resp(200, {"ok": False, "error": "unauthorized"})

    monkeypatch.setattr("app.email.httpx.post", fake_fail)
    with pytest.raises(EmailDeliveryError):
        relay.send_verification_email("u@gmail.com", "https://example.com/verify")


def test_email_verification_immediately_bootstraps_super_admin(
    client, database, email_provider, monkeypatch
):
    admin_email = "tuvshoo0331@gmail.com"
    monkeypatch.setenv("ADMIN_BOOTSTRAP_EMAIL", admin_email)
    get_settings.cache_clear()
    try:
        reg = client.post(
            "/api/v1/auth/register",
            json={"email": admin_email, "password": TEST_PASSWORD, "display_name": "Түвшөө"},
        )
        assert reg.status_code == 201
        link = email_provider.deliveries[-1].text.rsplit(" ", 1)[-1]
        token = urlsplit(link).fragment.removeprefix("token=")

        confirm = client.post("/api/v1/auth/email/verification/confirm", json={"token": token})
        assert confirm.status_code == 200

        login = client.post(
            "/api/v1/auth/login",
            json={"identifier": admin_email, "password": TEST_PASSWORD},
        )
        assert login.status_code == 200
        assert client.get("/api/v1/admin/me").json()["role"] == "SUPER_ADMIN"
    finally:
        get_settings.cache_clear()


def test_google_oidc_login_immediately_bootstraps_super_admin(client, database, monkeypatch):
    admin_email = "tuvshoo0331@gmail.com"
    monkeypatch.setenv("ADMIN_BOOTSTRAP_EMAIL", admin_email)
    monkeypatch.setenv("GOOGLE_OIDC_ENABLED", "true")
    monkeypatch.setenv("GOOGLE_OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_OIDC_CLIENT_SECRET", "csec")
    monkeypatch.setenv("GOOGLE_OIDC_REDIRECT_URI", "http://localhost:8000/api/v1/auth/google/callback")
    monkeypatch.setenv("GOOGLE_OIDC_STATE_SECRET", "g" * 40)
    get_settings.cache_clear()
    try:
        monkeypatch.setattr(
            auth,
            "_google_provider",
            lambda: FakeGoogle(email=admin_email, subject="sub-admin-1"),
        )
        start = client.get("/api/v1/auth/google/start", follow_redirects=False)
        assert start.status_code == 303
        state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
        cb = client.get(
            f"/api/v1/auth/google/callback?code=test-code&state={state}",
            follow_redirects=False,
        )
        assert cb.status_code == 303
        assert "google=success" in cb.headers["location"]

        assert client.get("/api/v1/admin/me").json()["role"] == "SUPER_ADMIN"
        with database() as db:
            user = db.scalar(select(User).where(User.email == admin_email))
            assert user is not None
            grant = db.get(AdminGrant, user.id)
            assert grant is not None and grant.role == "SUPER_ADMIN"
    finally:
        get_settings.cache_clear()

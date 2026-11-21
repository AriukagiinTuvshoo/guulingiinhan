import httpx
import pytest

from app import sms as sms_module
from app.config import Settings
from app.sms import TwilioSmsProvider, get_sms_provider, validate_sms_url

VALID_URL = "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json"


def production_twilio_settings():
    return Settings(
        app_env="production",
        database_url="postgresql+psycopg://user:pass@db.example/guulingiinhan",
        cors_origins="https://guulingiinhan.mn",
        otp_hash_secret="x" * 40,
        sms_provider="twilio",
        twilio_account_sid="AC" + "x" * 32,
        twilio_auth_token="x" * 32,
        twilio_from_number="+12025550100",
        email_provider="smtp",
        email_from="no-reply@guulingiinhan.mn",
        email_public_base_url="https://guulingiinhan.mn",
        email_smtp_host="smtp.example.net",
        email_smtp_username="smtp-user",
        email_smtp_password="smtp-password",
        email_smtp_starttls=True,
        storage_provider="s3",
        storage_endpoint="https://r2.example",
        storage_bucket="guulingiinhan-media",
        storage_access_key="access-key",
        storage_secret_key="secret-key",
    )


def test_validate_sms_url_accepts_valid_https_url():
    assert validate_sms_url(VALID_URL) == VALID_URL


def test_validate_sms_url_rejects_http_url_in_production(monkeypatch):
    settings = production_twilio_settings()
    monkeypatch.setattr(sms_module, "get_settings", lambda: settings)
    provider = get_sms_provider()
    assert isinstance(provider, TwilioSmsProvider)
    # Production has no cleartext path: HTTP provider URLs are always refused.
    with pytest.raises(RuntimeError, match="SMS delivery failed"):
        validate_sms_url("http://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json")


def test_validate_sms_url_rejects_file_scheme():
    with pytest.raises(RuntimeError, match="SMS delivery failed"):
        validate_sms_url("file:///etc/passwd")


@pytest.mark.parametrize(
    "url",
    [
        "ftp://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json",
        "gopher://api.twilio.com/1",
        "ws://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json",
    ],
)
def test_validate_sms_url_rejects_unsupported_scheme(url):
    with pytest.raises(RuntimeError, match="SMS delivery failed"):
        validate_sms_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/2010-04-01/Accounts/ACtest/Messages.json",
        "https://api.twilio.com.evil.example/Messages.json",
        "https://api.twilio.com@evil.example/Messages.json",
        "https://user:pass@api.twilio.com/Messages.json",
        "https://api.twilio.com:8443/Messages.json",
    ],
)
def test_validate_sms_url_rejects_unexpected_host(url):
    with pytest.raises(RuntimeError, match="SMS delivery failed"):
        validate_sms_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "://missing-scheme",
        "https://",
        "not a url",
        "https://api.twilio.com:abc/Messages.json",
        "https://api.twilio.com/a\nb",
    ],
)
def test_validate_sms_url_rejects_malformed_url(url):
    with pytest.raises(RuntimeError, match="SMS delivery failed"):
        validate_sms_url(url)


def test_validate_sms_url_rejects_missing_url():
    with pytest.raises(RuntimeError, match="SMS delivery failed"):
        validate_sms_url("")


def test_twilio_send_otp_posts_to_validated_url(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 201

        @staticmethod
        def json():
            return {"sid": "SM123"}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return FakeResponse()

    monkeypatch.setattr(httpx, "post", fake_post)
    provider = TwilioSmsProvider("ACtest", "auth-token-value", "+12025550100")
    provider.send_otp("+97699112233", "123456", "phone_login")

    assert captured["url"] == VALID_URL
    assert captured["timeout"] == 8.0
    assert captured["follow_redirects"] is False
    assert captured["headers"]["Authorization"].startswith("Basic ")
    # The message body is form-encoded exactly as before the httpx migration.
    assert captured["data"]["To"] == "+97699112233"
    assert "123456" in captured["data"]["Body"]


def test_twilio_send_otp_wraps_transport_errors(monkeypatch):
    def fake_post(url, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "post", fake_post)
    provider = TwilioSmsProvider("ACtest", "auth-token-value", "+12025550100")
    with pytest.raises(RuntimeError, match="SMS delivery failed"):
        provider.send_otp("+97699112233", "123456", "phone_login")


def test_twilio_send_otp_wraps_rejected_status_without_leaking_body(monkeypatch):
    class FakeResponse:
        status_code = 401

        @staticmethod
        def json():
            return {"error": "Authenticate: auth-token-value"}

    monkeypatch.setattr(httpx, "post", lambda url, **kwargs: FakeResponse())
    provider = TwilioSmsProvider("ACtest", "auth-token-value", "+12025550100")
    with pytest.raises(RuntimeError, match="SMS provider rejected request") as excinfo:
        provider.send_otp("+97699112233", "123456", "phone_login")
    assert "auth-token-value" not in str(excinfo.value)


def test_twilio_send_otp_rejects_malformed_account_sid_before_network(monkeypatch):
    def fake_post(url, **kwargs):
        raise AssertionError("network call must not happen for an invalid URL")

    monkeypatch.setattr(httpx, "post", fake_post)
    provider = TwilioSmsProvider("AC\ntest", "auth-token-value", "+12025550100")
    with pytest.raises(RuntimeError, match="SMS delivery failed"):
        provider.send_otp("+97699112233", "123456", "phone_login")

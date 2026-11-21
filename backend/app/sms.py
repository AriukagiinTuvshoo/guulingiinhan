"""SMS delivery boundary. OTP values are never logged or returned to API clients."""

from __future__ import annotations

import base64
from typing import Protocol

import httpx
from fastapi import HTTPException

from app.config import get_settings

# The only host outbound SMS requests may ever reach. The full URL is
# assembled from admin-configured settings (never from API-client input)
# and re-validated immediately before every request; see validate_sms_url.
TWILIO_API_HOST = "api.twilio.com"


def validate_sms_url(url: str) -> str:
    """Return ``url`` when it targets the Twilio HTTPS API, else raise.

    Defense in depth for the outbound SMS boundary: only absolute ``https``
    URLs on ``api.twilio.com`` with the default port and no embedded
    credentials are ever requested. Cleartext HTTP, ``file:``, ``ftp:``,
    other custom schemes, unexpected hosts (including userinfo tricks such
    as ``https://api.twilio.com@evil.example``), malformed or missing URLs
    are rejected before any network I/O. There is deliberately no
    development cleartext exception: local runs use FakeSmsProvider, which
    performs no I/O at all.
    """
    try:
        parsed = httpx.URL(url)
    except (httpx.InvalidURL, TypeError, ValueError) as error:
        raise RuntimeError("SMS delivery failed") from error
    if (
        not parsed.is_absolute_url
        or parsed.scheme != "https"
        or parsed.host != TWILIO_API_HOST
        or parsed.port not in (None, 443)
        or parsed.userinfo
    ):
        raise RuntimeError("SMS delivery failed")
    return url


class SmsProvider(Protocol):
    def send_otp(self, phone: str, code: str, purpose: str) -> None: ...


class FakeSmsProvider:
    """No-op local provider; tests can subclass to capture codes in memory."""

    def send_otp(self, phone: str, code: str, purpose: str) -> None:
        return None


class TwilioSmsProvider:
    def __init__(self, account_sid: str, auth_token: str, from_number: str):
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.from_number = from_number

    def send_otp(self, phone: str, code: str, purpose: str) -> None:
        reason = {
            "phone_link": "утас баталгаажуулах",
            "phone_login": "нэвтрэх",
            "password_recovery": "нууц үг сэргээх",
        }.get(purpose, "баталгаажуулах")
        payload = {
            "To": phone,
            "From": self.from_number,
            "Body": f"Гуулингийнхан {reason} код: {code}",
        }
        credentials = base64.b64encode(f"{self.account_sid}:{self.auth_token}".encode()).decode()
        url = validate_sms_url(
            f"https://{TWILIO_API_HOST}/2010-04-01/Accounts/{self.account_sid}/Messages.json"
        )
        try:
            # follow_redirects=False: a redirect must never move the validated
            # target; trust_env=False: ignore ambient proxy configuration.
            response = httpx.post(
                url,
                data=payload,
                headers={"Authorization": f"Basic {credentials}"},
                timeout=8.0,
                follow_redirects=False,
                trust_env=False,
            )
            if response.status_code not in (200, 201):
                raise RuntimeError("SMS provider rejected request")
            response.json()
        except (httpx.HTTPError, ValueError) as error:
            # Do not propagate provider response bodies or credentials into logs/errors.
            raise RuntimeError("SMS delivery failed") from error


def get_sms_provider() -> SmsProvider:
    settings = get_settings()
    if settings.sms_provider.lower() == "disabled" and settings.app_env.lower() == "staging":
        raise HTTPException(status_code=503, detail="SMS үйлчилгээ түр боломжгүй байна.")
    if settings.sms_provider.lower() == "twilio":
        if not (
            settings.twilio_account_sid
            and settings.twilio_auth_token
            and settings.twilio_from_number
        ):
            raise RuntimeError("SMS provider is not configured")
        return TwilioSmsProvider(
            settings.twilio_account_sid,
            settings.twilio_auth_token,
            settings.twilio_from_number,
        )
    if settings.app_env.lower() == "production":
        raise RuntimeError("SMS provider is not configured")
    return FakeSmsProvider()

"""SMS delivery boundary. OTP values are never logged or returned to API clients."""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Protocol

from fastapi import HTTPException

from app.config import get_settings


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
        payload = urllib.parse.urlencode(
            {"To": phone, "From": self.from_number, "Body": f"Гуулингийнхан {reason} код: {code}"}
        ).encode()
        credentials = base64.b64encode(f"{self.account_sid}:{self.auth_token}".encode()).decode()
        request = urllib.request.Request(
            f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json",
            data=payload,
            headers={"Authorization": f"Basic {credentials}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                if response.status not in (200, 201):
                    raise RuntimeError("SMS provider rejected request")
                json.loads(response.read())
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
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

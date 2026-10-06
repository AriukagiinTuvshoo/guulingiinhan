"""Verify.MN MO-SMS boundary, based on https://www.verify.mn/.

Users send SMS; this provider never sends login codes. Unsigned callbacks and
client-supplied SMS text are never accepted as proof. Only server-side status is.
"""
from datetime import UTC, datetime
from typing import Literal, Protocol
from uuid import UUID

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError

from app.config import get_settings


class ProviderSession(BaseModel):
    sessionId: UUID
    phone: str
    shortcode: Literal["144773"]
    text: str = Field(pattern=r"^[0-9]{6}$")
    displayInstruction: str = Field(min_length=1, max_length=2000)
    expiresAt: datetime


class ProviderStatus(BaseModel):
    sessionId: UUID
    sessionStatus: Literal["PENDING", "VERIFIED", "EXPIRED"]
    verifiedAt: datetime | None = None
    expiresAt: datetime


class VerificationProvider(Protocol):
    def create(self, phone: str, text: str) -> ProviderSession: ...
    def status(self, session_id: str) -> ProviderStatus: ...


class VerifyMNProvider:
    def __init__(self, api_key: str):
        self._api_key = api_key

    def create(self, phone: str, text: str) -> ProviderSession:
        if not phone.startswith("+976") or len(phone) != 12:
            raise HTTPException(422, "Verify.MN-д Монголын утасны дугаар ашиглана уу.")
        try:
            with httpx.Client(timeout=8, follow_redirects=False, trust_env=False) as client:
                response = client.post(
                    "https://api.verify.mn/sessions",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json={"phone": phone[4:], "text": text},
                )
                response.raise_for_status()
                result = ProviderSession.model_validate(response.json())
            if result.phone != phone[4:] or result.text != text or result.expiresAt.tzinfo is None:
                raise ValueError("Provider session mismatch")
            if result.expiresAt <= datetime.now(UTC):
                raise ValueError("Expired provider session")
            return result
        except (httpx.HTTPError, ValidationError, ValueError, TypeError):
            # No provider response, URL, credentials, phone or SMS text in errors.
            raise HTTPException(503, "Утас баталгаажуулах үйлчилгээ түр боломжгүй байна.") from None

    def status(self, session_id: str) -> ProviderStatus:
        try:
            parsed_id = UUID(session_id)
            with httpx.Client(timeout=8, follow_redirects=False, trust_env=False) as client:
                response = client.get(f"https://api.verify.mn/sessions/{parsed_id}")
                response.raise_for_status()
                result = ProviderStatus.model_validate(response.json())
            if result.sessionId != parsed_id or result.expiresAt.tzinfo is None:
                raise ValueError("Provider status mismatch")
            return result
        except (httpx.HTTPError, ValidationError, ValueError, TypeError):
            raise HTTPException(503, "Баталгаажуулалтыг шалгаж чадсангүй. Дахин оролдоно уу.") from None


def get_verification_provider() -> VerificationProvider:
    key = get_settings().verify_mn_api_key
    if not key:
        raise HTTPException(503, "Утас баталгаажуулах үйлчилгээ түр боломжгүй байна.")
    return VerifyMNProvider(key)

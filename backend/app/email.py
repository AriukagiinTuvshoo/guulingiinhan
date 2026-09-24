"""Transactional email boundary with a no-op test/development provider."""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from app.config import get_settings

logger = logging.getLogger("guulingiinhan.email")


class EmailProvider(Protocol):
    def send_verification_email(self, recipient: str, link: str) -> None: ...

    def send_password_reset_email(self, recipient: str, link: str) -> None: ...

    def send_invitation_email(self, recipient: str, family_name: str, link: str) -> None: ...


@dataclass(frozen=True)
class EmailDelivery:
    recipient: str
    subject: str
    text: str


class EmailDeliveryError(RuntimeError):
    """Provider failure without exposing provider response or credentials."""


class FakeEmailProvider:
    """No-network provider. Tests may inspect its in-memory deliveries."""

    def __init__(self):
        self.deliveries: list[EmailDelivery] = []

    def _send(self, recipient: str, subject: str, text: str) -> None:
        self.deliveries.append(EmailDelivery(recipient, subject, text))

    def send_verification_email(self, recipient: str, link: str) -> None:
        self._send(
            recipient, "Гуулингийнхан — имэйл баталгаажуулах", f"Имэйлээ баталгаажуулах: {link}"
        )

    def send_password_reset_email(self, recipient: str, link: str) -> None:
        self._send(recipient, "Гуулингийнхан — нууц үг шинэчлэх", f"Нууц үгээ шинэчлэх: {link}")

    def send_invitation_email(self, recipient: str, family_name: str, link: str) -> None:
        self._send(recipient, f"{family_name} гэр бүлд урьж байна", f"Урилгыг нээх: {link}")


class SmtpEmailProvider:
    """Provider-neutral SMTP adapter for managed transactional mail relays."""

    def __init__(
        self,
        host: str,
        port: int,
        username: str | None,
        password: str | None,
        sender: str,
        starttls: bool,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.sender = sender
        self.starttls = starttls

    def _send(self, recipient: str, subject: str, text: str) -> None:
        try:
            message = EmailMessage()
            message["From"] = self.sender
            message["To"] = recipient
            message["Subject"] = subject
            message.set_content(text)
            with smtplib.SMTP(self.host, self.port, timeout=8) as client:
                client.ehlo()
                if self.starttls:
                    client.starttls(context=ssl.create_default_context())
                    client.ehlo()
                if self.username and self.password:
                    client.login(self.username, self.password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException, ValueError) as exc:
            raise EmailDeliveryError("Email delivery failed") from exc

    def send_verification_email(self, recipient: str, link: str) -> None:
        self._send(
            recipient, "Гуулингийнхан — имэйл баталгаажуулах", f"Имэйлээ баталгаажуулах: {link}"
        )

    def send_password_reset_email(self, recipient: str, link: str) -> None:
        self._send(recipient, "Гуулингийнхан — нууц үг шинэчлэх", f"Нууц үгээ шинэчлэх: {link}")

    def send_invitation_email(self, recipient: str, family_name: str, link: str) -> None:
        self._send(recipient, f"{family_name} гэр бүлд урьж байна", f"Урилгыг нээх: {link}")


def get_email_provider() -> EmailProvider:
    settings = get_settings()
    provider = settings.email_provider.lower()
    if provider == "fake":
        if settings.app_env.lower() == "production":
            raise RuntimeError("Fake email provider is not allowed in production")
        return FakeEmailProvider()
    if provider == "smtp":
        if not settings.email_from or not settings.email_smtp_host:
            raise RuntimeError("Email provider is not configured")
        return SmtpEmailProvider(
            host=settings.email_smtp_host,
            port=settings.email_smtp_port,
            username=settings.email_smtp_username,
            password=settings.email_smtp_password,
            sender=settings.email_from,
            starttls=settings.email_smtp_starttls,
        )
    raise RuntimeError("Email provider is not configured")


def send_email_safely(
    provider: EmailProvider, method_name: str, args: tuple, request_id: str | None
) -> None:
    """Send after the API response without logging message, address, or provider body."""
    try:
        getattr(provider, method_name)(*args)
    except EmailDeliveryError as exc:
        logger.warning(
            "Transactional email delivery failed",
            extra={
                "provider": get_settings().email_provider,
                "error_type": type(exc).__name__,
                "request_id": request_id,
            },
        )

"""Transactional email boundary with HTTPS relays, SMTP, and test providers."""

from __future__ import annotations

import base64
import html
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from typing import Protocol

import httpx
from fastapi import HTTPException

from app.config import Settings, get_settings

logger = logging.getLogger("guulingiinhan.email")


class EmailProvider(Protocol):
    def send_verification_email(self, recipient: str, link: str) -> None: ...

    def send_password_reset_email(self, recipient: str, link: str) -> None: ...

    def send_invitation_email(self, recipient: str, family_name: str, link: str) -> None: ...

    def send_account_invitation_email(self, recipient: str, link: str) -> None: ...


@dataclass(frozen=True)
class EmailDelivery:
    recipient: str
    subject: str
    text: str


class EmailDeliveryError(RuntimeError):
    """Provider failure without exposing provider response or credentials."""

    def __init__(self, message: str = "Email delivery failed", *, reason: str | None = None):
        super().__init__(message)
        self.reason = reason


def _render_email_html(title: str, intro: str, cta_label: str, link: str) -> str:
    safe_title = html.escape(title)
    safe_intro = html.escape(intro)
    safe_cta = html.escape(cta_label)
    safe_href = html.escape(link, quote=True)
    return (
        "<!DOCTYPE html>"
        '<html lang="mn"><body style="margin:0;padding:24px;background:#f7f2e7;'
        'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f1a14;">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #d8ccb4;'
        'border-radius:16px;overflow:hidden;">'
        '<tr><td style="padding:22px 26px;background:#163d2d;color:#f5eedc;">'
        '<strong style="font-size:17px;letter-spacing:0.06em;">ГУУЛИНГИЙНХАН</strong>'
        '<div style="font-size:12px;opacity:0.85;margin-top:4px;">Миний удам · Манай түүх</div>'
        "</td></tr>"
        '<tr><td style="padding:26px;">'
        f'<h1 style="margin:0 0 12px;font-size:20px;color:#1f1a14;">{safe_title}</h1>'
        f'<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4a433a;">{safe_intro}</p>'
        f'<p style="margin:0 0 22px;"><a href="{safe_href}" '
        'style="display:inline-block;padding:12px 22px;background:#163d2d;color:#fffdf8;'
        'text-decoration:none;font-weight:700;border-radius:10px;">'
        f"{safe_cta}</a></p>"
        '<p style="margin:0;font-size:12.5px;line-height:1.5;color:#6b6154;word-break:break-all;">'
        f"Хэрэв товч ажиллахгүй бол доорх холбоосыг хуулж нээнэ үү:<br>{safe_href}"
        "</p></td></tr></table></body></html>"
    )


def _build_mime_message(
    *,
    sender: str,
    sender_name: str,
    recipient: str,
    subject: str,
    text: str,
    html_body: str,
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = formataddr((sender_name, sender)) if sender_name else sender
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text)
    message.add_alternative(html_body, subtype="html")
    return message


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

    def send_account_invitation_email(self, recipient: str, link: str) -> None:
        self._send(recipient, "Гуулингийнхан — бүртгүүлэх урилга", f"Бүртгэл үүсгэх: {link}")


class _BaseRealEmailProvider:
    """Shared Mongolian email templates for SMTP and HTTPS delivery adapters."""

    def _send(self, recipient: str, subject: str, text: str, html_body: str) -> None:
        raise NotImplementedError

    def send_verification_email(self, recipient: str, link: str) -> None:
        self._send(
            recipient,
            "Гуулингийнхан — имэйл баталгаажуулах",
            f"Имэйлээ баталгаажуулах: {link}",
            _render_email_html(
                "Имэйл баталгаажуулах",
                "Гуулингийнхан ургийн модонд нэвтрэх имэйл хаягаа доорх товчоор баталгаажуулна уу.",
                "Имэйл баталгаажуулах",
                link,
            ),
        )

    def send_password_reset_email(self, recipient: str, link: str) -> None:
        self._send(
            recipient,
            "Гуулингийнхан — нууц үг шинэчлэх",
            f"Нууц үгээ шинэчлэх: {link}",
            _render_email_html(
                "Нууц үг шинэчлэх",
                "Таны аккаунтын нууц үгийг шинэчлэх хүсэлт ирлээ. Доорх товчоор шинэ нууц үг тохируулна уу.",
                "Нууц үг шинэчлэх",
                link,
            ),
        )

    def send_invitation_email(self, recipient: str, family_name: str, link: str) -> None:
        self._send(
            recipient,
            f"{family_name} гэр бүлд урьж байна",
            f"Урилгыг нээх: {link}",
            _render_email_html(
                f"{family_name} гэр бүлийн урилга",
                f"Таныг Гуулингийнхан ургийн модны {family_name} орчинд нэгдэхийг урьж байна.",
                "Урилгыг нээх",
                link,
            ),
        )

    def send_account_invitation_email(self, recipient: str, link: str) -> None:
        self._send(
            recipient,
            "Гуулингийнхан — бүртгүүлэх урилга",
            f"Бүртгэл үүсгэх: {link}",
            _render_email_html(
                "Ургийн модонд нэгдэх урилга",
                "Гэр бүлийн ургийн модонд таны бүртгэлийг бэлтгэлээ. Доорх товчоор нэвтэрч эсвэл нууц үгээ тохируулна уу.",
                "Бүртгэл үүсгэх",
                link,
            ),
        )


class SmtpEmailProvider(_BaseRealEmailProvider):
    """Provider-neutral SMTP adapter for managed transactional mail relays."""

    def __init__(
        self,
        host: str,
        port: int,
        username: str | None,
        password: str | None,
        sender: str,
        starttls: bool,
        sender_name: str = "Гуулингийнхан",
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.sender = sender
        self.sender_name = sender_name
        self.starttls = starttls

    def _send(self, recipient: str, subject: str, text: str, html_body: str) -> None:
        try:
            message = _build_mime_message(
                sender=self.sender,
                sender_name=self.sender_name,
                recipient=recipient,
                subject=subject,
                text=text,
                html_body=html_body,
            )
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


class BrevoEmailProvider(_BaseRealEmailProvider):
    """HTTPS transactional email delivery via Brevo REST API (port 443)."""

    ENDPOINT = "https://api.brevo.com/v3/smtp/email"

    def __init__(self, api_key: str, sender: str, sender_name: str = "Гуулингийнхан"):
        self.api_key = api_key
        self.sender = sender
        self.sender_name = sender_name

    def _send(self, recipient: str, subject: str, text: str, html_body: str) -> None:
        try:
            response = httpx.post(
                self.ENDPOINT,
                headers={
                    "api-key": self.api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "sender": {"email": self.sender, "name": self.sender_name},
                    "to": [{"email": recipient}],
                    "subject": subject,
                    "textContent": text,
                    "htmlContent": html_body,
                },
                timeout=10.0,
            )
            response.raise_for_status()
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise EmailDeliveryError("Email delivery failed") from exc


class ResendEmailProvider(_BaseRealEmailProvider):
    """HTTPS transactional email delivery via Resend REST API (port 443)."""

    ENDPOINT = "https://api.resend.com/emails"

    def __init__(self, api_key: str, sender: str, sender_name: str = "Гуулингийнхан"):
        self.api_key = api_key
        self.sender = sender
        self.sender_name = sender_name

    def _send(self, recipient: str, subject: str, text: str, html_body: str) -> None:
        try:
            response = httpx.post(
                self.ENDPOINT,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": formataddr((self.sender_name, self.sender)) if self.sender_name else self.sender,
                    "to": [recipient],
                    "subject": subject,
                    "text": text,
                    "html": html_body,
                },
                timeout=10.0,
            )
            response.raise_for_status()
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise EmailDeliveryError("Email delivery failed") from exc


class GmailApiEmailProvider(_BaseRealEmailProvider):
    """Send directly through the Gmail REST API over HTTPS (port 443)."""

    TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
    SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        sender: str,
        sender_name: str = "Гуулингийнхан",
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.sender = sender
        self.sender_name = sender_name

    def _send(self, recipient: str, subject: str, text: str, html_body: str) -> None:
        try:
            token_resp = httpx.post(
                self.TOKEN_ENDPOINT,
                data={
                    "grant_type": "refresh_token",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": self.refresh_token,
                },
                timeout=10.0,
            )
            token_resp.raise_for_status()
            access_token = token_resp.json().get("access_token")
            if not isinstance(access_token, str) or not access_token:
                raise EmailDeliveryError("Email delivery failed")

            mime_msg = _build_mime_message(
                sender=self.sender,
                sender_name=self.sender_name,
                recipient=recipient,
                subject=subject,
                text=text,
                html_body=html_body,
            )
            raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("ascii")
            send_resp = httpx.post(
                self.SEND_ENDPOINT,
                headers={"Authorization": f"Bearer {access_token}"},
                json={"raw": raw},
                timeout=10.0,
            )
            send_resp.raise_for_status()
        except EmailDeliveryError:
            raise
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
            raise EmailDeliveryError("Email delivery failed") from exc


class AppsScriptEmailProvider(_BaseRealEmailProvider):
    """Send directly from user's Gmail via Google Apps Script HTTPS Web App (port 443)."""

    def __init__(
        self,
        webhook_url: str,
        webhook_secret: str,
        sender: str,
        sender_name: str = "Гуулингийнхан",
    ):
        self.webhook_url = webhook_url
        self.webhook_secret = webhook_secret
        self.sender = sender
        self.sender_name = sender_name

    def _send(self, recipient: str, subject: str, text: str, html_body: str) -> None:
        try:
            response = httpx.post(
                self.webhook_url,
                json={
                    "secret": self.webhook_secret,
                    "to": recipient,
                    "subject": subject,
                    "text": text,
                    "html": html_body,
                    "from_name": self.sender_name,
                },
                follow_redirects=True,
                timeout=12.0,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or payload.get("ok") is not True:
                raw_err = payload.get("error") if isinstance(payload, dict) else None
                allowed = {"relay_not_configured", "unauthorized", "invalid_payload"}
                safe_reason = (
                    raw_err
                    if isinstance(raw_err, str) and raw_err in allowed
                    else "apps_script_error"
                )
                raise EmailDeliveryError("Email delivery failed", reason=safe_reason)
        except EmailDeliveryError:
            raise
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
            raise EmailDeliveryError("Email delivery failed") from exc


def is_email_delivery_configured(settings: Settings) -> bool:
    """Return True only when a real delivery adapter is completely configured."""
    provider = settings.email_provider.lower()
    if provider == "smtp":
        return all((
            settings.email_from,
            settings.email_smtp_host,
            settings.email_smtp_username,
            settings.email_smtp_password,
        ))
    if provider in {"brevo", "resend"}:
        return bool(settings.email_from and settings.email_api_key)
    if provider == "gmail_api":
        return all((
            settings.email_from,
            settings.email_gmail_client_id,
            settings.email_gmail_client_secret,
            settings.email_gmail_refresh_token,
        ))
    if provider == "apps_script":
        return bool(
            settings.email_from
            and settings.email_webhook_url
            and settings.email_webhook_secret
            and len(settings.email_webhook_secret) >= 32
        )
    return False


def get_email_provider() -> EmailProvider:
    settings = get_settings()
    provider = settings.email_provider.lower()
    if provider == "disabled" and settings.app_env.lower() == "staging":
        raise HTTPException(status_code=503, detail="Имэйл үйлчилгээ түр боломжгүй байна.")
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
            sender=str(settings.email_from),
            starttls=settings.email_smtp_starttls,
            sender_name=settings.email_from_name,
        )
    if provider == "brevo":
        if not settings.email_from or not settings.email_api_key:
            raise RuntimeError("Brevo email provider is not configured")
        return BrevoEmailProvider(
            api_key=settings.email_api_key,
            sender=str(settings.email_from),
            sender_name=settings.email_from_name,
        )
    if provider == "resend":
        if not settings.email_from or not settings.email_api_key:
            raise RuntimeError("Resend email provider is not configured")
        return ResendEmailProvider(
            api_key=settings.email_api_key,
            sender=str(settings.email_from),
            sender_name=settings.email_from_name,
        )
    if provider == "gmail_api":
        if not all((
            settings.email_from,
            settings.email_gmail_client_id,
            settings.email_gmail_client_secret,
            settings.email_gmail_refresh_token,
        )):
            raise RuntimeError("Gmail API email provider is not configured")
        return GmailApiEmailProvider(
            client_id=str(settings.email_gmail_client_id),
            client_secret=str(settings.email_gmail_client_secret),
            refresh_token=str(settings.email_gmail_refresh_token),
            sender=str(settings.email_from),
            sender_name=settings.email_from_name,
        )
    if provider == "apps_script":
        if not settings.email_from or not settings.email_webhook_url or not settings.email_webhook_secret:
            raise RuntimeError("Apps Script email provider is not configured")
        return AppsScriptEmailProvider(
            webhook_url=settings.email_webhook_url,
            webhook_secret=settings.email_webhook_secret,
            sender=str(settings.email_from),
            sender_name=settings.email_from_name,
        )
    raise RuntimeError("Email provider is not configured")


def send_email_safely(
    provider: EmailProvider, method_name: str, args: tuple, request_id: str | None
) -> None:
    """Send after the API response without logging message, address, or provider body."""
    try:
        getattr(provider, method_name)(*args)
    except EmailDeliveryError as exc:
        status_code = (
            exc.__cause__.response.status_code
            if isinstance(exc.__cause__, httpx.HTTPStatusError)
            else None
        )
        logger.warning(
            "Transactional email delivery failed",
            extra={
                "provider": get_settings().email_provider,
                "event": "email_delivery_failed",
                "error_type": type(exc).__name__,
                "cause_type": type(exc.__cause__).__name__ if exc.__cause__ else None,
                "cause_errno": getattr(exc.__cause__, "errno", None),
                "status_code": status_code,
                "reason": exc.reason,
                "request_id": request_id,
            },
        )

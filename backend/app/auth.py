"""Password authentication and short-lived signed browser sessions."""

import base64
import hashlib
import hmac
import ipaddress
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import (
    BaseModel,
    EmailStr,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)
from sqlalchemy import case, delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.email import EmailProvider, get_email_provider, send_email_safely
from app.identity import email_is_registered, find_email_user, normalize_email, normalize_phone
from app.models import (
    AuditLog,
    EmailVerificationToken,
    IdentityLinkRequest,
    LoginIdentity,
    LoginThrottle,
    PasswordResetToken,
    PhoneOtpChallenge,
    User,
    UserPersonLink,
    UserSession,
)
from app.observability import request_id_context
from app.oidc import ISSUER, GoogleOIDCProvider, OIDCError
from app.sms import SmsProvider, get_sms_provider

router = APIRouter(prefix="/auth", tags=["authentication"])
SESSION_SECONDS = 60 * 60 * 24 * 7
OTP_SECONDS = 5 * 60
OTP_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5
PASSWORD_MIN_LENGTH = 8
_OTP_DEV_SECRET = secrets.token_bytes(32)
_DUMMY_PASSWORD_HASH: str
GOOGLE_STATE_SECONDS = 600
GOOGLE_STATE_COOKIE = "guulingiinhan_google_state"
logger = logging.getLogger("guulingiinhan.auth")


class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=128)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def check_display_name(self):
        if self.display_name is not None and not self.display_name.strip():
            raise ValueError("Нэр хоосон байж болохгүй.")
        return self


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class EmailAddressInput(BaseModel):
    email: EmailStr


class EmailTokenInput(BaseModel):
    token: str = Field(min_length=40, max_length=128)


class PasswordResetConfirmInput(EmailTokenInput):
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=128)


class GenericEmailResponse(BaseModel):
    message: str


class UserOutput(BaseModel):
    id: UUID
    email: str | None
    display_name: str
    person_id: UUID | None = None


class LoginIdentityOutput(BaseModel):
    id: UUID
    provider: str
    display_identifier: str | None
    verified: bool
    created_at: datetime


class PhoneOtpRequestInput(BaseModel):
    phone: str

    @field_validator("phone")
    @classmethod
    def canonical_phone(cls, value: str) -> str:
        try:
            return normalize_phone(value)
        except ValueError as error:
            raise ValueError(str(error)) from error


class PhoneRegisterInput(PhoneOtpRequestInput):
    display_name: str = Field(min_length=1, max_length=120)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Нэр хоосон байж болохгүй.")
        return value


class PhoneOtpRequestOutput(BaseModel):
    challenge_id: UUID
    expires_in: int
    resend_after: int


class PhoneOtpVerifyInput(PhoneOtpRequestInput):
    challenge_id: UUID
    code: str = Field(pattern=r"^[0-9]{6}$")


class PhoneRegisterVerifyInput(PhoneOtpVerifyInput):
    display_name: str = Field(min_length=1, max_length=120)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Нэр хоосон байж болохгүй.")
        return value


class PasswordRecoveryInput(PhoneOtpVerifyInput):
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=128)


class PhoneLoginOutput(UserOutput):
    pass


class IdentityLinkInput(BaseModel):
    provider: str = Field(pattern="^(email|phone|google)$")
    identifier: str | None = Field(default=None, max_length=320)
    issuer: str | None = Field(default=None, max_length=500)
    subject: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def normalize_claim(self):
        if self.provider == "email":
            if not self.identifier or self.issuer or self.subject:
                raise ValueError("Имэйлийн холбоосын мэдээлэл буруу байна.")
            try:
                parsed_email = TypeAdapter(EmailStr).validate_python(self.identifier)
                self.identifier = normalize_email(str(parsed_email))
            except ValidationError as error:
                raise ValueError("Имэйл хаяг буруу байна.") from error
        elif self.provider == "phone":
            if not self.identifier or self.issuer or self.subject:
                raise ValueError("Утасны холбоосын мэдээлэл буруу байна.")
            try:
                self.identifier = normalize_phone(self.identifier)
            except ValueError as error:
                raise ValueError(str(error)) from error
        elif not self.issuer or not self.subject or self.identifier:
            raise ValueError("Google холбоосын issuer болон subject шаардлагатай.")
        return self


class IdentityLinkRequestOutput(BaseModel):
    id: UUID
    provider: str
    display_identifier: str | None
    status: str
    expires_at: datetime
    created_at: datetime


def _password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(derived).decode()}"


_DUMMY_PASSWORD_HASH = _password_hash(secrets.token_urlsafe(24))


def _password_matches(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt_b64, digest_b64 = encoded.split("$")
        if algorithm != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_b64)
        expected = base64.urlsafe_b64decode(digest_b64)
        actual = hashlib.scrypt(
            password.encode(), salt=salt, n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _otp_secret() -> bytes:
    configured = get_settings().otp_hash_secret
    if configured:
        return configured.encode()
    if get_settings().app_env.lower() == "production":
        raise RuntimeError("OTP_HASH_SECRET is required")
    return _OTP_DEV_SECRET


def _otp_digest(challenge_id: UUID, phone: str, purpose: str, code: str) -> str:
    message = f"{challenge_id}\0{phone}\0{purpose}\0{code}".encode()
    return hmac.new(_otp_secret(), message, hashlib.sha256).hexdigest()


def _otp_rate_key(kind: str, value: str) -> str:
    return hmac.new(_otp_secret(), f"rate\0{kind}\0{value}".encode(), hashlib.sha256).hexdigest()


def _normalized_ip(request: Request) -> str:
    candidate = request.client.host if request.client else "unknown"
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return "unknown"


def _consume_otp_rate(db: Session, kind: str, value: str, limit: int) -> bool:
    now = datetime.now(UTC)
    db.execute(delete(LoginThrottle).where(LoginThrottle.window_started < now - timedelta(days=7)))
    key = _otp_rate_key(kind, value)
    table = LoginThrottle.__table__
    dialect = db.get_bind().dialect.name
    insert = pg_insert if dialect == "postgresql" else sqlite_insert
    statement = insert(table).values(key_hash=key, window_started=now, attempts=1)
    fresh_window = table.c.window_started < now - timedelta(minutes=1)
    statement = statement.on_conflict_do_update(
        index_elements=[table.c.key_hash],
        set_={
            "window_started": case((fresh_window, now), else_=table.c.window_started),
            "attempts": case((fresh_window, 1), else_=table.c.attempts + 1),
        },
    ).returning(table.c.attempts)
    attempts = db.execute(statement).scalar_one()
    db.commit()
    return attempts <= limit


def _phone_identity(db: Session, phone: str) -> LoginIdentity | None:
    return db.scalar(
        select(LoginIdentity).where(
            LoginIdentity.provider == "phone",
            LoginIdentity.normalized_identifier == phone,
            LoginIdentity.verified_at.is_not(None),
            LoginIdentity.disabled_at.is_(None),
        )
    )


def _create_phone_challenge(
    *,
    db: Session,
    request: Request,
    phone: str,
    purpose: str,
    user_id: UUID | None,
    sms: SmsProvider,
) -> PhoneOtpRequestOutput:
    now = datetime.now(UTC)
    db.execute(
        delete(PhoneOtpChallenge).where(PhoneOtpChallenge.created_at < now - timedelta(days=90))
    )
    recent = db.scalar(
        select(PhoneOtpChallenge)
        .where(
            PhoneOtpChallenge.phone_e164 == phone,
            PhoneOtpChallenge.purpose == purpose,
            PhoneOtpChallenge.created_at > now - timedelta(seconds=OTP_COOLDOWN_SECONDS),
        )
        .order_by(PhoneOtpChallenge.created_at.desc())
    )
    if recent:
        raise HTTPException(status_code=429, detail="Түр хүлээгээд дахин оролдоно уу.")
    if not _consume_otp_rate(db, "phone", phone, 3):
        raise HTTPException(status_code=429, detail="Түр хүлээгээд дахин оролдоно уу.")
    if not _consume_otp_rate(db, "ip", _normalized_ip(request), 10):
        raise HTTPException(status_code=429, detail="Түр хүлээгээд дахин оролдоно уу.")
    if user_id and not _consume_otp_rate(db, "user", str(user_id), 6):
        raise HTTPException(status_code=429, detail="Түр хүлээгээд дахин оролдоно уу.")
    previous = db.scalars(
        select(PhoneOtpChallenge).where(
            PhoneOtpChallenge.phone_e164 == phone,
            PhoneOtpChallenge.purpose == purpose,
            PhoneOtpChallenge.status == "pending",
        )
    ).all()
    for item in previous:
        item.status = "superseded"
    challenge_id = UUID(bytes=secrets.token_bytes(16), version=4)
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = PhoneOtpChallenge(
        id=challenge_id,
        user_id=user_id,
        phone_e164=phone,
        purpose=purpose,
        code_hash=_otp_digest(challenge_id, phone, purpose, code),
        status="pending",
        attempt_count=0,
        max_attempts=OTP_MAX_ATTEMPTS,
        expires_at=now + timedelta(seconds=OTP_SECONDS),
        request_ip_hash=_otp_rate_key("ip", _normalized_ip(request)),
    )
    db.add(challenge)
    db.commit()
    try:
        sms.send_otp(phone, code, purpose)
    except Exception as error:
        challenge = db.get(PhoneOtpChallenge, challenge_id)
        if challenge:
            challenge.status = "expired"
            db.commit()
        raise HTTPException(
            status_code=503, detail="Код илгээж чадсангүй. Түр хүлээгээд дахин оролдоно уу."
        ) from error
    return PhoneOtpRequestOutput(
        challenge_id=challenge_id, expires_in=OTP_SECONDS, resend_after=OTP_COOLDOWN_SECONDS
    )


def _matching_otp(
    db: Session,
    *,
    challenge_id: UUID,
    phone: str,
    purpose: str,
    user_id: UUID | None,
    code: str,
) -> PhoneOtpChallenge | None:
    challenge = db.scalar(
        select(PhoneOtpChallenge)
        .where(
            PhoneOtpChallenge.id == challenge_id,
            PhoneOtpChallenge.phone_e164 == phone,
            PhoneOtpChallenge.purpose == purpose,
            PhoneOtpChallenge.status == "pending",
        )
        .with_for_update()
    )
    if challenge is None or (user_id is not None and challenge.user_id != user_id):
        return None
    now = datetime.now(UTC)
    expires = challenge.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires <= now:
        challenge.status = "expired"
        db.commit()
        return None
    if challenge.attempt_count >= challenge.max_attempts:
        challenge.status = "locked"
        db.commit()
        return None
    expected = challenge.code_hash
    supplied = _otp_digest(challenge.id, phone, purpose, code)
    if not hmac.compare_digest(expected, supplied):
        challenge.attempt_count += 1
        if challenge.attempt_count >= challenge.max_attempts:
            challenge.status = "locked"
        db.commit()
        return None
    return challenge


def _audit(db: Session, user_id: UUID, action: str, challenge: PhoneOtpChallenge) -> None:
    db.add(
        AuditLog(
            actor_id=user_id,
            action=action,
            target_type="phone_otp_challenge",
            target_id=challenge.id,
            request_id=request_id_context.get(),
        )
    )


def set_session_cookie(db: Session, response: Response, user_id: UUID) -> None:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    db.execute(delete(UserSession).where(UserSession.expires_at < now))
    db.add(
        UserSession(
            user_id=user_id,
            token_hash=_token_hash(token),
            expires_at=now + timedelta(seconds=SESSION_SECONDS),
        )
    )
    db.commit()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=settings.app_env.lower() == "production",
        samesite="none" if settings.app_env.lower() == "production" else "lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        secure=settings.app_env.lower() == "production",
        httponly=True,
        samesite="none" if settings.app_env.lower() == "production" else "lax",
    )


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Нэвтэрнэ үү.")
    session = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == _token_hash(token),
            UserSession.expires_at > datetime.now(UTC),
        )
    )
    user = db.get(User, session.user_id) if session else None
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Нэвтэрнэ үү.")
    return user


def _record_login_attempt(db: Session, email: str, ip: str) -> int:
    """Database-backed one-minute bucket, shared by all API workers."""
    now = datetime.now(UTC)
    key = hashlib.sha256(f"{email}\0{ip}".encode()).hexdigest()
    db.execute(delete(LoginThrottle).where(LoginThrottle.window_started < now - timedelta(days=7)))
    table = LoginThrottle.__table__
    dialect = db.get_bind().dialect.name
    insert = pg_insert if dialect == "postgresql" else sqlite_insert
    statement = insert(table).values(key_hash=key, window_started=now, attempts=1)
    fresh_window = table.c.window_started < now - timedelta(minutes=1)
    statement = statement.on_conflict_do_update(
        index_elements=[table.c.key_hash],
        set_={
            "window_started": case((fresh_window, now), else_=table.c.window_started),
            "attempts": case((fresh_window, 1), else_=table.c.attempts + 1),
        },
    ).returning(table.c.attempts)
    attempts = db.execute(statement).scalar_one()
    db.commit()
    return attempts


def _user_output(db: Session, user: User) -> UserOutput:
    person_id = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    return UserOutput(
        id=user.id, email=user.email, display_name=user.display_name, person_id=person_id
    )


GENERIC_VERIFICATION_MESSAGE = "Хэрэв энэ имэйлд баталгаажуулах шаардлагатай account байвал холбоос илгээнэ."
GENERIC_RESET_MESSAGE = "Хэрэв энэ имэйлд баталгаажсан account байвал нууц үг шинэчлэх холбоос илгээнэ."


def _email_request_allowed(db: Session, request: Request, purpose: str, email: str) -> bool:
    ip = _normalized_ip(request)
    email_allowed = _consume_otp_rate(db, f"{purpose}-email", email, 1)
    ip_allowed = _consume_otp_rate(db, f"{purpose}-ip", ip, 10)
    return email_allowed and ip_allowed


def _audit_auth_event(
    db: Session, user_id: UUID, action: str, target_type: str, target_id: UUID | None = None
) -> None:
    db.add(
        AuditLog(
            actor_id=user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            request_id=request_id_context.get(),
        )
    )


def _create_email_token(
    db: Session,
    user: User,
    *,
    model,
    kind: str,
    ttl_seconds: int,
    audit_action: str,
) -> str:
    now = datetime.now(UTC)
    db.execute(delete(model).where(model.created_at < now - timedelta(days=90)))
    db.execute(
        update(model)
        .where(model.user_id == user.id, model.consumed_at.is_(None))
        .values(consumed_at=now)
    )
    raw_token = secrets.token_urlsafe(32)
    row = model(
        user_id=user.id,
        token_hash=_token_hash(raw_token),
        expires_at=now + timedelta(seconds=ttl_seconds),
        created_at=now,
    )
    db.add(row)
    db.flush()
    _audit_auth_event(db, user.id, audit_action, kind, row.id)
    db.commit()
    return raw_token


def _email_link(page: str, token: str) -> str:
    base = get_settings().email_public_base_url.rstrip("/")
    return f"{base}/{page}#token={token}"


def _verified_email_identity(db: Session, user: User) -> LoginIdentity | None:
    if not user.email:
        return None
    identity = db.scalar(
        select(LoginIdentity).where(
            LoginIdentity.user_id == user.id,
            LoginIdentity.provider == "email",
            LoginIdentity.normalized_identifier == normalize_email(user.email),
            LoginIdentity.disabled_at.is_(None),
        )
    )
    if identity and identity.verified_at is None and user.email_verified_at is not None:
        identity.verified_at = user.email_verified_at
        db.commit()
    return identity if identity and identity.verified_at is not None else None


def _verification_link_for_user(
    db: Session,
    user: User,
    email_provider: EmailProvider,
    background_tasks: BackgroundTasks,
    request_id: str | None,
) -> None:
    if user.email_verified_at is not None:
        return
    identity = db.scalar(
        select(LoginIdentity).where(
            LoginIdentity.user_id == user.id,
            LoginIdentity.provider == "email",
            LoginIdentity.normalized_identifier == normalize_email(user.email),
        )
    )
    if identity is None:
        identity = LoginIdentity(
            user_id=user.id,
            provider="email",
            normalized_identifier=normalize_email(user.email),
            display_identifier=user.email,
        )
        db.add(identity)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            logger.info("Email verification skipped for conflicting identity", extra={
                "event": "email_verification_skipped", "request_id": request_id,
            })
            return
    if identity.verified_at is not None:
        if user.email_verified_at is None:
            user.email_verified_at = identity.verified_at
            db.commit()
        return
    if identity.disabled_at is not None:
        return
    settings = get_settings()
    raw_token = _create_email_token(
        db,
        user,
        model=EmailVerificationToken,
        kind="email_verification_token",
        ttl_seconds=settings.email_verification_ttl_seconds,
        audit_action="email_verification_requested",
    )
    background_tasks.add_task(
        send_email_safely,
        email_provider,
        "send_verification_email",
        (user.email, _email_link("email-verification", raw_token)),
        request_id,
    )


def _google_provider() -> GoogleOIDCProvider:
    settings = get_settings()
    if not settings.google_oidc_enabled or not all(
        (settings.google_oidc_client_id, settings.google_oidc_client_secret, settings.google_oidc_redirect_uri)
    ):
        raise HTTPException(status_code=404, detail="Google нэвтрэх боломжгүй байна.")
    return GoogleOIDCProvider(
        settings.google_oidc_client_id or "",
        settings.google_oidc_client_secret or "",
        settings.google_oidc_redirect_uri or "",
    )


def _google_state_secret() -> bytes:
    settings = get_settings()
    if settings.google_oidc_state_secret:
        return settings.google_oidc_state_secret.encode()
    # Development-only process fallback; production settings reject a missing secret.
    if settings.app_env.lower() == "production":
        raise RuntimeError("GOOGLE_OIDC_STATE_SECRET is required")
    return _OTP_DEV_SECRET


def _sign_google_state(payload: dict) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).rstrip(b"=")
    signature = hmac.new(_google_state_secret(), encoded, hashlib.sha256).digest()
    return encoded.decode() + "." + base64.urlsafe_b64encode(signature).rstrip(b"=").decode()


def _read_google_state(value: str) -> dict | None:
    try:
        encoded, supplied = value.split(".", 1)
        expected = hmac.new(_google_state_secret(), encoded.encode(), hashlib.sha256).digest()
        signature = base64.urlsafe_b64decode(supplied + "=" * (-len(supplied) % 4))
        if not hmac.compare_digest(expected, signature):
            return None
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if int(payload["iat"]) < int(datetime.now(UTC).timestamp()) - GOOGLE_STATE_SECONDS:
            return None
        if payload.get("flow") not in {"login", "link"}:
            return None
        return payload
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def _google_state_key(state: str) -> str:
    return hmac.new(_google_state_secret(), f"google-state\0{state}".encode(), hashlib.sha256).hexdigest()


def _consume_google_state(db: Session, state: str) -> bool:
    now = datetime.now(UTC)
    result = db.execute(
        update(LoginThrottle)
        .where(
            LoginThrottle.key_hash == _google_state_key(state),
            LoginThrottle.attempts == 0,
            LoginThrottle.window_started >= now - timedelta(seconds=GOOGLE_STATE_SECONDS),
        )
        .values(attempts=1)
    )
    db.commit()
    return result.rowcount == 1


def _start_google(
    flow: str, db: Session, request: Request, user_id: UUID | None = None
):
    if not _consume_otp_rate(db, "google-start", _normalized_ip(request), 10):
        raise HTTPException(status_code=429, detail="Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.")
    provider = _google_provider()
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    db.add(LoginThrottle(key_hash=_google_state_key(state), window_started=now, attempts=0))
    db.commit()
    cookie = _sign_google_state(
        {"state": state, "nonce": nonce, "flow": flow, "user_id": str(user_id) if user_id else None, "iat": int(now.timestamp())}
    )
    redirect = RedirectResponse(provider.authorization_url(state, nonce), status_code=303)
    settings = get_settings()
    redirect.set_cookie(
        GOOGLE_STATE_COOKIE,
        cookie,
        max_age=GOOGLE_STATE_SECONDS,
        httponly=True,
        secure=settings.app_env.lower() == "production",
        samesite="lax",
        path="/api/v1/auth/google/callback",
    )
    return redirect


def _google_frontend_redirect(result: str) -> RedirectResponse:
    settings = get_settings()
    origin = settings.cors_origin_list[0] if settings.cors_origin_list else "http://localhost:3000"
    path = "/dashboard" if result == "success" else "/login"
    return RedirectResponse(f"{origin}{path}?google={result}", status_code=303)


@router.get("/google/config")
def google_login_config():
    return {"enabled": get_settings().google_oidc_enabled}


@router.get("/google/start")
def google_login_start(request: Request, db: Session = Depends(get_db)):
    return _start_google("login", db, request)


@router.post("/me/google/start")
def google_link_start(
    request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return _start_google("link", db, request, user.id)


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if not _consume_otp_rate(db, "google-callback", _normalized_ip(request), 20):
        response = _google_frontend_redirect("failed")
        response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
        return response
    state_payload = _read_google_state(request.cookies.get(GOOGLE_STATE_COOKIE, ""))
    if (
        error
        or not code
        or not state
        or state_payload is None
        or not hmac.compare_digest(state, str(state_payload.get("state", "")))
        or not _consume_google_state(db, state)
    ):
        logger.info("Google OIDC callback rejected", extra={
            "event": "google_callback_rejected",
            "request_id": getattr(request.state, "request_id", None),
        })
        result = "failed"
        response = _google_frontend_redirect(result)
        response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
        return response

    try:
        provider = _google_provider()
        claims = provider.verify(provider.exchange(code), str(state_payload["nonce"]))
        subject = claims["sub"]
        email = normalize_email(str(TypeAdapter(EmailStr).validate_python(claims["email"])))
    except (OIDCError, ValidationError, ValueError, HTTPException):
        logger.info("Google OIDC claim validation failed", extra={
            "event": "google_claim_validation_failed",
            "request_id": getattr(request.state, "request_id", None),
        })
        response = _google_frontend_redirect("failed")
        response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
        return response

    flow = state_payload["flow"]
    issuer = ISSUER
    identity = db.scalar(
        select(LoginIdentity).where(
            LoginIdentity.provider == "google",
            LoginIdentity.issuer == issuer,
            LoginIdentity.subject == subject,
            LoginIdentity.disabled_at.is_(None),
        )
    )
    if flow == "link":
        try:
            expected_user_id = UUID(state_payload["user_id"])
        except (ValueError, TypeError):
            expected_user_id = None
        session_token = request.cookies.get(get_settings().session_cookie_name)
        current_session = db.scalar(
            select(UserSession).where(
                UserSession.token_hash == _token_hash(session_token or ""),
                UserSession.expires_at > datetime.now(UTC),
            )
        )
        link_user = db.get(User, expected_user_id) if expected_user_id else None
        if (
            not expected_user_id
            or not current_session
            or current_session.user_id != expected_user_id
            or not link_user
            or not link_user.is_active
        ):
            result = "failed"
        elif identity and identity.user_id != expected_user_id:
            db.add(AuditLog(actor_id=expected_user_id, action="google.identity_conflict", target_type="google_identity"))
            db.commit()
            result = "failed"
        elif identity:
            result = "success"
        else:
            db.add(LoginIdentity(
                user_id=expected_user_id, provider="google", issuer=issuer, subject=subject,
                display_identifier=email, verified_at=datetime.now(UTC),
            ))
            db.add(AuditLog(actor_id=expected_user_id, action="google.identity_linked", target_type="google_identity"))
            try:
                db.commit()
                result = "success"
            except IntegrityError:
                db.rollback()
                result = "failed"
    else:
        user = db.get(User, identity.user_id) if identity else None
        if identity and user and user.is_active:
            response = _google_frontend_redirect("success")
            set_session_cookie(db, response, user.id)
            response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
            return response
        # Verified Google email is not proof of ownership of a pre-existing app account.
        if identity is None and email_is_registered(db, email):
            result = "failed"
        elif identity is None:
            user = User(email=email, display_name=str(claims.get("name") or email.partition("@")[0])[:120],
                        password_hash=None, email_verified_at=datetime.now(UTC))
            db.add(user)
            db.flush()
            db.add(LoginIdentity(user_id=user.id, provider="google", issuer=issuer, subject=subject,
                                 display_identifier=email, verified_at=datetime.now(UTC)))
            db.add(AuditLog(actor_id=user.id, action="google.account_created", target_type="user", target_id=user.id))
            try:
                db.commit()
                response = _google_frontend_redirect("success")
                set_session_cookie(db, response, user.id)
                response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
                return response
            except IntegrityError:
                db.rollback()
                result = "failed"
        else:
            result = "failed"

    response = _google_frontend_redirect(result)
    response.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/v1/auth/google/callback")
    return response


@router.post("/register", response_model=UserOutput, status_code=status.HTTP_201_CREATED)
def register(
    body: RegisterInput,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    email_provider: EmailProvider = Depends(get_email_provider),
    db: Session = Depends(get_db),
):
    email = normalize_email(str(body.email))
    if email_is_registered(db, email):
        raise HTTPException(status_code=409, detail="Энэ имэйлээр бүртгэл үүссэн байна.")
    user = User(
        email=email,
        display_name=(body.display_name or email.partition("@")[0]).strip(),
        password_hash=_password_hash(body.password),
        email_verified_at=None,
    )
    db.add(user)
    db.flush()
    db.add(
        LoginIdentity(
            user_id=user.id,
            provider="email",
            normalized_identifier=email,
            display_identifier=str(body.email).strip(),
            verified_at=None,
        )
    )
    db.add(
        AuditLog(actor_id=user.id, action="user.registered", target_type="user", target_id=user.id)
    )
    try:
        db.commit()
    except Exception as error:
        db.rollback()
        # Covers two simultaneous registrations racing on the unique index.
        from sqlalchemy.exc import IntegrityError

        if isinstance(error, IntegrityError):
            raise HTTPException(
                status_code=409, detail="Энэ имэйлээр бүртгэл үүссэн байна."
            ) from error
        raise
    db.refresh(user)
    _verification_link_for_user(
        db, user, email_provider, background_tasks, getattr(request.state, "request_id", None)
    )
    return _user_output(db, user)


@router.post(
    "/email/verification/request", response_model=GenericEmailResponse, status_code=202
)
def request_email_verification(
    body: EmailAddressInput,
    request: Request,
    background_tasks: BackgroundTasks,
    email_provider: EmailProvider = Depends(get_email_provider),
    db: Session = Depends(get_db),
):
    email = normalize_email(str(body.email))
    if not _email_request_allowed(db, request, "email-verification", email):
        return GenericEmailResponse(message=GENERIC_VERIFICATION_MESSAGE)
    user = find_email_user(db, email)
    if user and _consume_otp_rate(db, "email-verification-account", str(user.id), 5):
        _verification_link_for_user(
            db,
            user,
            email_provider,
            background_tasks,
            getattr(request.state, "request_id", None),
        )
    return GenericEmailResponse(message=GENERIC_VERIFICATION_MESSAGE)


@router.post("/email/verification/confirm", response_model=GenericEmailResponse)
def confirm_email_verification(
    body: EmailTokenInput,
    request: Request,
    db: Session = Depends(get_db),
):
    supplied_hash = _token_hash(body.token)
    row = db.scalar(
        select(EmailVerificationToken).where(EmailVerificationToken.token_hash == supplied_hash)
    )
    now = datetime.now(UTC)
    if row is None or not hmac.compare_digest(row.token_hash, supplied_hash):
        logger.info(
            "Email verification rejected",
            extra={"event": "email_verification_rejected",
                   "request_id": getattr(request.state, "request_id", None)},
        )
        raise HTTPException(
            status_code=400,
            detail="Баталгаажуулах холбоос хүчингүй эсвэл хугацаа дууссан байна.",
        )
    user = db.get(User, row.user_id)
    identity = db.scalar(
        select(LoginIdentity).where(
            LoginIdentity.user_id == row.user_id,
            LoginIdentity.provider == "email",
            LoginIdentity.normalized_identifier == normalize_email(user.email) if user else False,
        )
    )
    consumed_user_id = db.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.id == row.id,
            EmailVerificationToken.consumed_at.is_(None),
            EmailVerificationToken.expires_at > now,
        )
        .values(consumed_at=now)
        .execution_options(synchronize_session=False)
        .returning(EmailVerificationToken.user_id)
    ).scalar_one_or_none()
    if consumed_user_id is None or user is None or identity is None or identity.disabled_at is not None:
        if user:
            _audit_auth_event(
                db,
                user.id,
                "email_verification_failed",
                "email_identity",
                identity.id if identity else None,
            )
            db.commit()
        logger.info(
            "Email verification rejected",
            extra={"event": "email_verification_rejected",
                   "request_id": getattr(request.state, "request_id", None)},
        )
        raise HTTPException(
            status_code=400,
            detail="Баталгаажуулах холбоос хүчингүй эсвэл хугацаа дууссан байна.",
        )
    identity.verified_at = now
    user.email_verified_at = now
    _audit_auth_event(db, user.id, "email_verified", "email_identity", identity.id)
    db.commit()
    return GenericEmailResponse(message="Имэйл хаяг баталгаажлаа. Одоо нэвтэрч болно.")


@router.post("/password-reset/request", response_model=GenericEmailResponse, status_code=202)
def request_email_password_reset(
    body: EmailAddressInput,
    request: Request,
    background_tasks: BackgroundTasks,
    email_provider: EmailProvider = Depends(get_email_provider),
    db: Session = Depends(get_db),
):
    email = normalize_email(str(body.email))
    if not _email_request_allowed(db, request, "email-password-reset", email):
        return GenericEmailResponse(message=GENERIC_RESET_MESSAGE)
    user = find_email_user(db, email)
    identity = _verified_email_identity(db, user) if user else None
    if user and identity:
        if _consume_otp_rate(db, "email-password-reset-account", str(user.id), 5):
            settings = get_settings()
            raw_token = _create_email_token(
                db,
                user,
                model=PasswordResetToken,
                kind="password_reset_token",
                ttl_seconds=settings.email_password_reset_ttl_seconds,
                audit_action="password_reset_requested",
            )
            background_tasks.add_task(
                send_email_safely,
                email_provider,
                "send_password_reset_email",
                (user.email, _email_link("password-reset", raw_token)),
                getattr(request.state, "request_id", None),
            )
    elif user:
        _password_matches("email-reset-enumeration-padding", _DUMMY_PASSWORD_HASH)
        _audit_auth_event(db, user.id, "password_reset_failed", "user", user.id)
        db.commit()
    else:
        _password_matches("email-reset-enumeration-padding", _DUMMY_PASSWORD_HASH)
    return GenericEmailResponse(message=GENERIC_RESET_MESSAGE)


@router.post("/password-reset/confirm", status_code=204)
def confirm_email_password_reset(
    body: PasswordResetConfirmInput,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    supplied_hash = _token_hash(body.token)
    row = db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == supplied_hash)
    )
    now = datetime.now(UTC)
    user = db.get(User, row.user_id) if row else None
    identity = _verified_email_identity(db, user) if user else None
    consumed_user_id = None
    if row is not None and hmac.compare_digest(row.token_hash, supplied_hash) and identity:
        consumed_user_id = db.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.id == row.id,
                PasswordResetToken.consumed_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
            .values(consumed_at=now)
            .execution_options(synchronize_session=False)
            .returning(PasswordResetToken.user_id)
        ).scalar_one_or_none()
    if consumed_user_id is None or user is None:
        if user:
            _audit_auth_event(db, user.id, "password_reset_failed", "password_reset_token", row.id)
            db.commit()
        logger.info(
            "Password reset rejected",
            extra={"event": "password_reset_rejected",
                   "request_id": getattr(request.state, "request_id", None)},
        )
        raise HTTPException(
            status_code=400,
            detail="Нууц үг шинэчлэх холбоос хүчингүй эсвэл хугацаа дууссан байна.",
        )
    user.password_hash = _password_hash(body.new_password)
    user.updated_at = now
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    _audit_auth_event(db, user.id, "password_reset_completed", "user", user.id)
    _audit_auth_event(db, user.id, "sessions.invalidated", "user", user.id)
    db.commit()
    clear_session_cookie(response)
    response.status_code = 204
    return response


@router.post("/login", response_model=UserOutput)
def login(body: LoginInput, request: Request, response: Response, db: Session = Depends(get_db)):
    email = normalize_email(str(body.email))
    attempts = _record_login_attempt(
        db, email, request.client.host if request.client else "unknown"
    )
    if attempts > 5:
        raise HTTPException(
            status_code=429, detail="Хэт олон оролдлого. Нэг минутын дараа дахин оролдоно уу."
        )
    user = find_email_user(db, email)
    valid = (
        user is not None
        and user.password_hash is not None
        and _password_matches(body.password, user.password_hash)
    )
    if user is None or user.password_hash is None:
        _password_matches(body.password, _DUMMY_PASSWORD_HASH)
    if not valid or user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Имэйл эсвэл нууц үг буруу байна.")
    if _verified_email_identity(db, user) is None:
        raise HTTPException(
            status_code=403,
            detail="Нэвтрэхийн өмнө имэйл хаягаа баталгаажуулна уу.",
        )
    # A successful sign-in clears the shared failure bucket for this account/client pair.
    db.execute(
        delete(LoginThrottle).where(
            LoginThrottle.key_hash
            == hashlib.sha256(
                f"{email}\0{request.client.host if request.client else 'unknown'}".encode()
            ).hexdigest()
        )
    )
    set_session_cookie(db, response, user.id)
    return _user_output(db, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(get_settings().session_cookie_name)
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == _token_hash(token)))
        db.commit()
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOutput)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _user_output(db, user)


@router.get("/me/identities", response_model=list[LoginIdentityOutput])
def list_login_identities(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    identities = db.scalars(
        select(LoginIdentity)
        .where(LoginIdentity.user_id == user.id, LoginIdentity.disabled_at.is_(None))
        .order_by(LoginIdentity.created_at)
    ).all()
    return [
        LoginIdentityOutput(
            id=item.id,
            provider=item.provider,
            display_identifier=item.display_identifier,
            verified=item.verified_at is not None,
            created_at=item.created_at,
        )
        for item in identities
    ]


@router.post(
    "/me/identity-link-requests", response_model=IdentityLinkRequestOutput, status_code=201
)
def request_identity_link(
    body: IdentityLinkInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record unverified intent only; it cannot claim or authenticate an identity."""
    now = datetime.now(UTC)
    request = IdentityLinkRequest(
        user_id=user.id,
        provider=body.provider,
        normalized_identifier=body.identifier,
        display_identifier=body.identifier,
        issuer=body.issuer,
        subject=body.subject,
        expires_at=now + timedelta(hours=24),
    )
    db.add(request)
    db.flush()
    db.add(
        AuditLog(
            actor_id=user.id,
            action="identity.link_requested",
            target_type="identity_link_request",
            target_id=request.id,
        )
    )
    db.commit()
    return IdentityLinkRequestOutput(
        id=request.id,
        provider=request.provider,
        display_identifier=request.display_identifier,
        status=request.status,
        expires_at=request.expires_at,
        created_at=request.created_at,
    )


@router.get("/me/identity-link-requests", response_model=list[IdentityLinkRequestOutput])
def list_identity_link_requests(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    now = datetime.now(UTC)
    requests = db.scalars(
        select(IdentityLinkRequest)
        .where(IdentityLinkRequest.user_id == user.id)
        .order_by(IdentityLinkRequest.created_at.desc())
    ).all()
    result = []
    changed = False
    for item in requests:
        if item.status == "pending" and item.expires_at <= now:
            item.status = "expired"
            changed = True
        result.append(
            IdentityLinkRequestOutput(
                id=item.id,
                provider=item.provider,
                display_identifier=item.display_identifier,
                status=item.status,
                expires_at=item.expires_at,
                created_at=item.created_at,
            )
        )
    if changed:
        db.commit()
    return result


@router.delete("/me/identity-link-requests/{request_id}", status_code=204)
def cancel_identity_link_request(
    request_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(IdentityLinkRequest).where(
            IdentityLinkRequest.id == request_id,
            IdentityLinkRequest.user_id == user.id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Хүсэлт олдсонгүй.")
    if item.status == "pending":
        item.status = "cancelled"
        db.add(
            AuditLog(
                actor_id=user.id,
                action="identity.link_request_cancelled",
                target_type="identity_link_request",
                target_id=item.id,
            )
        )
        db.commit()
    return Response(status_code=204)


@router.get("/phone/config")
def phone_auth_config():
    """Expose only whether real SMS delivery is configured for auth UI."""
    settings = get_settings()
    enabled = settings.sms_provider.lower() == "twilio" and all(
        (settings.twilio_account_sid, settings.twilio_auth_token, settings.twilio_from_number)
    )
    return {"enabled": enabled}


@router.post("/me/phone/request", response_model=PhoneOtpRequestOutput, status_code=202)
def request_phone_link(
    body: PhoneOtpRequestInput,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    sms: SmsProvider = Depends(get_sms_provider),
):
    phone = body.phone
    if db.scalar(
        select(LoginIdentity.id).where(
            LoginIdentity.provider == "phone",
            LoginIdentity.normalized_identifier == phone,
            LoginIdentity.disabled_at.is_(None),
        )
    ):
        db.add(
            AuditLog(
                actor_id=user.id,
                action="phone.identity_conflict",
                target_type="phone_identity",
            )
        )
        db.commit()
        raise HTTPException(status_code=409, detail="Энэ дугаарыг холбох боломжгүй.")
    response = _create_phone_challenge(
        db=db,
        request=request,
        phone=phone,
        purpose="phone_link",
        user_id=user.id,
        sms=sms,
    )
    challenge = db.get(PhoneOtpChallenge, response.challenge_id)
    _audit(db, user.id, "phone.otp_requested", challenge)
    db.commit()
    return response


@router.post("/me/phone/verify", response_model=LoginIdentityOutput)
def verify_phone_link(
    body: PhoneOtpVerifyInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    challenge = _matching_otp(
        db,
        challenge_id=body.challenge_id,
        phone=body.phone,
        purpose="phone_link",
        user_id=user.id,
        code=body.code,
    )
    if challenge is None:
        raise HTTPException(status_code=400, detail="Код буруу эсвэл хугацаа дууссан байна.")
    identity = LoginIdentity(
        user_id=user.id,
        provider="phone",
        normalized_identifier=body.phone,
        display_identifier=body.phone,
        verified_at=datetime.now(UTC),
    )
    challenge.status = "consumed"
    challenge.consumed_at = datetime.now(UTC)
    db.add(identity)
    _audit(db, user.id, "phone.otp_verified", challenge)
    _audit(db, user.id, "phone.identity_linked", challenge)
    try:
        db.commit()
    except Exception as error:
        db.rollback()
        from sqlalchemy.exc import IntegrityError

        if isinstance(error, IntegrityError):
            db.add(
                AuditLog(
                    actor_id=user.id,
                    action="phone.identity_conflict",
                    target_type="phone_identity",
                )
            )
            db.commit()
            raise HTTPException(status_code=409, detail="Энэ дугаарыг холбох боломжгүй.") from error
        raise
    db.refresh(identity)
    return LoginIdentityOutput(
        id=identity.id,
        provider=identity.provider,
        display_identifier=identity.display_identifier,
        verified=True,
        created_at=identity.created_at,
    )


@router.post("/phone/register/request", response_model=PhoneOtpRequestOutput, status_code=202)
def request_phone_registration(
    body: PhoneRegisterInput,
    request: Request,
    db: Session = Depends(get_db),
    sms: SmsProvider = Depends(get_sms_provider),
):
    identity = _phone_identity(db, body.phone)
    return _create_phone_challenge(
        db=db,
        request=request,
        phone=body.phone,
        purpose="phone_registration",
        user_id=identity.user_id if identity else None,
        sms=sms,
    )


@router.post("/phone/register/verify", response_model=UserOutput)
def verify_phone_registration(
    body: PhoneRegisterVerifyInput,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    if not _consume_otp_rate(db, "login-ip", _normalized_ip(request), 10):
        raise HTTPException(
            status_code=429, detail="Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу."
        )
    challenge = _matching_otp(
        db,
        challenge_id=body.challenge_id,
        phone=body.phone,
        purpose="phone_registration",
        user_id=None,
        code=body.code,
    )
    if challenge is None:
        raise HTTPException(status_code=400, detail="Код буруу эсвэл хугацаа дууссан байна.")

    identity = _phone_identity(db, body.phone)
    if identity is not None:
        user = db.get(User, identity.user_id)
        if user is None or not user.is_active:
            raise HTTPException(status_code=400, detail="Баталгаажуулалт дууссангүй. Дахин оролдоно уу.")
        challenge.status = "consumed"
        challenge.consumed_at = datetime.now(UTC)
        _audit(db, user.id, "phone.registration_verified_existing", challenge)
        db.commit()
        set_session_cookie(db, response, user.id)
        return _user_output(db, user)

    user = User(
        email=None,
        display_name=body.display_name,
        password_hash=None,
        email_verified_at=None,
    )
    db.add(user)
    try:
        db.flush()
        identity = LoginIdentity(
            user_id=user.id,
            provider="phone",
            normalized_identifier=body.phone,
            display_identifier=body.phone,
            verified_at=datetime.now(UTC),
        )
        challenge.user_id = user.id
        challenge.status = "consumed"
        challenge.consumed_at = datetime.now(UTC)
        db.add(identity)
        _audit_auth_event(db, user.id, "phone.registration_verified", "phone_identity", identity.id)
        db.add(
            AuditLog(
                actor_id=user.id,
                action="user.registered",
                target_type="user",
                target_id=user.id,
                request_id=request_id_context.get(),
            )
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        identity = _phone_identity(db, body.phone)
        user = db.get(User, identity.user_id) if identity else None
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=409, detail="Бүртгэлийг дуусгаж чадсангүй. Дахин оролдоно уу."
            )
        challenge = db.get(PhoneOtpChallenge, body.challenge_id)
        if challenge is not None:
            challenge.status = "consumed"
            challenge.consumed_at = datetime.now(UTC)
            _audit(db, user.id, "phone.registration_verified_existing", challenge)
            db.commit()
        else:
            raise HTTPException(status_code=409, detail="Бүртгэлийг дуусгаж чадсангүй.")
    db.refresh(user)
    set_session_cookie(db, response, user.id)
    return _user_output(db, user)


@router.post("/phone/login/request", response_model=PhoneOtpRequestOutput, status_code=202)
def request_phone_login(
    body: PhoneOtpRequestInput,
    request: Request,
    db: Session = Depends(get_db),
    sms: SmsProvider = Depends(get_sms_provider),
):
    identity = _phone_identity(db, body.phone)
    challenge = _create_phone_challenge(
        db=db,
        request=request,
        phone=body.phone,
        purpose="phone_login",
        user_id=identity.user_id if identity else None,
        sms=sms,
    )
    if identity:
        item = db.get(PhoneOtpChallenge, challenge.challenge_id)
        _audit(db, identity.user_id, "phone.otp_requested", item)
        db.commit()
    return challenge


@router.post("/phone/login/verify", response_model=PhoneLoginOutput)
def verify_phone_login(
    body: PhoneOtpVerifyInput,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    if not _consume_otp_rate(db, "login-ip", _normalized_ip(request), 10):
        raise HTTPException(
            status_code=429, detail="Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу."
        )
    challenge = _matching_otp(
        db,
        challenge_id=body.challenge_id,
        phone=body.phone,
        purpose="phone_login",
        user_id=None,
        code=body.code,
    )
    identity = _phone_identity(db, body.phone) if challenge else None
    user = db.get(User, identity.user_id) if identity else None
    if challenge is None or user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Утасны код буруу эсвэл хугацаа дууссан байна.")
    challenge.status = "consumed"
    challenge.consumed_at = datetime.now(UTC)
    _audit(db, user.id, "phone.login_verified", challenge)
    db.flush()
    set_session_cookie(db, response, user.id)
    return _user_output(db, user)


@router.post("/password-reset/phone/request", response_model=PhoneOtpRequestOutput, status_code=202)
def request_phone_recovery(
    body: PhoneOtpRequestInput,
    request: Request,
    db: Session = Depends(get_db),
    sms: SmsProvider = Depends(get_sms_provider),
):
    identity = _phone_identity(db, body.phone)
    challenge = _create_phone_challenge(
        db=db,
        request=request,
        phone=body.phone,
        purpose="password_recovery",
        user_id=identity.user_id if identity else None,
        sms=sms,
    )
    if identity:
        item = db.get(PhoneOtpChallenge, challenge.challenge_id)
        _audit(db, identity.user_id, "phone.otp_requested", item)
        db.commit()
    return challenge


@router.post("/password-reset/phone/confirm", status_code=204)
def confirm_phone_recovery(
    body: PasswordRecoveryInput,
    db: Session = Depends(get_db),
):
    challenge = _matching_otp(
        db,
        challenge_id=body.challenge_id,
        phone=body.phone,
        purpose="password_recovery",
        user_id=None,
        code=body.code,
    )
    identity = _phone_identity(db, body.phone) if challenge else None
    user = db.get(User, identity.user_id) if identity else None
    if challenge is None or user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="Сэргээх хүсэлт баталгаажаагүй байна.")
    user.password_hash = _password_hash(body.new_password)
    challenge.status = "consumed"
    challenge.consumed_at = datetime.now(UTC)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    _audit(db, user.id, "password.reset_completed", challenge)
    _audit(db, user.id, "sessions.invalidated", challenge)
    db.commit()
    return Response(status_code=204)

"""Password authentication and short-lived signed browser sessions."""

import base64
import hashlib
import hmac
import ipaddress
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import (
    BaseModel,
    EmailStr,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)
from sqlalchemy import case, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.identity import email_is_registered, find_email_user, normalize_email, normalize_phone
from app.models import (
    AuditLog,
    IdentityLinkRequest,
    LoginIdentity,
    LoginThrottle,
    PhoneOtpChallenge,
    User,
    UserPersonLink,
    UserSession,
)
from app.sms import SmsProvider, get_sms_provider

router = APIRouter(prefix="/auth", tags=["authentication"])
SESSION_SECONDS = 60 * 60 * 24 * 7
OTP_SECONDS = 5 * 60
OTP_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5
_OTP_DEV_SECRET = secrets.token_bytes(32)
_DUMMY_PASSWORD_HASH: str


class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def check_display_name(self):
        if self.display_name is not None and not self.display_name.strip():
            raise ValueError("Нэр хоосон байж болохгүй.")
        return self


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOutput(BaseModel):
    id: UUID
    email: str
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


class PhoneOtpRequestOutput(BaseModel):
    challenge_id: UUID
    expires_in: int
    resend_after: int


class PhoneOtpVerifyInput(PhoneOtpRequestInput):
    challenge_id: UUID
    code: str = Field(pattern=r"^[0-9]{6}$")


class PasswordRecoveryInput(PhoneOtpVerifyInput):
    new_password: str = Field(min_length=10, max_length=128)


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


@router.post("/register", response_model=UserOutput, status_code=status.HTTP_201_CREATED)
def register(body: RegisterInput, response: Response, db: Session = Depends(get_db)):
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
    set_session_cookie(db, response, user.id)
    return _user_output(db, user)


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
    """Indicates phone sign-in UI availability without disclosing provider settings."""
    return {"enabled": get_settings().sms_provider.lower() in {"fake", "twilio"}}


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

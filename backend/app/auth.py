"""Password authentication and short-lived signed browser sessions."""

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field, TypeAdapter, ValidationError, model_validator
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
    User,
    UserPersonLink,
    UserSession,
)

router = APIRouter(prefix="/auth", tags=["authentication"])
SESSION_SECONDS = 60 * 60 * 24 * 7
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
def list_login_identities(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
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


@router.post("/me/identity-link-requests", response_model=IdentityLinkRequestOutput, status_code=201)
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

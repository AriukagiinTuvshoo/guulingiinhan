"""Password login identities and account-bound Verify.MN ownership checks."""
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import (
    GenericEmailResponse,
    PhoneOtpRequestInput,
    PhoneRegisterInput,
    _audit_auth_event,
    _consume_otp_rate,
    _create_email_token,
    _email_link,
    _email_request_allowed,
    _ensure_user_login_allowed,
    _normalized_ip,
    _otp_digest,
    _password_hash,
    _password_matches,
    _phone_identity,
    _token_hash,
    clear_session_cookie,
    get_current_user,
)
from app.config import get_settings
from app.db import get_db
from app.email import EmailProvider, get_email_provider, send_email_safely
from app.identity import email_is_registered, normalize_email
from app.models import (
    EmailVerificationToken,
    LoginIdentity,
    PasswordResetToken,
    PhoneOtpChallenge,
    User,
    UserSession,
)
from app.verify_mn import VerificationProvider, get_verification_provider

router = APIRouter(prefix="/auth", tags=["account phone verification"])


class PhonePasswordRegister(PhoneRegisterInput):
    password: str = Field(min_length=8, max_length=128)


class PhoneStartInput(PhoneOtpRequestInput):
    current_password: str | None = Field(default=None, max_length=128)


class VerificationInput(BaseModel):
    challenge_id: UUID
    challenge_token: str = Field(min_length=32, max_length=128)


class PhoneResetInput(VerificationInput):
    new_password: str = Field(min_length=8, max_length=128)


class PhoneSessionOutput(VerificationInput):
    sms_uri: str
    display_instruction: str
    sms_text: str
    expires_in: int
    resend_after: int = 60


class VerificationState(BaseModel):
    status: Literal["pending", "verified", "expired"]


class PasswordChangeInput(BaseModel):
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


def reauthenticate(db: Session, request: Request, user: User, password: str | None) -> None:
    if not _consume_otp_rate(db, "reauth-user", str(user.id), 5):
        raise HTTPException(429, "Түр хүлээгээд дахин оролдоно уу.")
    if user.password_hash:
        if not password or not _password_matches(password, user.password_hash):
            raise HTTPException(401, "Одоогийн нууц үг буруу байна.")
    else:
        # Existing passwordless OTP/OIDC accounts may set a password only after
        # a recent authenticated login; stale cookies do not suffice.
        cookie = request.cookies.get(get_settings().session_cookie_name, "")
        recent = db.scalar(select(UserSession.id).where(
            UserSession.user_id == user.id, UserSession.token_hash == _token_hash(cookie),
            UserSession.created_at > datetime.now(UTC) - timedelta(minutes=10),
        ))
        if not recent:
            raise HTTPException(401, "Дахин нэвтэрч баталгаажуулна уу.")


@router.post("/register/phone", response_model=GenericEmailResponse, status_code=201)
def register_phone_password(body: PhonePasswordRegister, request: Request,
                            db: Session = Depends(get_db)):
    if not _consume_otp_rate(db, "phone-register-ip", _normalized_ip(request), 5):
        raise HTTPException(429, "Түр хүлээгээд дахин оролдоно уу.")
    # Apply password work on both paths; generic output does not disclose ownership.
    encoded = _password_hash(body.password)
    existing = db.scalar(select(LoginIdentity.id).where(
        LoginIdentity.provider == "phone", LoginIdentity.normalized_identifier == body.phone,
    ))
    if not existing:
        user = User(display_name=body.display_name, password_hash=encoded)
        db.add(user)
        db.flush()
        db.add(LoginIdentity(user_id=user.id, provider="phone",
                             normalized_identifier=body.phone, display_identifier=body.phone))
        _audit_auth_event(db, user.id, "phone.password_registered", "user", user.id)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return GenericEmailResponse(message="Хүсэлтийг хүлээн авлаа. Нэвтэрсний дараа тохиргооноос утсаа баталгаажуулна уу.")


def _start(db: Session, request: Request, phone: str, purpose: str,
           user_id: UUID | None, provider: VerificationProvider) -> PhoneSessionOutput:
    now = datetime.now(UTC)
    recent = db.scalar(select(PhoneOtpChallenge.id).where(
        PhoneOtpChallenge.phone_e164 == phone, PhoneOtpChallenge.purpose == purpose,
        PhoneOtpChallenge.created_at > now - timedelta(seconds=60),
    ))
    if recent or not _consume_otp_rate(db, "verify-phone", phone, 3):
        raise HTTPException(429, "Түр хүлээгээд дахин оролдоно уу.")
    if not _consume_otp_rate(db, "verify-ip", _normalized_ip(request), 10):
        raise HTTPException(429, "Түр хүлээгээд дахин оролдоно уу.")
    if user_id and not _consume_otp_rate(db, "verify-user", str(user_id), 6):
        raise HTTPException(429, "Түр хүлээгээд дахин оролдоно уу.")
    token = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = PhoneOtpChallenge(
        id=UUID(bytes=secrets.token_bytes(16), version=4), phone_e164=phone,
        user_id=user_id, purpose=purpose, status="pending", expires_at=now + timedelta(seconds=300),
    )
    # The client capability is hashed, distinct from displayed MO-SMS text.
    challenge.code_hash = _otp_digest(challenge.id, phone, purpose, token)
    previous = db.scalars(select(PhoneOtpChallenge).where(
        PhoneOtpChallenge.phone_e164 == phone, PhoneOtpChallenge.purpose == purpose,
        PhoneOtpChallenge.status == "pending",
    )).all()
    for item in previous:
        item.status = "superseded"
    db.add(challenge)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(429, "Түр хүлээгээд дахин оролдоно уу.") from None
    try:
        session = provider.create(phone, code)
        challenge.provider_session_id = str(session.sessionId)
        challenge.expires_at = min(session.expiresAt, now + timedelta(seconds=300))
        if user_id:
            _audit_auth_event(db, user_id, "phone.verification_requested", "phone_otp_challenge", challenge.id)
        db.commit()
    except Exception:
        challenge.status = "expired"
        db.commit()
        raise
    return PhoneSessionOutput(challenge_id=challenge.id, challenge_token=token,
        sms_uri=f"sms:144773?body={code}", sms_text=code,
        display_instruction=session.displayInstruction,
        expires_in=max(0, int((challenge.expires_at - now).total_seconds())))


@router.post("/me/phone/verification/request", response_model=PhoneSessionOutput, status_code=202)
def start_phone_verification(body: PhoneStartInput, request: Request,
                            user: User = Depends(get_current_user), db: Session = Depends(get_db),
                            provider: VerificationProvider = Depends(get_verification_provider)):
    reauthenticate(db, request, user, body.current_password)
    existing = db.scalar(select(LoginIdentity).where(
        LoginIdentity.provider == "phone", LoginIdentity.normalized_identifier == body.phone,
    ))
    if existing and (existing.user_id != user.id or existing.disabled_at is not None):
        raise HTTPException(409, "Энэ дугаарыг холбох боломжгүй байна.")
    if existing and existing.verified_at:
        raise HTTPException(409, "Энэ утасны дугаар аль хэдийн баталгаажсан байна.")
    return _start(db, request, body.phone, "phone_link", user.id, provider)


def _check(db: Session, body: VerificationInput, purpose: str, user_id: UUID | None,
           provider: VerificationProvider) -> tuple[PhoneOtpChallenge, Literal["pending", "verified", "expired"]]:
    row = db.scalar(select(PhoneOtpChallenge).where(
        PhoneOtpChallenge.id == body.challenge_id, PhoneOtpChallenge.purpose == purpose,
    ).with_for_update())
    if (row is None or not row.provider_session_id
        or (user_id is not None and row.user_id != user_id)
        or not hmac.compare_digest(row.code_hash,
            _otp_digest(row.id, row.phone_e164, purpose, body.challenge_token))):
        raise HTTPException(400, "Баталгаажуулах хүсэлт хүчингүй байна.")
    now = datetime.now(UTC)
    expires = row.expires_at.replace(tzinfo=UTC) if row.expires_at.tzinfo is None else row.expires_at
    if row.status != "pending" or expires <= now:
        if row.status == "pending":
            row.status = "expired"
            db.commit()
        return row, "expired"
    if row.provider_checked_at:
        checked = row.provider_checked_at.replace(tzinfo=UTC) if row.provider_checked_at.tzinfo is None else row.provider_checked_at
        if checked > now - timedelta(seconds=3):
            raise HTTPException(429, "3 секунд хүлээгээд дахин шалгана уу.")
    result = provider.status(row.provider_session_id)
    row.provider_checked_at = now
    if str(result.sessionId) != row.provider_session_id or result.expiresAt <= now:
        row.status = "expired"
        db.commit()
        return row, "expired"
    if result.sessionStatus == "EXPIRED":
        row.status = "expired"
        db.commit()
        return row, "expired"
    if result.sessionStatus == "VERIFIED":
        if (not result.verifiedAt or result.verifiedAt.tzinfo is None
            or result.verifiedAt > now or result.verifiedAt > expires):
            raise HTTPException(503, "Баталгаажуулалтыг шалгаж чадсангүй.")
        return row, "verified"
    db.commit()
    return row, "pending"


@router.post("/me/phone/verification/confirm", response_model=VerificationState)
def confirm_phone_verification(body: VerificationInput, request: Request, user: User = Depends(get_current_user),
                              db: Session = Depends(get_db),
                              provider: VerificationProvider = Depends(get_verification_provider)):
    row, state = _check(db, body, "phone_link", user.id, provider)
    if state != "verified":
        return VerificationState(status=state)
    # Lock account row too: concurrent verifications must not create two active phone identities.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    owned = db.scalars(select(LoginIdentity).where(
        LoginIdentity.user_id == user.id, LoginIdentity.provider == "phone",
    ).with_for_update()).all()
    target = next((item for item in owned if item.normalized_identifier == row.phone_e164), None)
    if target is None:
        target = LoginIdentity(user_id=user.id, provider="phone", normalized_identifier=row.phone_e164,
                               display_identifier=row.phone_e164)
        db.add(target)
    for item in owned:
        if item is not target:
            item.disabled_at = datetime.now(UTC)
    target.disabled_at = None
    target.verified_at = datetime.now(UTC)
    row.status = "consumed"
    row.consumed_at = datetime.now(UTC)
    # Existing reset capabilities and other sessions must not retain an old identity.
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
    cookie = request.cookies.get(get_settings().session_cookie_name, "")
    db.execute(delete(UserSession).where(UserSession.user_id == user.id,
                                         UserSession.token_hash != _token_hash(cookie)))
    for other in db.scalars(select(PhoneOtpChallenge).where(
        PhoneOtpChallenge.user_id == user.id, PhoneOtpChallenge.status == "pending",
        PhoneOtpChallenge.id != row.id,
    )).all():
        other.status = "superseded"
    _audit_auth_event(db, user.id, "phone.verified_or_changed", "phone_otp_challenge", row.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Энэ дугаарыг холбох боломжгүй байна.") from None
    return VerificationState(status="verified")


@router.post("/password-reset/phone/verification/request", response_model=PhoneSessionOutput, status_code=202)
def start_phone_reset(body: PhoneOtpRequestInput, request: Request, db: Session = Depends(get_db),
                      provider: VerificationProvider = Depends(get_verification_provider)):
    identity = _phone_identity(db, body.phone)
    # Same provider request and response for unknown, inactive and known numbers.
    return _start(db, request, body.phone, "password_recovery",
                  identity.user_id if identity else None, provider)


@router.post("/password-reset/phone/verification/confirm", status_code=204)
def finish_phone_reset(body: PhoneResetInput, db: Session = Depends(get_db),
                       provider: VerificationProvider = Depends(get_verification_provider)):
    row, state = _check(db, body, "password_recovery", None, provider)
    identity = _phone_identity(db, row.phone_e164)
    user = db.get(User, row.user_id) if row.user_id else None
    if (state != "verified" or not identity or not user or not user.is_active
        or identity.user_id != user.id):
        raise HTTPException(400, "Сэргээх хүсэлт баталгаажаагүй байна.")
    _ensure_user_login_allowed(db, user)
    user.password_hash = _password_hash(body.new_password)
    row.status = "consumed"
    row.consumed_at = datetime.now(UTC)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
    for other in db.scalars(select(PhoneOtpChallenge).where(
        PhoneOtpChallenge.user_id == user.id, PhoneOtpChallenge.status == "pending",
    )).all():
        other.status = "superseded"
    _audit_auth_event(db, user.id, "password.reset_completed", "phone_otp_challenge", row.id)
    db.commit()
    return Response(status_code=204)


@router.post("/me/password", status_code=204)
def change_password(body: PasswordChangeInput, request: Request, response: Response,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    reauthenticate(db, request, user, body.current_password)
    user.password_hash = _password_hash(body.new_password)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
    for item in db.scalars(select(PhoneOtpChallenge).where(
        PhoneOtpChallenge.user_id == user.id, PhoneOtpChallenge.status == "pending",
    )).all():
        item.status = "superseded"
    _audit_auth_event(db, user.id, "password.changed", "user", user.id)
    db.commit()
    clear_session_cookie(response)
    response.status_code = 204
    return response


class EmailChangeInput(BaseModel):
    email: EmailStr
    current_password: str | None = Field(default=None, max_length=128)


def request_email_change(db: Session, request: Request, target: User, email: str,
                         provider: EmailProvider, background: BackgroundTasks) -> None:
    if not _email_request_allowed(db, request, "email-change", email):
        raise HTTPException(429, "Түр хүлээгээд дахин оролдоно уу.")
    if email == target.email or email_is_registered(db, email):
        raise HTTPException(409, "Энэ имэйлийг холбох боломжгүй байна.")
    token = _create_email_token(db, target, model=EmailVerificationToken,
        kind="email_verification_token", ttl_seconds=get_settings().email_verification_ttl_seconds,
        audit_action="email.change_requested")
    row = db.scalar(select(EmailVerificationToken).where(EmailVerificationToken.token_hash == _token_hash(token)))
    if row is None:
        raise HTTPException(503, "Баталгаажуулах хүсэлт үүссэнгүй.")
    row.target_email = email
    db.commit()
    background.add_task(send_email_safely, provider, "send_verification_email",
                        (email, _email_link("email-verification", token)),
                        getattr(request.state, "request_id", None))


@router.post("/me/email/request", response_model=GenericEmailResponse, status_code=202)
def change_email(body: EmailChangeInput, request: Request, background: BackgroundTasks,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db),
                 provider: EmailProvider = Depends(get_email_provider)):
    reauthenticate(db, request, user, body.current_password)
    request_email_change(db, request, user, normalize_email(str(body.email)), provider, background)
    return GenericEmailResponse(message="Шинэ имэйлд баталгаажуулах холбоос илгээнэ. Баталгаажих хүртэл хуучин хаяг хэвээр үлдэнэ.")

"""Global administration. Family membership never grants these permissions."""

import logging
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import _consume_otp_rate, get_current_user, normalize_email
from app.config import get_settings
from app.db import SessionLocal, get_db
from app.email import EmailDeliveryError, EmailProvider, get_email_provider
from app.models import (
    AdminBootstrap,
    AdminGrant,
    AuditLog,
    Family,
    FamilyMember,
    FamilyPerson,
    LoginIdentity,
    Person,
    Story,
    User,
    UserPersonLink,
    UserSession,
)


class AdminRole(StrEnum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN = "ADMIN"
    MODERATOR = "MODERATOR"


router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger("guulingiinhan.admin")


class AdminIdentity(BaseModel):
    user_id: UUID
    email: str | None
    display_name: str
    role: AdminRole


class AdminOverview(BaseModel):
    users: int
    families: int
    admins: int


class AdminUser(BaseModel):
    id: UUID
    display_name: str
    email: str | None
    is_active: bool
    created_at: datetime


class AdminFamily(BaseModel):
    id: UUID
    name: str
    created_at: datetime


class AdminAccount(AdminUser):
    role: AdminRole


class AdminRoleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: AdminRole


class AdminUserStatusInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: bool


class AdminUserProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(min_length=1, max_length=120)


class AdminAuditEvent(BaseModel):
    id: UUID
    action: str
    target_type: str
    target_id: UUID | None
    family_id: UUID | None
    actor_name: str
    created_at: datetime


class AdminAccountInviteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr


class AdminMembership(BaseModel):
    family_id: UUID
    family_name: str
    role: str


class AdminLinkedPerson(BaseModel):
    id: UUID
    family_id: UUID
    first_name: str
    last_name: str


class AdminUserDetail(AdminUser):
    email_verified: bool
    admin_role: AdminRole | None
    memberships: list[AdminMembership]
    linked_people: list[AdminLinkedPerson]


class AdminStory(BaseModel):
    id: UUID
    family_id: UUID
    title: str
    body: str
    visibility: str
    created_at: datetime


class AdminStoryEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=100000)


def bootstrap_admin_roles() -> None:
    """Grant initial roles once, from verified accounts named by runtime secrets.

    The durable marker prevents re-granting after a later revocation or env reuse.
    Nothing happens unless the operator configures ADMIN_BOOTSTRAP_EMAIL.
    """
    settings = get_settings()
    roles = [
        (AdminRole.SUPER_ADMIN, settings.admin_bootstrap_email),
        (AdminRole.ADMIN, settings.admin_bootstrap_admin_email),
        (AdminRole.MODERATOR, settings.admin_bootstrap_moderator_email),
    ]
    if not roles[0][1]:
        if any(email for _, email in roles[1:]):
            raise RuntimeError("Admin bootstrap requires ADMIN_BOOTSTRAP_EMAIL")
        return
    supplied = [normalize_email(str(email)) for _, email in roles if email]
    if len(supplied) != len(set(supplied)):
        raise RuntimeError("Admin bootstrap accounts must be distinct")
    with SessionLocal.begin() as db:
        if db.get(AdminBootstrap, 1) or db.scalar(select(AdminGrant.user_id).limit(1)):
            return
        accounts = []
        for role, email in roles:
            if not email:
                continue
            normalized = normalize_email(str(email))
            user = db.scalar(select(User).where(User.email == normalized))
            identity = db.scalar(
                select(LoginIdentity).where(
                    LoginIdentity.user_id == user.id,
                    LoginIdentity.provider == "email",
                    LoginIdentity.normalized_identifier == normalized,
                    LoginIdentity.verified_at.is_not(None),
                    LoginIdentity.disabled_at.is_(None),
                )
            ) if user else None
            if not user or not user.is_active or not user.email_verified_at or not identity:
                logger.warning(
                    "Admin bootstrap deferred until the configured account is verified",
                    extra={"event": "admin_bootstrap_deferred",
                           "error_code": "ADMIN_BOOTSTRAP_ACCOUNT_UNAVAILABLE"},
                )
                return
            accounts.append((role, user))
        now = datetime.now(UTC)
        root_id = accounts[0][1].id
        db.add(AdminBootstrap(id=1, user_id=root_id, created_at=now))
        for role, user in accounts:
            db.add(AdminGrant(user_id=user.id, role=role, granted_by=root_id,
                              created_at=now, updated_at=now))
            db.add(AuditLog(
                id=uuid4(), family_id=None, actor_id=root_id, action="admin.bootstrapped",
                target_type="user", target_id=user.id, created_at=now,
            ))
        try:
            db.flush()
        except IntegrityError:
            # A concurrent process completed the one-time bootstrap first.
            db.rollback()


def require_admin(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> tuple[User, AdminRole]:
    grant = db.get(AdminGrant, user.id)
    if grant is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Админ эрх шаардлагатай.")
    return user, AdminRole(grant.role)


def require_super_admin(
    current: tuple[User, AdminRole] = Depends(require_admin),
) -> tuple[User, AdminRole]:
    if current[1] != AdminRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Энэ үйлдэлд эрх хүрэхгүй.")
    return current


def require_operator(
    current: tuple[User, AdminRole] = Depends(require_admin),
) -> tuple[User, AdminRole]:
    if current[1] == AdminRole.MODERATOR:
        raise HTTPException(status_code=403, detail="Энэ үйлдэлд эрх хүрэхгүй.")
    return current


@router.get("/me", response_model=AdminIdentity)
def admin_me(current: tuple[User, AdminRole] = Depends(require_admin)):
    user, role = current
    return AdminIdentity(user_id=user.id, email=user.email, display_name=user.display_name, role=role)


@router.get("/overview", response_model=AdminOverview)
def overview(
    _: tuple[User, AdminRole] = Depends(require_admin), db: Session = Depends(get_db)
):
    return AdminOverview(
        users=db.scalar(select(func.count()).select_from(User)) or 0,
        families=db.scalar(select(func.count()).select_from(Family).where(Family.archived_at.is_(None))) or 0,
        admins=db.scalar(select(func.count()).select_from(AdminGrant)) or 0,
    )


@router.get("/users", response_model=list[AdminUser])
def users(
    limit: int = Query(default=25, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    _: tuple[User, AdminRole] = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = db.scalars(select(User).order_by(User.created_at, User.id).offset(offset).limit(limit)).all()
    return [AdminUser(id=u.id, display_name=u.display_name, email=u.email,
                      is_active=u.is_active, created_at=u.created_at) for u in rows]


@router.get("/families", response_model=list[AdminFamily])
def families(
    limit: int = Query(default=25, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    _: tuple[User, AdminRole] = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Family).where(Family.archived_at.is_(None))
        .order_by(Family.created_at, Family.id).offset(offset).limit(limit)
    ).all()
    return [AdminFamily(id=f.id, name=f.name, created_at=f.created_at) for f in rows]


@router.get("/users/lookup", response_model=AdminUser)
def lookup_user(
    email: EmailStr,
    _: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.email == normalize_email(str(email))))
    if not user:
        raise HTTPException(status_code=404, detail="Хэрэглэгч олдсонгүй.")
    return AdminUser(id=user.id, display_name=user.display_name, email=user.email,
                     is_active=user.is_active, created_at=user.created_at)


@router.post("/users/invite", status_code=202)
def invite_new_account(
    body: AdminAccountInviteInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
    provider: EmailProvider = Depends(get_email_provider),
):
    email = normalize_email(str(body.email))
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Энэ имэйлээр бүртгэл бий.")
    if not _consume_otp_rate(db, "admin-account-invite", email, 2):
        raise HTTPException(status_code=429, detail="Урилга хэт олон илгээгдсэн.")
    link = get_settings().email_public_base_url.rstrip("/") + "/register"
    try:
        provider.send_account_invitation_email(email, link)
    except EmailDeliveryError as exc:
        raise HTTPException(status_code=503, detail="Урилгын имэйл илгээж чадсангүй.") from exc
    db.add(AuditLog(id=uuid4(), family_id=None, actor_id=current[0].id,
                    action="admin.account_invitation_sent", target_type="user", target_id=current[0].id))
    db.commit()
    return {"message": "Бүртгүүлэх холбоос илгээлээ. Аккаунт хэрэглэгч баталгаажуулсны дараа үүснэ."}


@router.get("/users/{user_id}", response_model=AdminUserDetail)
def user_detail(
    user_id: UUID,
    _: tuple[User, AdminRole] = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Хэрэглэгч олдсонгүй.")
    memberships = db.execute(
        select(FamilyMember, Family).join(Family, Family.id == FamilyMember.family_id)
        .where(FamilyMember.user_id == user_id, Family.archived_at.is_(None))
        .order_by(Family.name, Family.id)
    ).all()
    linked = db.execute(
        select(Person, FamilyPerson.family_id)
        .join(UserPersonLink, UserPersonLink.person_id == Person.id)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .join(FamilyMember, FamilyMember.family_id == FamilyPerson.family_id)
        .where(UserPersonLink.user_id == user_id, FamilyMember.user_id == user_id)
    ).all()
    grant = db.get(AdminGrant, user_id)
    return AdminUserDetail(
        id=user.id, display_name=user.display_name, email=user.email,
        is_active=user.is_active, created_at=user.created_at,
        email_verified=user.email_verified_at is not None,
        admin_role=AdminRole(grant.role) if grant else None,
        memberships=[AdminMembership(family_id=f.id, family_name=f.name, role=m.role)
                     for m, f in memberships],
        linked_people=[AdminLinkedPerson(id=p.id, family_id=family_id,
                                         first_name=p.first_name, last_name=p.last_name)
                       for p, family_id in linked],
    )


@router.put("/users/{user_id}/profile", response_model=AdminUser)
def edit_user_profile(
    user_id: UUID,
    body: AdminUserProfileInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Хэрэглэгч олдсонгүй.")
    name = body.display_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Нэр хоосон байж болохгүй.")
    if target.display_name != name:
        target.display_name = name
        db.add(AuditLog(id=uuid4(), family_id=None, actor_id=current[0].id,
                        action="admin.user_profile_edited", target_type="user", target_id=user_id))
        db.commit()
    return AdminUser(id=target.id, display_name=target.display_name, email=target.email,
                     is_active=target.is_active, created_at=target.created_at)


@router.get("/audit", response_model=list[AdminAuditEvent])
def audit_events(
    limit: int = Query(default=40, ge=1, le=100),
    _: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(AuditLog, User.display_name)
        .join(User, User.id == AuditLog.actor_id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit)
    ).all()
    return [
        AdminAuditEvent(id=log.id, action=log.action, target_type=log.target_type,
                        target_id=log.target_id, family_id=log.family_id,
                        actor_name=name, created_at=log.created_at)
        for log, name in rows
    ]


@router.put("/users/{user_id}/status", response_model=AdminUser)
def set_user_status(
    user_id: UUID,
    body: AdminUserStatusInput,
    current: tuple[User, AdminRole] = Depends(require_operator),
    db: Session = Depends(get_db),
):
    actor, role = current
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Хэрэглэгч олдсонгүй.")
    target_grant = db.get(AdminGrant, user_id)
    if target.id == actor.id or (target_grant and (
        target_grant.role == AdminRole.SUPER_ADMIN or role != AdminRole.SUPER_ADMIN
    )):
        raise HTTPException(status_code=403, detail="Энэ аккаунтын төлөвийг өөрчлөх эрхгүй.")
    if target.is_active != body.is_active:
        target.is_active = body.is_active
        if not body.is_active:
            db.execute(delete(UserSession).where(UserSession.user_id == user_id))
        db.add(AuditLog(id=uuid4(), family_id=None, actor_id=actor.id,
                        action="admin.user_activated" if body.is_active else "admin.user_blocked",
                        target_type="user", target_id=user_id))
        db.commit()
    return AdminUser(id=target.id, display_name=target.display_name, email=target.email,
                     is_active=target.is_active, created_at=target.created_at)


@router.get("/users/{user_id}/stories", response_model=list[AdminStory])
def user_stories(
    user_id: UUID,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    if db.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="Хэрэглэгч олдсонгүй.")
    rows = db.scalars(select(Story).where(Story.created_by == user_id)
                      .order_by(Story.created_at.desc(), Story.id).offset(offset).limit(limit)).all()
    db.add(AuditLog(id=uuid4(), family_id=None, actor_id=current[0].id,
                    action="admin.user_stories_viewed", target_type="user", target_id=user_id))
    db.commit()
    return [AdminStory(id=s.id, family_id=s.family_id, title=s.title, body=s.body,
                       visibility=s.visibility, created_at=s.created_at) for s in rows]


@router.put("/stories/{story_id}", response_model=AdminStory)
def edit_story(
    story_id: UUID, body: AdminStoryEdit,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    story = db.get(Story, story_id)
    if story is None:
        raise HTTPException(status_code=404, detail="Түүх олдсонгүй.")
    story.title = body.title.strip()
    story.body = body.body.strip()
    if not story.title or not story.body:
        raise HTTPException(status_code=422, detail="Гарчиг болон түүхийн агуулга шаардлагатай.")
    db.add(AuditLog(id=uuid4(), family_id=story.family_id, actor_id=current[0].id,
                    action="admin.story_edited", target_type="story", target_id=story.id))
    db.commit()
    return AdminStory(id=story.id, family_id=story.family_id, title=story.title,
                      body=story.body, visibility=story.visibility, created_at=story.created_at)


@router.get("/admins", response_model=list[AdminAccount])
def admins(
    _: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(User, AdminGrant.role).join(AdminGrant, AdminGrant.user_id == User.id)
        .order_by(User.created_at, User.id)
    ).all()
    return [AdminAccount(id=u.id, display_name=u.display_name, email=u.email,
                         is_active=u.is_active, created_at=u.created_at, role=role)
            for u, role in rows]


@router.put("/admins/{user_id}", response_model=AdminAccount)
def grant_admin_role(
    user_id: UUID,
    body: AdminRoleInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    actor = current[0]
    if user_id == actor.id or body.role == AdminRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Энэ эрхийг өөрчлөх боломжгүй.")
    target = db.get(User, user_id)
    if not target or not target.is_active or not target.email_verified_at:
        raise HTTPException(status_code=404, detail="Баталгаажсан идэвхтэй хэрэглэгч олдсонгүй.")
    grant = db.get(AdminGrant, user_id)
    if grant and grant.role == AdminRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super Admin эрхийг энд өөрчлөх боломжгүй.")
    if not grant:
        grant = AdminGrant(user_id=user_id, role=body.role, granted_by=actor.id)
        db.add(grant)
    else:
        grant.role = body.role
        grant.granted_by = actor.id
        grant.updated_at = datetime.now(UTC)
    db.add(AuditLog(id=uuid4(), family_id=None, actor_id=actor.id,
                    action="admin.role_assigned", target_type="user", target_id=user_id))
    db.commit()
    return AdminAccount(id=target.id, display_name=target.display_name, email=target.email,
                        is_active=target.is_active, created_at=target.created_at, role=body.role)


@router.delete("/admins/{user_id}", status_code=204)
def revoke_admin_role(
    user_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    actor = current[0]
    if user_id == actor.id:
        raise HTTPException(status_code=403, detail="Өөрийн эрхийг энд цуцлах боломжгүй.")
    grant = db.get(AdminGrant, user_id)
    if not grant:
        raise HTTPException(status_code=404, detail="Админ эрх олдсонгүй.")
    if grant.role == AdminRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super Admin эрхийг энд цуцлах боломжгүй.")
    db.delete(grant)
    db.add(AuditLog(id=uuid4(), family_id=None, actor_id=actor.id,
                    action="admin.role_revoked", target_type="user", target_id=user_id))
    db.commit()

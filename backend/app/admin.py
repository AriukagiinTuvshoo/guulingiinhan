"""Global administration. Family membership never grants these permissions."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user, normalize_email
from app.config import get_settings
from app.db import SessionLocal, get_db
from app.models import AdminBootstrap, AdminGrant, AuditLog, Family, LoginIdentity, User


class AdminRole(StrEnum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN = "ADMIN"
    MODERATOR = "MODERATOR"


router = APIRouter(prefix="/admin", tags=["admin"])


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
                raise RuntimeError("Admin bootstrap requires active, verified email accounts")
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

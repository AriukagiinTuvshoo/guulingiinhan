"""Explicit maintenance for expired authentication artifacts and trash metadata.

Trash cleanup removes restore records only; it never deletes people or photos.
"""
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    EmailVerificationToken,
    FamilyTrashRecord,
    LoginThrottle,
    PasswordResetToken,
    PhoneOtpChallenge,
    UserSession,
)


def prune_expired_auth_artifacts(
    db: Session, *, apply: bool = False, now: datetime | None = None
) -> dict[str, int]:
    """Count or delete expired artifacts; callers own transaction boundaries."""
    current = now or datetime.now(UTC)
    targets: list[tuple[str, Any, Any]] = [
        ("sessions", UserSession, UserSession.expires_at < current),
        ("email_tokens", EmailVerificationToken, EmailVerificationToken.expires_at < current),
        ("password_tokens", PasswordResetToken, PasswordResetToken.expires_at < current),
        ("otp_challenges", PhoneOtpChallenge, PhoneOtpChallenge.expires_at < current - timedelta(days=1)),
        ("throttles", LoginThrottle, LoginThrottle.window_started < current - timedelta(days=7)),
    ]
    counts: dict[str, int] = {}
    for name, model, predicate in targets:
        counts[name] = int(db.scalar(select(func.count()).select_from(model).where(predicate)) or 0)
        if apply:
            db.execute(delete(model).where(predicate))
    return counts


def prune_expired_trash(
    db: Session, *, retention_days: int = 30, apply: bool = False, now: datetime | None = None
) -> int:
    """Expire tombstones, without deleting the underlying person or related records."""
    if not 1 <= retention_days <= 3650:
        raise ValueError("Trash retention must be between 1 and 3650 days")
    cutoff = (now or datetime.now(UTC)) - timedelta(days=retention_days)
    predicate = FamilyTrashRecord.deleted_at < cutoff
    count = int(db.scalar(select(func.count()).select_from(FamilyTrashRecord).where(predicate)) or 0)
    if apply:
        db.execute(delete(FamilyTrashRecord).where(predicate))
    return count

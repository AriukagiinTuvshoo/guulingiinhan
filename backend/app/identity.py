"""Canonical identifier normalization and safe account identity lookup."""

import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import LoginIdentity, User


def normalize_email(value: str) -> str:
    """Trim and case-fold the whole address; never strip provider-specific aliases."""
    return value.strip().casefold()


def normalize_phone(value: str) -> str:
    """Canonicalize E.164 plus common Mongolian local/mobile input."""
    candidate = re.sub(r"[\s\-()]", "", value.strip())
    if re.fullmatch(r"[6-9][0-9]{7}", candidate):
        candidate = "+976" + candidate
    elif re.fullmatch(r"976[6-9][0-9]{7}", candidate):
        candidate = "+" + candidate
    if not re.fullmatch(r"\+[1-9][0-9]{7,14}", candidate):
        raise ValueError("Утасны дугаарыг улсын кодтой дугаараар оруулна уу.")
    return candidate


def find_email_user(db: Session, email: str) -> User | None:
    """Resolve an email identity, failing closed for ambiguous legacy rows."""
    normalized = normalize_email(email)
    identity = db.scalar(
        select(LoginIdentity).where(
            LoginIdentity.provider == "email",
            LoginIdentity.normalized_identifier == normalized,
        )
    )
    if identity is not None:
        if identity.disabled_at is not None:
            return None
        return db.get(User, identity.user_id)

    # Compatibility for pre-registry or collision rows that were intentionally
    # omitted from the backfill. Never pick an arbitrary case-insensitive match.
    matches = list(db.scalars(select(User).where(func.lower(func.trim(User.email)) == normalized)))
    return matches[0] if len(matches) == 1 else None


def email_is_registered(db: Session, email: str) -> bool:
    """Treat both normal and ambiguous legacy matches as already reserved."""
    normalized = normalize_email(email)
    return (
        db.scalar(
            select(LoginIdentity.id).where(
                LoginIdentity.provider == "email",
                LoginIdentity.normalized_identifier == normalized,
            )
        )
        is not None
        or db.scalar(select(User.id).where(func.lower(func.trim(User.email)) == normalized))
        is not None
    )

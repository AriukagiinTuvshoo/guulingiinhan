"""Recipient-only preview before the existing invitation acceptance mutation."""
import hashlib
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.families import InvitationAccept, normalize_email
from app.models import Family, Invitation, LoginIdentity, User

router = APIRouter(prefix="/invitations", tags=["invitations"])


@router.post("/preview")
def preview_invitation(body: InvitationAccept, response: Response, user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "private, no-store"
    invitation = db.scalar(select(Invitation).where(
        Invitation.token_hash == hashlib.sha256(body.token.encode()).hexdigest(),
        Invitation.accepted_at.is_(None), Invitation.revoked_at.is_(None),
        Invitation.expires_at > datetime.now(UTC),
    ))
    if invitation is None:
        raise HTTPException(404, "Урилга хүчингүй эсвэл хугацаа дууссан байна.")
    if not user.email or normalize_email(user.email) != invitation.invited_email:
        raise HTTPException(403, "Энэ урилга өөр имэйл хаягт зориулагдсан.")
    identity = db.scalar(select(LoginIdentity.id).where(
        LoginIdentity.user_id == user.id, LoginIdentity.provider == "email",
        LoginIdentity.normalized_identifier == invitation.invited_email,
        LoginIdentity.verified_at.is_not(None), LoginIdentity.disabled_at.is_(None),
    ))
    if user.email_verified_at is None and identity is None:
        raise HTTPException(403, "Урилгыг авахын өмнө имэйлээ баталгаажуулна уу.")
    family = db.get(Family, invitation.family_id)
    if family is None or family.archived_at is not None:
        raise HTTPException(404, "Гэр бүл олдсонгүй.")
    return {"family_name": family.name, "role": invitation.role, "expires_at": invitation.expires_at}

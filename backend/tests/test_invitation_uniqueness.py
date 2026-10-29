from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models import Family, FamilyMember, Invitation, User

INDEX_SQL = """
CREATE UNIQUE INDEX uq_invitation_active_family_email
ON invitations (family_id, invited_email)
WHERE accepted_at IS NULL AND revoked_at IS NULL
"""


def _install_index(database):
    with database() as db:
        db.execute(text(INDEX_SQL))
        db.commit()


def _seed_family(db, email):
    user = User(
        email=email,
        display_name="Owner",
        password_hash="hash",
    )
    db.add(user)
    db.flush()
    family = Family(name=f"Family {uuid4()}", created_by=user.id)
    db.add(family)
    db.flush()
    db.add(FamilyMember(family_id=family.id, user_id=user.id, role="owner"))
    db.commit()
    return user, family


def _invitation(family, user, email, **states):
    return Invitation(
        family_id=family.id,
        invited_email=email,
        role="member",
        token_hash=uuid4().hex,
        invited_by=user.id,
        expires_at=datetime.now(UTC) + timedelta(days=7),
        **states,
    )


def test_active_invitation_database_index_rejects_sequential_duplicate(database):
    _install_index(database)
    with database() as db:
        user, family = _seed_family(db, "owner@example.com")
        db.add(_invitation(family, user, "Member@Example.com".casefold()))
        db.commit()

        db.add(_invitation(family, user, "member@example.com"))
        with pytest.raises(IntegrityError):
            db.commit()


def test_active_invitation_allows_same_email_in_different_families(database):
    _install_index(database)
    with database() as db:
        user_a, family_a = _seed_family(db, "owner-a@example.com")
        user_b, family_b = _seed_family(db, "owner-b@example.com")
        db.add_all(
            [
                _invitation(family_a, user_a, "member@example.com"),
                _invitation(family_b, user_b, "member@example.com"),
            ]
        )
        db.commit()


def test_revoked_invitation_allows_new_active_invitation(database):
    _install_index(database)
    with database() as db:
        user, family = _seed_family(db, "owner@example.com")
        first = _invitation(family, user, "member@example.com")
        db.add(first)
        db.commit()

        first.revoked_at = datetime.now(UTC)
        db.commit()

        db.add(_invitation(family, user, "member@example.com"))
        db.commit()


def test_accepted_invitation_allows_new_active_invitation(database):
    _install_index(database)
    with database() as db:
        user, family = _seed_family(db, "owner@example.com")
        first = _invitation(family, user, "member@example.com")
        db.add(first)
        db.commit()

        first.accepted_at = datetime.now(UTC)
        db.commit()

        db.add(_invitation(family, user, "member@example.com"))
        db.commit()

"""Centralized minor detection and family-scoped guardian policy."""

import calendar
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Person, PersonGuardianship, UserPersonLink

GUARDIAN_SCOPES = frozenset(
    {
        "view_profile",
        "edit_profile",
        "manage_biography",
        "manage_events",
        "manage_memories",
        "manage_media",
    }
)
ADULT_AGE_YEARS = 18


def is_minor(birth_date: date | None, today: date | None = None) -> bool | None:
    """Return True/False for known ages and None when the birth date is unknown.

    The product privacy threshold is 18. A Feb 29 birthday is treated as
    reaching the age threshold on Feb 28 in non-leap years.
    """
    if birth_date is None:
        return None
    current_date = today or datetime.now(UTC).date()
    threshold_year = birth_date.year + ADULT_AGE_YEARS
    try:
        birthday_at_threshold = birth_date.replace(year=threshold_year)
    except ValueError:  # February 29 in a non-leap threshold year.
        birthday_at_threshold = date(threshold_year, 2, 28)
    return current_date < birthday_at_threshold


def adult_birth_cutoff(today: date) -> date:
    """Latest birth date that ``is_minor`` treats as an adult on ``today``.

    Keeps SQL predicates aligned with the Python policy, including the
    February 29 birthday handled by ``is_minor``.
    """
    year = today.year - ADULT_AGE_YEARS
    if today.month == 2 and today.day == 28 and calendar.isleap(year) and not calendar.isleap(today.year):
        return today.replace(year=year, day=29)
    if today.month == 2 and today.day == 29 and not calendar.isleap(year):
        return today.replace(year=year, day=28)
    return today.replace(year=year)


def person_not_private(user_id: UUID):
    """SQL predicate mirroring :func:`app.families._assert_person_visible`."""
    from app.models import UserPersonLink

    linked = select(UserPersonLink.person_id).where(UserPersonLink.user_id == user_id)
    return or_(
        Person.visibility != "private",
        Person.created_by == user_id,
        Person.id.in_(linked),
    )


def person_minor_guardian_allowed(
    family_id: UUID, user_id: UUID, scope: str, *, now: datetime, cutoff: date
):
    """SQL predicate mirroring :func:`require_minor_scope` for a ``Person``.

    Unknown birth dates are not minors, matching ``is_minor`` returning None.
    """
    guardian = select(PersonGuardianship.id).where(
        PersonGuardianship.family_id == family_id,
        PersonGuardianship.person_id == Person.id,
        PersonGuardianship.guardian_user_id == user_id,
        PersonGuardianship.scope == scope,
        PersonGuardianship.status == "active",
        PersonGuardianship.revoked_at.is_(None),
        or_(
            PersonGuardianship.expires_at.is_(None),
            PersonGuardianship.expires_at > now,
        ),
    ).correlate(Person).exists()
    return or_(
        Person.birth_date.is_(None),
        Person.birth_date <= cutoff,
        guardian,
    )


def active_guardian_scopes(
    db: Session,
    user_id: UUID,
    family_id: UUID,
    person_ids: list[UUID],
    *,
    now: datetime | None = None,
) -> dict[UUID, set[str]]:
    """Fetch all usable scopes for these people in one query."""
    if not person_ids:
        return {}
    current_time = now or datetime.now(UTC)
    rows = db.execute(
        select(PersonGuardianship.person_id, PersonGuardianship.scope).where(
            PersonGuardianship.guardian_user_id == user_id,
            PersonGuardianship.family_id == family_id,
            PersonGuardianship.person_id.in_(person_ids),
            PersonGuardianship.status == "active",
            PersonGuardianship.revoked_at.is_(None),
            or_(
                PersonGuardianship.expires_at.is_(None),
                PersonGuardianship.expires_at > current_time,
            ),
        )
    ).all()
    result: dict[UUID, set[str]] = {}
    for person_id, scope in rows:
        result.setdefault(person_id, set()).add(scope)
    return result


def has_guardian_scope(
    db: Session,
    user_id: UUID,
    family_id: UUID,
    person_id: UUID,
    scope: str,
    *,
    now: datetime | None = None,
) -> bool:
    return scope in active_guardian_scopes(
        db, user_id, family_id, [person_id], now=now
    ).get(person_id, set())


def person_is_minor(person: Person, today: date | None = None) -> bool:
    return is_minor(person.birth_date, today) is True


def user_linked_person_is_minor(db: Session, user_id: UUID, today: date | None = None) -> bool:
    person = db.scalar(
        select(Person)
        .join(UserPersonLink, UserPersonLink.person_id == Person.id)
        .where(UserPersonLink.user_id == user_id)
    )
    return person is not None and person_is_minor(person, today)


def redact_minor_profile_fields(person: Person, scopes: set[str]) -> dict[str, object]:
    """Return response overrides; no guardian scope means minimal family profile."""
    if not person_is_minor(person) or "view_profile" in scopes:
        return {}
    return {
        "birth_date": None,
        "birth_place": None,
        "death_date": None,
        "death_place": None,
        "short_description": None,
    }


def require_minor_scope(
    db: Session,
    user_id: UUID,
    family_id: UUID,
    person: Person,
    scope: str,
) -> bool:
    """Return whether the person is a minor; reject missing scoped authority."""
    if not person_is_minor(person):
        return False
    if not has_guardian_scope(db, user_id, family_id, person.id, scope):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="Энэ хүний мэдээлэлд хандах эрхгүй.")
    return True

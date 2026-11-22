"""Narrow family-scoped admin grants and reversible person detachments."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.families import (
    ADMIN_SCOPES,
    EXTENDED_ADMIN_SCOPES,
    WORK_ADMIN_SCOPES,
    _assert_person_visible,
    _audit,
    _commit,
    _member,
    _person_in_family,
    _require_admin_scope,
    _require_minor_scope,
    _require_work_scope,
    _safe_list_member_scopes,
)
from app.models import (
    Branch,
    Family,
    FamilyAdminExtendedGrant,
    FamilyAdminGrant,
    FamilyAdminWorkGrant,
    FamilyClanLink,
    FamilyMember,
    FamilyPerson,
    FamilyTrashRecord,
    Lineage,
    Person,
    PersonLineageAssignment,
    User,
)
from app.privacy import (
    adult_birth_cutoff,
    person_minor_guardian_allowed,
    person_not_private,
)

router = APIRouter(prefix="/families", tags=["family administration"])

CLAN_RELATIONS = frozenset({"child_of", "parent_of", "spouse_of"})


class GrantInput(BaseModel):
    scopes: list[str] = Field(max_length=len(ADMIN_SCOPES))

    @model_validator(mode="after")
    def validate_scopes(self):
        if len(self.scopes) != len(set(self.scopes)) or not set(self.scopes) <= ADMIN_SCOPES:
            raise ValueError("Invalid or duplicate administration scope")
        return self


@router.get("/{family_id}/admin-access")
def admin_access(family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member, _ = _member(db, family_id, user)
    if member.role == "owner":
        scopes = sorted(ADMIN_SCOPES)
    else:
        scopes = _safe_list_member_scopes(db, member.id)
    return {"owner": member.role == "owner", "scopes": scopes}


@router.get("/{family_id}/admin-grants")
def list_grants(family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user, {"owner"})
    members = db.execute(select(FamilyMember, User.display_name).join(
        User, User.id == FamilyMember.user_id
    ).where(FamilyMember.family_id == family_id).order_by(User.display_name)).all()
    grants: list[tuple[UUID, str]] = []
    for model in (FamilyAdminGrant, FamilyAdminExtendedGrant, FamilyAdminWorkGrant):
        try:
            with db.begin_nested():
                rows = db.execute(select(model.member_id, model.scope).join(
                    FamilyMember, FamilyMember.id == model.member_id
                ).where(FamilyMember.family_id == family_id)).all()
            grants.extend((row[0], row[1]) for row in rows)
        except SQLAlchemyError:
            continue
    return [{"user_id": m.user_id, "display_name": name, "role": m.role,
             "scopes": [scope for member_id, scope in grants if member_id == m.id]}
            for m, name in members if m.role != "owner"]


@router.put("/{family_id}/admin-grants/{user_id}", status_code=204)
def set_grants(family_id: UUID, user_id: UUID, body: GrantInput,
               user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(select(Family.id).where(Family.id == family_id).with_for_update())
    _member(db, family_id, user, {"owner"})
    member = db.scalar(select(FamilyMember).where(
        FamilyMember.family_id == family_id, FamilyMember.user_id == user_id
    ))
    if member is None:
        raise HTTPException(status_code=404, detail="Гишүүн олдсонгүй.")
    if member.role == "owner":
        raise HTTPException(status_code=409, detail="Эзэмшигчийн эрхийг өөрчлөхгүй.")
    db.execute(delete(FamilyAdminGrant).where(FamilyAdminGrant.member_id == member.id))
    db.execute(delete(FamilyAdminExtendedGrant).where(FamilyAdminExtendedGrant.member_id == member.id))
    db.execute(delete(FamilyAdminWorkGrant).where(FamilyAdminWorkGrant.member_id == member.id))
    for scope in body.scopes:
        model = (FamilyAdminWorkGrant if scope in WORK_ADMIN_SCOPES else
                 FamilyAdminExtendedGrant if scope in EXTENDED_ADMIN_SCOPES else FamilyAdminGrant)
        db.add(model(member_id=member.id, scope=scope, granted_by=user.id))
    _audit(db, user, family_id, "admin.grants_updated", "family_member", member.id)
    _commit(db, "Эрхийг шинэчилж чадсангүй.")
    return Response(status_code=204)


def _visible_trashed_person(db: Session, family_id: UUID, user: User, person: Person, scope: str) -> None:
    _assert_person_visible(db, person, user)
    _require_minor_scope(db, family_id, person, user, scope)


@router.get("/{family_id}/trash")
def list_trash(
    family_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin_scope(db, family_id, user, "manage_trash")
    # Privacy and guardian policy must be part of the SQL predicate; filtering
    # after a hard limit hides records past that limit and leaks total counts.
    now = datetime.now(UTC)
    conditions = (
        FamilyTrashRecord.family_id == family_id,
        person_not_private(user.id),
        person_minor_guardian_allowed(
            family_id, user.id, "view_profile", now=now, cutoff=adult_birth_cutoff(now.date())
        ),
    )
    try:
        with db.begin_nested():
            total = db.scalar(
                select(func.count()).select_from(FamilyTrashRecord).join(
                    Person, Person.id == FamilyTrashRecord.person_id
                ).where(*conditions)
            ) or 0
            rows = db.execute(
                select(FamilyTrashRecord, Person).join(
                    Person, Person.id == FamilyTrashRecord.person_id
                ).where(*conditions)
                .order_by(FamilyTrashRecord.deleted_at.desc(), FamilyTrashRecord.id.desc())
                .offset((page - 1) * page_size).limit(page_size)
            ).all()
    except SQLAlchemyError:
        return {
            "items": [],
            "page": page,
            "page_size": page_size,
            "total": 0,
            "has_next": False,
        }
    return {
        "items": [
            {"id": record.id, "person_id": person.id, "first_name": person.first_name,
             "last_name": person.last_name, "deleted_at": record.deleted_at}
            for record, person in rows
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_next": page * page_size < total,
    }


@router.post("/{family_id}/trash/{trash_id}/restore", status_code=204)
def restore_trash(family_id: UUID, trash_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(select(Family.id).where(Family.id == family_id).with_for_update())
    _require_admin_scope(db, family_id, user, "manage_trash")
    record = db.scalar(select(FamilyTrashRecord).where(
        FamilyTrashRecord.id == trash_id, FamilyTrashRecord.family_id == family_id
    ).with_for_update())
    person = db.get(Person, record.person_id) if record else None
    if record is None or person is None:
        raise HTTPException(status_code=404, detail="Хогийн саванд бүртгэл олдсонгүй.")
    _visible_trashed_person(db, family_id, user, person, "edit_profile")
    if db.scalar(select(FamilyPerson.id).where(FamilyPerson.family_id == family_id,
                                               FamilyPerson.person_id == person.id)) is not None:
        raise HTTPException(status_code=409, detail="Хүн гэр бүлд аль хэдийн байна.")
    if record.assignment_present and (record.lineage_id is None or db.scalar(select(Lineage.id).where(
        Lineage.id == record.lineage_id, Lineage.family_id == family_id
    )) is None):
        raise HTTPException(status_code=409, detail="Өмнөх удам олдсонгүй.")
    if record.branch_present and (record.branch_id is None or db.scalar(select(Branch.id).where(
        Branch.id == record.branch_id, Branch.lineage_id == record.lineage_id
    )) is None):
        raise HTTPException(status_code=409, detail="Өмнөх салаа олдсонгүй.")
    if record.lineage_id is not None and db.scalar(select(PersonLineageAssignment.id).where(
        PersonLineageAssignment.person_id == person.id
    )) is not None:
        raise HTTPException(status_code=409, detail="Хүнд өөр удмын оноолт байна.")
    db.add(FamilyPerson(family_id=family_id, person_id=person.id, added_by=user.id))
    if record.lineage_id is not None:
        db.add(PersonLineageAssignment(person_id=person.id, lineage_id=record.lineage_id,
                                       branch_id=record.branch_id))
    _audit(db, user, family_id, "person.restored", "person", person.id)
    db.delete(record)
    _commit(db, "Бүртгэлийг сэргээж чадсангүй.")
    return Response(status_code=204)


class ClanLinkInput(BaseModel):
    clan_family_id: UUID
    household_person_id: UUID
    clan_anchor_person_id: UUID
    relation: str

    @model_validator(mode="after")
    def validate_relation(self):
        if self.relation not in CLAN_RELATIONS:
            raise ValueError("Unsupported clan relation")
        return self


def _lock_families(db: Session, *family_ids: UUID) -> None:
    """Take family locks in one deterministic order so paired writes cannot deadlock."""
    for other_id in sorted({str(family_id) for family_id in family_ids}):
        db.execute(select(Family.id).where(Family.id == UUID(other_id)).with_for_update())


def _clan_chain_reaches(db: Session, start: UUID, target: UUID, limit: int = 12) -> bool:
    """True when following links upward from ``start`` would land on ``target``."""
    seen = {start}
    current: UUID | None = start
    for _ in range(limit):
        parent = db.scalar(select(FamilyClanLink.clan_family_id).where(
            FamilyClanLink.household_family_id == current
        ))
        if parent is None or parent in seen:
            return False
        if parent == target:
            return True
        seen.add(parent)
        current = parent
    return True  # unbounded chain is treated as a cycle rather than allowed


def _person_label(db: Session, family_id: UUID, person_id: UUID, user: User) -> str | None:
    """Name a person only when the requester may see them in their own family."""
    try:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
    except HTTPException as error:
        if error.status_code in {403, 404}:
            return None
        raise
    return " ".join(filter(None, (person.last_name, person.first_name)))


@router.get("/{family_id}/clan-link")
def get_clan_link(family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _member(db, family_id, user)
    link = db.scalar(select(FamilyClanLink).where(FamilyClanLink.household_family_id == family_id))
    if link is None:
        return {"linked": False}
    clan_name: str | None = None
    try:
        _, clan_family = _member(db, link.clan_family_id, user)
        clan_name = clan_family.name
    except HTTPException as error:
        if error.status_code not in {403, 404}:
            raise
    return {
        "linked": True,
        "clan_family_id": link.clan_family_id if clan_name else None,
        "clan_family_name": clan_name,
        "household_person_id": link.household_person_id,
        "household_person_name": _person_label(db, family_id, link.household_person_id, user),
        "clan_anchor_person_id": link.clan_anchor_person_id if clan_name else None,
        "clan_anchor_person_name": (
            _person_label(db, link.clan_family_id, link.clan_anchor_person_id, user)
            if clan_name else None
        ),
        "relation": link.relation,
        "created_at": link.created_at,
    }


@router.put("/{family_id}/clan-link")
def set_clan_link(family_id: UUID, body: ClanLinkInput,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.clan_family_id == family_id:
        raise HTTPException(status_code=400, detail="Гэр бүлийг өөртэй нь холбох боломжгүй.")
    _lock_families(db, family_id, body.clan_family_id)
    _require_work_scope(db, family_id, user, "manage_people")
    _member(db, body.clan_family_id, user)
    household_person = _person_in_family(db, family_id, body.household_person_id)
    _assert_person_visible(db, household_person, user)
    _require_minor_scope(db, family_id, household_person, user, "edit_profile")
    anchor = _person_in_family(db, body.clan_family_id, body.clan_anchor_person_id)
    _assert_person_visible(db, anchor, user)
    _require_minor_scope(db, body.clan_family_id, anchor, user, "edit_profile")
    if _clan_chain_reaches(db, body.clan_family_id, family_id):
        raise HTTPException(status_code=409, detail="Их үе болон өрхийн холбоос тойрог үүсгэж байна.")
    existing = db.scalar(select(FamilyClanLink).where(
        FamilyClanLink.household_family_id == family_id
    ))
    if existing is not None and all((
        existing.clan_family_id == body.clan_family_id,
        existing.household_person_id == body.household_person_id,
        existing.clan_anchor_person_id == body.clan_anchor_person_id,
        existing.relation == body.relation,
    )):
        return {"linked": True, "unchanged": True, "relation": existing.relation,
                "created_at": existing.created_at}
    if existing is not None:
        db.delete(existing)
        db.flush()
    link = FamilyClanLink(
        household_family_id=family_id, clan_family_id=body.clan_family_id,
        household_person_id=body.household_person_id,
        clan_anchor_person_id=body.clan_anchor_person_id,
        relation=body.relation, created_by=user.id,
    )
    db.add(link)
    _audit(db, user, family_id, "household.linked_to_clan", "family", body.clan_family_id)
    _commit(db, "Холбоосыг шинэчилж чадсангүй.")
    return {"linked": True, "unchanged": False, "relation": link.relation,
            "created_at": link.created_at}


@router.delete("/{family_id}/clan-link", status_code=204)
def remove_clan_link(family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_work_scope(db, family_id, user, "manage_people")
    link = db.scalar(select(FamilyClanLink).where(FamilyClanLink.household_family_id == family_id))
    if link is None:
        raise HTTPException(status_code=404, detail="Холбоос олдсонгүй.")
    clan_family_id = link.clan_family_id
    db.delete(link)
    _audit(db, user, family_id, "household.unlinked_from_clan", "family", clan_family_id)
    _commit(db, "Холбоосыг тасалж чадсангүй.")
    return Response(status_code=204)


@router.get("/{family_id}/clan-households")
def list_clan_households(
    family_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    member_families = select(FamilyMember.family_id).where(FamilyMember.user_id == user.id)
    conditions = (
        FamilyClanLink.clan_family_id == family_id,
        FamilyClanLink.household_family_id.in_(member_families),
        Family.archived_at.is_(None),
    )
    base = select(FamilyClanLink).join(
        Family, Family.id == FamilyClanLink.household_family_id
    ).where(*conditions)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.execute(
        select(FamilyClanLink, Family).join(
            Family, Family.id == FamilyClanLink.household_family_id
        ).where(*conditions)
        .order_by(FamilyClanLink.created_at.desc(), FamilyClanLink.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {
        "items": [{"household_family_id": household.id, "household_family_name": household.name,
                   "linked_at": link.created_at} for link, household in rows],
        "page": page, "page_size": page_size, "total": total,
        "has_next": page * page_size < total,
    }

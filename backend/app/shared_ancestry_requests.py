"""Per-person review queue for the shared tree, backed by canonical family data."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.admin import AdminRole, require_super_admin
from app.auth import get_current_user
from app.db import get_db
from app.models import (
    AuditLog,
    Family,
    FamilyMember,
    FamilyPerson,
    Marriage,
    ParentChildRelationship,
    Person,
    SharedAncestry,
    SharedAncestryPerson,
    SharedAncestryRelationship,
    SharedAncestryRequest,
    User,
    UserPersonLink,
)
from app.privacy import person_is_minor
from app.relationships import (
    RelationshipError,
    assert_parent_child_is_acyclic,
    canonical_pair,
    lock_ancestry_writes,
)
from app.shared_ancestry import (
    _family_member,
    _person_in_family,
    _root_connection_person,
    _shared_target,
)

family_router = APIRouter(prefix="/families", tags=["shared ancestry requests"])
admin_router = APIRouter(prefix="/admin/shared-lineage", tags=["shared ancestry requests"])


class SharedRequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    person_id: UUID
    target_person_id: UUID | None = None
    kind: Literal["child", "spouse", "detach"]
    relationship_type: Literal["biological", "adoptive", "step", "married", "widowed"] | None = None
    share_consent: bool = False

    @model_validator(mode="after")
    def validate_connection(self):
        if self.kind == "detach":
            if self.target_person_id is not None or self.relationship_type is not None:
                raise ValueError("Модноос салгахад өөр хүн эсвэл холбооны төрөл сонгохгүй.")
            return self
        if not self.share_consent:
            raise ValueError("Үндсэн модонд харуулах зөвшөөрөл шаардлагатай.")
        if self.target_person_id is None or self.target_person_id == self.person_id:
            raise ValueError("Үндсэн модны өөр хүн сонгоно уу.")
        allowed = {"biological", "adoptive", "step"} if self.kind == "child" else {"married", "widowed"}
        if self.relationship_type is None:
            self.relationship_type = "biological" if self.kind == "child" else "married"
        if self.relationship_type not in allowed:
            raise ValueError("Сонгосон холбооны төрөл тохирохгүй байна.")
        return self


class SharedRequestOut(BaseModel):
    id: UUID
    family_id: UUID
    family_name: str
    person_id: UUID
    person_name: str
    target_person_id: UUID | None
    target_name: str | None
    kind: str
    relationship_type: str | None
    status: str
    requested_at: datetime
    decided_at: datetime | None


class SharedRequestDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approve: bool


def _out(db: Session, row: SharedAncestryRequest) -> SharedRequestOut:
    family = db.get(Family, row.family_id)
    person = db.get(Person, row.person_id)
    target = db.get(Person, row.target_person_id) if row.target_person_id else None

    def name(value: Person | None) -> str:
        return " ".join(filter(None, (value.last_name, value.first_name, value.middle_name))) if value else "Бүртгэл олдсонгүй"

    return SharedRequestOut(
        id=row.id, family_id=row.family_id, family_name=family.name if family else "Гэр бүл",
        person_id=row.person_id, person_name=name(person), target_person_id=row.target_person_id,
        target_name=("Харагдах зөвшөөрөл өөрчлөгдсөн" if target.visibility == "private" or person_is_minor(target)
                     else name(target)) if target else None, kind=row.kind,
        relationship_type=row.relationship_type, status=row.status,
        requested_at=row.requested_at, decided_at=row.decided_at,
    )


def _graph_edges(db: Session) -> list[tuple[UUID, UUID]]:
    canonical = db.execute(select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id)).all()
    legacy = db.execute(select(SharedAncestryRelationship.parent_id, SharedAncestryRelationship.child_id)).all()
    return list({(parent, child) for parent, child in [*canonical, *legacy]})


def _lock_review_context(db: Session, family_id: UUID, person_id: UUID,
                          target_id: UUID | None, requester_id: UUID) -> None:
    """Keep sharing/identity checks valid until approval commits.

    Person FOR UPDATE also blocks concurrent account-link FK insertion, while
    locking the membership rows protects role removal and family detachment.
    Ancestry writers already hold the common advisory transaction lock.
    """
    db.execute(select(SharedAncestry.id).where(SharedAncestry.id == 1).with_for_update()).all()
    db.execute(select(User.id).where(User.id == requester_id).with_for_update()).all()
    db.execute(select(Family.id).where(Family.id == family_id).with_for_update()).all()
    db.execute(select(FamilyMember.id).where(
        FamilyMember.family_id == family_id, FamilyMember.user_id == requester_id,
    ).with_for_update()).all()
    person_ids = sorted({person_id, *([target_id] if target_id else [])}, key=str)
    db.execute(select(Person.id).where(Person.id.in_(person_ids)).order_by(Person.id).with_for_update()).all()
    db.execute(select(UserPersonLink.id).where(
        or_(UserPersonLink.user_id == requester_id, UserPersonLink.person_id == person_id),
    ).order_by(UserPersonLink.id).with_for_update()).all()
    db.execute(select(FamilyPerson.id).where(
        FamilyPerson.family_id == family_id, FamilyPerson.person_id.in_(person_ids),
    ).order_by(FamilyPerson.id).with_for_update()).all()
    db.execute(select(SharedAncestryPerson.person_id).where(
        SharedAncestryPerson.person_id.in_(person_ids),
    ).order_by(SharedAncestryPerson.person_id).with_for_update()).all()


def _detach_authority(db: Session, family_id: UUID, person_id: UUID, user: User) -> SharedAncestryPerson:
    root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
    if person_id == root_id or (root_id and db.scalar(select(Marriage.id).where(
        or_(Marriage.person_1_id == root_id, Marriage.person_2_id == root_id),
        or_(Marriage.person_1_id == person_id, Marriage.person_2_id == person_id),
        Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
    ).limit(1))):
        raise HTTPException(status_code=409, detail="Үндсэн эхийн хоёр хүнийг эхийн тохиргооноос өөрчилнө үү.")
    association = db.get(SharedAncestryPerson, person_id)
    if association is None or association.family_id != family_id:
        raise HTTPException(status_code=404, detail="Үндсэн модны хүний холбоос олдсонгүй.")
    if association.added_by != user.id:
        raise HTTPException(status_code=403, detail="Зөвхөн өөрийн нийтэлсэн хүнийг салгах хүсэлт гаргана.")
    return association


def _validate_addition(db: Session, family_id: UUID, person_id: UUID, target_id: UUID,
                       kind: str, relationship_type: str) -> ParentChildRelationship | Marriage | None:
    _shared_target(db, target_id)
    if person_id == target_id:
        raise HTTPException(status_code=422, detail="Хүнийг өөртэй нь холбох боломжгүй.")
    shared = db.get(SharedAncestryPerson, person_id)
    if shared and shared.family_id != family_id:
        raise HTTPException(status_code=409, detail="Энэ хүн өөр гэр бүлийн зөвшөөрлөөр үндсэн модонд байна.")
    edges = _graph_edges(db)
    if kind == "child":
        existing_edge = db.scalar(select(ParentChildRelationship).where(
            ParentChildRelationship.parent_id == target_id,
            ParentChildRelationship.child_id == person_id,
        ))
        if existing_edge and existing_edge.relationship_type != relationship_type:
            raise HTTPException(status_code=409, detail="Бодит эцэг/эхийн холбооны төрөл өөр байна.")
        if existing_edge and shared:
            raise HTTPException(status_code=409, detail="Энэ эцэг/эх–хүүхдийн холбоо үндсэн модонд аль хэдийн байна.")
        if not existing_edge and (target_id, person_id) in edges:
            raise HTTPException(status_code=409, detail="Хуучин холбоог админ эхлээд шалгах шаардлагатай.")
        parents = {parent for parent, child in edges if child == person_id}
        if len(parents | {target_id}) > 2:
            raise HTTPException(status_code=409, detail="Нэг хүнд хоёр хүртэлх эцэг/эх холбож болно.")
        try:
            assert_parent_child_is_acyclic(edges, target_id, person_id)
        except RelationshipError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return existing_edge
    if not _person_in_family(db, family_id, target_id):
        raise HTTPException(status_code=422, detail="Хос нэг гэр бүлд бүртгэлтэй байх ёстой.")
    try:
        # Both directions are checked so an ancestor/descendant cannot be a spouse.
        assert_parent_child_is_acyclic(edges, person_id, target_id)
        assert_parent_child_is_acyclic(edges, target_id, person_id)
    except RelationshipError as error:
        raise HTTPException(status_code=422, detail="Эцэг/эх, үр удмын холбоотой хүмүүсийг хос болгож болохгүй.") from error
    first, second = canonical_pair(person_id, target_id)
    active = db.scalars(select(Marriage).where(
        or_(Marriage.person_1_id.in_((first, second)), Marriage.person_2_id.in_((first, second))),
        Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
    )).all()
    existing = next((marriage for marriage in active
                     if (marriage.person_1_id, marriage.person_2_id) == (first, second)), None)
    if any(marriage is not existing for marriage in active):
        raise HTTPException(status_code=409, detail="Энэ хүний өөр хос бүртгэлтэй байна. Бодит гэрлэлтийн бүртгэлийг шалгана уу.")
    if existing and existing.status != relationship_type:
        raise HTTPException(status_code=409, detail="Бүртгэлтэй хосын төлөв сонголтоос өөр байна.")
    if existing and shared:
        raise HTTPException(status_code=409, detail="Энэ хосын холбоо үндсэн модонд аль хэдийн байна.")
    return existing


@family_router.get("/{family_id}/shared-ancestry-requests", response_model=list[SharedRequestOut])
def list_my_requests(family_id: UUID, limit: int = Query(default=100, ge=1, le=100),
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _family_member(db, family_id, user)
    rows = db.scalars(select(SharedAncestryRequest).where(
        SharedAncestryRequest.family_id == family_id, SharedAncestryRequest.requested_by == user.id,
    ).order_by(SharedAncestryRequest.requested_at.desc(), SharedAncestryRequest.id).limit(limit)).all()
    return [_out(db, row) for row in rows]


@family_router.post("/{family_id}/shared-ancestry-requests", response_model=SharedRequestOut, status_code=201)
def request_shared_change(family_id: UUID, body: SharedRequestInput,
                          user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lock_ancestry_writes(db)
    member = _family_member(db, family_id, user)
    if body.kind == "detach":
        _detach_authority(db, family_id, body.person_id, user)
    else:
        _root_connection_person(db, family_id, body.person_id, user, member)
        if body.target_person_id is None or body.relationship_type is None:
            raise HTTPException(status_code=422, detail="Холбох хүн болон холбооны төрөл сонгоно уу.")
        _validate_addition(db, family_id, body.person_id, body.target_person_id,
                           body.kind, body.relationship_type)
    if db.scalar(select(SharedAncestryRequest.id).where(
        SharedAncestryRequest.person_id == body.person_id,
        SharedAncestryRequest.status == "pending",
    ).limit(1)):
        raise HTTPException(status_code=409, detail="Энэ хүний хүсэлт админы зөвшөөрөл хүлээж байна.")
    row = SharedAncestryRequest(
        family_id=family_id, person_id=body.person_id, target_person_id=body.target_person_id,
        kind=body.kind, relationship_type=body.relationship_type, requested_by=user.id,
        consented_at=datetime.now(UTC) if body.share_consent and body.kind != "detach" else None,
    )
    db.add(row)
    db.add(AuditLog(actor_id=user.id, family_id=family_id,
                    action="shared_ancestry.change_requested", target_type="person", target_id=body.person_id))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Энэ хүний хүсэлт аль хэдийн бүртгэлтэй байна.") from error
    return _out(db, row)


@family_router.post("/{family_id}/shared-ancestry-requests/{request_id}/cancel", response_model=SharedRequestOut)
def cancel_my_request(family_id: UUID, request_id: UUID,
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lock_ancestry_writes(db)
    _family_member(db, family_id, user)
    row = db.scalar(select(SharedAncestryRequest).where(
        SharedAncestryRequest.id == request_id, SharedAncestryRequest.family_id == family_id,
        SharedAncestryRequest.requested_by == user.id,
    ).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Таны хүсэлт олдсонгүй.")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="Хүсэлт аль хэдийн шийдвэрлэгдсэн байна.")
    row.status = "cancelled"
    row.decided_by = user.id
    row.decided_at = datetime.now(UTC)
    db.add(AuditLog(actor_id=user.id, family_id=family_id,
                    action="shared_ancestry.change_cancelled", target_type="shared_ancestry_request",
                    target_id=row.id))
    db.commit()
    return _out(db, row)


@admin_router.get("/requests", response_model=list[SharedRequestOut])
def list_shared_requests(status: Literal["pending", "approved", "rejected", "cancelled"] = "pending",
                         limit: int = Query(default=100, ge=1, le=100),
                         current: tuple[User, AdminRole] = Depends(require_super_admin),
                         db: Session = Depends(get_db)):
    rows = db.scalars(select(SharedAncestryRequest).where(
        SharedAncestryRequest.status == status,
    ).order_by(SharedAncestryRequest.requested_at, SharedAncestryRequest.id).limit(limit)).all()
    return [_out(db, row) for row in rows]


@admin_router.post("/requests/{request_id}/decision", response_model=SharedRequestOut)
def decide_shared_request(request_id: UUID, body: SharedRequestDecision,
                          current: tuple[User, AdminRole] = Depends(require_super_admin),
                          db: Session = Depends(get_db)):
    lock_ancestry_writes(db)
    row = db.scalar(select(SharedAncestryRequest).where(
        SharedAncestryRequest.id == request_id,
    ).with_for_update())
    if row is None or row.status != "pending":
        raise HTTPException(status_code=409, detail="Шалгах идэвхтэй хүсэлт алга.")
    if body.approve:
        _lock_review_context(db, row.family_id, row.person_id, row.target_person_id, row.requested_by)
        requester = db.get(User, row.requested_by, populate_existing=True)
        if requester is None or not requester.is_active:
            raise HTTPException(status_code=409, detail="Хүсэлт гаргасан аккаунт идэвхгүй байна.")
        try:
            member = _family_member(db, row.family_id, requester)
            if row.kind == "detach":
                association = _detach_authority(db, row.family_id, row.person_id, requester)
                db.execute(delete(SharedAncestryRelationship).where(
                    or_(SharedAncestryRelationship.parent_id == row.person_id,
                        SharedAncestryRelationship.child_id == row.person_id),
                ))
                db.delete(association)
            else:
                if row.consented_at is None:
                    raise HTTPException(status_code=409, detail="Нийтлэх зөвшөөрөл алга.")
                if row.target_person_id is None or row.relationship_type is None:
                    raise HTTPException(status_code=409, detail="Хүсэлтийн хүн эсвэл холбооны төрөл дутуу байна.")
                _root_connection_person(db, row.family_id, row.person_id, requester, member)
                existing = _validate_addition(db, row.family_id, row.person_id, row.target_person_id,
                                               row.kind, row.relationship_type)
                if row.kind == "child":
                    if existing is not None and not isinstance(existing, ParentChildRelationship):
                        raise HTTPException(status_code=409, detail="Холбооны төрөл тохирохгүй байна.")
                    if existing is None:
                        existing = ParentChildRelationship(parent_id=row.target_person_id, child_id=row.person_id,
                                                            relationship_type=row.relationship_type,
                                                            created_by=current[0].id)
                        db.add(existing)
                    db.flush()
                    row.canonical_edge_id = existing.id
                else:
                    if existing is not None and not isinstance(existing, Marriage):
                        raise HTTPException(status_code=409, detail="Холбооны төрөл тохирохгүй байна.")
                    if existing is None:
                        first, second = canonical_pair(row.person_id, row.target_person_id)
                        existing = Marriage(person_1_id=first, person_2_id=second,
                                            status=row.relationship_type, created_by=current[0].id)
                        db.add(existing)
                    db.flush()
                    row.canonical_marriage_id = existing.id
                if db.get(SharedAncestryPerson, row.person_id) is None:
                    db.add(SharedAncestryPerson(person_id=row.person_id, family_id=row.family_id,
                                                added_by=row.requested_by))
        except HTTPException:
            db.rollback()
            raise
        except IntegrityError as error:
            db.rollback()
            raise HTTPException(status_code=409, detail="Бодит холбоо өөрчлөгдсөн байна. Дахин шалгана уу.") from error
    row.status = "approved" if body.approve else "rejected"
    row.decided_by = current[0].id
    row.decided_at = datetime.now(UTC)
    db.add(AuditLog(actor_id=current[0].id, family_id=row.family_id,
                    action="shared_ancestry.change_approved" if body.approve else "shared_ancestry.change_rejected",
                    target_type="shared_ancestry_request", target_id=row.id))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Холбоо өөрчлөгдсөн байна. Дахин шалгана уу.") from error
    return _out(db, row)

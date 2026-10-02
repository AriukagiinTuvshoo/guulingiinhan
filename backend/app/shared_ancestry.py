"""Account-wide genealogy tree with explicit per-person sharing."""

from datetime import UTC, datetime
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import or_, select
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
    Person,
    SharedAncestry,
    SharedAncestryPerson,
    SharedAncestryRelationship,
    SharedDonationInfo,
    User,
    UserPersonLink,
)
from app.privacy import person_is_minor
from app.relationships import RelationshipError, assert_parent_child_is_acyclic

router = APIRouter(prefix="/shared-lineage", tags=["shared lineage"])
admin_router = APIRouter(prefix="/admin/shared-lineage", tags=["admin shared lineage"])


class SharedPersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    first_name: str
    last_name: str
    middle_name: str | None
    gender: str
    birth_date: str | None
    is_alive: bool
    death_date: str | None
    shared_by_me: bool


class SharedEdgeOut(BaseModel):
    id: UUID
    parent_id: UUID
    child_id: UUID
    relationship_type: str


class SharedTreeOut(BaseModel):
    name: str
    root_person_id: UUID | None
    persons: list[SharedPersonOut]
    relationships: list[SharedEdgeOut]
    my_person_id: UUID | None


class JoinTreeInput(BaseModel):
    person_id: UUID
    parent_person_id: UUID | None = None
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive|step)$")
    share_consent: bool


class MyPlacementInput(BaseModel):
    parent_person_id: UUID | None = None
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive|step)$")


class CandidateOut(BaseModel):
    id: UUID
    name: str
    family_name: str
    birth_date: str | None
    is_alive: bool


class RootInput(BaseModel):
    person_id: UUID
    expected_root_person_id: UUID | None = None


class AdminSharedRelationshipInput(BaseModel):
    parent_person_id: UUID
    child_person_id: UUID
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive|step)$")


class DonationInfoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(default="", max_length=180)
    purpose: str = Field(default="", max_length=4000)
    currency: str = Field(default="MNT", min_length=3, max_length=3)
    bank_name: str = Field(default="", max_length=120)
    account_name: str = Field(default="", max_length=180)
    account_number: str = Field(default="", max_length=80)
    qr_image_url: str | None = Field(default=None, max_length=1000)
    is_published: bool = False

    @field_validator("currency")
    @classmethod
    def currency_code(cls, value: str) -> str:
        code = value.strip().upper()
        if not code.isascii() or not code.isalpha():
            raise ValueError("Валютын код гурван латин үсэг байна.")
        return code

    @field_validator("qr_image_url")
    @classmethod
    def secure_qr_image_url(cls, value: str | None) -> str | None:
        value = value.strip() if value else None
        if value is None:
            return None
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("QR зураг HTTPS хаягтай байна.")
        return value

    @model_validator(mode="after")
    def published_has_payment_route(self):
        if self.is_published and not any((self.account_number.strip(), self.qr_image_url)):
            raise ValueError("Нийтлэхийн өмнө дансны дугаар эсвэл QR зураг оруулна уу.")
        return self


class DonationInfoOut(BaseModel):
    id: int
    title: str
    purpose: str
    currency: str
    bank_name: str
    account_name: str
    account_number: str
    qr_image_url: str | None
    is_published: bool


def _my_linked_person(db: Session, user: User) -> Person | None:
    return db.scalar(
        select(Person).join(UserPersonLink, UserPersonLink.person_id == Person.id)
        .where(UserPersonLink.user_id == user.id)
    )


def _tree_row(db: Session) -> SharedAncestry | None:
    return db.get(SharedAncestry, 1)


def _donation_info_out(row: SharedDonationInfo) -> DonationInfoOut:
    return DonationInfoOut.model_validate(row, from_attributes=True)


def _person_shared_data(person: Person, shared_by_me: bool) -> SharedPersonOut:
    return SharedPersonOut(
        id=person.id, first_name=person.first_name, last_name=person.last_name,
        middle_name=person.middle_name, gender=person.gender,
        birth_date=person.birth_date.isoformat() if person.birth_date else None,
        is_alive=person.is_alive,
        death_date=person.death_date.isoformat() if person.death_date else None,
        shared_by_me=shared_by_me,
    )


@router.get("", response_model=SharedTreeOut)
def read_shared_tree(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ancestry = _tree_row(db)
    rows = db.execute(
        select(Person, SharedAncestryPerson.family_id, SharedAncestryPerson.added_by)
        .join(SharedAncestryPerson, SharedAncestryPerson.person_id == Person.id)
        .where(Person.visibility != "private")
        .order_by(Person.search_last_name, Person.search_first_name, Person.id)
        .limit(2001)
    ).all()
    people = [row[0] for row in rows]
    if ancestry and ancestry.root_person_id:
        root = db.get(Person, ancestry.root_person_id)
        family_id = db.scalar(select(FamilyPerson.family_id).where(
            FamilyPerson.person_id == ancestry.root_person_id
        ).order_by(FamilyPerson.created_at).limit(1))
        if root and family_id and root.visibility != "private" and not person_is_minor(root):
            people = [root, *(person for person in people if person.id != root.id)]
            rows = [(person, family_id if person.id == root.id else next(row[1] for row in rows if row[0].id == person.id),
                     user.id if person.id == root.id else next(row[2] for row in rows if row[0].id == person.id))
                    for person in people]
    rows = [row for row in rows if not person_is_minor(row[0]) and row[0].visibility != "private"]
    visible_ids = {row[0].id for row in rows}
    edges = db.scalars(select(SharedAncestryRelationship).where(
        SharedAncestryRelationship.parent_id.in_(visible_ids),
        SharedAncestryRelationship.child_id.in_(visible_ids),
    ).order_by(SharedAncestryRelationship.created_at, SharedAncestryRelationship.id)).all() if visible_ids else []
    linked = _my_linked_person(db, user)
    return SharedTreeOut(
        name="Гуулингийнхан",
        root_person_id=ancestry.root_person_id if ancestry else None,
        persons=[_person_shared_data(person, added_by == user.id)
                 for person, family_id, added_by in rows],
        relationships=[SharedEdgeOut.model_validate(edge, from_attributes=True) for edge in edges],
        my_person_id=linked.id if linked else None,
    )


@router.post("/join", response_model=SharedTreeOut, status_code=201)
def join_shared_tree(body: JoinTreeInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.share_consent:
        raise HTTPException(status_code=422, detail="Нийтлэг модонд нийтлэх зөвшөөрөл шаардлагатай.")
    linked = _my_linked_person(db, user)
    if linked is None or linked.id != body.person_id:
        raise HTTPException(status_code=403, detail="Нийтлэг модонд зөвхөн өөрийн баталгаажсан хүнийг холбож болно.")
    if linked.visibility == "private" or person_is_minor(linked):
        raise HTTPException(status_code=422, detail="Хувийн эсвэл насанд хүрээгүй хүнийг нийтлэг модонд холбох боломжгүй.")
    family_row = db.execute(
        select(FamilyPerson.family_id, Family.archived_at)
        .join(Family, Family.id == FamilyPerson.family_id)
        .join(FamilyMember, FamilyMember.family_id == Family.id)
        .where(FamilyPerson.person_id == linked.id, FamilyMember.user_id == user.id)
        .order_by(FamilyPerson.created_at, FamilyPerson.family_id).limit(1)
    ).first()
    if family_row is None or family_row.archived_at is not None:
        raise HTTPException(status_code=403, detail="Хүний гэр бүлийн орчинд гишүүнчлэл шаардлагатай.")
    if db.get(SharedAncestryPerson, linked.id):
        raise HTTPException(status_code=409, detail="Та нийтлэг модонд аль хэдийн холбогдсон байна.")

    db.add(SharedAncestryPerson(person_id=linked.id, family_id=family_row.family_id, added_by=user.id))
    if body.parent_person_id:
        parent = db.get(Person, body.parent_person_id)
        parent_member = db.get(SharedAncestryPerson, body.parent_person_id)
        root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
        if parent is None or parent.visibility == "private" or person_is_minor(parent) or not (parent_member or parent.id == root_id):
            db.rollback()
            raise HTTPException(status_code=404, detail="Нийтлэг модонд байгаа хүн олдсонгүй.")
        current_edges = db.execute(select(
            SharedAncestryRelationship.parent_id, SharedAncestryRelationship.child_id
        )).all()
        try:
            assert_parent_child_is_acyclic(current_edges, body.parent_person_id, linked.id)
        except RelationshipError as error:
            db.rollback()
            raise HTTPException(status_code=422, detail=str(error)) from error
        db.add(SharedAncestryRelationship(parent_id=body.parent_person_id, child_id=linked.id,
                                          relationship_type=body.relationship_type, created_by=user.id))
    db.add(AuditLog(actor_id=user.id, family_id=family_row.family_id,
                    action="shared_ancestry.person_joined", target_type="person", target_id=linked.id))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Энэ хүн нийтлэг модонд аль хэдийн холбогдсон байна.") from error
    return read_shared_tree(user, db)


@router.put("/relationships/me", response_model=SharedTreeOut)
def change_my_shared_placement(
    body: MyPlacementInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Let a person correct or remove only their own global parent placement."""
    person = _my_linked_person(db, user)
    if person is None:
        raise HTTPException(status_code=404, detail="Аккаунттай холбосон хүн олдсонгүй.")
    association = db.get(SharedAncestryPerson, person.id)
    if association is None or association.added_by != user.id:
        raise HTTPException(status_code=403, detail="Өөрийн нийтлэг модны хүнийг эхлээд холбож, зөвшөөрнө үү.")
    root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
    if person.id == root_id:
        raise HTTPException(status_code=409, detail="Үндсэн удмын эхийн байрлалыг өөрчлөх боломжгүй.")

    existing = db.scalars(select(SharedAncestryRelationship).where(
        SharedAncestryRelationship.child_id == person.id,
    )).all()
    if body.parent_person_id is not None:
        parent = db.get(Person, body.parent_person_id)
        parent_member = db.get(SharedAncestryPerson, body.parent_person_id)
        if parent is None or parent.visibility == "private" or person_is_minor(parent) or not (
            parent_member or parent.id == root_id
        ):
            raise HTTPException(status_code=404, detail="Нийтлэг модонд байгаа хүн олдсонгүй.")
        edges = db.execute(select(
            SharedAncestryRelationship.parent_id, SharedAncestryRelationship.child_id
        ).where(SharedAncestryRelationship.child_id != person.id)).all()
        try:
            assert_parent_child_is_acyclic(edges, body.parent_person_id, person.id)
        except RelationshipError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    for relation in existing:
        db.delete(relation)
    db.flush()
    if body.parent_person_id is not None:
        db.add(SharedAncestryRelationship(
            parent_id=body.parent_person_id, child_id=person.id,
            relationship_type=body.relationship_type, created_by=user.id,
        ))
    db.add(AuditLog(
        actor_id=user.id, family_id=association.family_id,
        action="shared_ancestry.placement_changed", target_type="person", target_id=person.id,
    ))
    db.commit()
    return read_shared_tree(user, db)


@router.delete("/people/me", status_code=204)
def leave_shared_tree(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    person = _my_linked_person(db, user)
    if person is None:
        raise HTTPException(status_code=404, detail="Аккаунттай холбосон хүн олдсонгүй.")
    association = db.get(SharedAncestryPerson, person.id)
    if association is None:
        return Response(status_code=204)
    if association.added_by != user.id:
        raise HTTPException(status_code=403, detail="Энэ хүнийг нийтлэг модонд өөр хүн нэмсэн байна.")
    if person.id == db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1)):
        raise HTTPException(status_code=409, detail="Үндсэн удмын эхийг зөвхөн ерөнхий админ өөрчилнө.")
    referenced = db.scalar(select(SharedAncestryRelationship.id).where(
        SharedAncestryRelationship.parent_id == person.id,
    ).limit(1))
    if referenced:
        raise HTTPException(status_code=409, detail="Таны хүн нийтлэг модонд хүүхэдтэй байна. Хүүхэд бүр өөрийн холболтоо цуцалсны дараа салгаж болно.")
    db.execute(SharedAncestryRelationship.__table__.delete().where(
        or_(SharedAncestryRelationship.parent_id == person.id, SharedAncestryRelationship.child_id == person.id)
    ))
    db.delete(association)
    db.add(AuditLog(actor_id=user.id, family_id=association.family_id,
                    action="shared_ancestry.person_left", target_type="person", target_id=person.id))
    db.commit()
    return Response(status_code=204)


@router.get("/donation-info", response_model=DonationInfoOut | None)
def read_donation_info(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(SharedDonationInfo, 1)
    if row is None or not row.is_published:
        return None
    return _donation_info_out(row)


@admin_router.get("/candidates", response_model=list[CandidateOut])
def shared_root_candidates(_: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Person, Family.name)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .join(Family, Family.id == FamilyPerson.family_id)
        .where(Person.visibility != "private", Family.archived_at.is_(None))
        .order_by(Person.last_name, Person.first_name, Family.name, Person.id)
    ).all()
    seen: set[UUID] = set()
    result = []
    for person, family_name in rows:
        if person.id in seen or person_is_minor(person):
            continue
        seen.add(person.id)
        result.append(CandidateOut(
            id=person.id, name=" ".join(part for part in (person.last_name, person.first_name, person.middle_name) if part),
            family_name=family_name, birth_date=person.birth_date.isoformat() if person.birth_date else None,
            is_alive=person.is_alive,
        ))
    return result


@admin_router.put("/root", response_model=SharedTreeOut)
def set_shared_root(body: RootInput, current: tuple[User, AdminRole] = Depends(require_super_admin),
                    db: Session = Depends(get_db)):
    person = db.scalar(select(Person).join(FamilyPerson, FamilyPerson.person_id == Person.id)
                        .join(Family, Family.id == FamilyPerson.family_id)
                        .where(Person.id == body.person_id, Person.visibility != "private",
                               Family.archived_at.is_(None)))
    if person is None or person_is_minor(person):
        raise HTTPException(status_code=422, detail="Үндсэн модонд нийтлэх боломжтой насанд хүрсэн хүн сонгоно уу.")
    row = db.scalar(select(SharedAncestry).where(SharedAncestry.id == 1).with_for_update())
    previous_root_id = row.root_person_id if row else None
    if previous_root_id != body.expected_root_person_id:
        raise HTTPException(status_code=409, detail="Үндсэн удмын эх өөрчлөгдсөн байна. Хуудсыг шинэчлээд дахин оролдоно уу.")
    if previous_root_id == person.id:
        return read_shared_tree(current[0], db)
    if row is None:
        row = SharedAncestry(id=1, root_person_id=person.id, created_by=current[0].id)
        db.add(row)
    else:
        # Keep the former admin-designated root visible so existing global edges remain intact.
        previous_root = db.get(Person, previous_root_id) if previous_root_id else None
        if previous_root_id and db.get(SharedAncestryPerson, previous_root_id) is None:
            previous_family_id = db.scalar(
                select(FamilyPerson.family_id).where(FamilyPerson.person_id == previous_root_id)
                .order_by(FamilyPerson.created_at, FamilyPerson.family_id).limit(1)
            )
            if previous_root is None or previous_family_id is None:
                raise HTTPException(status_code=409, detail="Өмнөх удмын эхийг нийтлэг модонд хадгалж чадсангүй.")
            db.add(SharedAncestryPerson(
                person_id=previous_root_id, family_id=previous_family_id, added_by=current[0].id,
            ))
        row.root_person_id = person.id
        row.updated_at = datetime.now(UTC)
    if previous_root_id:
        db.add(AuditLog(actor_id=current[0].id, family_id=None,
                        action="shared_ancestry.root_replaced_from", target_type="person",
                        target_id=previous_root_id))
        db.add(AuditLog(actor_id=current[0].id, family_id=None,
                        action="shared_ancestry.root_replaced_to", target_type="person",
                        target_id=person.id))
    else:
        db.add(AuditLog(actor_id=current[0].id, family_id=None,
                        action="shared_ancestry.root_set", target_type="person", target_id=person.id))
    db.commit()
    return read_shared_tree(current[0], db)


@admin_router.post("/relationships", response_model=SharedTreeOut, status_code=201)
def add_shared_relationship(
    body: AdminSharedRelationshipInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Connect two people already visible in the consent based shared tree."""
    root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
    if body.parent_person_id == body.child_person_id or body.child_person_id == root_id:
        raise HTTPException(status_code=422, detail="Үндсэн эхийг хүүхэд болгох эсвэл хүнийг өөртэй нь холбох боломжгүй.")
    for person_id in (body.parent_person_id, body.child_person_id):
        person = db.get(Person, person_id)
        if person is None or person.visibility == "private" or person_is_minor(person) or not (
            person_id == root_id or db.get(SharedAncestryPerson, person_id)
        ):
            raise HTTPException(status_code=404, detail="Нийтлэг модонд зөвшөөрлөөр орсон хүн олдсонгүй.")
    edges = db.execute(select(
        SharedAncestryRelationship.parent_id, SharedAncestryRelationship.child_id
    )).all()
    try:
        assert_parent_child_is_acyclic(edges, body.parent_person_id, body.child_person_id)
    except RelationshipError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if any(parent == body.parent_person_id and child == body.child_person_id for parent, child in edges):
        raise HTTPException(status_code=409, detail="Энэ хоёр хүн аль хэдийн холбогдсон байна.")
    if sum(child == body.child_person_id for _, child in edges) >= 2:
        raise HTTPException(status_code=409, detail="Нэг хүнд хоёр хүртэлх эцэг эх холбож болно.")
    edge = SharedAncestryRelationship(
        parent_id=body.parent_person_id, child_id=body.child_person_id,
        relationship_type=body.relationship_type, created_by=current[0].id,
    )
    db.add(edge)
    db.flush()
    db.add(AuditLog(actor_id=current[0].id, family_id=None,
                    action="shared_ancestry.relationship_added", target_type="relationship", target_id=edge.id))
    db.commit()
    return read_shared_tree(current[0], db)


@admin_router.delete("/relationships/{relationship_id}", response_model=SharedTreeOut)
def remove_shared_relationship(
    relationship_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    edge = db.get(SharedAncestryRelationship, relationship_id)
    if edge is None:
        raise HTTPException(status_code=404, detail="Нийтлэг модны холбоос олдсонгүй.")
    db.delete(edge)
    db.add(AuditLog(actor_id=current[0].id, family_id=None,
                    action="shared_ancestry.relationship_removed", target_type="relationship", target_id=relationship_id))
    db.commit()
    return read_shared_tree(current[0], db)


@admin_router.get("/donation-info", response_model=DonationInfoOut | None)
def read_admin_donation_info(_: tuple[User, AdminRole] = Depends(require_super_admin),
                             db: Session = Depends(get_db)):
    row = db.get(SharedDonationInfo, 1)
    return _donation_info_out(row) if row else None


@admin_router.put("/donation-info", response_model=DonationInfoOut)
def save_donation_info(body: DonationInfoInput,
                       current: tuple[User, AdminRole] = Depends(require_super_admin),
                       db: Session = Depends(get_db)):
    values = body.model_dump()
    for key in ("title", "purpose", "bank_name", "account_name", "account_number"):
        values[key] = values[key].strip()
    row = db.get(SharedDonationInfo, 1)
    if row is None:
        row = SharedDonationInfo(id=1, created_by=current[0].id, **values)
        db.add(row)
    else:
        for key, value in values.items():
            setattr(row, key, value)
        row.updated_at = datetime.now(UTC)
    db.add(AuditLog(actor_id=current[0].id, family_id=None,
                    action="admin.shared_donation_info_saved", target_type="shared_donation_info"))
    db.commit()
    db.refresh(row)
    return _donation_info_out(row)

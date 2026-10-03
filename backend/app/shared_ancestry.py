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
    ParentChildRelationship,
    Person,
    RootConnection,
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
family_router = APIRouter(prefix="/families", tags=["root connection"])


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


class RootConnectionInput(BaseModel):
    person_id: UUID
    target_person_id: UUID
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive|step)$")
    share_consent: bool


class RootConnectionOut(BaseModel):
    family_id: UUID
    family_name: str | None = None
    status: str
    person_id: UUID | None = None
    person_name: str | None = None
    target_person_id: UUID | None = None
    target_name: str | None = None
    relationship_type: str | None = None
    can_request: bool


class RootConnectionDecision(BaseModel):
    approve: bool


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
    family_id: UUID
    birth_date: str | None
    is_alive: bool


class RootInput(BaseModel):
    person_id: UUID
    expected_root_person_id: UUID | None = None


class AdminSharedRelationshipInput(BaseModel):
    parent_person_id: UUID
    child_person_id: UUID
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive|step)$")


class AdminPublishPersonInput(BaseModel):
    person_id: UUID
    family_id: UUID


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
        # Shared context needs generation context, not exact personal dates.
        birth_date=str(person.birth_date.year) if person.birth_date else None,
        is_alive=person.is_alive,
        death_date=str(person.death_date.year) if person.death_date else None,
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
    canonical_edges = db.scalars(select(ParentChildRelationship).where(
        ParentChildRelationship.parent_id.in_(visible_ids),
        ParentChildRelationship.child_id.in_(visible_ids),
    ).order_by(ParentChildRelationship.created_at, ParentChildRelationship.id)).all() if visible_ids else []
    legacy_edges = db.scalars(select(SharedAncestryRelationship).where(
        SharedAncestryRelationship.parent_id.in_(visible_ids),
        SharedAncestryRelationship.child_id.in_(visible_ids),
    ).order_by(SharedAncestryRelationship.created_at, SharedAncestryRelationship.id)).all() if visible_ids else []
    family_by_person = {person.id: family_id for person, family_id, _ in rows}
    connections = {row.family_id: row for row in db.scalars(
        select(RootConnection).where(RootConnection.family_id.in_(set(family_by_person.values())))
    ).all()} if family_by_person else {}

    def projection_allows(edge) -> bool:
        child_family = family_by_person.get(edge.child_id)
        parent_family = family_by_person.get(edge.parent_id)
        connection = connections.get(child_family)
        if connection and connection.person_id == edge.child_id and parent_family != child_family:
            return connection.status == "approved" and connection.target_person_id == edge.parent_id
        return True

    canonical_edges = [edge for edge in canonical_edges if projection_allows(edge)]
    legacy_edges = [edge for edge in legacy_edges if projection_allows(edge)]
    canonical_pairs = {(edge.parent_id, edge.child_id) for edge in canonical_edges}
    edges = [*canonical_edges, *(edge for edge in legacy_edges
                                if (edge.parent_id, edge.child_id) not in canonical_pairs)]
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

    if body.parent_person_id:
        _shared_target(db, body.parent_person_id)
        if not _person_in_family(db, family_row.family_id, body.parent_person_id):
            raise HTTPException(status_code=409, detail="Бусад гэр бүлийн салбарт холбогдох хүсэлт илгээнэ үү.")
        edge = db.scalar(select(ParentChildRelationship).where(
            ParentChildRelationship.parent_id == body.parent_person_id,
            ParentChildRelationship.child_id == linked.id,
        ))
        if edge is None or edge.relationship_type != body.relationship_type:
            raise HTTPException(status_code=422, detail="Энэ эцэг/эхийн бодит холбоог гэр бүлийн модонд эхлээд баталгаажуулна уу.")
    db.add(SharedAncestryPerson(person_id=linked.id, family_id=family_row.family_id, added_by=user.id))
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
        _shared_target(db, body.parent_person_id)
        if not _person_in_family(db, association.family_id, body.parent_person_id):
            raise HTTPException(status_code=409, detail="Бусад гэр бүлийн салбарт холбогдох хүсэлт илгээнэ үү.")
        edge = db.scalar(select(ParentChildRelationship).where(
            ParentChildRelationship.parent_id == body.parent_person_id,
            ParentChildRelationship.child_id == person.id,
        ))
        if edge is None or edge.relationship_type != body.relationship_type:
            raise HTTPException(status_code=422, detail="Бодит эцэг/эхийн холбоо бүртгэгдээгүй байна.")

    for relation in existing:
        db.delete(relation)
    db.flush()
    # Legacy placement edges can be removed. New ancestry edges always come
    # from ParentChildRelationship, never a second genealogy graph.
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
    connection = db.get(RootConnection, association.family_id)
    if connection and connection.person_id == person.id and connection.status in {"pending", "approved"}:
        connection.status = "disconnected"
        connection.decided_by = user.id
        connection.decided_at = datetime.now(UTC)
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
        select(Person, Family.name, Family.id)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .join(Family, Family.id == FamilyPerson.family_id)
        .where(Person.visibility != "private", Family.archived_at.is_(None))
        .order_by(Person.last_name, Person.first_name, Family.name, Person.id)
    ).all()
    seen: set[UUID] = set()
    result = []
    for person, family_name, family_id in rows:
        if person.id in seen or person_is_minor(person):
            continue
        seen.add(person.id)
        result.append(CandidateOut(
            id=person.id, name=" ".join(part for part in (person.last_name, person.first_name, person.middle_name) if part),
            family_name=family_name, family_id=family_id,
            birth_date=person.birth_date.isoformat() if person.birth_date else None,
            is_alive=person.is_alive,
        ))
    return result


@admin_router.post("/people", response_model=SharedTreeOut, status_code=201)
def publish_existing_person(
    body: AdminPublishPersonInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Publish a real, existing non-account ancestor; never fabricate genealogy records."""
    person = db.scalar(
        select(Person).join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .join(Family, Family.id == FamilyPerson.family_id)
        .where(Person.id == body.person_id, FamilyPerson.family_id == body.family_id,
               Family.archived_at.is_(None))
    )
    if person is None or person.visibility == "private" or person_is_minor(person):
        raise HTTPException(status_code=422, detail="Нийтлэг модонд нийтлэх боломжтой бодит хүн сонгоно уу.")
    if person.is_alive and person.visibility != "public":
        raise HTTPException(status_code=422, detail="Амьд хүнийг нийтлэхийн өмнө харагдах хүрээг нь нийтийн болгож, зөвшөөрлийг нь шалгана уу.")
    if db.scalar(select(UserPersonLink.user_id).where(UserPersonLink.person_id == person.id)):
        raise HTTPException(status_code=403, detail="Аккаунттай холбогдсон хүн зөвшөөрлөө өөрөө өгч нийтлэг модонд орно.")
    if db.get(SharedAncestryPerson, person.id):
        raise HTTPException(status_code=409, detail="Энэ хүн нийтлэг модонд аль хэдийн байна.")
    db.add(SharedAncestryPerson(person_id=person.id, family_id=body.family_id,
                                added_by=current[0].id))
    db.add(AuditLog(actor_id=current[0].id, family_id=body.family_id,
                    action="shared_ancestry.person_published", target_type="person", target_id=person.id))
    db.commit()
    return read_shared_tree(current[0], db)


def _shared_target(db: Session, person_id: UUID) -> Person:
    root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
    person = db.get(Person, person_id)
    if person is None or person.visibility == "private" or person_is_minor(person) or not (
        person_id == root_id or db.get(SharedAncestryPerson, person_id)
    ):
        raise HTTPException(status_code=404, detail="Үндэс модны зөвшөөрөгдсөн хүн олдсонгүй.")
    if root_id is None:
        raise HTTPException(status_code=409, detail="Үндэс модны эх хүн хараахан батлагдаагүй байна.")
    shared_rows = db.execute(
        select(Person, SharedAncestryPerson.family_id)
        .join(SharedAncestryPerson, SharedAncestryPerson.person_id == Person.id)
        .where(Person.visibility != "private")
    ).all()
    family_by_person = {shared.id: family_id for shared, family_id in shared_rows
                        if not person_is_minor(shared)}
    visible = set(family_by_person)
    visible.add(root_id)
    connections = {row.family_id: row for row in db.scalars(
        select(RootConnection).where(RootConnection.family_id.in_(set(family_by_person.values())))
    ).all()} if family_by_person else {}
    canonical = db.execute(select(
        ParentChildRelationship.parent_id, ParentChildRelationship.child_id,
    ).where(ParentChildRelationship.parent_id.in_(visible),
            ParentChildRelationship.child_id.in_(visible))).all()
    legacy = db.execute(select(
        SharedAncestryRelationship.parent_id, SharedAncestryRelationship.child_id,
    ).where(SharedAncestryRelationship.parent_id.in_(visible),
            SharedAncestryRelationship.child_id.in_(visible))).all()
    children: dict[UUID, set[UUID]] = {}
    for parent_id, child_id in [*canonical, *legacy]:
        child_family = family_by_person.get(child_id)
        connection = connections.get(child_family)
        if (connection and connection.person_id == child_id
                and family_by_person.get(parent_id) != child_family
                and (connection.status != "approved" or connection.target_person_id != parent_id)):
            continue
        children.setdefault(parent_id, set()).add(child_id)
    seen = {root_id}
    frontier = [root_id]
    while frontier:
        current = frontier.pop()
        for child_id in children.get(current, ()):
            if child_id not in seen:
                seen.add(child_id)
                frontier.append(child_id)
    if person_id not in seen:
        raise HTTPException(status_code=422, detail="Зөвхөн үндэс модны баталгаатай салбарыг сонгоно уу.")
    return person


def _family_member(db: Session, family_id: UUID, user: User) -> FamilyMember:
    family = db.get(Family, family_id)
    member = db.scalar(select(FamilyMember).where(
        FamilyMember.family_id == family_id, FamilyMember.user_id == user.id,
    ))
    if family is None or family.archived_at is not None or member is None:
        raise HTTPException(status_code=404, detail="Гэр бүл олдсонгүй эсвэл танд хандах эрхгүй.")
    return member


def _person_in_family(db: Session, family_id: UUID, person_id: UUID) -> bool:
    return db.scalar(select(FamilyPerson.id).where(
        FamilyPerson.family_id == family_id, FamilyPerson.person_id == person_id,
    ).limit(1)) is not None


def _connection_out(db: Session, family_id: UUID, user: User) -> RootConnectionOut:
    row = db.get(RootConnection, family_id)
    family = db.get(Family, family_id)
    linked = _my_linked_person(db, user)
    can_request = bool(linked and _person_in_family(db, family_id, linked.id))
    if row is None:
        return RootConnectionOut(family_id=family_id, family_name=family.name if family else None,
                                 status="not_connected", can_request=can_request)
    person = db.get(Person, row.person_id)
    target = db.get(Person, row.target_person_id)
    name = lambda value: " ".join(filter(None, (value.last_name, value.first_name))) if value else None
    return RootConnectionOut(
        family_id=family_id, family_name=family.name if family else None,
        status=row.status, person_id=row.person_id,
        person_name=name(person), target_person_id=row.target_person_id,
        target_name=name(target), relationship_type=row.relationship_type,
        can_request=can_request,
    )


@family_router.get("/{family_id}/root-connection", response_model=RootConnectionOut)
def read_root_connection(family_id: UUID, user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    _family_member(db, family_id, user)
    return _connection_out(db, family_id, user)


@family_router.post("/{family_id}/root-connection", response_model=RootConnectionOut)
def request_root_connection(family_id: UUID, body: RootConnectionInput,
                            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _family_member(db, family_id, user)
    if not body.share_consent:
        raise HTTPException(status_code=422, detail="Үндэс модонд харуулах зөвшөөрөл шаардлагатай.")
    person = _my_linked_person(db, user)
    if person is None or person.id != body.person_id or not _person_in_family(db, family_id, body.person_id):
        raise HTTPException(status_code=403, detail="Зөвхөн өөрийн баталгаажсан хүнийг холбож болно.")
    if person.visibility == "private" or person_is_minor(person):
        raise HTTPException(status_code=422, detail="Хувийн эсвэл насанд хүрээгүй хүнийг холбох боломжгүй.")
    if body.person_id == body.target_person_id:
        raise HTTPException(status_code=422, detail="Хүнийг өөртэй нь холбох боломжгүй.")
    _shared_target(db, body.target_person_id)
    row = db.scalar(select(RootConnection).where(
        RootConnection.family_id == family_id,
    ).with_for_update())
    if row and row.status in {"pending", "approved"}:
        if (row.person_id, row.target_person_id, row.relationship_type) == (
            body.person_id, body.target_person_id, body.relationship_type
        ):
            return _connection_out(db, family_id, user)
        raise HTTPException(status_code=409, detail="Энэ гэр бүлийн холболт аль хэдийн хүсэгдсэн эсвэл батлагдсан.")
    if row is None:
        row = RootConnection(
            family_id=family_id, person_id=body.person_id,
            target_person_id=body.target_person_id,
            relationship_type=body.relationship_type, status="pending", requested_by=user.id,
        )
        db.add(row)
    else:
        row.person_id = body.person_id
        row.target_person_id = body.target_person_id
        row.relationship_type = body.relationship_type
        row.status = "pending"
        row.requested_by = user.id
        row.consented_at = datetime.now(UTC)
        row.requested_at = datetime.now(UTC)
        row.decided_by = None
        row.decided_at = None
        row.canonical_edge_id = None
    db.add(AuditLog(actor_id=user.id, family_id=family_id,
                    action="root_connection.requested", target_type="person", target_id=person.id))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Холболтын хүсэлт аль хэдийн бүртгэгдсэн.") from error
    return _connection_out(db, family_id, user)


@family_router.delete("/{family_id}/root-connection", response_model=RootConnectionOut)
def disconnect_root_connection(family_id: UUID, user: User = Depends(get_current_user),
                               db: Session = Depends(get_db)):
    member = _family_member(db, family_id, user)
    row = db.scalar(select(RootConnection).where(
        RootConnection.family_id == family_id,
    ).with_for_update())
    if row is None:
        return _connection_out(db, family_id, user)
    if member.role != "owner" and row.requested_by != user.id:
        raise HTTPException(status_code=403, detail="Холболтыг зөвхөн хүсэлт гаргасан хүн эсвэл гэр бүлийн эзэн салгана.")
    if row.status != "disconnected":
        row.status = "disconnected"
        row.decided_by = user.id
        row.decided_at = datetime.now(UTC)
        db.add(AuditLog(actor_id=user.id, family_id=family_id,
                        action="root_connection.disconnected", target_type="person", target_id=row.person_id))
        db.commit()
    return _connection_out(db, family_id, user)


@admin_router.get("/connections", response_model=list[RootConnectionOut])
def list_root_connections(current: tuple[User, AdminRole] = Depends(require_super_admin),
                          db: Session = Depends(get_db)):
    rows = db.scalars(select(RootConnection).where(RootConnection.status == "pending")
                      .order_by(RootConnection.requested_at)).all()
    return [_connection_out(db, row.family_id, current[0]) for row in rows]


@admin_router.post("/connections/{family_id}/decision", response_model=RootConnectionOut)
def decide_root_connection(family_id: UUID, body: RootConnectionDecision,
                           current: tuple[User, AdminRole] = Depends(require_super_admin),
                           db: Session = Depends(get_db)):
    row = db.scalar(select(RootConnection).where(
        RootConnection.family_id == family_id,
    ).with_for_update())
    if row is None or row.status != "pending":
        raise HTTPException(status_code=409, detail="Шалгах идэвхтэй хүсэлт алга.")
    if body.approve:
        requester = db.get(User, row.requested_by)
        if requester is None:
            raise HTTPException(status_code=409, detail="Хүсэлт гаргасан аккаунт олдсонгүй.")
        _family_member(db, family_id, requester)
        linked = _my_linked_person(db, requester)
        if linked is None or linked.id != row.person_id or not _person_in_family(db, family_id, row.person_id):
            raise HTTPException(status_code=409, detail="Хүсэлт гаргасан хүний баталгаажсан холбоос өөрчлөгдсөн.")
        if linked.visibility == "private" or person_is_minor(linked):
            raise HTTPException(status_code=422, detail="Энэ хүнийг нийтлэг модонд харуулах боломжгүй.")
        _shared_target(db, row.target_person_id)
        db.execute(select(Family.id).where(Family.id == family_id).with_for_update())
        edges = db.execute(select(
            ParentChildRelationship.parent_id, ParentChildRelationship.child_id,
        )).all()
        legacy_pairs = db.execute(select(
            SharedAncestryRelationship.parent_id, SharedAncestryRelationship.child_id,
        )).all()
        graph_edges = list({*edges, *legacy_pairs})
        try:
            assert_parent_child_is_acyclic(graph_edges, row.target_person_id, row.person_id)
        except RelationshipError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        existing = db.scalar(select(ParentChildRelationship).where(
            ParentChildRelationship.parent_id == row.target_person_id,
            ParentChildRelationship.child_id == row.person_id,
        ))
        if existing is None:
            if sum(child_id == row.person_id for parent_id, child_id in graph_edges
                   if parent_id != row.target_person_id) >= 2:
                raise HTTPException(status_code=409, detail="Энэ хүн хоёр эцэг/эхийн холбоотой байна.")
            existing = ParentChildRelationship(
                parent_id=row.target_person_id, child_id=row.person_id,
                relationship_type=row.relationship_type, created_by=current[0].id,
            )
            db.add(existing)
            db.flush()
        elif existing.relationship_type != row.relationship_type:
            raise HTTPException(status_code=409, detail="Одоогийн бодит холбооны төрөл хүсэлтээс өөр байна.")
        for legacy in db.scalars(select(SharedAncestryRelationship).where(
            SharedAncestryRelationship.parent_id == row.target_person_id,
            SharedAncestryRelationship.child_id == row.person_id,
        )).all():
            db.delete(legacy)
        if db.get(SharedAncestryPerson, row.person_id) is None:
            db.add(SharedAncestryPerson(person_id=row.person_id, family_id=family_id,
                                        added_by=row.requested_by))
        row.canonical_edge_id = existing.id
        row.status = "approved"
    else:
        row.status = "rejected"
    row.decided_by = current[0].id
    row.decided_at = datetime.now(UTC)
    db.add(AuditLog(actor_id=current[0].id, family_id=family_id,
                    action="root_connection.approved" if body.approve else "root_connection.rejected",
                    target_type="person", target_id=row.person_id))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Холболт өөрчлөгдсөн байна. Дахин шалгана уу.") from error
    return _connection_out(db, family_id, current[0])


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
        ParentChildRelationship.parent_id, ParentChildRelationship.child_id
    )).all()
    edges = list({*edges, *db.execute(select(
        SharedAncestryRelationship.parent_id, SharedAncestryRelationship.child_id
    )).all()})
    try:
        assert_parent_child_is_acyclic(edges, body.parent_person_id, body.child_person_id)
    except RelationshipError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if any(parent == body.parent_person_id and child == body.child_person_id for parent, child in edges):
        raise HTTPException(status_code=409, detail="Энэ хоёр хүн аль хэдийн холбогдсон байна.")
    if sum(child == body.child_person_id for _, child in edges) >= 2:
        raise HTTPException(status_code=409, detail="Нэг хүнд хоёр хүртэлх эцэг эх холбож болно.")
    edge = ParentChildRelationship(
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
    edge = db.get(ParentChildRelationship, relationship_id)
    legacy_edge = db.get(SharedAncestryRelationship, relationship_id)
    edge = edge or legacy_edge
    if edge is None:
        raise HTTPException(status_code=404, detail="Нийтлэг модны холбоос олдсонгүй.")
    # A canonical relationship is also shown in the family's own tree. The UI
    # explicitly confirms that both views will change before this endpoint runs.
    if isinstance(edge, ParentChildRelationship):
        for duplicate in db.scalars(select(SharedAncestryRelationship).where(
            SharedAncestryRelationship.parent_id == edge.parent_id,
            SharedAncestryRelationship.child_id == edge.child_id,
        )).all():
            db.delete(duplicate)
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

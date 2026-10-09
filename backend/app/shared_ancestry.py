"""Account-wide genealogy tree with explicit per-person sharing."""

from datetime import UTC, datetime
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_serializer,
    model_validator,
)
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
    RootConnection,
    SharedAncestry,
    SharedAncestryPerson,
    SharedAncestryRelationship,
    SharedDonationInfo,
    User,
    UserPersonLink,
)
from app.privacy import is_minor, person_is_minor
from app.profile_photos import _object_key as _profile_photo_object_key
from app.relationships import (
    RelationshipError,
    assert_parent_child_is_acyclic,
    canonical_pair,
    lock_ancestry_writes,
)
from app.storage import ObjectStorage, get_storage

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
    profile_photo_url: str | None = None

    @model_serializer(mode="wrap")
    def omit_unavailable_portrait(self, handler):
        result = handler(self)
        if self.profile_photo_url is None:
            result.pop("profile_photo_url", None)
        return result


class SharedEdgeOut(BaseModel):
    id: UUID
    parent_id: UUID
    child_id: UUID
    relationship_type: str
    source: str = "canonical"


class SharedSpouseOut(BaseModel):
    id: UUID
    person_1_id: UUID
    person_2_id: UUID
    status: str


class SharedTreeOut(BaseModel):
    name: str
    root_person_id: UUID | None
    persons: list[SharedPersonOut]
    relationships: list[SharedEdgeOut]
    spouses: list[SharedSpouseOut] = Field(default_factory=list)
    root_partner_person_id: UUID | None = None
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
    requested_by_name: str | None = None
    requested_at: datetime | None = None
    decided_at: datetime | None = None
    can_request: bool


class RootConnectionCandidateOut(BaseModel):
    person_id: UUID
    first_name: str
    last_name: str
    middle_name: str | None
    birth_date: str | None
    death_date: str | None
    is_alive: bool
    is_current_user: bool
    parent_person_ids: list[UUID] = Field(default_factory=list)


class RootConnectionDecision(BaseModel):
    approve: bool


class CanonicalRelationshipDelete(BaseModel):
    confirmation: str = Field(pattern="^DELETE_CANONICAL_RELATIONSHIP$")


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
    account_linked: bool = False
    eligible_for_admin_link: bool = False


class RootInput(BaseModel):
    person_id: UUID
    expected_root_person_id: UUID | None = None


class RootPartnerInput(BaseModel):
    person_id: UUID
    expected_root_person_id: UUID
    status: str = Field(default="married", pattern="^(married|widowed)$")


class RootCoupleInput(BaseModel):
    root_person_id: UUID
    partner_person_id: UUID
    family_id: UUID
    expected_root_person_id: UUID | None = None
    status: str = Field(default="married", pattern="^(married|widowed)$")


class AdminConnectPersonInput(BaseModel):
    person_id: UUID
    family_id: UUID
    related_person_id: UUID
    second_parent_person_id: UUID | None = None
    connection_kind: str = Field(pattern="^(child|spouse)$")
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive|step)$")
    spouse_status: str = Field(default="married", pattern="^(married|widowed)$")


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


def _person_shared_data(
    person: Person, shared_by_me: bool, *, profile_photo_url: str | None = None
) -> SharedPersonOut:
    return SharedPersonOut(
        id=person.id, first_name=person.first_name, last_name=person.last_name,
        middle_name=person.middle_name, gender=person.gender,
        # Shared context needs generation context, not exact personal dates.
        birth_date=str(person.birth_date.year) if person.birth_date else None,
        is_alive=person.is_alive,
        death_date=str(person.death_date.year) if person.death_date else None,
        shared_by_me=shared_by_me,
        profile_photo_url=profile_photo_url,
    )


def _person_may_show_shared_portrait(person: Person) -> bool:
    if person.visibility != "public" or person_is_minor(person):
        return False
    # A living person's portrait is sensitive when age is unknown. Historical
    # deceased records continue to follow the existing minor policy.
    return not person.is_alive or is_minor(person.birth_date) is False


def _shared_portrait_version(person: Person) -> str | None:
    key = person.profile_photo_key
    prefix = f"profile-photos/{person.id}/"
    if not key or not key.startswith(prefix) or not key.endswith(".jpg"):
        return None
    raw_version = key[len(prefix):-4]
    try:
        version = str(UUID(raw_version))
    except ValueError:
        return None
    return version if _profile_photo_object_key(person.id, version) == key else None


def _shared_portrait_url(person: Person, reachable_ids: set[UUID]) -> str | None:
    version = _shared_portrait_version(person)
    if version is None or person.id not in reachable_ids or not _person_may_show_shared_portrait(person):
        return None
    return f"/shared-lineage/people/{person.id}/profile-photo?v={version}"


@router.get("", response_model=SharedTreeOut)
def read_shared_tree(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ancestry = _tree_row(db)
    rows = list(db.execute(
        select(Person, SharedAncestryPerson.family_id, SharedAncestryPerson.added_by)
        .join(SharedAncestryPerson, SharedAncestryPerson.person_id == Person.id)
        .where(Person.visibility != "private")
        .order_by(Person.search_last_name, Person.search_first_name, Person.id)
        .limit(2001)
    ).tuples().all())
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
    marriages = db.scalars(select(Marriage).where(
        Marriage.person_1_id.in_(visible_ids), Marriage.person_2_id.in_(visible_ids),
        Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
    ).order_by(Marriage.created_at, Marriage.id)).all() if visible_ids else []
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
    memberships: dict[UUID, set[UUID]] = {}
    for person_id, family_id in db.execute(select(
        FamilyPerson.person_id, FamilyPerson.family_id,
    ).join(Family, Family.id == FamilyPerson.family_id).where(
        FamilyPerson.person_id.in_(visible_ids), Family.archived_at.is_(None),
    )).all() if visible_ids else []:
        memberships.setdefault(person_id, set()).add(family_id)
    marriages = [marriage for marriage in marriages
                 if memberships.get(marriage.person_1_id, set())
                 & memberships.get(marriage.person_2_id, set())]

    def projection_allows(edge) -> bool:
        child_family = family_by_person.get(edge.child_id)
        parent_family = family_by_person.get(edge.parent_id)
        connection = connections.get(child_family) if child_family is not None else None
        if connection and connection.person_id == edge.child_id and parent_family != child_family:
            return connection.status == "approved" and connection.target_person_id == edge.parent_id
        return True

    canonical_edges = [edge for edge in canonical_edges if projection_allows(edge)]
    legacy_edges = [edge for edge in legacy_edges if projection_allows(edge)]
    canonical_pairs = {(edge.parent_id, edge.child_id) for edge in canonical_edges}
    edges: list[ParentChildRelationship | SharedAncestryRelationship] = [*canonical_edges, *(edge for edge in legacy_edges
                                if (edge.parent_id, edge.child_id) not in canonical_pairs)]
    linked = _my_linked_person(db, user)
    root_id = ancestry.root_person_id if ancestry else None
    try:
        reachable_ids = _shared_reachable_person_ids(db) if root_id else set()
    except HTTPException:
        # A stale or invalid root must hide portraits without making the tree
        # response fail; the photo endpoint independently rechecks eligibility.
        reachable_ids = set()
    root_partners = {
        marriage.person_2_id if marriage.person_1_id == root_id else marriage.person_1_id
        for marriage in marriages if root_id in (marriage.person_1_id, marriage.person_2_id)
    }
    return SharedTreeOut(
        name="Гуулингийнхан",
        root_person_id=ancestry.root_person_id if ancestry else None,
        persons=[_person_shared_data(
            person, added_by == user.id,
            profile_photo_url=_shared_portrait_url(person, reachable_ids),
        )
                 for person, family_id, added_by in rows],
        relationships=[SharedEdgeOut(
            id=edge.id, parent_id=edge.parent_id, child_id=edge.child_id,
            relationship_type=edge.relationship_type,
            source="canonical" if (edge.parent_id, edge.child_id) in canonical_pairs else "legacy_projection",
        ) for edge in edges],
        spouses=[SharedSpouseOut(id=marriage.id, person_1_id=marriage.person_1_id,
                                person_2_id=marriage.person_2_id, status=marriage.status)
                 for marriage in marriages],
        root_partner_person_id=next(iter(root_partners)) if len(root_partners) == 1 else None,
        my_person_id=linked.id if linked else None,
    )


@router.get("/people/{person_id}/profile-photo")
def read_shared_profile_photo(
    person_id: UUID,
    version: str = Query(alias="v", min_length=36, max_length=36,
                         pattern=r"^[0-9a-fA-F-]{36}$"),
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    # Re-check root membership, public visibility, minor policy, and the live
    # consent/projection graph for every request. A tree response URL is not a
    # durable authorization grant.
    person = _shared_target(db, person_id)
    if not _person_may_show_shared_portrait(person):
        raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
    stored_version = _shared_portrait_version(person)
    try:
        requested_version = str(UUID(version))
    except ValueError:
        raise HTTPException(status_code=404, detail="Зураг олдсонгүй.") from None
    if stored_version is None or stored_version != requested_version:
        raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
    key = _profile_photo_object_key(person.id, requested_version)
    try:
        data = storage.get(key)
    except Exception as error:
        raise HTTPException(status_code=503, detail="Зургийг уншиж чадсангүй.") from error
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/join", response_model=SharedTreeOut, status_code=201)
def join_shared_tree(body: JoinTreeInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lock_ancestry_writes(db)
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
        raise HTTPException(status_code=409, detail="Үндсэн модонд холбохдоо админд хүн нэмэх хүсэлт илгээнэ үү.")
    db.add(SharedAncestryPerson(person_id=linked.id, family_id=family_row.family_id, added_by=user.id))
    try:
        # An absent parent field must not bypass review through an existing
        # canonical parent or spouse edge. Check the hypothetical membership
        # in this transaction before it can become visible to another account.
        db.flush()
        root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
        if root_id and linked.id in _shared_reachable_person_ids(db):
            raise HTTPException(status_code=409, detail="Таны хүнийг үндсэн модонд нэмэхэд админы зөвшөөрөл шаардлагатай. Холболтын хүсэлт илгээнэ үү.")
        db.add(AuditLog(actor_id=user.id, family_id=family_row.family_id,
                        action="shared_ancestry.person_joined", target_type="person", target_id=linked.id))
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Энэ хүн нийтлэг модонд аль хэдийн холбогдсон байна.") from error
    return read_shared_tree(user, db)


@router.put("/relationships/me", response_model=SharedTreeOut)
def change_my_shared_placement(
    body: MyPlacementInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Legacy placement edits now use the same review boundary as tree additions."""
    person = _my_linked_person(db, user)
    if person is None:
        raise HTTPException(status_code=404, detail="Аккаунттай холбосон хүн олдсонгүй.")
    association = db.get(SharedAncestryPerson, person.id)
    if association is None or association.added_by != user.id:
        raise HTTPException(status_code=403, detail="Өөрийн нийтлэг модны хүнийг эхлээд холбож, зөвшөөрнө үү.")
    root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
    if person.id == root_id:
        raise HTTPException(status_code=409, detail="Үндсэн удмын эхийн байрлалыг өөрчлөх боломжгүй.")

    raise HTTPException(status_code=409, detail="Үндсэн модны холбоог өөрчлөхдөө админд хүсэлт илгээнэ үү. Зөвшөөрлөө цуцлах бол үндсэн модноос салгах үйлдлийг сонгоно.")


@router.delete("/people/me", status_code=204)
def leave_shared_tree(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Imported at call time: the queue reuses this module's eligibility helpers.
    from app.shared_ancestry_requests import _cancel_own_pending_consent

    lock_ancestry_writes(db)
    person = _my_linked_person(db, user)
    if person is None:
        raise HTTPException(status_code=404, detail="Аккаунттай холбосон хүн олдсонгүй.")
    association = db.get(SharedAncestryPerson, person.id)
    if association is None:
        if _cancel_own_pending_consent(db, person.id, user):
            db.commit()
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
    _cancel_own_pending_consent(db, person.id, user)
    db.execute(delete(SharedAncestryRelationship).where(
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
    account_person_ids = set(db.scalars(select(UserPersonLink.person_id)).all())
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
            account_linked=person.id in account_person_ids,
            eligible_for_admin_link=person.id not in account_person_ids and (
                not person.is_alive or person.visibility == "public"
            ),
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


def _admin_publishable_person(db: Session, person_id: UUID, family_id: UUID) -> Person:
    person = db.scalar(select(Person).join(FamilyPerson, FamilyPerson.person_id == Person.id)
                       .join(Family, Family.id == FamilyPerson.family_id)
                       .where(Person.id == person_id, FamilyPerson.family_id == family_id,
                              Family.archived_at.is_(None)))
    if person is None or person.visibility == "private" or person_is_minor(person):
        raise HTTPException(status_code=422, detail="Идэвхтэй гэр бүлд бүртгэлтэй, нийтлэг модонд харагдах бодит хүн сонгоно уу.")
    if db.scalar(select(UserPersonLink.user_id).where(UserPersonLink.person_id == person_id)):
        raise HTTPException(status_code=403, detail="Аккаунттай холбогдсон хүн өөрөө зөвшөөрч, холболтын хүсэлт илгээнэ.")
    if person.is_alive and person.visibility != "public":
        raise HTTPException(status_code=422, detail="Амьд хүнийг нийтлэхийн өмнө харагдах хүрээ болон зөвшөөрлийг нь шалгана уу.")
    return person


def _validate_spouse_ancestry(db: Session, first: UUID, second: UUID) -> None:
    descendants: dict[UUID, set[UUID]] = {}
    for parent_id, child_id in db.execute(select(
        ParentChildRelationship.parent_id, ParentChildRelationship.child_id,
    )).all():
        descendants.setdefault(parent_id, set()).add(child_id)
    for origin, target in ((first, second), (second, first)):
        seen = {origin}
        frontier = [origin]
        while frontier:
            for child_id in descendants.get(frontier.pop(), set()):
                if child_id == target:
                    raise HTTPException(status_code=422, detail="Эцэг/эх, үр удмын холбоотой хүмүүсийг хос болгож болохгүй.")
                if child_id not in seen:
                    seen.add(child_id)
                    frontier.append(child_id)


def _flush_shared_changes(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Холбоо давхар бүртгэгдэх гэж байна. Дахин шалгана уу.") from error


@admin_router.put("/root-couple", response_model=SharedTreeOut)
def set_root_couple(
    body: RootCoupleInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Establish one explicitly selected canonical couple in one transaction."""
    lock_ancestry_writes(db)
    if body.root_person_id == body.partner_person_id:
        raise HTTPException(status_code=422, detail="Нэг хүнийг өөртэй нь хос болгож болохгүй.")
    _admin_publishable_person(db, body.root_person_id, body.family_id)
    _admin_publishable_person(db, body.partner_person_id, body.family_id)
    _validate_spouse_ancestry(db, body.root_person_id, body.partner_person_id)
    row = db.scalar(select(SharedAncestry).where(SharedAncestry.id == 1).with_for_update())
    previous_root_id = row.root_person_id if row else None
    if previous_root_id != body.expected_root_person_id:
        raise HTTPException(status_code=409, detail="Үндсэн эх өөрчлөгдсөн байна. Хуудсыг шинэчилж дахин шалгана уу.")
    first, second = canonical_pair(body.root_person_id, body.partner_person_id)
    existing = db.scalar(select(Marriage).where(
        Marriage.person_1_id == first, Marriage.person_2_id == second,
        Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
    ))
    other = db.scalar(select(Marriage).where(
        or_(Marriage.person_1_id.in_((body.root_person_id, body.partner_person_id)),
            Marriage.person_2_id.in_((body.root_person_id, body.partner_person_id))),
        Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
        or_(Marriage.person_1_id != first, Marriage.person_2_id != second),
    ).limit(1))
    if other:
        raise HTTPException(status_code=409, detail="Энэ хүний өөр хос бүртгэлтэй байна. Бодит гэрлэлтийн бүртгэлийг шалгана уу.")
    if existing and existing.status != body.status:
        raise HTTPException(status_code=409, detail="Одоо байгаа хосын төлөв сонголтоос өөр байна.")
    if row is None:
        row = SharedAncestry(id=1, root_person_id=body.root_person_id, created_by=current[0].id)
        db.add(row)
    else:
        if previous_root_id and previous_root_id != body.root_person_id and db.get(SharedAncestryPerson, previous_root_id) is None:
            previous_family_id = db.scalar(select(FamilyPerson.family_id).where(
                FamilyPerson.person_id == previous_root_id,
            ).order_by(FamilyPerson.created_at, FamilyPerson.family_id).limit(1))
            if previous_family_id is None:
                raise HTTPException(status_code=409, detail="Өмнөх үндсэн эхийн гэр бүл олдсонгүй.")
            db.add(SharedAncestryPerson(person_id=previous_root_id, family_id=previous_family_id,
                                        added_by=current[0].id))
        row.root_person_id = body.root_person_id
        row.updated_at = datetime.now(UTC)
    if db.get(SharedAncestryPerson, body.partner_person_id) is None:
        db.add(SharedAncestryPerson(person_id=body.partner_person_id, family_id=body.family_id,
                                    added_by=current[0].id))
    if existing is None:
        existing = Marriage(person_1_id=first, person_2_id=second, status=body.status,
                            created_by=current[0].id)
        db.add(existing)
        _flush_shared_changes(db)
    db.add(AuditLog(actor_id=current[0].id, family_id=body.family_id,
                    action="shared_ancestry.root_couple_set", target_type="marriage", target_id=existing.id))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Эх модны холбоо давхар бүртгэгдэх гэж байна. Дахин шалгана уу.") from error
    return read_shared_tree(current[0], db)


@admin_router.post("/connect-person", response_model=SharedTreeOut, status_code=201)
def connect_person_to_root(
    body: AdminConnectPersonInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Publish a non-account Person and their explicit canonical relationship atomically."""
    lock_ancestry_writes(db)
    db.execute(select(SharedAncestry.id).where(SharedAncestry.id == 1).with_for_update())
    _admin_publishable_person(db, body.person_id, body.family_id)
    if body.person_id == body.related_person_id:
        raise HTTPException(status_code=422, detail="Хүнийг өөртэй нь холбож болохгүй.")
    _shared_target(db, body.related_person_id)
    already_shared = db.get(SharedAncestryPerson, body.person_id) is not None
    if body.connection_kind == "spouse":
        if body.second_parent_person_id is not None:
            raise HTTPException(status_code=422, detail="Ханьд эцэг/эхийн холбоо сонгохгүй.")
        if not _person_in_family(db, body.family_id, body.related_person_id):
            raise HTTPException(status_code=422, detail="Хос нэг идэвхтэй гэр бүлд бүртгэлтэй байх ёстой.")
        _validate_spouse_ancestry(db, body.person_id, body.related_person_id)
        first, second = canonical_pair(body.person_id, body.related_person_id)
        existing_marriage = db.scalar(select(Marriage).where(
            Marriage.person_1_id == first, Marriage.person_2_id == second,
            Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
        ).limit(1))
        if existing_marriage is not None and already_shared:
            raise HTTPException(status_code=409, detail="Энэ хоёр хүний хосын холбоо аль хэдийн бүртгэлтэй.")
        if existing_marriage is not None and existing_marriage.status != body.spouse_status:
            raise HTTPException(status_code=409, detail="Бүртгэлтэй хосын төлөв сонголтоос өөр байна. Гэр бүлийн бүртгэлийг шалгана уу.")
        root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
        if body.related_person_id == root_id and db.scalar(select(Marriage.id).where(
            or_(Marriage.person_1_id == root_id, Marriage.person_2_id == root_id),
            Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
            or_(Marriage.person_1_id != first, Marriage.person_2_id != second),
        ).limit(1)):
            raise HTTPException(status_code=409, detail="Үндсэн эхийн хос аль хэдийн бүртгэлтэй байна. Эхийн тохиргооноос шалгана уу.")
        marriage = existing_marriage
        if marriage is None:
            marriage = Marriage(person_1_id=first, person_2_id=second,
                                status=body.spouse_status, created_by=current[0].id)
            db.add(marriage)
            _flush_shared_changes(db)
        target_id = marriage.id
        action = "shared_ancestry.spouse_connected"
    else:
        parent_ids = [body.related_person_id]
        if body.second_parent_person_id is not None:
            if body.second_parent_person_id == body.related_person_id:
                raise HTTPException(status_code=422, detail="Хоёр дахь эцэг/эхийг зөв сонгоно уу.")
            _shared_target(db, body.second_parent_person_id)
            first, second = canonical_pair(body.related_person_id, body.second_parent_person_id)
            if db.scalar(select(Marriage.id).where(
                Marriage.person_1_id == first, Marriage.person_2_id == second,
                Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
            ).limit(1)) is None:
                raise HTTPException(status_code=422, detail="Хоёр эцэг/эхийн хосын бодит холбоо эхлээд бүртгэлтэй байх ёстой.")
            parent_ids.append(body.second_parent_person_id)
        if body.person_id in parent_ids:
            raise HTTPException(status_code=422, detail="Хүнийг өөрийн салбарт хүүхэд болгох боломжгүй.")
        edges = list({*db.execute(select(ParentChildRelationship.parent_id,
                                         ParentChildRelationship.child_id)).all(),
                      *db.execute(select(SharedAncestryRelationship.parent_id,
                                         SharedAncestryRelationship.child_id)).all()})
        existing_parents = {parent_id for parent_id, child_id in edges if child_id == body.person_id}
        if len(existing_parents | set(parent_ids)) > 2:
            raise HTTPException(status_code=409, detail="Нэг хүнд хоёр хүртэлх эцэг/эх холбож болно.")
        created_edges = []
        reused_edges = []
        for parent_id in parent_ids:
            try:
                assert_parent_child_is_acyclic(edges, parent_id, body.person_id)
            except RelationshipError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            existing_edge = db.scalar(select(ParentChildRelationship).where(
                ParentChildRelationship.parent_id == parent_id,
                ParentChildRelationship.child_id == body.person_id,
            ))
            if existing_edge is not None:
                if existing_edge.relationship_type != body.relationship_type:
                    raise HTTPException(status_code=409, detail="Бодит эцэг/эхийн холбооны төрөл өөр байна.")
                reused_edges.append(existing_edge)
                continue
            if (parent_id, body.person_id) in edges:
                raise HTTPException(status_code=409, detail="Хуучин модонд энэ холбоо бий. Эхлээд шалгана уу.")
            edge = ParentChildRelationship(parent_id=parent_id, child_id=body.person_id,
                                            relationship_type=body.relationship_type,
                                            created_by=current[0].id)
            db.add(edge)
            created_edges.append(edge)
        if not created_edges and already_shared:
            raise HTTPException(status_code=409, detail="Энэ эцэг/эх–хүүхдийн холбоо аль хэдийн бүртгэлтэй.")
        _flush_shared_changes(db)
        target_id = (created_edges or reused_edges)[0].id
        action = "shared_ancestry.person_connected"
    if db.get(SharedAncestryPerson, body.person_id) is None:
        db.add(SharedAncestryPerson(person_id=body.person_id, family_id=body.family_id,
                                    added_by=current[0].id))
    db.add(AuditLog(actor_id=current[0].id, family_id=body.family_id,
                    action=action, target_type=body.connection_kind, target_id=target_id))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Холбоо давхар бүртгэгдэх гэж байна. Дахин шалгана уу.") from error
    return read_shared_tree(current[0], db)


@admin_router.delete("/people/{person_id}", response_model=SharedTreeOut)
def detach_shared_person(
    person_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    tree = read_shared_tree(current[0], db)
    if person_id in {tree.root_person_id, tree.root_partner_person_id}:
        raise HTTPException(status_code=409, detail="Үндсэн эхийн хоёр хүнийг эхийн тохиргооноос өөрчилнө үү.")
    association = db.get(SharedAncestryPerson, person_id)
    if association is None:
        raise HTTPException(status_code=404, detail="Үндсэн модны хүний холбоос олдсонгүй.")
    family_id = association.family_id
    connection = db.get(RootConnection, family_id)
    if connection and connection.person_id == person_id:
        connection.status = "disconnected"
        connection.decided_by = current[0].id
        connection.decided_at = datetime.now(UTC)
    db.execute(delete(SharedAncestryRelationship).where(
        or_(SharedAncestryRelationship.parent_id == person_id,
            SharedAncestryRelationship.child_id == person_id),
    ))
    db.delete(association)
    db.add(AuditLog(actor_id=current[0].id, family_id=family_id,
                    action="shared_ancestry.person_detached", target_type="person", target_id=person_id))
    db.commit()
    return read_shared_tree(current[0], db)


def _shared_reachable_person_ids(db: Session) -> set[UUID]:
    root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
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
    root = db.get(Person, root_id)
    if root is None or root.visibility == "private" or person_is_minor(root):
        raise HTTPException(status_code=422, detail="Үндсэн эхийн нийтлэх зөвшөөрөл өөрчлөгдсөн байна.")
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
        connection = connections.get(child_family) if child_family is not None else None
        if (connection and connection.person_id == child_id
                and family_by_person.get(parent_id) != child_family
                and (connection.status != "approved" or connection.target_person_id != parent_id)):
            continue
        children.setdefault(parent_id, set()).add(child_id)
    partner_ids = {marriage.person_2_id if marriage.person_1_id == root_id else marriage.person_1_id
                   for marriage in db.scalars(select(Marriage).where(
                       or_(Marriage.person_1_id == root_id, Marriage.person_2_id == root_id),
                       Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
                   )).all()
                   if marriage.person_1_id in visible and marriage.person_2_id in visible}
    root_families = select(FamilyPerson.family_id).where(FamilyPerson.person_id == root_id)
    partner_ids = {partner_id for partner_id in partner_ids if db.scalar(
        select(FamilyPerson.family_id).join(Family, Family.id == FamilyPerson.family_id)
        .where(FamilyPerson.person_id == partner_id,
               FamilyPerson.family_id.in_(root_families),
               Family.archived_at.is_(None)).limit(1)
    ) is not None}
    memberships: dict[UUID, set[UUID]] = {}
    for member_person_id, family_id in db.execute(select(
        FamilyPerson.person_id, FamilyPerson.family_id,
    ).join(Family, Family.id == FamilyPerson.family_id).where(
        FamilyPerson.person_id.in_(visible), Family.archived_at.is_(None),
    )).all():
        memberships.setdefault(member_person_id, set()).add(family_id)
    for marriage in db.scalars(select(Marriage).where(
        Marriage.person_1_id.in_(visible), Marriage.person_2_id.in_(visible),
        Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
    )).all():
        if memberships.get(marriage.person_1_id, set()) & memberships.get(marriage.person_2_id, set()):
            children.setdefault(marriage.person_1_id, set()).add(marriage.person_2_id)
            children.setdefault(marriage.person_2_id, set()).add(marriage.person_1_id)
    roots = {root_id, *partner_ids} if len(partner_ids) == 1 else {root_id}
    seen = set(roots)
    frontier = list(roots)
    while frontier:
        current = frontier.pop()
        for child_id in children.get(current, ()):
            if child_id not in seen:
                seen.add(child_id)
                frontier.append(child_id)
    return seen


def _shared_target(db: Session, person_id: UUID) -> Person:
    root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
    person = db.get(Person, person_id)
    if person is None or person.visibility == "private" or person_is_minor(person) or not (
        person_id == root_id or db.get(SharedAncestryPerson, person_id) is not None
    ):
        raise HTTPException(status_code=404, detail="Үндэс модны зөвшөөрөгдсөн хүн олдсонгүй.")
    reachable_ids = _shared_reachable_person_ids(db)
    if person_id not in reachable_ids:
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


def _root_connection_candidates(db: Session, family_id: UUID, user: User,
                                member: FamilyMember) -> list[Person]:
    linked = _my_linked_person(db, user)
    rows = db.execute(
        select(Person, FamilyPerson.added_by)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family_id)
        .order_by(Person.search_last_name, Person.search_first_name, Person.id)
        .limit(300)
    ).all()
    person_ids = [person.id for person, _added_by in rows]
    linked_ids = set(db.scalars(select(UserPersonLink.person_id).where(
        UserPersonLink.person_id.in_(person_ids),
    )).all()) if person_ids else set()
    shared_ids = set(db.scalars(select(SharedAncestryPerson.person_id).where(
        SharedAncestryPerson.person_id.in_(person_ids),
    )).all()) if person_ids else set()
    ancestry = _tree_row(db)
    try:
        rooted_ids = _shared_reachable_person_ids(db) if ancestry and ancestry.root_person_id else set()
    except HTTPException:
        # A root whose privacy changed cannot authorize another connection.
        rooted_ids = shared_ids
    candidates: list[Person] = []
    for person, added_by in rows:
        if person.visibility == "private" or person_is_minor(person) or person.id in rooted_ids:
            continue
        if linked is not None and person.id == linked.id:
            candidates.append(person)
            continue
        # A living person's record can only be shared by that person's own
        # verified account. Never let a relative publish it on their behalf.
        if person.is_alive:
            continue
        if person.id in linked_ids:
            continue
        if member.role in {"owner", "editor"} or added_by == user.id:
            candidates.append(person)
    return candidates


def _root_connection_person(db: Session, family_id: UUID, person_id: UUID,
                            user: User, member: FamilyMember) -> Person:
    row = db.execute(
        select(Person, FamilyPerson.added_by)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family_id, Person.id == person_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Сонгосон хүн энэ гэр бүлийн модонд алга.")
    person, added_by = row
    if person.visibility == "private" or person_is_minor(person):
        raise HTTPException(status_code=422, detail="Хувийн эсвэл насанд хүрээгүй хүнийг нийтлэг модонд холбох боломжгүй.")
    linked = _my_linked_person(db, user)
    if linked is not None and linked.id == person.id:
        return person
    if person.is_alive:
        raise HTTPException(status_code=403, detail="Амьд хүнийг зөвхөн өөрийн баталгаажсан аккаунтаар холбож болно.")
    linked_account = db.scalar(select(UserPersonLink.id).where(
        UserPersonLink.person_id == person.id,
    ).limit(1))
    if linked_account is not None:
        raise HTTPException(status_code=403, detail="Энэ хүн аккаунттай холбогдсон байна. Тухайн аккаунтын зөвшөөрөл шаардлагатай.")
    if member.role not in {"owner", "editor"} and added_by != user.id:
        raise HTTPException(status_code=403, detail="Зөвхөн өөрийн бүртгэсэн хүнийг эсвэл эзэн/засварлагч холбож болно.")
    return person


def _connection_out(db: Session, family_id: UUID, user: User) -> RootConnectionOut:
    row = db.get(RootConnection, family_id)
    family = db.get(Family, family_id)
    member = db.scalar(select(FamilyMember).where(
        FamilyMember.family_id == family_id, FamilyMember.user_id == user.id,
    ))
    can_request = bool(member and _root_connection_candidates(db, family_id, user, member))
    if row is None:
        return RootConnectionOut(family_id=family_id, family_name=family.name if family else None,
                                 status="not_connected", can_request=can_request)
    person = db.get(Person, row.person_id)
    target = db.get(Person, row.target_person_id)
    requester = db.get(User, row.requested_by)
    name = lambda value: " ".join(filter(None, (value.last_name, value.first_name))) if value else None
    return RootConnectionOut(
        family_id=family_id, family_name=family.name if family else None,
        status=row.status, person_id=row.person_id,
        person_name=name(person), target_person_id=row.target_person_id,
        target_name=name(target), relationship_type=row.relationship_type,
        requested_by_name=requester.display_name if requester else None,
        requested_at=row.requested_at, decided_at=row.decided_at,
        can_request=can_request,
    )


@family_router.get("/{family_id}/root-connection", response_model=RootConnectionOut)
def read_root_connection(family_id: UUID, user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    _family_member(db, family_id, user)
    return _connection_out(db, family_id, user)


@family_router.get("/{family_id}/root-connection/candidates",
                   response_model=list[RootConnectionCandidateOut])
def list_root_connection_candidates(family_id: UUID, user: User = Depends(get_current_user),
                                    db: Session = Depends(get_db)):
    member = _family_member(db, family_id, user)
    linked = _my_linked_person(db, user)
    candidates = _root_connection_candidates(db, family_id, user, member)
    parent_map: dict[UUID, list[UUID]] = {}
    candidate_ids = [person.id for person in candidates]
    if candidate_ids:
        parent_rows = db.execute(
            select(ParentChildRelationship.child_id, ParentChildRelationship.parent_id)
            .join(FamilyPerson, FamilyPerson.person_id == ParentChildRelationship.parent_id)
            .where(
                FamilyPerson.family_id == family_id,
                ParentChildRelationship.child_id.in_(candidate_ids),
            )
        ).all()
        for child_id, parent_id in parent_rows:
            parent_map.setdefault(child_id, []).append(parent_id)
    return [RootConnectionCandidateOut(
        person_id=person.id, first_name=person.first_name, last_name=person.last_name,
        middle_name=person.middle_name,
        birth_date=str(person.birth_date) if person.birth_date else None,
        death_date=str(person.death_date) if person.death_date else None,
        is_alive=person.is_alive,
        is_current_user=linked is not None and person.id == linked.id,
        parent_person_ids=parent_map.get(person.id, []),
    ) for person in candidates]


@family_router.post("/{family_id}/root-connection", response_model=RootConnectionOut)
def request_root_connection(family_id: UUID, body: RootConnectionInput,
                            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member = _family_member(db, family_id, user)
    if not body.share_consent:
        raise HTTPException(status_code=422, detail="Үндэс модонд харуулах зөвшөөрөл шаардлагатай.")
    person = _root_connection_person(db, family_id, body.person_id, user, member)
    if body.person_id == body.target_person_id:
        raise HTTPException(status_code=422, detail="Хүнийг өөртэй нь холбох боломжгүй.")
    _shared_target(db, body.target_person_id)
    existing_parent = db.scalar(select(ParentChildRelationship).where(
        ParentChildRelationship.parent_id == body.target_person_id,
        ParentChildRelationship.child_id == body.person_id,
    ))
    recorded_family_parents = set(db.scalars(
        select(ParentChildRelationship.parent_id)
        .join(FamilyPerson, FamilyPerson.person_id == ParentChildRelationship.parent_id)
        .where(
            ParentChildRelationship.child_id == body.person_id,
            FamilyPerson.family_id == family_id,
        )
    ).all())
    if recorded_family_parents and body.target_person_id not in recorded_family_parents:
        raise HTTPException(status_code=409, detail="Гэр бүлийн модонд бүртгэсэн эцэг/эхээ сонгоно уу.")
    if existing_parent is not None and existing_parent.relationship_type != body.relationship_type:
        raise HTTPException(status_code=409, detail="Гэр бүлийн модонд энэ холбоо өөр төрлөөр бүртгэгдсэн байна.")
    if existing_parent is None:
        parent_ids = db.scalars(select(ParentChildRelationship.id).where(
            ParentChildRelationship.child_id == body.person_id,
        ).limit(2)).all()
        if len(parent_ids) >= 2:
            raise HTTPException(status_code=409, detail="Энэ хүн хоёр эцэг/эхийн холбоотой бүртгэгдсэн байна.")
    graph_edges = db.execute(select(
        ParentChildRelationship.parent_id, ParentChildRelationship.child_id,
    )).all()
    legacy_edges = db.execute(select(
        SharedAncestryRelationship.parent_id, SharedAncestryRelationship.child_id,
    )).all()
    try:
        assert_parent_child_is_acyclic([*graph_edges, *legacy_edges], body.target_person_id, body.person_id)
    except RelationshipError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
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
            consented_at=datetime.now(UTC),
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
def list_root_connections(status: str = "pending",
                          current: tuple[User, AdminRole] = Depends(require_super_admin),
                          db: Session = Depends(get_db)):
    if status not in {"pending", "approved", "rejected", "disconnected"}:
        raise HTTPException(status_code=422, detail="Холболтын төлөв буруу байна.")
    rows = db.scalars(select(RootConnection).where(RootConnection.status == status)
                      .order_by(RootConnection.requested_at.desc()).limit(100)).all()
    return [_connection_out(db, row.family_id, current[0]) for row in rows]


@admin_router.delete("/connections/{family_id}", response_model=RootConnectionOut)
def disconnect_root_connection_as_admin(
    family_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    row = db.scalar(select(RootConnection).where(
        RootConnection.family_id == family_id,
    ).with_for_update())
    if row is None:
        raise HTTPException(status_code=404, detail="Гэр бүлийн холболт олдсонгүй.")
    if row.status not in {"pending", "approved"}:
        raise HTTPException(status_code=409, detail="Салгах идэвхтэй холболт алга.")
    row.status = "disconnected"
    row.decided_by = current[0].id
    row.decided_at = datetime.now(UTC)
    db.add(AuditLog(actor_id=current[0].id, family_id=family_id,
                    action="root_connection.admin_disconnected", target_type="person",
                    target_id=row.person_id))
    db.commit()
    return _connection_out(db, family_id, current[0])


@admin_router.post("/connections/{family_id}/decision", response_model=RootConnectionOut)
def decide_root_connection(family_id: UUID, body: RootConnectionDecision,
                           current: tuple[User, AdminRole] = Depends(require_super_admin),
                           db: Session = Depends(get_db)):
    lock_ancestry_writes(db)
    row = db.scalar(select(RootConnection).where(
        RootConnection.family_id == family_id,
    ).with_for_update())
    if row is None or row.status != "pending":
        raise HTTPException(status_code=409, detail="Шалгах идэвхтэй хүсэлт алга.")
    if body.approve:
        from app.shared_ancestry_requests import (
            _assert_single_person_admission,
            _lock_review_context,
        )

        _lock_review_context(db, family_id, row.person_id, row.target_person_id, row.requested_by)
        requester = db.get(User, row.requested_by, populate_existing=True)
        if requester is None or not requester.is_active:
            raise HTTPException(status_code=409, detail="Хүсэлт гаргасан аккаунт идэвхгүй байна.")
        requester_member = _family_member(db, family_id, requester)
        try:
            _root_connection_person(db, family_id, row.person_id, requester, requester_member)
        except HTTPException as error:
            raise HTTPException(status_code=409, detail="Хүсэлт гаргасан хүнийг холбох эрх эсвэл зөвшөөрөл өөрчлөгдсөн.") from error
        _shared_target(db, row.target_person_id)
        previously_rooted = _shared_reachable_person_ids(db)
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
        db.flush()
        try:
            _assert_single_person_admission(db, row.person_id, previously_rooted)
        except HTTPException:
            db.rollback()
            raise
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
    lock_ancestry_writes(db)
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


@admin_router.post("/root-partner", response_model=SharedTreeOut, status_code=201)
def connect_root_partner(
    body: RootPartnerInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Record an explicitly selected canonical spouse; do not invent a second graph."""
    lock_ancestry_writes(db)
    ancestry = db.scalar(select(SharedAncestry).where(SharedAncestry.id == 1).with_for_update())
    if ancestry is None or ancestry.root_person_id != body.expected_root_person_id:
        raise HTTPException(status_code=409, detail="Үндсэн удмын эх өөрчлөгдсөн байна. Хуудсыг шинэчлэнэ үү.")
    root_id = ancestry.root_person_id
    if root_id == body.person_id:
        raise HTTPException(status_code=422, detail="Хүнийг өөртэй нь гэрлүүлэх боломжгүй.")
    partner = db.get(Person, body.person_id)
    if (partner is None or partner.visibility == "private" or person_is_minor(partner)
            or db.get(SharedAncestryPerson, partner.id) is None):
        raise HTTPException(status_code=422, detail="Хосыг эхлээд зөвшөөрөгдсөн бодит хүнээр нийтлэг модонд оруулна уу.")
    root_families = select(FamilyPerson.family_id).where(FamilyPerson.person_id == root_id)
    shared_family = db.scalar(select(FamilyPerson.family_id).join(
        Family, Family.id == FamilyPerson.family_id,
    ).where(FamilyPerson.person_id == partner.id,
            FamilyPerson.family_id.in_(root_families),
            Family.archived_at.is_(None)).limit(1))
    if shared_family is None:
        raise HTTPException(status_code=422, detail="Үндсэн эх ба хос нь нэг идэвхтэй гэр бүлийн бодит бүртгэлд байх ёстой.")
    first, second = canonical_pair(root_id, partner.id)
    existing = db.scalars(select(Marriage).where(
        Marriage.person_1_id == first, Marriage.person_2_id == second,
        Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
    )).first()
    if existing:
        return read_shared_tree(current[0], db)
    other = db.scalars(select(Marriage).where(
        or_(Marriage.person_1_id == root_id, Marriage.person_2_id == root_id),
        Marriage.deleted_at.is_(None), Marriage.status.in_(("married", "widowed")),
    )).first()
    if other:
        raise HTTPException(status_code=409, detail="Үндсэн эхийн өөр хос бүртгэлтэй байна. Гэр бүлийн бодит гэрлэлтийн бүртгэлийг эхлээд шалгана уу.")
    marriage = Marriage(person_1_id=first, person_2_id=second,
                        status=body.status, created_by=current[0].id)
    db.add(marriage)
    db.flush()
    db.add(AuditLog(actor_id=current[0].id, family_id=shared_family,
                    action="shared_ancestry.root_partner_connected",
                    target_type="marriage", target_id=marriage.id))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Энэ хоёр хүний гэрлэлтийн холбоо аль хэдийн бүртгэгдсэн байна.") from error
    return read_shared_tree(current[0], db)


@admin_router.post("/relationships", response_model=SharedTreeOut, status_code=201)
def add_shared_relationship(
    body: AdminSharedRelationshipInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Connect two people already visible in the consent based shared tree."""
    lock_ancestry_writes(db)
    root_id = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
    if body.parent_person_id == body.child_person_id or body.child_person_id == root_id:
        raise HTTPException(status_code=422, detail="Үндсэн эхийг хүүхэд болгох эсвэл хүнийг өөртэй нь холбох боломжгүй.")
    for person_id in (body.parent_person_id, body.child_person_id):
        person = db.get(Person, person_id)
        if person is None or person.visibility == "private" or person_is_minor(person) or not (
            person_id == root_id or db.get(SharedAncestryPerson, person_id) is not None
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
    canonical_edge = db.get(ParentChildRelationship, relationship_id)
    legacy_edge = db.get(SharedAncestryRelationship, relationship_id)
    if canonical_edge is None and legacy_edge is None:
        raise HTTPException(status_code=404, detail="Нийтлэг модны холбоос олдсонгүй.")
    if canonical_edge is not None:
        raise HTTPException(
            status_code=409,
            detail="Энэ бол гэр бүлийн бодит холбоос. Үндэс модны холболтыг салгах эсвэл гэр бүлийн модны эрхтэй орчноос тусад нь засна уу.",
        )
    db.delete(legacy_edge)
    db.add(AuditLog(actor_id=current[0].id, family_id=None,
                    action="shared_ancestry.legacy_projection_removed", target_type="relationship", target_id=relationship_id))
    db.commit()
    return read_shared_tree(current[0], db)


@admin_router.post("/canonical-relationships/{relationship_id}/delete", response_model=SharedTreeOut)
def delete_canonical_shared_relationship(
    relationship_id: UUID, body: CanonicalRelationshipDelete,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Explicit correction of real genealogy, separate from Root projection removal."""
    edge = db.scalar(select(ParentChildRelationship).where(
        ParentChildRelationship.id == relationship_id,
    ).with_for_update())
    if edge is None:
        raise HTTPException(status_code=404, detail="Бодит холбоос олдсонгүй.")
    if db.scalar(select(RootConnection.family_id).where(
        RootConnection.canonical_edge_id == relationship_id,
        RootConnection.status == "approved",
    ).limit(1)) is not None:
        raise HTTPException(status_code=409, detail="Эхлээд батлагдсан үндэс модны холболтыг салгана уу.")
    db.add(AuditLog(actor_id=current[0].id, family_id=None,
                    action="shared_ancestry.canonical_relationship_deleted",
                    target_type="relationship", target_id=relationship_id))
    db.delete(edge)
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

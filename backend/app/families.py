"""Authenticated family, person and relationship APIs."""

import hashlib
import secrets
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import (
    AuditLog,
    Biography,
    Family,
    FamilyMember,
    FamilyPerson,
    Invitation,
    LifeEvent,
    Marriage,
    Memory,
    MemoryPersonTag,
    ParentChildRelationship,
    Person,
    User,
    UserPersonLink,
)
from app.relationships import (
    RelationshipError,
    assert_date_order,
    assert_parent_child_is_acyclic,
    canonical_pair,
)

router = APIRouter(prefix="/families", tags=["families"])
invitations_router = APIRouter(prefix="/invitations", tags=["invitations"])


class FamilyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def check_name(self):
        if not self.name.strip():
            raise ValueError("Гэр бүлийн нэр хоосон байж болохгүй.")
        return self


class FamilyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def check_name(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Гэр бүлийн нэр хоосон байж болохгүй.")
        if self.name is not None and not self.name.strip():
            raise ValueError("Гэр бүлийн нэр хоосон байж болохгүй.")
        return self


class FamilyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str | None
    created_at: datetime
    role: str


class PersonCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(default="", max_length=120)
    middle_name: str | None = Field(default=None, max_length=120)
    nickname: str | None = Field(default=None, max_length=120)
    gender: str = Field(default="unknown", pattern="^(female|male|other|unknown)$")
    birth_date: date | None = None
    birth_place: str | None = Field(default=None, max_length=240)
    is_alive: bool = True
    death_date: date | None = None
    death_place: str | None = Field(default=None, max_length=240)
    short_description: str | None = Field(default=None, max_length=1000)
    visibility: str = Field(default="family", pattern="^(private|family|public)$")

    @model_validator(mode="after")
    def check_dates(self):
        if self.first_name is not None and not self.first_name.strip():
            raise ValueError("Нэр хоосон байж болохгүй.")
        if self.birth_date and self.birth_date > datetime.now(UTC).date():
            raise ValueError("Төрсөн огноо ирээдүйд байж болохгүй.")
        if self.death_date and self.birth_date and self.death_date < self.birth_date:
            raise ValueError("Нас барсан огноо төрсөн огнооноос өмнө байж болохгүй.")
        if self.is_alive and self.death_date:
            raise ValueError("Амьд хүний нас барсан огноог бөглөж болохгүй.")
        return self


class PersonPatch(PersonCreate):
    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, max_length=120)
    gender: str | None = Field(default=None, pattern="^(female|male|other|unknown)$")
    is_alive: bool | None = None
    visibility: str | None = Field(default=None, pattern="^(private|family|public)$")

    @model_validator(mode="after")
    def reject_null_required_fields(self):
        for field in ("first_name", "gender", "is_alive", "visibility"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} талбарыг хоосон болгох боломжгүй.")
        return self


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    first_name: str
    last_name: str
    middle_name: str | None
    nickname: str | None
    gender: str
    birth_date: date | None
    birth_place: str | None
    is_alive: bool
    death_date: date | None
    death_place: str | None
    short_description: str | None
    visibility: str
    created_at: datetime
    updated_at: datetime


class ParentChildCreate(BaseModel):
    parent_id: UUID
    child_id: UUID
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive)$")


class MarriageCreate(BaseModel):
    person_1_id: UUID
    person_2_id: UUID
    status: str = Field(default="married", pattern="^(married|divorced|widowed)$")
    start_date: date | None = None
    end_date: date | None = None
    location: str | None = Field(default=None, max_length=240)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def valid_dates(self):
        assert_date_order(self.start_date, self.end_date)
        if self.status == "divorced" and self.end_date is None:
            raise ValueError("Салсан гэрлэлтийн дууссан огноог оруулна уу.")
        return self


class MarriagePatch(BaseModel):
    status: str = Field(pattern="^(married|divorced|widowed)$")
    end_date: date | None = None


class MemberOut(BaseModel):
    user_id: UUID
    display_name: str
    role: str


class InvitationCreate(BaseModel):
    email: EmailStr
    role: str = Field(pattern="^(editor|member)$")


class InvitationAccept(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class BiographyInput(BaseModel):
    content: str = Field(max_length=50000)


class LifeEventInput(BaseModel):
    event_type: str = Field(
        pattern="^(birth|school|work|marriage|divorce|move|child_birth|death|other)$"
    )
    title: str = Field(min_length=1, max_length=180)
    event_date: date | None = None
    date_note: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=240)
    description: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def check_title(self):
        if not self.title.strip():
            raise ValueError("Үйл явдлын гарчиг хоосон байж болохгүй.")
        return self


class MemoryInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=20000)
    memory_date: date | None = None
    visibility: str = Field(default="family", pattern="^(private|family|public)$")
    person_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def check_title(self):
        if not self.title.strip():
            raise ValueError("Дурсамжийн гарчиг хоосон байж болохгүй.")
        return self


def _member(db: Session, family_id: UUID, user: User, roles: set[str] | None = None):
    member = db.scalar(
        select(FamilyMember).where(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(status_code=403, detail="Энэ гэр бүлийн мэдээллийг харах эрхгүй.")
    if roles and member.role not in roles:
        raise HTTPException(status_code=403, detail="Энэ үйлдлийг хийх эрхгүй.")
    family = db.get(Family, family_id)
    if family is None or family.archived_at is not None:
        raise HTTPException(status_code=404, detail="Гэр бүл олдсонгүй.")
    return member, family


def _person_in_family(db: Session, family_id: UUID, person_id: UUID) -> Person:
    person = db.scalar(
        select(Person)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family_id, Person.id == person_id)
    )
    if person is None:
        raise HTTPException(status_code=404, detail="Хүн олдсонгүй.")
    return person


def _assert_person_visible(db: Session, person: Person, user: User) -> None:
    if person.visibility == "private":
        linked_to_user = db.scalar(
            select(UserPersonLink.id).where(
                UserPersonLink.user_id == user.id, UserPersonLink.person_id == person.id
            )
        )
        if person.created_by != user.id and linked_to_user is None:
            raise HTTPException(status_code=404, detail="Хүн олдсонгүй.")


def _commit(db: Session, message: str):
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail=message) from error


def _audit(
    db: Session,
    user: User,
    family_id: UUID | None,
    action: str,
    target_type: str,
    target_id: UUID | None,
) -> None:
    db.add(
        AuditLog(
            actor_id=user.id,
            family_id=family_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
        )
    )


def _can_edit_person(db: Session, family_id: UUID, person: Person, user: User) -> bool:
    member, _ = _member(db, family_id, user)
    if member.role in {"owner", "editor"}:
        return True
    return (
        db.scalar(
            select(UserPersonLink.id).where(
                UserPersonLink.user_id == user.id, UserPersonLink.person_id == person.id
            )
        )
        is not None
    )


@router.post("", response_model=FamilyOut, status_code=201)
def create_family(
    body: FamilyCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    family = Family(name=body.name.strip(), description=body.description, created_by=user.id)
    db.add(family)
    db.flush()
    member = FamilyMember(family_id=family.id, user_id=user.id, role="owner")
    db.add(member)
    db.flush()
    _audit(db, user, family.id, "family.created", "family", family.id)
    db.commit()
    db.refresh(family)
    return FamilyOut(
        id=family.id,
        name=family.name,
        description=family.description,
        created_at=family.created_at,
        role=member.role,
    )


@router.get("", response_model=list[FamilyOut])
def list_families(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Family, FamilyMember.role)
        .join(FamilyMember, FamilyMember.family_id == Family.id)
        .where(FamilyMember.user_id == user.id, Family.archived_at.is_(None))
        .order_by(Family.created_at)
    ).all()
    return [
        FamilyOut(
            id=f.id, name=f.name, description=f.description, created_at=f.created_at, role=role
        )
        for f, role in rows
    ]


@router.get("/{family_id}", response_model=FamilyOut)
def get_family(
    family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    member, family = _member(db, family_id, user)
    return FamilyOut(
        id=family.id,
        name=family.name,
        description=family.description,
        created_at=family.created_at,
        role=member.role,
    )


@router.patch("/{family_id}", response_model=FamilyOut)
def update_family(
    family_id: UUID,
    body: FamilyPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, family = _member(db, family_id, user, {"owner", "editor"})
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(family, key, value.strip() if key == "name" and value else value)
    _audit(db, user, family_id, "family.updated", "family", family.id)
    db.commit()
    db.refresh(family)
    return FamilyOut(
        id=family.id,
        name=family.name,
        description=family.description,
        created_at=family.created_at,
        role=member.role,
    )


@router.delete("/{family_id}", status_code=204)
def archive_family(
    family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    _, family = _member(db, family_id, user, {"owner"})
    family.archived_at = datetime.now(UTC)
    _audit(db, user, family_id, "family.archived", "family", family.id)
    db.commit()
    return Response(status_code=204)


@router.get("/{family_id}/members", response_model=list[MemberOut])
def list_members(
    family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    _member(db, family_id, user)
    rows = db.execute(
        select(User.id, User.display_name, FamilyMember.role)
        .join(FamilyMember, FamilyMember.user_id == User.id)
        .where(FamilyMember.family_id == family_id)
    ).all()
    return [MemberOut(user_id=r.id, display_name=r.display_name, role=r.role) for r in rows]


@router.post("/{family_id}/persons", response_model=PersonOut, status_code=201)
def create_person(
    family_id: UUID,
    body: PersonCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    data = body.model_dump()
    data["first_name"] = body.first_name.strip()
    data["last_name"] = body.last_name.strip()
    person = Person(**data, created_by=user.id)
    db.add(person)
    db.flush()
    db.add(FamilyPerson(family_id=family_id, person_id=person.id, added_by=user.id))
    db.flush()
    _audit(db, user, family_id, "person.created", "person", person.id)
    db.commit()
    db.refresh(person)
    return person


@router.get("/{family_id}/persons", response_model=list[PersonOut])
def list_persons(
    family_id: UUID,
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    query = (
        select(Person)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family_id)
    )
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.where(
            or_(
                Person.first_name.ilike(pattern),
                Person.last_name.ilike(pattern),
                Person.middle_name.ilike(pattern),
            )
        )
    own_link = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    query = query.where(
        or_(Person.visibility != "private", Person.created_by == user.id, Person.id == own_link)
    )
    return list(db.scalars(query.order_by(Person.last_name, Person.first_name)).all())


@router.get("/{family_id}/persons/search", response_model=list[PersonOut])
def search_persons(
    family_id: UUID,
    q: str = Query(min_length=1, max_length=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_persons(family_id, q, user, db)


@router.get("/{family_id}/persons/{person_id}", response_model=PersonOut)
def get_person(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    return person


@router.patch("/{family_id}/persons/{person_id}", response_model=PersonOut)
def update_person(
    family_id: UUID,
    person_id: UUID,
    body: PersonPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    if member.role == "member":
        linked_to_user = db.scalar(
            select(UserPersonLink.id).where(
                UserPersonLink.user_id == user.id, UserPersonLink.person_id == person.id
            )
        )
        if linked_to_user is None:
            raise HTTPException(status_code=403, detail="Зөвхөн өөрийн profile-г засах эрхтэй.")
    data = body.model_dump(exclude_unset=True)
    candidate_birth = data.get("birth_date", person.birth_date)
    candidate_death = data.get("death_date", person.death_date)
    candidate_alive = data.get("is_alive", person.is_alive)
    if candidate_birth and candidate_death and candidate_death < candidate_birth:
        raise HTTPException(
            status_code=422, detail="Нас барсан огноо төрсөн огнооноос өмнө байж болохгүй."
        )
    if candidate_alive and candidate_death:
        raise HTTPException(status_code=422, detail="Амьд хүний нас барсан огноог бөглөж болохгүй.")
    for key, value in data.items():
        setattr(
            person, key, value.strip() if key in {"first_name", "last_name"} and value else value
        )
    _audit(db, user, family_id, "person.updated", "person", person.id)
    db.commit()
    db.refresh(person)
    return person


@router.delete("/{family_id}/persons/{person_id}", status_code=204)
def remove_person_from_family(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detach from this family; preserve the person and relationship history."""
    _member(db, family_id, user, {"owner", "editor"})
    _person_in_family(db, family_id, person_id)
    association = db.scalar(
        select(FamilyPerson).where(
            FamilyPerson.family_id == family_id, FamilyPerson.person_id == person_id
        )
    )
    _audit(db, user, family_id, "person.detached", "person", person_id)
    db.delete(association)
    db.commit()
    return Response(status_code=204)


@router.post("/{family_id}/persons/{person_id}/link-me", status_code=204)
def link_me(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    _person_in_family(db, family_id, person_id)
    if db.scalar(select(UserPersonLink).where(UserPersonLink.user_id == user.id)):
        raise HTTPException(
            status_code=409, detail="Таны бүртгэл хүнтэй аль хэдийн холбогдсон байна."
        )
    if db.scalar(select(UserPersonLink).where(UserPersonLink.person_id == person_id)):
        raise HTTPException(status_code=409, detail="Энэ хүн өөр бүртгэлтэй холбогдсон байна.")
    db.add(UserPersonLink(user_id=user.id, person_id=person_id, linked_by=user.id))
    _commit(db, "Энэ хүн өөр бүртгэлтэй холбогдсон байна.")
    return Response(status_code=204)


@router.post("/{family_id}/relationships/parent-child", status_code=201)
def add_parent_child(
    family_id: UUID,
    body: ParentChildCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    _person_in_family(db, family_id, body.parent_id)
    _person_in_family(db, family_id, body.child_id)
    _assert_person_visible(db, _person_in_family(db, family_id, body.parent_id), user)
    _assert_person_visible(db, _person_in_family(db, family_id, body.child_id), user)
    # Serialize ancestry writes on PostgreSQL to avoid concurrent inverse edges.
    db.execute(select(Family.id).where(Family.id == family_id).with_for_update())
    family_person_ids = select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
    edges = db.execute(
        select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id).where(
            ParentChildRelationship.parent_id.in_(family_person_ids),
            ParentChildRelationship.child_id.in_(family_person_ids),
        )
    ).all()
    try:
        assert_parent_child_is_acyclic(edges, body.parent_id, body.child_id)
    except RelationshipError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    edge = ParentChildRelationship(
        parent_id=body.parent_id,
        child_id=body.child_id,
        relationship_type=body.relationship_type,
        created_by=user.id,
    )
    db.add(edge)
    db.flush()
    _audit(db, user, family_id, "relationship.parent_child.created", "parent_child", edge.id)
    _commit(db, "Энэ эцэг эх-хүүхдийн холбоо өмнө нь бүртгэгдсэн байна.")
    return {
        "id": edge.id,
        "parent_id": edge.parent_id,
        "child_id": edge.child_id,
        "relationship_type": edge.relationship_type,
    }


@router.post("/{family_id}/marriages", status_code=201)
def create_marriage(
    family_id: UUID,
    body: MarriageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    _person_in_family(db, family_id, body.person_1_id)
    _person_in_family(db, family_id, body.person_2_id)
    _assert_person_visible(db, _person_in_family(db, family_id, body.person_1_id), user)
    _assert_person_visible(db, _person_in_family(db, family_id, body.person_2_id), user)
    try:
        first, second = canonical_pair(body.person_1_id, body.person_2_id)
        assert_date_order(body.start_date, body.end_date)
    except RelationshipError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    marriage = Marriage(
        person_1_id=first,
        person_2_id=second,
        status=body.status,
        start_date=body.start_date,
        end_date=body.end_date,
        location=body.location,
        description=body.description,
        created_by=user.id,
    )
    db.add(marriage)
    db.flush()
    _audit(db, user, family_id, "marriage.created", "marriage", marriage.id)
    _commit(db, "Энэ хоёр хүний гэрлэлтийн холбоо өмнө нь бүртгэгдсэн байна.")
    return {
        "id": marriage.id,
        "person_1_id": first,
        "person_2_id": second,
        "status": marriage.status,
        "start_date": marriage.start_date,
        "end_date": marriage.end_date,
    }


@router.get("/{family_id}/marriages")
def list_marriages(
    family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    _member(db, family_id, user)
    own_link = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    family_people = (
        select(Person.id)
        .join(FamilyPerson)
        .where(
            FamilyPerson.family_id == family_id,
            or_(
                Person.visibility != "private", Person.created_by == user.id, Person.id == own_link
            ),
        )
    )
    return list(
        db.execute(
            select(Marriage).where(
                Marriage.person_1_id.in_(family_people),
                Marriage.person_2_id.in_(family_people),
                Marriage.deleted_at.is_(None),
            )
        )
        .scalars()
        .all()
    )


@router.patch("/{family_id}/marriages/{marriage_id}")
def update_marriage(
    family_id: UUID,
    marriage_id: UUID,
    body: MarriagePatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    marriage = db.get(Marriage, marriage_id)
    if marriage is None or marriage.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Гэрлэлтийн мэдээлэл олдсонгүй.")
    _person_in_family(db, family_id, marriage.person_1_id)
    _person_in_family(db, family_id, marriage.person_2_id)
    if body.status == "divorced" and body.end_date is None:
        raise HTTPException(status_code=422, detail="Салсан гэрлэлтийн дууссан огноог оруулна уу.")
    try:
        assert_date_order(marriage.start_date, body.end_date)
    except RelationshipError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    marriage.status, marriage.end_date = body.status, body.end_date
    _audit(
        db,
        user,
        family_id,
        "marriage.divorced" if body.status == "divorced" else "marriage.updated",
        "marriage",
        marriage.id,
    )
    db.commit()
    return {
        "id": marriage.id,
        "person_1_id": marriage.person_1_id,
        "person_2_id": marriage.person_2_id,
        "status": marriage.status,
        "start_date": marriage.start_date,
        "end_date": marriage.end_date,
    }


@router.delete("/{family_id}/marriages/{marriage_id}", status_code=204)
def remove_marriage(
    family_id: UUID,
    marriage_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner", "editor"})
    marriage = db.get(Marriage, marriage_id)
    if marriage is None or marriage.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Гэрлэлтийн мэдээлэл олдсонгүй.")
    _person_in_family(db, family_id, marriage.person_1_id)
    _person_in_family(db, family_id, marriage.person_2_id)
    marriage.deleted_at = datetime.now(UTC)
    _audit(db, user, family_id, "marriage.archived", "marriage", marriage.id)
    db.commit()
    return Response(status_code=204)


@router.get("/{family_id}/persons/{person_id}/biography")
def get_biography(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    biography = db.scalar(select(Biography).where(Biography.person_id == person_id))
    return {
        "content": biography.body if biography else "",
        "updated_at": biography.updated_at if biography else None,
    }


@router.put("/{family_id}/persons/{person_id}/biography")
def save_biography(
    family_id: UUID,
    person_id: UUID,
    body: BiographyInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    if not _can_edit_person(db, family_id, person, user):
        raise HTTPException(status_code=403, detail="Намтар засах эрхгүй.")
    biography = db.scalar(select(Biography).where(Biography.person_id == person_id))
    if biography is None:
        biography = Biography(person_id=person_id, body=body.content, updated_by=user.id)
        db.add(biography)
    else:
        biography.body = body.content
        biography.updated_by = user.id
    db.flush()
    _audit(db, user, family_id, "biography.updated", "person", person_id)
    db.commit()
    return {"content": biography.body, "updated_at": biography.updated_at}


@router.get("/{family_id}/persons/{person_id}/events")
def list_life_events(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    return list(
        db.scalars(
            select(LifeEvent).where(LifeEvent.person_id == person_id).order_by(LifeEvent.event_date)
        ).all()
    )


@router.post("/{family_id}/persons/{person_id}/events", status_code=201)
def create_life_event(
    family_id: UUID,
    person_id: UUID,
    body: LifeEventInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    if not _can_edit_person(db, family_id, person, user):
        raise HTTPException(status_code=403, detail="Амьдралын үйл явдал нэмэх эрхгүй.")
    event = LifeEvent(person_id=person_id, created_by=user.id, **body.model_dump())
    db.add(event)
    db.flush()
    _audit(db, user, family_id, "life_event.created", "life_event", event.id)
    db.commit()
    return event


@router.patch("/{family_id}/persons/{person_id}/events/{event_id}")
def update_life_event(
    family_id: UUID,
    person_id: UUID,
    event_id: UUID,
    body: LifeEventInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    if not _can_edit_person(db, family_id, person, user):
        raise HTTPException(status_code=403, detail="Амьдралын үйл явдал засах эрхгүй.")
    event = db.scalar(
        select(LifeEvent).where(LifeEvent.id == event_id, LifeEvent.person_id == person_id)
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Үйл явдал олдсонгүй.")
    for key, value in body.model_dump().items():
        setattr(event, key, value)
    _audit(db, user, family_id, "life_event.updated", "life_event", event.id)
    db.commit()
    return event


@router.delete("/{family_id}/persons/{person_id}/events/{event_id}", status_code=204)
def delete_life_event(
    family_id: UUID,
    person_id: UUID,
    event_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    if not _can_edit_person(db, family_id, person, user):
        raise HTTPException(status_code=403, detail="Амьдралын үйл явдал устгах эрхгүй.")
    event = db.scalar(
        select(LifeEvent).where(LifeEvent.id == event_id, LifeEvent.person_id == person_id)
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Үйл явдал олдсонгүй.")
    db.delete(event)
    db.commit()
    return Response(status_code=204)


@router.post("/{family_id}/memories", status_code=201)
def create_memory(
    family_id: UUID,
    body: MemoryInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    for person_id in body.person_ids:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
    memory = Memory(
        family_id=family_id,
        title=body.title.strip(),
        description=body.description,
        memory_date=body.memory_date,
        visibility=body.visibility,
        created_by=user.id,
    )
    db.add(memory)
    db.flush()
    for person_id in set(body.person_ids):
        db.add(MemoryPersonTag(memory_id=memory.id, person_id=person_id))
    _audit(db, user, family_id, "memory.created", "memory", memory.id)
    db.commit()
    return {
        "id": memory.id,
        "title": memory.title,
        "description": memory.description,
        "memory_date": memory.memory_date,
        "visibility": memory.visibility,
        "person_ids": list(set(body.person_ids)),
        "created_at": memory.created_at,
    }


@router.get("/{family_id}/memories")
def list_memories(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    return list(
        db.scalars(
            select(Memory)
            .where(
                Memory.family_id == family_id,
                or_(Memory.visibility != "private", Memory.created_by == user.id),
            )
            .order_by(Memory.memory_date.desc())
        ).all()
    )


@router.get("/{family_id}/memories/{memory_id}")
def get_memory(
    family_id: UUID,
    memory_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    memory = db.scalar(select(Memory).where(Memory.id == memory_id, Memory.family_id == family_id))
    if memory is None or (memory.visibility == "private" and memory.created_by != user.id):
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    tag_ids = list(
        db.scalars(
            select(MemoryPersonTag.person_id).where(MemoryPersonTag.memory_id == memory_id)
        ).all()
    )
    return {
        "id": memory.id,
        "title": memory.title,
        "description": memory.description,
        "memory_date": memory.memory_date,
        "visibility": memory.visibility,
        "person_ids": tag_ids,
        "created_at": memory.created_at,
    }


@router.patch("/{family_id}/memories/{memory_id}")
def update_memory(
    family_id: UUID,
    memory_id: UUID,
    body: MemoryInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    memory = db.scalar(select(Memory).where(Memory.id == memory_id, Memory.family_id == family_id))
    if memory is None:
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    if memory.visibility == "private" and memory.created_by != user.id:
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    if member.role not in {"owner", "editor"} and memory.created_by != user.id:
        raise HTTPException(status_code=403, detail="Дурсамж засах эрхгүй.")
    for person_id in body.person_ids:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
    for key in ("title", "description", "memory_date", "visibility"):
        setattr(memory, key, getattr(body, key))
    db.execute(delete(MemoryPersonTag).where(MemoryPersonTag.memory_id == memory_id))
    db.add_all(
        MemoryPersonTag(memory_id=memory_id, person_id=person_id)
        for person_id in set(body.person_ids)
    )
    _audit(db, user, family_id, "memory.updated", "memory", memory_id)
    db.commit()
    return get_memory(family_id, memory_id, user, db)


@router.delete("/{family_id}/memories/{memory_id}", status_code=204)
def delete_memory(
    family_id: UUID,
    memory_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    memory = db.scalar(select(Memory).where(Memory.id == memory_id, Memory.family_id == family_id))
    if memory is None:
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    if memory.visibility == "private" and memory.created_by != user.id:
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    if member.role not in {"owner", "editor"} and memory.created_by != user.id:
        raise HTTPException(status_code=403, detail="Дурсамж устгах эрхгүй.")
    _audit(db, user, family_id, "memory.deleted", "memory", memory_id)
    db.delete(memory)
    db.commit()
    return Response(status_code=204)


@router.get("/{family_id}/audit")
def family_audit(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner"})
    entries = db.scalars(
        select(AuditLog)
        .where(AuditLog.family_id == family_id)
        .order_by(AuditLog.created_at.desc())
        .limit(100)
    ).all()
    return [
        {
            "id": entry.id,
            "actor_id": entry.actor_id,
            "action": entry.action,
            "target_type": entry.target_type,
            "target_id": entry.target_id,
            "created_at": entry.created_at,
        }
        for entry in entries
    ]


@router.post("/{family_id}/invitations", status_code=201)
def create_invitation(
    family_id: UUID,
    body: InvitationCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user, {"owner"})
    email = str(body.email).strip().lower()
    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user and db.scalar(
        select(FamilyMember.id).where(
            FamilyMember.family_id == family_id, FamilyMember.user_id == existing_user.id
        )
    ):
        raise HTTPException(status_code=409, detail="Энэ хэрэглэгч гэр бүлийн гишүүн байна.")
    raw_token = secrets.token_urlsafe(32)
    invitation = Invitation(
        family_id=family_id,
        invited_email=email,
        role=body.role,
        token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
        invited_by=user.id,
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add(invitation)
    db.flush()
    _audit(db, user, family_id, "invitation.created", "invitation", invitation.id)
    db.commit()
    return {
        "id": invitation.id,
        "email": invitation.invited_email,
        "role": invitation.role,
        "token": raw_token,
        "expires_at": invitation.expires_at,
        "delivery": "manual",
    }


@invitations_router.post("/accept")
def accept_invitation(
    body: InvitationAccept,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    invitation = db.scalar(
        select(Invitation).where(
            Invitation.token_hash == token_hash,
            Invitation.accepted_at.is_(None),
            Invitation.expires_at > datetime.now(UTC),
        )
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Урилга хүчингүй эсвэл хугацаа дууссан байна.")
    if user.email != invitation.invited_email:
        raise HTTPException(status_code=403, detail="Энэ урилга өөр имэйл хаягт зориулагдсан.")
    if db.scalar(
        select(FamilyMember.id).where(
            FamilyMember.family_id == invitation.family_id, FamilyMember.user_id == user.id
        )
    ):
        raise HTTPException(status_code=409, detail="Та энэ гэр бүлийн гишүүн байна.")
    invitation.accepted_at = datetime.now(UTC)
    db.add(FamilyMember(family_id=invitation.family_id, user_id=user.id, role=invitation.role))
    _audit(db, user, invitation.family_id, "invitation.accepted", "invitation", invitation.id)
    _commit(db, "Урилгыг ашиглах боломжгүй байна.")
    return {"family_id": invitation.family_id, "role": invitation.role}


@router.get("/{family_id}/tree")
def family_tree(
    family_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    _member(db, family_id, user)
    own_link = db.scalar(select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id))
    persons = list(
        db.scalars(
            select(Person)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(
                FamilyPerson.family_id == family_id,
                or_(
                    Person.visibility != "private",
                    Person.created_by == user.id,
                    Person.id == own_link,
                ),
            )
        ).all()
    )
    ids = [person.id for person in persons]
    parent_edges = (
        list(
            db.scalars(
                select(ParentChildRelationship).where(
                    ParentChildRelationship.parent_id.in_(ids),
                    ParentChildRelationship.child_id.in_(ids),
                )
            ).all()
        )
        if ids
        else []
    )
    marriages = (
        list(
            db.scalars(
                select(Marriage).where(
                    Marriage.person_1_id.in_(ids),
                    Marriage.person_2_id.in_(ids),
                    Marriage.deleted_at.is_(None),
                )
            ).all()
        )
        if ids
        else []
    )
    return {
        "persons": [PersonOut.model_validate(person) for person in persons],
        "parent_child_relationships": parent_edges,
        "marriages": marriages,
    }

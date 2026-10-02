"""Audited system administration of family heritage and notices."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.admin import AdminRole, require_admin, require_super_admin
from app.auth import get_current_user
from app.db import get_db
from app.families import FamilyPatch, ParentChildCreate, PersonCreate, PersonPatch
from app.models import (
    Announcement,
    ArchivePerson,
    AuditLog,
    Biography,
    Family,
    FamilyMember,
    FamilyPerson,
    LifeEvent,
    Marriage,
    MemoryPersonTag,
    ParentChildRelationship,
    Person,
    PersonGuardianship,
    PersonLineageAssignment,
    PersonLinkRequest,
    Story,
    StoryPerson,
    User,
    UserPersonLink,
)
from app.person_search import normalize_search_name
from app.privacy import person_is_minor
from app.relationships import RelationshipError, assert_parent_child_is_acyclic

router = APIRouter(prefix="/admin", tags=["admin-workspace"])
public_router = APIRouter(prefix="/announcements", tags=["announcements"])


class WorkspaceFamily(BaseModel):
    id: UUID
    name: str
    description: str | None
    root_person_id: UUID | None
    people_count: int
    relationship_count: int
    story_count: int
    members_count: int


class WorkspacePerson(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    gender: str
    birth_date: str | None
    birth_place: str | None
    is_alive: bool
    death_date: str | None
    short_description: str | None
    visibility: str
    updated_at: datetime


class WorkspaceEdge(BaseModel):
    id: UUID
    parent_id: UUID
    child_id: UUID
    relationship_type: str


class WorkspaceStory(BaseModel):
    id: UUID
    title: str
    body: str
    visibility: str
    created_at: datetime


class WorkspaceEvent(BaseModel):
    id: UUID
    action: str
    target_type: str
    target_id: UUID | None
    actor_name: str
    created_at: datetime


class FamilyWorkspace(BaseModel):
    family: WorkspaceFamily
    people: list[WorkspacePerson]
    relationships: list[WorkspaceEdge]
    stories: list[WorkspaceStory]
    history: list[WorkspaceEvent]


class RootInput(BaseModel):
    person_id: UUID


class StoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=100000)
    visibility: str = Field(default="family", pattern="^(family|public)$")

    @model_validator(mode="after")
    def nonblank(self):
        if not self.title.strip() or not self.body.strip():
            raise ValueError("Гарчиг, агуулга шаардлагатай.")
        return self


class AnnouncementInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=4000)
    is_published: bool = False
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def validate_notice(self):
        if not self.title.strip() or not self.body.strip():
            raise ValueError("Мэдэгдлийн гарчиг, агуулга шаардлагатай.")
        if self.expires_at and (not self.expires_at.tzinfo or self.expires_at <= datetime.now(UTC)):
            raise ValueError("Дуусах хугацаа ирээдүйд, цагийн бүстэй байх ёстой.")
        return self


class AnnouncementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    body: str
    is_published: bool
    created_at: datetime
    expires_at: datetime | None


def _family(db: Session, family_id: UUID) -> Family:
    family = db.get(Family, family_id)
    if family is None or family.archived_at is not None:
        raise HTTPException(status_code=404, detail="Гэр бүл олдсонгүй.")
    return family


def _person(db: Session, family_id: UUID, person_id: UUID) -> Person:
    person = db.scalar(
        select(Person).join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family_id, Person.id == person_id)
    )
    if person is None:
        raise HTTPException(status_code=404, detail="Энэ гэр бүлд хүн олдсонгүй.")
    return person


def _audit(db: Session, actor: User, family_id: UUID | None, action: str,
           target_type: str, target_id: UUID) -> None:
    db.add(AuditLog(id=uuid4(), family_id=family_id, actor_id=actor.id,
                    action=action, target_type=target_type, target_id=target_id))


def _person_out(person: Person) -> WorkspacePerson:
    return WorkspacePerson(
        id=person.id, first_name=person.first_name, last_name=person.last_name,
        gender=person.gender, birth_date=person.birth_date.isoformat() if person.birth_date else None,
        birth_place=person.birth_place, is_alive=person.is_alive,
        death_date=person.death_date.isoformat() if person.death_date else None,
        short_description=person.short_description, visibility=person.visibility,
        updated_at=person.updated_at,
    )


@router.get("/families/{family_id}/workspace", response_model=FamilyWorkspace)
def family_workspace(
    family_id: UUID, current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    family = _family(db, family_id)
    people = db.scalars(
        select(Person).join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family_id).order_by(Person.last_name, Person.first_name, Person.id)
    ).all()
    ids = [person.id for person in people]
    edges = db.scalars(select(ParentChildRelationship).where(
        ParentChildRelationship.parent_id.in_(ids), ParentChildRelationship.child_id.in_(ids)
    ).order_by(ParentChildRelationship.created_at)).all() if ids else []
    stories = db.scalars(select(Story).where(Story.family_id == family_id)
                         .order_by(Story.created_at.desc()).limit(50)).all()
    logs = db.execute(
        select(AuditLog, User.display_name).join(User, User.id == AuditLog.actor_id)
        .where(AuditLog.family_id == family_id).order_by(AuditLog.created_at.desc()).limit(50)
    ).all()
    _audit(db, current[0], family_id, "admin.family_workspace_viewed", "family", family_id)
    db.commit()
    return FamilyWorkspace(
        family=WorkspaceFamily(
            id=family.id, name=family.name, description=family.description,
            root_person_id=family.root_person_id, people_count=len(people),
            relationship_count=len(edges),
            story_count=db.scalar(select(func.count()).select_from(Story).where(Story.family_id == family_id)) or 0,
            members_count=db.scalar(select(func.count()).select_from(FamilyMember).where(
                FamilyMember.family_id == family_id)) or 0,
        ),
        people=[_person_out(person) for person in people],
        relationships=[WorkspaceEdge.model_validate(edge, from_attributes=True) for edge in edges],
        stories=[WorkspaceStory.model_validate(story, from_attributes=True) for story in stories],
        history=[WorkspaceEvent(id=log.id, action=log.action, target_type=log.target_type,
                                target_id=log.target_id, actor_name=name, created_at=log.created_at)
                 for log, name in logs],
    )


@router.patch("/families/{family_id}")
def edit_family(
    family_id: UUID, body: FamilyPatch,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    family = _family(db, family_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(family, key, value.strip() if key == "name" and value else value)
    _audit(db, current[0], family_id, "admin.family_edited", "family", family_id)
    db.commit()
    return {"id": family.id, "name": family.name, "description": family.description}


@router.post("/families/{family_id}/people", response_model=WorkspacePerson, status_code=201)
def create_person(
    family_id: UUID, body: PersonCreate,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    data = body.model_dump()
    data["first_name"] = body.first_name.strip()
    data["last_name"] = body.last_name.strip()
    data["search_first_name"] = normalize_search_name(body.first_name)
    data["search_last_name"] = normalize_search_name(body.last_name)
    data["search_middle_name"] = normalize_search_name(body.middle_name)
    person = Person(**data, created_by=current[0].id)
    db.add(person)
    db.flush()
    db.add(FamilyPerson(family_id=family_id, person_id=person.id, added_by=current[0].id))
    _audit(db, current[0], family_id, "admin.person_created", "person", person.id)
    db.commit()
    db.refresh(person)
    return _person_out(person)


@router.patch("/families/{family_id}/people/{person_id}", response_model=WorkspacePerson)
def edit_person(
    family_id: UUID, person_id: UUID, body: PersonPatch,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    person = _person(db, family_id, person_id)
    data = body.model_dump(exclude_unset=True)
    birth = data.get("birth_date", person.birth_date)
    death = data.get("death_date", person.death_date)
    alive = data.get("is_alive", person.is_alive)
    if (birth and death and death < birth) or (alive and death):
        raise HTTPException(status_code=422, detail="Амьдралын огноонууд зөрчилтэй байна.")
    for key, value in data.items():
        setattr(person, key, value.strip() if key in {"first_name", "last_name"} and value else value)
    person.search_first_name = normalize_search_name(person.first_name)
    person.search_last_name = normalize_search_name(person.last_name)
    person.search_middle_name = normalize_search_name(person.middle_name)
    _audit(db, current[0], family_id, "admin.person_edited", "person", person.id)
    db.commit()
    db.refresh(person)
    return _person_out(person)


@router.delete("/families/{family_id}/people/{person_id}", status_code=204)
def detach_person(
    family_id: UUID, person_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    family = _family(db, family_id)
    _person(db, family_id, person_id)
    if family.root_person_id == person_id:
        raise HTTPException(status_code=409, detail="Эхлээд удмын эхийг солино уу.")
    references = (
        (ParentChildRelationship, or_(ParentChildRelationship.parent_id == person_id,
                                      ParentChildRelationship.child_id == person_id)),
        (Marriage, or_(Marriage.person_1_id == person_id, Marriage.person_2_id == person_id)),
        (UserPersonLink, UserPersonLink.person_id == person_id),
        (StoryPerson, StoryPerson.person_id == person_id),
        (ArchivePerson, ArchivePerson.person_id == person_id),
        (MemoryPersonTag, MemoryPersonTag.person_id == person_id),
        (PersonGuardianship, PersonGuardianship.person_id == person_id),
        (PersonLineageAssignment, PersonLineageAssignment.person_id == person_id),
        (PersonLinkRequest, PersonLinkRequest.person_id == person_id),
        (Biography, Biography.person_id == person_id),
        (LifeEvent, LifeEvent.person_id == person_id),
    )
    if any(db.scalar(select(model.id).where(condition).limit(1)) for model, condition in references):
        raise HTTPException(status_code=409, detail="Энэ хүн холбоос, түүх эсвэл бүртгэлтэй. Холбоосыг эхлээд цэгцэлнэ үү.")
    link = db.scalar(select(FamilyPerson).where(
        FamilyPerson.family_id == family_id, FamilyPerson.person_id == person_id))
    db.delete(link)
    _audit(db, current[0], family_id, "admin.person_detached", "person", person_id)
    db.commit()
    return Response(status_code=204)


@router.put("/families/{family_id}/root")
def replace_root(
    family_id: UUID, body: RootInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    family = _family(db, family_id)
    person = _person(db, family_id, body.person_id)
    if person.visibility == "private" or person_is_minor(person):
        raise HTTPException(status_code=422, detail="Удмын эх насанд хүрсэн, гэр бүлд харагдах хүн байх ёстой.")
    if family.root_person_id != body.person_id:
        family.root_person_id = body.person_id
        _audit(db, current[0], family_id, "admin.lineage_root_changed", "person", person.id)
        db.commit()
    return {"person_id": family.root_person_id}


@router.post("/families/{family_id}/relationships", response_model=WorkspaceEdge, status_code=201)
def create_relationship(
    family_id: UUID, body: ParentChildCreate,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    _person(db, family_id, body.parent_id)
    _person(db, family_id, body.child_id)
    db.execute(select(Family.id).where(Family.id == family_id).with_for_update())
    person_ids = select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
    edges = db.execute(select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id).where(
        ParentChildRelationship.parent_id.in_(person_ids),
        ParentChildRelationship.child_id.in_(person_ids))).all()
    try:
        assert_parent_child_is_acyclic(edges, body.parent_id, body.child_id)
    except RelationshipError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    edge = ParentChildRelationship(parent_id=body.parent_id, child_id=body.child_id,
                                   relationship_type=body.relationship_type, created_by=current[0].id)
    db.add(edge)
    db.flush()
    _audit(db, current[0], family_id, "admin.relationship_created", "parent_child", edge.id)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Энэ холбоос аль хэдийн байна.") from exc
    return WorkspaceEdge.model_validate(edge, from_attributes=True)


@router.delete("/families/{family_id}/relationships/{relationship_id}", status_code=204)
def delete_relationship(
    family_id: UUID, relationship_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    person_ids = select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
    edge = db.scalar(select(ParentChildRelationship).where(
        ParentChildRelationship.id == relationship_id,
        ParentChildRelationship.parent_id.in_(person_ids),
        ParentChildRelationship.child_id.in_(person_ids)))
    if edge is None:
        raise HTTPException(status_code=404, detail="Холбоос олдсонгүй.")
    db.delete(edge)
    _audit(db, current[0], family_id, "admin.relationship_deleted", "parent_child", relationship_id)
    db.commit()
    return Response(status_code=204)


@router.post("/families/{family_id}/stories", response_model=WorkspaceStory, status_code=201)
def create_story(
    family_id: UUID, body: StoryCreate,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    story = Story(family_id=family_id, title=body.title.strip(), body=body.body.strip(),
                  visibility=body.visibility, created_by=current[0].id)
    db.add(story)
    db.flush()
    _audit(db, current[0], family_id, "admin.story_created", "story", story.id)
    db.commit()
    db.refresh(story)
    return WorkspaceStory.model_validate(story, from_attributes=True)


@router.get("/announcements", response_model=list[AnnouncementOut])
def list_admin_announcements(
    _: tuple[User, AdminRole] = Depends(require_admin), db: Session = Depends(get_db),
):
    return db.scalars(select(Announcement).order_by(Announcement.created_at.desc()).limit(50)).all()


@router.post("/announcements", response_model=AnnouncementOut, status_code=201)
def create_announcement(
    body: AnnouncementInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    row = Announcement(title=body.title.strip(), body=body.body.strip(), created_by=current[0].id,
                       created_at=datetime.now(UTC), expires_at=body.expires_at,
                       is_published=body.is_published)
    db.add(row)
    db.flush()
    _audit(db, current[0], None, "admin.announcement_created", "announcement", row.id)
    db.commit()
    db.refresh(row)
    return row


@router.put("/announcements/{announcement_id}", response_model=AnnouncementOut)
def edit_announcement(
    announcement_id: UUID, body: AnnouncementInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    row = db.get(Announcement, announcement_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Мэдэгдэл олдсонгүй.")
    row.title = body.title.strip()
    row.body = body.body.strip()
    row.is_published = body.is_published
    row.expires_at = body.expires_at
    _audit(db, current[0], None, "admin.announcement_edited", "announcement", row.id)
    db.commit()
    return row


@public_router.get("", response_model=list[AnnouncementOut])
def published_announcements(
    _: User = Depends(get_current_user), db: Session = Depends(get_db),
    limit: int = Query(default=3, ge=1, le=10),
):
    now = datetime.now(UTC)
    return db.scalars(select(Announcement).where(
        Announcement.is_published.is_(True),
        or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
    ).order_by(Announcement.created_at.desc()).limit(limit)).all()

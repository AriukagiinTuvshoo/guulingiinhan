"""Audited system administration of family heritage and notices."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.admin import AdminRole, require_admin, require_super_admin
from app.auth import get_current_user
from app.db import get_db
from app.families import (
    BranchCreate,
    FamilyPatch,
    LineageCreate,
    ParentChildCreate,
    PersonCreate,
    PersonLineageAssignmentInput,
    PersonPatch,
)
from app.models import (
    Announcement,
    Archive,
    ArchivePerson,
    AuditLog,
    Branch,
    Family,
    FamilyMember,
    FamilyPerson,
    Lineage,
    Marriage,
    Memory,
    MemoryPersonTag,
    ParentChildRelationship,
    Person,
    PersonLineageAssignment,
    PersonLinkRequest,
    Photo,
    RootConnection,
    SharedAncestry,
    SharedAncestryPerson,
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


class WorkspaceLineage(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str | None


class WorkspaceBranch(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    lineage_id: UUID
    name: str
    description: str | None = None


class WorkspaceLabelPatch(BaseModel):
    name: str | None = Field(default=None, max_length=180)
    description: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def check_name(self):
        if "name" in self.model_fields_set and (self.name is None or not self.name.strip()):
            raise ValueError("Нэр хоосон байж болохгүй.")
        return self


class ArchiveFamilyInput(BaseModel):
    confirm_name: str = Field(min_length=1, max_length=180)


class FamilyArchivePreview(BaseModel):
    family_id: UUID
    family_name: str
    archived: bool
    people: int
    members: int
    stories: int
    memories: int
    archives: int
    photos: int
    shared_people: int
    active_connections: int
    shared_root: bool
    can_archive: bool


class WorkspaceAssignment(BaseModel):
    person_id: UUID
    lineage_id: UUID
    branch_id: UUID | None


class FamilyWorkspace(BaseModel):
    family: WorkspaceFamily
    people: list[WorkspacePerson]
    relationships: list[WorkspaceEdge]
    stories: list[WorkspaceStory]
    history: list[WorkspaceEvent]
    lineages: list[WorkspaceLineage]
    branches: list[WorkspaceBranch]
    assignments: list[WorkspaceAssignment]


class PersonDependencyPreview(BaseModel):
    account_link: bool
    parent_child_count: int
    marriage_count: int
    story_count: int
    memory_count: int
    archive_count: int
    in_shared_ancestry: bool
    root_connection: bool
    pending_claim: bool
    family_root: bool
    shared_root: bool
    can_detach: bool


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


class AnnouncementSummary(BaseModel):
    published: int
    drafts: int
    archived: int


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
    lineages = db.scalars(select(Lineage).where(Lineage.family_id == family_id)
                          .order_by(Lineage.name, Lineage.id)).all()
    lineage_ids = [lineage.id for lineage in lineages]
    branches = db.scalars(select(Branch).where(Branch.lineage_id.in_(lineage_ids))
                          .order_by(Branch.name, Branch.id)).all() if lineage_ids else []
    assignments = db.scalars(select(PersonLineageAssignment).where(
        PersonLineageAssignment.person_id.in_(ids),
        PersonLineageAssignment.lineage_id.in_(lineage_ids),
    )).all() if ids and lineage_ids else []
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
        lineages=[WorkspaceLineage.model_validate(row) for row in lineages],
        branches=[WorkspaceBranch.model_validate(row) for row in branches],
        assignments=[WorkspaceAssignment(person_id=row.person_id, lineage_id=row.lineage_id,
                                         branch_id=row.branch_id) for row in assignments],
    )


@router.post("/families/{family_id}/lineages", response_model=WorkspaceLineage, status_code=201)
def create_workspace_lineage(
    family_id: UUID, body: LineageCreate,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    lineage = Lineage(family_id=family_id, name=body.name.strip(), description=body.description)
    db.add(lineage)
    try:
        db.flush()
        _audit(db, current[0], family_id, "admin.lineage_created", "lineage", lineage.id)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Энэ нэртэй удам аль хэдийн байна.") from exc
    return WorkspaceLineage.model_validate(lineage)


@router.patch("/families/{family_id}/lineages/{lineage_id}", response_model=WorkspaceLineage)
def edit_workspace_lineage(
    family_id: UUID, lineage_id: UUID, body: WorkspaceLabelPatch,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    row = db.scalar(select(Lineage).where(Lineage.id == lineage_id, Lineage.family_id == family_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Удмын нэрийн бүртгэл олдсонгүй.")
    if body.name is not None:
        row.name = body.name.strip()
    if "description" in body.model_fields_set:
        row.description = (body.description or "").strip() or None
    _audit(db, current[0], family_id, "admin.lineage_edited", "lineage", row.id)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Энэ нэртэй бүртгэл аль хэдийн байна.") from exc
    return WorkspaceLineage.model_validate(row)


@router.delete("/families/{family_id}/lineages/{lineage_id}", status_code=204)
def delete_unused_workspace_lineage(
    family_id: UUID, lineage_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    row = db.scalar(select(Lineage).where(Lineage.id == lineage_id, Lineage.family_id == family_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Удмын нэрийн бүртгэл олдсонгүй.")
    if db.scalar(select(Branch.id).where(Branch.lineage_id == lineage_id).limit(1)) or db.scalar(
        select(PersonLineageAssignment.id).where(
            PersonLineageAssignment.lineage_id == lineage_id).limit(1)
    ):
        raise HTTPException(status_code=409, detail="Салаа эсвэл хүний багцлалттай бүртгэлийг эхлээд цэгцэлнэ үү.")
    _audit(db, current[0], family_id, "admin.lineage_deleted", "lineage", row.id)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.post(
    "/families/{family_id}/lineages/{lineage_id}/branches",
    response_model=WorkspaceBranch, status_code=201,
)
def create_workspace_branch(
    family_id: UUID, lineage_id: UUID, body: BranchCreate,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    if db.scalar(select(Lineage.id).where(Lineage.id == lineage_id,
                                          Lineage.family_id == family_id)) is None:
        raise HTTPException(status_code=404, detail="Удам олдсонгүй.")
    branch = Branch(lineage_id=lineage_id, name=body.name.strip(), description=body.description)
    db.add(branch)
    try:
        db.flush()
        _audit(db, current[0], family_id, "admin.branch_created", "branch", branch.id)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Энэ нэртэй салаа аль хэдийн байна.") from exc
    return WorkspaceBranch.model_validate(branch)


def _workspace_branch(db: Session, family_id: UUID, branch_id: UUID) -> Branch:
    _family(db, family_id)
    row = db.scalar(select(Branch).join(Lineage, Lineage.id == Branch.lineage_id).where(
        Branch.id == branch_id, Lineage.family_id == family_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Салааны нэрийн бүртгэл олдсонгүй.")
    return row


@router.patch("/families/{family_id}/branches/{branch_id}", response_model=WorkspaceBranch)
def edit_workspace_branch(
    family_id: UUID, branch_id: UUID, body: WorkspaceLabelPatch,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    row = _workspace_branch(db, family_id, branch_id)
    if body.name is not None:
        row.name = body.name.strip()
    if "description" in body.model_fields_set:
        row.description = (body.description or "").strip() or None
    _audit(db, current[0], family_id, "admin.branch_edited", "branch", row.id)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Энэ нэртэй салааны бүртгэл аль хэдийн байна.") from exc
    return WorkspaceBranch.model_validate(row)


@router.delete("/families/{family_id}/branches/{branch_id}", status_code=204)
def delete_unused_workspace_branch(
    family_id: UUID, branch_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    row = _workspace_branch(db, family_id, branch_id)
    if db.scalar(select(PersonLineageAssignment.id).where(
        PersonLineageAssignment.branch_id == branch_id).limit(1)
    ):
        raise HTTPException(status_code=409, detail="Энэ салаанд хүний багцлалт байна. Эхлээд багцлалтыг цэгцэлнэ үү.")
    _audit(db, current[0], family_id, "admin.branch_deleted", "branch", row.id)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


def _family_archive_preview(db: Session, family: Family) -> FamilyArchivePreview:
    def count(model, column):
        return db.scalar(select(func.count()).select_from(model).where(column == family.id)) or 0

    ancestry_root = db.scalar(select(SharedAncestry.root_person_id).where(SharedAncestry.id == 1))
    shared_root = bool(ancestry_root and db.scalar(select(FamilyPerson.id).where(
        FamilyPerson.family_id == family.id, FamilyPerson.person_id == ancestry_root)))
    shared_people = count(SharedAncestryPerson, SharedAncestryPerson.family_id)
    active_connections = db.scalar(select(func.count()).select_from(RootConnection).where(
        RootConnection.family_id == family.id, RootConnection.status.in_(("pending", "approved")))) or 0
    return FamilyArchivePreview(
        family_id=family.id, family_name=family.name, archived=family.archived_at is not None,
        people=count(FamilyPerson, FamilyPerson.family_id),
        members=count(FamilyMember, FamilyMember.family_id), stories=count(Story, Story.family_id),
        memories=count(Memory, Memory.family_id), archives=count(Archive, Archive.family_id),
        photos=count(Photo, Photo.family_id), shared_people=shared_people,
        active_connections=active_connections, shared_root=shared_root,
        can_archive=not shared_root and not shared_people and not active_connections,
    )


@router.get("/families/{family_id}/archive-preview", response_model=FamilyArchivePreview)
def preview_family_archive(
    family_id: UUID, current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    family = db.get(Family, family_id)
    if family is None:
        raise HTTPException(status_code=404, detail="Гэр бүл олдсонгүй.")
    return _family_archive_preview(db, family)


@router.post("/families/{family_id}/archive", status_code=204)
def archive_workspace_family(
    family_id: UUID, body: ArchiveFamilyInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    family = db.scalar(select(Family).where(Family.id == family_id).with_for_update())
    if family is None:
        raise HTTPException(status_code=404, detail="Гэр бүл олдсонгүй.")
    if body.confirm_name.strip() != family.name:
        raise HTTPException(status_code=409, detail="Гэр бүлийн нэрийг яг тааруулж бичнэ үү.")
    if not _family_archive_preview(db, family).can_archive:
        raise HTTPException(status_code=409, detail="Үндсэн модтой холбоотой гэр бүлийг эхлээд шалгаж цэгцэлнэ үү.")
    family.archived_at = datetime.now(UTC)
    _audit(db, current[0], family_id, "admin.family_archived", "family", family.id)
    db.commit()
    return Response(status_code=204)


@router.get("/archived-families")
def list_archived_workspace_families(
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
    limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0),
):
    return [{"id": family.id, "name": family.name, "archived_at": family.archived_at}
            for family in db.scalars(select(Family).where(Family.archived_at.is_not(None))
                                     .order_by(Family.archived_at.desc(), Family.id)
                                     .offset(offset).limit(limit)).all()]


@router.post("/families/{family_id}/restore", status_code=204)
def restore_workspace_family(
    family_id: UUID, body: ArchiveFamilyInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    family = db.get(Family, family_id)
    if family is None:
        raise HTTPException(status_code=404, detail="Гэр бүл олдсонгүй.")
    if body.confirm_name.strip() != family.name:
        raise HTTPException(status_code=409, detail="Гэр бүлийн нэрийг яг тааруулж бичнэ үү.")
    family.archived_at = None
    _audit(db, current[0], family_id, "admin.family_restored", "family", family.id)
    db.commit()
    return Response(status_code=204)


@router.put(
    "/families/{family_id}/people/{person_id}/lineage-assignment",
    response_model=WorkspaceAssignment,
)
def set_workspace_assignment(
    family_id: UUID, person_id: UUID, body: PersonLineageAssignmentInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    _person(db, family_id, person_id)
    if db.scalar(select(Lineage.id).where(
        Lineage.id == body.lineage_id, Lineage.family_id == family_id,
    )) is None:
        raise HTTPException(status_code=404, detail="Удам олдсонгүй.")
    if body.branch_id is not None and db.scalar(select(Branch.id).where(
        Branch.id == body.branch_id, Branch.lineage_id == body.lineage_id,
    )) is None:
        raise HTTPException(status_code=404, detail="Салаа энэ удамд харьяалагдахгүй.")
    assignment = db.scalar(select(PersonLineageAssignment).where(
        PersonLineageAssignment.person_id == person_id,
    ))
    if assignment is not None:
        existing_family = db.scalar(select(Lineage.family_id).where(
            Lineage.id == assignment.lineage_id,
        ))
        if existing_family != family_id:
            raise HTTPException(status_code=409, detail="Энэ хүн өөр гэр бүлийн удамд бүртгэлтэй.")
        assignment.lineage_id = body.lineage_id
        assignment.branch_id = body.branch_id
    else:
        assignment = PersonLineageAssignment(
            person_id=person_id, lineage_id=body.lineage_id, branch_id=body.branch_id,
        )
        db.add(assignment)
    _audit(db, current[0], family_id, "admin.lineage_assignment_saved", "person", person_id)
    db.commit()
    return WorkspaceAssignment(person_id=person_id, lineage_id=body.lineage_id,
                               branch_id=body.branch_id)


@router.delete("/families/{family_id}/people/{person_id}/lineage-assignment", status_code=204)
def clear_workspace_assignment(
    family_id: UUID, person_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    _family(db, family_id)
    _person(db, family_id, person_id)
    assignment = db.scalar(select(PersonLineageAssignment).join(
        Lineage, Lineage.id == PersonLineageAssignment.lineage_id,
    ).where(PersonLineageAssignment.person_id == person_id, Lineage.family_id == family_id))
    if assignment is None:
        raise HTTPException(status_code=404, detail="Удмын багцлалт олдсонгүй.")
    db.delete(assignment)
    _audit(db, current[0], family_id, "admin.lineage_assignment_cleared", "person", person_id)
    db.commit()
    return Response(status_code=204)


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


@router.get("/families/{family_id}/people/{person_id}/dependencies",
            response_model=PersonDependencyPreview)
def person_dependencies(
    family_id: UUID, person_id: UUID,
    _: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    family = _family(db, family_id)
    _person(db, family_id, person_id)
    count = lambda statement: db.scalar(statement) or 0
    account_link = db.scalar(select(UserPersonLink.user_id).where(
        UserPersonLink.person_id == person_id).limit(1)) is not None
    parent_child_count = count(select(func.count()).select_from(ParentChildRelationship).where(
        or_(ParentChildRelationship.parent_id == person_id,
            ParentChildRelationship.child_id == person_id)))
    marriage_count = count(select(func.count()).select_from(Marriage).where(
        or_(Marriage.person_1_id == person_id, Marriage.person_2_id == person_id),
        Marriage.deleted_at.is_(None)))
    story_count = count(select(func.count()).select_from(StoryPerson).where(
        StoryPerson.family_id == family_id, StoryPerson.person_id == person_id))
    memory_count = count(select(func.count()).select_from(MemoryPersonTag).join(
        Memory, Memory.id == MemoryPersonTag.memory_id).where(
        Memory.family_id == family_id, MemoryPersonTag.person_id == person_id))
    archive_count = count(select(func.count()).select_from(ArchivePerson).where(
        ArchivePerson.family_id == family_id, ArchivePerson.person_id == person_id))
    in_shared_ancestry = db.get(SharedAncestryPerson, person_id) is not None
    shared_root = db.scalar(select(SharedAncestry.id).where(
        SharedAncestry.root_person_id == person_id).limit(1)) is not None
    root_connection = db.scalar(select(RootConnection.family_id).where(
        or_(RootConnection.person_id == person_id, RootConnection.target_person_id == person_id),
        RootConnection.status.in_(("pending", "approved"))).limit(1)) is not None
    pending_claim = db.scalar(select(PersonLinkRequest.id).where(
        PersonLinkRequest.person_id == person_id).limit(1)) is not None
    family_root = family.root_person_id == person_id
    return PersonDependencyPreview(
        account_link=account_link, parent_child_count=parent_child_count,
        marriage_count=marriage_count, story_count=story_count,
        memory_count=memory_count, archive_count=archive_count,
        in_shared_ancestry=in_shared_ancestry, root_connection=root_connection,
        pending_claim=pending_claim, family_root=family_root, shared_root=shared_root,
        can_detach=not any((account_link, in_shared_ancestry, root_connection,
                            pending_claim, family_root, shared_root)),
    )


@router.delete("/families/{family_id}/people/{person_id}", status_code=204)
def detach_person(
    family_id: UUID, person_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_super_admin), db: Session = Depends(get_db),
):
    family = _family(db, family_id)
    _person(db, family_id, person_id)
    if family.root_person_id == person_id:
        raise HTTPException(status_code=409, detail="Эхлээд удмын эхийг солино уу.")
    if db.scalar(select(UserPersonLink.user_id).where(UserPersonLink.person_id == person_id)):
        raise HTTPException(status_code=409, detail="Энэ хүн аккаунттай холбогдсон байна. Эхлээд аккаунтын холбоосыг цэгцэлнэ үү.")
    if db.get(SharedAncestryPerson, person_id) or db.scalar(select(SharedAncestry.id).where(
        SharedAncestry.root_person_id == person_id
    )):
        raise HTTPException(status_code=409, detail="Энэ хүн нийтлэг модонд байна. Эхлээд нийтлэг модны холбоосыг цэгцэлнэ үү.")
    if db.scalar(select(RootConnection.family_id).where(
        or_(RootConnection.person_id == person_id, RootConnection.target_person_id == person_id),
        RootConnection.status.in_(("pending", "approved"))).limit(1)):
        raise HTTPException(status_code=409, detail="Энэ хүн үндэс модны идэвхтэй холболттой байна. Эхлээд холболтыг салгана уу.")
    if db.scalar(select(PersonLinkRequest.id).where(PersonLinkRequest.person_id == person_id)):
        raise HTTPException(status_code=409, detail="Энэ хүнд аккаунт холбох хүсэлт байна. Эхлээд хүсэлтийг шийднэ үү.")
    # Detach only this family's associations. The Person, biography and source
    # records survive; relationships can be restored by re-adding the Person.
    db.execute(delete(StoryPerson).where(StoryPerson.family_id == family_id,
                                         StoryPerson.person_id == person_id))
    db.execute(delete(ArchivePerson).where(ArchivePerson.family_id == family_id,
                                           ArchivePerson.person_id == person_id))
    db.execute(delete(MemoryPersonTag).where(
        MemoryPersonTag.person_id == person_id,
        MemoryPersonTag.memory_id.in_(select(Memory.id).where(Memory.family_id == family_id)),
    ))
    db.execute(delete(PersonLineageAssignment).where(
        PersonLineageAssignment.person_id == person_id,
        PersonLineageAssignment.lineage_id.in_(select(Lineage.id).where(Lineage.family_id == family_id)),
    ))
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
    if db.scalar(select(RootConnection.family_id).where(
        RootConnection.canonical_edge_id == relationship_id,
        RootConnection.status == "approved",
    ).limit(1)):
        raise HTTPException(status_code=409, detail="Энэ бодит холбоос үндэс модонд батлагдсан байна. Эхлээд үндэс модны холболтыг салгана уу.")
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
    from app.families import _validate_story_photos

    _validate_story_photos(db, family_id, current[0], body.body, body.visibility)
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


@router.get("/announcements/summary", response_model=AnnouncementSummary)
def announcement_summary(
    _: tuple[User, AdminRole] = Depends(require_admin), db: Session = Depends(get_db),
):
    now = datetime.now(UTC)
    published = db.scalar(select(func.count()).select_from(Announcement).where(
        Announcement.is_published.is_(True),
        or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
    )) or 0
    drafts = db.scalar(select(func.count()).select_from(Announcement).where(
        Announcement.is_published.is_(False),
    )) or 0
    archived = db.scalar(select(func.count()).select_from(Announcement).where(
        Announcement.is_published.is_(True), Announcement.expires_at <= now,
    )) or 0
    return AnnouncementSummary(published=published, drafts=drafts, archived=archived)


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
    limit: int = Query(default=3, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=10000),
):
    now = datetime.now(UTC)
    return db.scalars(select(Announcement).where(
        Announcement.is_published.is_(True),
        or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
    ).order_by(Announcement.created_at.desc(), Announcement.id.desc())
        .offset(offset).limit(limit)).all()

"""Self-registration requests from family members to be placed on the family tree."""

from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import (
    AuditLog,
    Branch,
    FamilyMember,
    FamilyPerson,
    Lineage,
    ParentChildRelationship,
    Person,
    PersonLineageAssignment,
    TreeJoinRequest,
    User,
    UserPersonLink,
)
from app.observability import request_id_context
from app.person_search import normalize_search_name
from app.privacy import person_is_minor

router = APIRouter(tags=["tree-join-requests"])


class TreeJoinRequestCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(default="", max_length=120)
    middle_name: str | None = Field(default=None, max_length=120)
    gender: str | None = Field(default=None, pattern="^(male|female|other)$")
    birth_date: date | None = None
    birth_place: str | None = Field(default=None, max_length=200)
    biography: str | None = Field(default=None, max_length=4000)
    branch_id: UUID | None = None
    claimed_generation: int | None = Field(default=None, ge=1, le=15)
    father_person_id: UUID | None = None
    mother_person_id: UUID | None = None
    declared_father_name: str | None = Field(default=None, max_length=160)
    declared_mother_name: str | None = Field(default=None, max_length=160)
    note: str | None = Field(default=None, max_length=1000)


class TreeJoinApproveInput(BaseModel):
    branch_id: UUID | None = None
    father_person_id: UUID | None = None
    mother_person_id: UUID | None = None
    review_note: str | None = Field(default=None, max_length=1000)


class TreeJoinRejectInput(BaseModel):
    review_note: str | None = Field(default=None, max_length=1000)


class TreeJoinAttachParentInput(BaseModel):
    parent_person_id: UUID


class ParentCandidateOut(BaseModel):
    person_id: UUID
    full_name: str
    gender: str | None = None
    birth_year: int | None = None


class TreeJoinRequestOut(BaseModel):
    id: UUID
    family_id: UUID
    user_id: UUID
    user_name: str
    first_name: str
    last_name: str
    middle_name: str | None = None
    gender: str | None = None
    birth_date: date | None = None
    birth_place: str | None = None
    biography: str | None = None
    branch_id: UUID | None = None
    branch_name: str | None = None
    claimed_generation: int | None = None
    father_person_id: UUID | None = None
    father_name: str | None = None
    mother_person_id: UUID | None = None
    mother_name: str | None = None
    declared_father_name: str | None = None
    declared_mother_name: str | None = None
    note: str | None = None
    status: str
    created_person_id: UUID | None = None
    review_note: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
    suggested_fathers: list[ParentCandidateOut] = Field(default_factory=list)
    suggested_mothers: list[ParentCandidateOut] = Field(default_factory=list)


class SmartMatchSuggestionOut(BaseModel):
    request_id: UUID
    child_person_id: UUID
    child_name: str
    branch_name: str | None = None
    claimed_generation: int | None = None
    parent_role: str
    declared_parent_name: str
    candidate_person_id: UUID
    candidate_name: str
    candidate_birth_year: int | None = None


def _require_member(
    db: Session, family_id: UUID, user: User, roles: set[str] | None = None
) -> FamilyMember:
    member = db.scalar(
        select(FamilyMember).where(
            FamilyMember.family_id == family_id,
            FamilyMember.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(status_code=403, detail="Энэ гэр бүлийн гишүүн биш байна.")
    if roles and member.role not in roles:
        raise HTTPException(status_code=403, detail="Энэ үйлдлийг гүйцэтгэх эрх хүрэлцэхгүй.")
    return member


def _person_in_family(db: Session, family_id: UUID, person_id: UUID) -> Person:
    person = db.scalar(
        select(Person)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family_id, Person.id == person_id)
    )
    if person is None:
        raise HTTPException(status_code=404, detail="Сонгосон хүн энэ гэр бүлд олдсонгүй.")
    return person


def _branch_in_family(db: Session, family_id: UUID, branch_id: UUID) -> Branch:
    branch = db.scalar(
        select(Branch)
        .join(Lineage, Lineage.id == Branch.lineage_id)
        .where(Lineage.family_id == family_id, Branch.id == branch_id)
    )
    if branch is None:
        raise HTTPException(status_code=404, detail="Сонгосон салбар энэ гэр бүлд олдсонгүй.")
    return branch


def _full_name(person: Person) -> str:
    return f"{person.last_name} {person.first_name}".strip() or person.first_name


def _audit(
    db: Session, user: User, family_id: UUID, action: str, target_type: str, target_id: UUID
) -> None:
    db.add(
        AuditLog(
            id=uuid4(),
            family_id=family_id,
            actor_id=user.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            request_id=request_id_context.get(),
        )
    )


def _match_candidates(
    family_persons: list[Person],
    declared_name: str | None,
    preferred_gender: str | None,
    exclude_ids: set[UUID],
) -> list[ParentCandidateOut]:
    if not declared_name or not declared_name.strip():
        return []
    needle = normalize_search_name(declared_name)
    if len(needle) < 2:
        return []
    tokens = [tok for tok in needle.split() if len(tok) >= 2]
    matches: list[tuple[int, Person]] = []
    for p in family_persons:
        if p.id in exclude_ids or person_is_minor(p):
            continue
        p_first = p.search_first_name or normalize_search_name(p.first_name)
        p_last = p.search_last_name or normalize_search_name(p.last_name)
        p_full = f"{p_last} {p_first}".strip()
        p_rev = f"{p_first} {p_last}".strip()
        score = 0
        if needle in {p_full, p_rev} and p_full:
            score = 100
        elif needle == p_first and p_first:
            score = 80
        elif tokens and any(tok == p_first for tok in tokens):
            score = 60
        elif p_first and (needle in p_full or p_first in needle):
            score = 40
        if score == 0:
            continue
        if preferred_gender and p.gender == preferred_gender:
            score += 15
        elif preferred_gender and p.gender and p.gender != preferred_gender:
            continue
        matches.append((score, p))
    matches.sort(key=lambda item: (-item[0], item[1].last_name, item[1].first_name))
    return [
        ParentCandidateOut(
            person_id=p.id,
            full_name=_full_name(p),
            gender=p.gender,
            birth_year=p.birth_date.year if p.birth_date else None,
        )
        for _, p in matches[:5]
    ]


def _serialize_request(
    db: Session,
    req: TreeJoinRequest,
    user_name: str,
    family_persons: list[Person] | None = None,
    include_suggestions: bool = False,
) -> TreeJoinRequestOut:
    branch_name = None
    if req.branch_id:
        branch = db.get(Branch, req.branch_id)
        branch_name = branch.name if branch else None
    father_name = None
    if req.father_person_id:
        father = db.get(Person, req.father_person_id)
        father_name = _full_name(father) if father else None
    mother_name = None
    if req.mother_person_id:
        mother = db.get(Person, req.mother_person_id)
        mother_name = _full_name(mother) if mother else None

    suggested_fathers: list[ParentCandidateOut] = []
    suggested_mothers: list[ParentCandidateOut] = []
    if include_suggestions and family_persons is not None:
        exclude = {pid for pid in (req.created_person_id, req.father_person_id, req.mother_person_id) if pid}
        if not req.father_person_id and req.declared_father_name:
            suggested_fathers = _match_candidates(
                family_persons, req.declared_father_name, "male", exclude
            )
        if not req.mother_person_id and req.declared_mother_name:
            suggested_mothers = _match_candidates(
                family_persons, req.declared_mother_name, "female", exclude
            )

    return TreeJoinRequestOut(
        id=req.id,
        family_id=req.family_id,
        user_id=req.user_id,
        user_name=user_name,
        first_name=req.first_name,
        last_name=req.last_name,
        middle_name=req.middle_name,
        gender=req.gender,
        birth_date=req.birth_date,
        birth_place=req.birth_place,
        biography=req.biography,
        branch_id=req.branch_id,
        branch_name=branch_name,
        claimed_generation=req.claimed_generation,
        father_person_id=req.father_person_id,
        father_name=father_name,
        mother_person_id=req.mother_person_id,
        mother_name=mother_name,
        declared_father_name=req.declared_father_name,
        declared_mother_name=req.declared_mother_name,
        note=req.note,
        status=req.status,
        created_person_id=req.created_person_id,
        review_note=req.review_note,
        reviewed_at=req.reviewed_at,
        created_at=req.created_at,
        suggested_fathers=suggested_fathers,
        suggested_mothers=suggested_mothers,
    )


def _creates_ancestor_cycle(db: Session, parent_id: UUID, child_id: UUID) -> bool:
    if parent_id == child_id:
        return True
    visited: set[UUID] = set()
    frontier: list[UUID] = [parent_id]
    while frontier:
        current = frontier.pop()
        if current in visited:
            continue
        visited.add(current)
        ancestors = list(
            db.scalars(
                select(ParentChildRelationship.parent_id).where(
                    ParentChildRelationship.child_id == current
                )
            ).all()
        )
        for anc in ancestors:
            if anc == child_id:
                return True
            if anc not in visited:
                frontier.append(anc)
    return False


@router.post(
    "/{family_id}/tree-join-requests",
    response_model=TreeJoinRequestOut,
    status_code=201,
)
def create_tree_join_request(
    family_id: UUID,
    body: TreeJoinRequestCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_member(db, family_id, user)
    if db.scalar(select(UserPersonLink.id).where(UserPersonLink.user_id == user.id)):
        raise HTTPException(
            status_code=409,
            detail="Таны аккаунт ургийн модны хүнтэй аль хэдийн холбогдсон байна.",
        )
    pending = db.scalar(
        select(TreeJoinRequest.id).where(
            TreeJoinRequest.family_id == family_id,
            TreeJoinRequest.user_id == user.id,
            TreeJoinRequest.status == "pending",
        )
    )
    if pending is not None:
        raise HTTPException(
            status_code=409,
            detail="Таны ургийн модонд орох хүсэлт аль хэдийн хүлээгдэж байна.",
        )
    if body.father_person_id and body.mother_person_id and body.father_person_id == body.mother_person_id:
        raise HTTPException(status_code=422, detail="Эцэг, эх нь хоёр өөр хүн байх ёстой.")
    if body.branch_id:
        _branch_in_family(db, family_id, body.branch_id)
    if body.father_person_id:
        _person_in_family(db, family_id, body.father_person_id)
    if body.mother_person_id:
        _person_in_family(db, family_id, body.mother_person_id)

    req = TreeJoinRequest(
        id=uuid4(),
        family_id=family_id,
        user_id=user.id,
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        middle_name=body.middle_name.strip() if body.middle_name else None,
        gender=body.gender,
        birth_date=body.birth_date,
        birth_place=body.birth_place.strip() if body.birth_place else None,
        biography=body.biography.strip() if body.biography else None,
        branch_id=body.branch_id,
        claimed_generation=body.claimed_generation,
        father_person_id=body.father_person_id,
        mother_person_id=body.mother_person_id,
        declared_father_name=body.declared_father_name.strip() if body.declared_father_name else None,
        declared_mother_name=body.declared_mother_name.strip() if body.declared_mother_name else None,
        note=body.note.strip() if body.note else None,
        status="pending",
    )
    db.add(req)
    _audit(db, user, family_id, "tree_join.requested", "tree_join_request", req.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Таны ургийн модонд орох хүсэлт аль хэдийн хүлээгдэж байна.",
        ) from None
    db.refresh(req)
    return _serialize_request(db, req, user.display_name)


@router.get(
    "/{family_id}/tree-join-requests/me",
    response_model=list[TreeJoinRequestOut],
)
def list_my_tree_join_requests(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_member(db, family_id, user)
    rows = list(
        db.scalars(
            select(TreeJoinRequest)
            .where(
                TreeJoinRequest.family_id == family_id,
                TreeJoinRequest.user_id == user.id,
            )
            .order_by(TreeJoinRequest.created_at.desc(), TreeJoinRequest.id)
            .limit(20)
        ).all()
    )
    return [_serialize_request(db, r, user.display_name) for r in rows]


@router.get(
    "/{family_id}/tree-join-requests",
    response_model=list[TreeJoinRequestOut],
)
def list_tree_join_requests(
    family_id: UUID,
    status: str = "pending",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_member(db, family_id, user, {"owner"})
    stmt = (
        select(TreeJoinRequest, User.display_name)
        .join(User, User.id == TreeJoinRequest.user_id)
        .where(TreeJoinRequest.family_id == family_id)
    )
    if status != "all":
        stmt = stmt.where(TreeJoinRequest.status == status)
    rows = db.execute(stmt.order_by(TreeJoinRequest.created_at.desc(), TreeJoinRequest.id)).all()
    family_persons = list(
        db.scalars(
            select(Person)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(FamilyPerson.family_id == family_id)
        ).all()
    )
    return [
        _serialize_request(db, req, uname, family_persons=family_persons, include_suggestions=True)
        for req, uname in rows
    ]


@router.post(
    "/{family_id}/tree-join-requests/{request_id}/approve",
    response_model=TreeJoinRequestOut,
)
def approve_tree_join_request(
    family_id: UUID,
    request_id: UUID,
    body: TreeJoinApproveInput | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_member(db, family_id, user, {"owner"})
    req = db.scalar(
        select(TreeJoinRequest).where(
            TreeJoinRequest.id == request_id,
            TreeJoinRequest.family_id == family_id,
            TreeJoinRequest.status == "pending",
        )
    )
    if req is None:
        raise HTTPException(status_code=404, detail="Хүлээгдэж буй хүсэлт олдсонгүй.")
    requester = db.get(User, req.user_id)
    if requester is None or not requester.is_active:
        raise HTTPException(status_code=409, detail="Хүсэлт гаргасан аккаунт идэвхгүй байна.")
    _require_member(db, family_id, requester)
    if db.scalar(select(UserPersonLink.id).where(UserPersonLink.user_id == req.user_id)):
        raise HTTPException(
            status_code=409, detail="Энэ хэрэглэгч ургийн модны хүнтэй аль хэдийн холбогдсон байна."
        )

    final_branch_id = body.branch_id if (body and body.branch_id is not None) else req.branch_id
    final_father_id = (
        body.father_person_id if (body and body.father_person_id is not None) else req.father_person_id
    )
    final_mother_id = (
        body.mother_person_id if (body and body.mother_person_id is not None) else req.mother_person_id
    )
    if final_father_id and final_mother_id and final_father_id == final_mother_id:
        raise HTTPException(status_code=422, detail="Эцэг, эх нь хоёр өөр хүн байх ёстой.")

    branch: Branch | None = None
    if final_branch_id:
        branch = _branch_in_family(db, family_id, final_branch_id)
    if final_father_id:
        _person_in_family(db, family_id, final_father_id)
    if final_mother_id:
        _person_in_family(db, family_id, final_mother_id)

    person = Person(
        id=uuid4(),
        first_name=req.first_name,
        last_name=req.last_name,
        middle_name=req.middle_name,
        search_first_name=normalize_search_name(req.first_name),
        search_last_name=normalize_search_name(req.last_name),
        search_middle_name=normalize_search_name(req.middle_name),
        gender=req.gender,
        birth_date=req.birth_date,
        birth_place=req.birth_place,
        short_description=req.biography,
        visibility="family",
        created_by=user.id,
    )
    db.add(person)
    db.flush()

    db.add(FamilyPerson(family_id=family_id, person_id=person.id, added_by=user.id))
    db.add(UserPersonLink(user_id=req.user_id, person_id=person.id, linked_by=user.id))

    if branch is not None:
        db.add(
            PersonLineageAssignment(
                person_id=person.id,
                lineage_id=branch.lineage_id,
                branch_id=branch.id,
            )
        )

    for parent_id in (final_father_id, final_mother_id):
        if parent_id is not None:
            db.add(
                ParentChildRelationship(
                    parent_id=parent_id,
                    child_id=person.id,
                    relationship_type="biological",
                    created_by=user.id,
                )
            )

    req.branch_id = final_branch_id
    req.father_person_id = final_father_id
    req.mother_person_id = final_mother_id
    req.status = "approved"
    req.created_person_id = person.id
    req.reviewed_by = user.id
    req.reviewed_at = datetime.now(UTC)
    if body and body.review_note:
        req.review_note = body.review_note.strip()

    _audit(db, user, family_id, "tree_join.approved", "person", person.id)
    db.commit()
    db.refresh(req)
    return _serialize_request(db, req, requester.display_name)


@router.post(
    "/{family_id}/tree-join-requests/{request_id}/reject",
    response_model=TreeJoinRequestOut,
)
def reject_tree_join_request(
    family_id: UUID,
    request_id: UUID,
    body: TreeJoinRejectInput | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_member(db, family_id, user, {"owner"})
    req = db.scalar(
        select(TreeJoinRequest).where(
            TreeJoinRequest.id == request_id,
            TreeJoinRequest.family_id == family_id,
            TreeJoinRequest.status == "pending",
        )
    )
    if req is None:
        raise HTTPException(status_code=404, detail="Хүлээгдэж буй хүсэлт олдсонгүй.")
    req.status = "rejected"
    req.reviewed_by = user.id
    req.reviewed_at = datetime.now(UTC)
    if body and body.review_note:
        req.review_note = body.review_note.strip()
    _audit(db, user, family_id, "tree_join.rejected", "tree_join_request", req.id)
    db.commit()
    db.refresh(req)
    requester = db.get(User, req.user_id)
    return _serialize_request(
        db, req, requester.display_name if requester else "Нэргүй хэрэглэгч"
    )


@router.get(
    "/{family_id}/tree-join-requests/smart-matches",
    response_model=list[SmartMatchSuggestionOut],
)
def list_smart_parent_matches(
    family_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Suggest 1-click parent links for approved members whose parents were added later."""
    _require_member(db, family_id, user, {"owner"})
    approved_reqs = list(
        db.scalars(
            select(TreeJoinRequest).where(
                TreeJoinRequest.family_id == family_id,
                TreeJoinRequest.status == "approved",
                TreeJoinRequest.created_person_id.is_not(None),
                or_(
                    TreeJoinRequest.declared_father_name.is_not(None),
                    TreeJoinRequest.declared_mother_name.is_not(None),
                ),
            )
        ).all()
    )
    if not approved_reqs:
        return []

    family_persons = list(
        db.scalars(
            select(Person)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(FamilyPerson.family_id == family_id)
        ).all()
    )
    persons_by_id = {p.id: p for p in family_persons}
    child_ids = [r.created_person_id for r in approved_reqs if r.created_person_id]
    existing_edges = list(
        db.scalars(
            select(ParentChildRelationship).where(
                ParentChildRelationship.child_id.in_(child_ids)
            )
        ).all()
    )
    parents_by_child: dict[UUID, set[UUID]] = {}
    for edge in existing_edges:
        parents_by_child.setdefault(edge.child_id, set()).add(edge.parent_id)

    suggestions: list[SmartMatchSuggestionOut] = []
    for req in approved_reqs:
        child_id = req.created_person_id
        if child_id is None or child_id not in persons_by_id:
            continue
        child = persons_by_id[child_id]
        current_parents = parents_by_child.get(child_id, set())
        branch_name = None
        if req.branch_id:
            b = db.get(Branch, req.branch_id)
            branch_name = b.name if b else None

        has_male_parent = any(
            persons_by_id[pid].gender == "male" for pid in current_parents if pid in persons_by_id
        )
        has_female_parent = any(
            persons_by_id[pid].gender == "female" for pid in current_parents if pid in persons_by_id
        )
        exclude = {child_id} | current_parents

        if req.declared_father_name and not req.father_person_id and not has_male_parent:
            for cand in _match_candidates(family_persons, req.declared_father_name, "male", exclude):
                suggestions.append(
                    SmartMatchSuggestionOut(
                        request_id=req.id,
                        child_person_id=child_id,
                        child_name=_full_name(child),
                        branch_name=branch_name,
                        claimed_generation=req.claimed_generation,
                        parent_role="father",
                        declared_parent_name=req.declared_father_name,
                        candidate_person_id=cand.person_id,
                        candidate_name=cand.full_name,
                        candidate_birth_year=cand.birth_year,
                    )
                )
        if req.declared_mother_name and not req.mother_person_id and not has_female_parent:
            for cand in _match_candidates(family_persons, req.declared_mother_name, "female", exclude):
                suggestions.append(
                    SmartMatchSuggestionOut(
                        request_id=req.id,
                        child_person_id=child_id,
                        child_name=_full_name(child),
                        branch_name=branch_name,
                        claimed_generation=req.claimed_generation,
                        parent_role="mother",
                        declared_parent_name=req.declared_mother_name,
                        candidate_person_id=cand.person_id,
                        candidate_name=cand.full_name,
                        candidate_birth_year=cand.birth_year,
                    )
                )
    return suggestions


@router.post(
    "/{family_id}/tree-join-requests/{request_id}/attach-parent",
    status_code=204,
)
def attach_smart_matched_parent(
    family_id: UUID,
    request_id: UUID,
    body: TreeJoinAttachParentInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_member(db, family_id, user, {"owner"})
    req = db.scalar(
        select(TreeJoinRequest).where(
            TreeJoinRequest.id == request_id,
            TreeJoinRequest.family_id == family_id,
            TreeJoinRequest.status == "approved",
        )
    )
    if req is None or req.created_person_id is None:
        raise HTTPException(status_code=404, detail="Батлагдсан хүсэлт олдсонгүй.")
    parent = _person_in_family(db, family_id, body.parent_person_id)
    _person_in_family(db, family_id, req.created_person_id)

    if _creates_ancestor_cycle(db, parent.id, req.created_person_id):
        raise HTTPException(
            status_code=409, detail="Энэ холбоос нь ургийн модонд тойрог (cycle) үүсгэнэ."
        )
    existing = db.scalar(
        select(ParentChildRelationship.id).where(
            and_(
                ParentChildRelationship.parent_id == parent.id,
                ParentChildRelationship.child_id == req.created_person_id,
            )
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Энэ эцэг/эхийн холбоос аль хэдийн бүртгэгдсэн байна.")

    db.add(
        ParentChildRelationship(
            parent_id=parent.id,
            child_id=req.created_person_id,
            relationship_type="biological",
            created_by=user.id,
        )
    )
    if parent.gender == "male" and req.father_person_id is None:
        req.father_person_id = parent.id
    elif parent.gender == "female" and req.mother_person_id is None:
        req.mother_person_id = parent.id
    _audit(db, user, family_id, "tree_join.parent_attached", "person", req.created_person_id)
    db.commit()
    return Response(status_code=204)

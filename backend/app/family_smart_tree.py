"""Smart kinship wiring, pair parent-child unlink, and Mongolian oral history extraction."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.families import (
    _assert_person_visible,
    _audit,
    _can_edit_person,
    _member,
    _person_in_family,
    _require_minor_scope,
    _require_work_scope,
)
from app.models import (
    Biography,
    Family,
    FamilyPerson,
    LifeEvent,
    Marriage,
    ParentChildRelationship,
    Person,
    User,
)
from app.oral_history import parse_oral_narrative
from app.person_search import normalize_search_name
from app.relationships import (
    RelationshipError,
    assert_parent_child_is_acyclic,
    canonical_pair,
)

router = APIRouter(tags=["smart tree"])


class SmartConnectInput(BaseModel):
    anchor_person_id: UUID
    target_person_id: UUID
    role: str = Field(pattern="^(father|mother|spouse|son|daughter|sibling)$")
    relationship_type: str = Field(default="biological", pattern="^(biological|adoptive)$")
    co_parent_id: UUID | None = None
    auto_marry_coparent: bool = True
    apply_to_siblings: bool = True
    create_shared_parent_first_name: str | None = Field(default=None, max_length=120)
    create_shared_parent_last_name: str | None = Field(default=None, max_length=120)
    create_shared_parent_gender: str = Field(default="male", pattern="^(male|female)$")
    marriage_start_date: date | None = None


class SmartConnectOut(BaseModel):
    created_parent_child_edges: int = 0
    created_marriages: int = 0
    created_shared_parent_id: UUID | None = None
    summary: str


class OralHistoryExtractInput(BaseModel):
    narrative_text: str = Field(min_length=10, max_length=25000)
    auto_create_events: bool = False
    update_biography: bool = False


class ExtractedEventDraft(BaseModel):
    event_type: str
    title: str
    event_date: date | None = None
    date_note: str | None = None
    location: str | None = None
    description: str | None = None


class OralHistoryExtractOut(BaseModel):
    suggested_biography: str
    extracted_events: list[ExtractedEventDraft]
    created_events_count: int = 0
    biography_updated: bool = False


@router.delete("/{family_id}/relationships/parent-child", status_code=204)
def remove_parent_child_by_pair(
    family_id: UUID,
    parent_id: UUID = Query(description="Эцэг эсвэл эхийн ID"),
    child_id: UUID = Query(description="Хүүхдийн ID"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_work_scope(db, family_id, user, "manage_people")
    parent = _person_in_family(db, family_id, parent_id)
    child = _person_in_family(db, family_id, child_id)
    _assert_person_visible(db, parent, user)
    _assert_person_visible(db, child, user)
    _require_minor_scope(db, family_id, parent, user, "edit_profile")
    _require_minor_scope(db, family_id, child, user, "edit_profile")
    edge = db.scalar(
        select(ParentChildRelationship).where(
            ParentChildRelationship.parent_id == parent_id,
            ParentChildRelationship.child_id == child_id,
        )
    )
    if edge is None:
        raise HTTPException(status_code=404, detail="Эцэг эх-хүүхдийн холбоос олдсонгүй.")
    edge_id = edge.id
    db.delete(edge)
    _audit(db, user, family_id, "relationship.parent_child.deleted", "parent_child", edge_id)
    db.commit()
    return Response(status_code=204)


@router.post("/{family_id}/relationships/smart-connect", response_model=SmartConnectOut, status_code=201)
def smart_connect_relatives(
    family_id: UUID,
    body: SmartConnectInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Atomically connect two family persons (parent, child, spouse, or sibling)."""
    _require_work_scope(db, family_id, user, "manage_people")
    if body.anchor_person_id == body.target_person_id:
        raise HTTPException(status_code=422, detail="Хүн өөрөө өөртэйгөө ураг холбох боломжгүй.")

    anchor = _person_in_family(db, family_id, body.anchor_person_id)
    target = _person_in_family(db, family_id, body.target_person_id)
    _assert_person_visible(db, anchor, user)
    _assert_person_visible(db, target, user)
    _require_minor_scope(db, family_id, anchor, user, "edit_profile")
    _require_minor_scope(db, family_id, target, user, "edit_profile")

    db.execute(select(Family.id).where(Family.id == family_id).with_for_update())
    family_person_ids = select(FamilyPerson.person_id).where(FamilyPerson.family_id == family_id)
    current_edges = [
        (r[0], r[1])
        for r in db.execute(
            select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id).where(
                ParentChildRelationship.parent_id.in_(family_person_ids),
                ParentChildRelationship.child_id.in_(family_person_ids),
            )
        ).all()
    ]

    created_edges = 0
    created_marriages = 0
    created_shared_parent_id: UUID | None = None

    def _ensure_parent_child(p_id: UUID, c_id: UUID) -> bool:
        nonlocal created_edges
        if p_id == c_id:
            return False
        if any(ep == p_id and ec == c_id for ep, ec in current_edges):
            return False
        try:
            assert_parent_child_is_acyclic(current_edges, p_id, c_id)
        except RelationshipError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        edge = ParentChildRelationship(
            parent_id=p_id,
            child_id=c_id,
            relationship_type=body.relationship_type,
            created_by=user.id,
        )
        db.add(edge)
        db.flush()
        current_edges.append((p_id, c_id))
        _audit(db, user, family_id, "relationship.parent_child.created", "parent_child", edge.id)
        created_edges += 1
        return True

    def _ensure_marriage(person_a: UUID, person_b: UUID) -> bool:
        nonlocal created_marriages
        if person_a == person_b:
            return False
        first, second = canonical_pair(person_a, person_b)
        existing = db.scalar(
            select(Marriage).where(
                Marriage.person_1_id == first,
                Marriage.person_2_id == second,
                Marriage.deleted_at.is_(None),
            )
        )
        if existing is not None:
            return False
        marriage = Marriage(
            person_1_id=first,
            person_2_id=second,
            status="married",
            start_date=body.marriage_start_date,
            created_by=user.id,
        )
        db.add(marriage)
        db.flush()
        _audit(db, user, family_id, "marriage.created", "marriage", marriage.id)
        created_marriages += 1
        return True

    anchor_name = f"{anchor.last_name} {anchor.first_name}".strip()
    target_name = f"{target.last_name} {target.first_name}".strip()

    if body.role in {"father", "mother"}:
        existing_parent_ids = [ep for ep, ec in current_edges if ec == anchor.id and ep != target.id]
        _ensure_parent_child(target.id, anchor.id)

        co_parent_to_use = body.co_parent_id
        if co_parent_to_use is None and len(existing_parent_ids) == 1:
            co_parent_to_use = existing_parent_ids[0]

        if co_parent_to_use is not None and co_parent_to_use != target.id:
            co_parent = _person_in_family(db, family_id, co_parent_to_use)
            _assert_person_visible(db, co_parent, user)
            if body.auto_marry_coparent:
                _ensure_marriage(target.id, co_parent.id)
            if body.apply_to_siblings:
                sibling_ids = [
                    ec
                    for ep, ec in list(current_edges)
                    if ep == co_parent.id and ec != anchor.id and ec != target.id
                ]
                for sib_id in sibling_ids:
                    try:
                        _ensure_parent_child(target.id, sib_id)
                    except HTTPException:
                        pass

        role_label = "эцэг" if body.role == "father" else "эх"
        summary = f"“{target_name}” нь “{anchor_name}”-ийн {role_label}-ээр амжилттай зангидагдлаа."

    elif body.role == "spouse":
        _ensure_marriage(anchor.id, target.id)
        summary = f"“{anchor_name}” болон “{target_name}” нарын гэрлэлтийн холбоос бүртгэгдлээ."

    elif body.role in {"son", "daughter"}:
        _ensure_parent_child(anchor.id, target.id)
        if body.co_parent_id and body.co_parent_id != anchor.id and body.co_parent_id != target.id:
            co_parent = _person_in_family(db, family_id, body.co_parent_id)
            _assert_person_visible(db, co_parent, user)
            _ensure_parent_child(co_parent.id, target.id)
            if body.auto_marry_coparent:
                _ensure_marriage(anchor.id, co_parent.id)
        role_label = "хүү" if body.role == "son" else "охин"
        summary = f"“{target_name}” нь “{anchor_name}”-ийн {role_label}-өөр модонд зангидагдлаа."

    else:
        anchor_parents = [ep for ep, ec in current_edges if ec == anchor.id and ep != target.id]
        target_parents = [ep for ep, ec in current_edges if ec == target.id and ep != anchor.id]

        shared_parents = list(dict.fromkeys(anchor_parents or target_parents))
        if not shared_parents:
            first_name = (body.create_shared_parent_first_name or "").strip()
            last_name = (body.create_shared_parent_last_name or anchor.last_name or target.last_name or "").strip()
            if not first_name:
                first_name = f"{anchor.last_name or anchor.first_name}-ийн эцэг/эх"
            shared_parent = Person(
                first_name=first_name,
                last_name=last_name,
                gender=body.create_shared_parent_gender,
                is_alive=False,
                visibility="family",
                search_first_name=normalize_search_name(first_name),
                search_last_name=normalize_search_name(last_name),
                search_middle_name="",
                created_by=user.id,
            )
            db.add(shared_parent)
            db.flush()
            db.add(FamilyPerson(family_id=family_id, person_id=shared_parent.id, added_by=user.id))
            db.flush()
            _audit(db, user, family_id, "person.created", "person", shared_parent.id)
            created_shared_parent_id = shared_parent.id
            shared_parents = [shared_parent.id]

        for p_id in shared_parents:
            _ensure_parent_child(p_id, anchor.id)
            _ensure_parent_child(p_id, target.id)

        summary = f"“{target_name}” болон “{anchor_name}” нар ах/дүүсийн холбоосоор эцэг эхдээ зангидагдлаа."

    db.commit()
    return SmartConnectOut(
        created_parent_child_edges=created_edges,
        created_marriages=created_marriages,
        created_shared_parent_id=created_shared_parent_id,
        summary=summary,
    )


@router.post(
    "/{family_id}/persons/{person_id}/oral-history/extract",
    response_model=OralHistoryExtractOut,
)
def extract_person_oral_history(
    family_id: UUID,
    person_id: UUID,
    body: OralHistoryExtractInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    _require_minor_scope(db, family_id, person, user, "manage_biography")

    full_name = f"{person.first_name} {person.last_name or ''}".strip() or None
    suggested_bio, milestones = parse_oral_narrative(body.narrative_text, person_name=full_name)

    created_count = 0
    bio_updated = False
    can_edit = _can_edit_person(db, family_id, person, user)

    if body.auto_create_events:
        if not can_edit:
            raise HTTPException(status_code=403, detail="Үйл явдал автоматаар үүсгэх эрхгүй.")
        for milestone in milestones:
            event = LifeEvent(
                person_id=person_id,
                event_type=milestone.event_type,
                title=milestone.title,
                event_date=milestone.event_date,
                date_note=milestone.date_note,
                location=milestone.location,
                description=milestone.description,
                created_by=user.id,
            )
            db.add(event)
            db.flush()
            _audit(db, user, family_id, "life_event.created", "life_event", event.id)
            created_count += 1

    if body.update_biography:
        if not can_edit:
            raise HTTPException(status_code=403, detail="Намтар шинэчлэх эрхгүй.")
        bio = db.scalar(select(Biography).where(Biography.person_id == person_id))
        if bio is None:
            bio = Biography(person_id=person_id, body=suggested_bio, updated_by=user.id)
            db.add(bio)
        else:
            bio.body = suggested_bio
            bio.updated_by = user.id
        db.flush()
        _audit(db, user, family_id, "biography.updated", "person", person_id)
        bio_updated = True

    if created_count > 0 or bio_updated:
        db.commit()

    return OralHistoryExtractOut(
        suggested_biography=suggested_bio,
        extracted_events=[
            ExtractedEventDraft(
                event_type=m.event_type,
                title=m.title,
                event_date=m.event_date,
                date_note=m.date_note,
                location=m.location,
                description=m.description,
            )
            for m in milestones
        ],
        created_events_count=created_count,
        biography_updated=bio_updated,
    )

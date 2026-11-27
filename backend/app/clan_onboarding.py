"""Unified Clan Guided Onboarding Quiz + 1-Click Admin Approval + Auto-Account Creation.

Uses existing tables (TreeJoinRequest, SharedAncestry, Person, FamilyMember, User)
so zero Alembic DDL migrations are required.
"""

from __future__ import annotations

import json
import secrets
from collections import deque
from datetime import UTC, date, datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.admin import AdminRole, require_super_admin
from app.auth import _password_hash as hash_password
from app.auth import get_current_user, normalize_email
from app.db import get_db
from app.models import (
    AdminGrant,
    Archive,
    ArchivePerson,
    AuditLog,
    Biography,
    ChatMessage,
    Donation,
    Family,
    FamilyClanLink,
    FamilyEvent,
    FamilyFund,
    FamilyMember,
    FamilyPerson,
    FamilyTrashRecord,
    LifeEvent,
    LoginIdentity,
    Marriage,
    Memory,
    MemoryPersonTag,
    ParentChildRelationship,
    Person,
    PersonLineageAssignment,
    PersonLinkRequest,
    Photo,
    PhotoPersonTag,
    RootConnection,
    SharedAncestry,
    SharedAncestryPerson,
    SharedAncestryRelationship,
    SharedAncestryRequest,
    Story,
    StoryPerson,
    TreeJoinRequest,
    User,
    UserPersonLink,
    UserSession,
)
from app.person_search import normalize_search_name
from app.relationships import (
    RelationshipError,
    assert_parent_child_is_acyclic,
    canonical_pair,
    lock_ancestry_writes,
)

PREFIX = "CLAN_ONBOARDING_V1:"
RELATIVES_PREFIX = "CLAN_RELATIVES_V1:"
CORRECTION_PREFIX = "CLAN_CORRECTION_V1:"

router = APIRouter(prefix="/clan/onboarding", tags=["clan-onboarding"])
admin_router = APIRouter(prefix="/admin/clan/onboarding", tags=["admin-clan-onboarding"])


class RelativeDraftInput(BaseModel):
    relation: str = Field(pattern="^(parent|spouse|child|sibling)$")
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(default="", max_length=120)
    gender: str = Field(default="unknown", pattern="^(male|female|unknown)$")
    birth_date: date | None = None
    is_alive: bool = True
    email: EmailStr | None = None


class ClanOnboardingSubmitInput(BaseModel):
    branch_person_id: UUID
    claimed_generation: int = Field(ge=2, le=12)
    anchor_person_id: UUID
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(default="", max_length=120)
    gender: str = Field(default="unknown", pattern="^(male|female|unknown)$")
    birth_date: date | None = None
    birth_place: str | None = Field(default=None, max_length=200)
    relatives: list[RelativeDraftInput] = Field(default_factory=list, max_length=15)
    note: str | None = Field(default=None, max_length=600)


class ClanRelativesSubmitInput(BaseModel):
    relatives: list[RelativeDraftInput] = Field(min_length=1, max_length=15)
    note: str | None = Field(default=None, max_length=600)


class ClanOnboardingCorrectionInput(BaseModel):
    branch_person_id: UUID
    claimed_generation: int = Field(ge=2, le=12)
    anchor_person_id: UUID
    reason: str | None = Field(default=None, max_length=600)


class ClanOnboardingRejectInput(BaseModel):
    review_note: str | None = Field(default=None, max_length=500)
    ban_user: bool = False


class ClanFamilyMergeInput(BaseModel):
    source_family_id: UUID
    target_family_id: UUID | None = None
    source_person_id: UUID
    target_person_id: UUID
    mode: Literal["attach_child", "merge_duplicate", "attach_spouse", "bridge_parent"]
    bridge_parent: RelativeDraftInput | None = None


def _resolve_clan_family_and_root(db: Session) -> tuple[Family | None, UUID | None]:
    """Find the primary unified clan family and its top-most founding ancestor."""
    shared = db.get(SharedAncestry, 1)
    root_pid = shared.root_person_id if shared and shared.root_person_id else None
    family: Family | None = None
    if root_pid:
        fp = db.scalar(select(FamilyPerson).where(FamilyPerson.person_id == root_pid))
        if fp:
            family = db.get(Family, fp.family_id)
    if family is None or family.archived_at is not None:
        family = db.scalar(
            select(Family)
            .where(Family.archived_at.is_(None))
            .order_by(Family.created_at, Family.id)
        )
    if family and root_pid is None:
        root_pid = family.root_person_id
    return family, root_pid


def _person_label(p: Person) -> str:
    return " ".join(part for part in (p.last_name, p.first_name) if part and part.strip()).strip() or "Хүн"


def _walk_up_top(db: Session, start_id: UUID, family_person_ids: set[UUID]) -> UUID:
    cur = start_id
    seen = {cur}
    while True:
        parents = [
            pid
            for pid in db.scalars(
                select(ParentChildRelationship.parent_id).where(ParentChildRelationship.child_id == cur)
            ).all()
            if pid in family_person_ids and pid not in seen
        ]
        if not parents:
            return cur
        cur = parents[0]
        seen.add(cur)


def require_clan_reviewer(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> tuple[User, str, UUID | None]:
    """Allow global admins OR primary clan family owner/editor to review requests."""
    grant = db.get(AdminGrant, user.id)
    if grant is not None:
        return user, grant.role, None
    clan_family, _ = _resolve_clan_family_and_root(db)
    if clan_family is not None:
        member = db.scalar(
            select(FamilyMember).where(
                FamilyMember.family_id == clan_family.id,
                FamilyMember.user_id == user.id,
            )
        )
        if member is not None and member.role in {"owner", "editor"}:
            return user, member.role, clan_family.id
    raise HTTPException(status_code=403, detail="Админ эсвэл Засагч эрх шаардлагатай.")


@router.get("/status")
def get_onboarding_status(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    is_admin = db.get(AdminGrant, user.id) is not None
    member_family_ids = db.scalars(
        select(FamilyMember.family_id)
        .join(Family, Family.id == FamilyMember.family_id)
        .where(FamilyMember.user_id == user.id, Family.archived_at.is_(None))
    ).all()
    clan_family, _ = _resolve_clan_family_and_root(db)
    is_clan_reviewer = is_admin
    if not is_clan_reviewer and clan_family is not None:
        clan_member = db.scalar(
            select(FamilyMember).where(
                FamilyMember.family_id == clan_family.id,
                FamilyMember.user_id == user.id,
            )
        )
        is_clan_reviewer = bool(clan_member and clan_member.role in {"owner", "editor"})

    pending = db.scalar(
        select(TreeJoinRequest)
        .where(TreeJoinRequest.user_id == user.id, TreeJoinRequest.status == "pending")
        .order_by(TreeJoinRequest.created_at.desc())
    )
    rejected = db.scalar(
        select(TreeJoinRequest)
        .where(TreeJoinRequest.user_id == user.id, TreeJoinRequest.status == "rejected")
        .order_by(TreeJoinRequest.created_at.desc())
    )

    approved = bool(is_admin or len(member_family_ids) > 0)
    return {
        "approved": approved,
        "is_admin": is_admin,
        "can_review": is_clan_reviewer,
        "clan_family_id": str(clan_family.id) if clan_family else None,
        "clan_family_name": clan_family.name if clan_family else "Гуулингийнхан",
        "pending_request": (
            {
                "id": str(pending.id),
                "status": pending.status,
                "claimed_generation": pending.claimed_generation,
                "created_at": pending.created_at.isoformat(),
            }
            if pending
            else None
        ),
        "last_rejected": (
            {
                "id": str(rejected.id),
                "review_note": rejected.review_note,
            }
            if rejected and not pending and not approved
            else None
        ),
    }


@router.get("/options")
def get_onboarding_options(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Privacy-safe minimal branch & ancestor names ONLY (no bios, emails, phones, photos)."""
    family, raw_root_id = _resolve_clan_family_and_root(db)
    if not family:
        return {"clan_family_id": None, "root_label": "Ядамсүрэн ⚭ Гүнд", "branches": [], "nodes": []}

    persons = db.scalars(
        select(Person)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family.id)
    ).all()
    by_id = {p.id: p for p in persons}
    if not by_id:
        return {"clan_family_id": str(family.id), "root_label": family.name, "branches": [], "nodes": []}

    all_ids = set(by_id.keys())
    seed_id = raw_root_id if raw_root_id in all_ids else next(iter(all_ids))
    top_root_id = _walk_up_top(db, seed_id, all_ids)

    edges = db.scalars(
        select(ParentChildRelationship).where(
            ParentChildRelationship.parent_id.in_(all_ids),
            ParentChildRelationship.child_id.in_(all_ids),
        )
    ).all()
    marriages = db.scalars(
        select(Marriage).where(
            Marriage.person_1_id.in_(all_ids),
            Marriage.person_2_id.in_(all_ids),
        )
    ).all()

    children_of: dict[UUID, list[UUID]] = {pid: [] for pid in all_ids}
    parents_of: dict[UUID, list[UUID]] = {pid: [] for pid in all_ids}
    for e in edges:
        if e.child_id not in children_of[e.parent_id]:
            children_of[e.parent_id].append(e.child_id)
        if e.parent_id not in parents_of[e.child_id]:
            parents_of[e.child_id].append(e.parent_id)

    root_spouses = [
        m.person_2_id if m.person_1_id == top_root_id else m.person_1_id
        for m in marriages
        if m.person_1_id == top_root_id or m.person_2_id == top_root_id
    ]
    root_couple_ids = [top_root_id, *root_spouses]
    root_label = " ⚭ ".join(_person_label(by_id[pid]) for pid in root_couple_ids if pid in by_id)

    # Direct children of founding couple = the main clan branches (e.g. Баавай, Бадамдорж, Долгор, Нансалмаа)
    branch_ids: list[UUID] = []
    for rpid in root_couple_ids:
        for cid in children_of.get(rpid, []):
            if cid not in root_couple_ids and cid not in branch_ids:
                branch_ids.append(cid)

    gen_map: dict[UUID, int] = {pid: 1 for pid in root_couple_ids}
    branch_map: dict[UUID, UUID] = {}
    q: deque[tuple[UUID, UUID]] = deque()
    for bid in branch_ids:
        gen_map[bid] = 2
        branch_map[bid] = bid
        q.append((bid, bid))

    while q:
        cur, b_root = q.popleft()
        cur_gen = gen_map[cur]
        for cid in children_of.get(cur, []):
            if cid not in gen_map:
                gen_map[cid] = cur_gen + 1
                branch_map[cid] = b_root
                q.append((cid, b_root))

    branches_out = [
        {"id": str(bid), "name": _person_label(by_id[bid]), "generation": 2}
        for bid in branch_ids
        if bid in by_id
    ]
    nodes_out = [
        {
            "id": str(pid),
            "name": _person_label(by_id[pid]),
            "generation": gen_map[pid],
            "branch_root_id": str(branch_map[pid]),
            "parent_ids": [str(p) for p in parents_of.get(pid, []) if p in gen_map],
        }
        for pid in branch_map
        if pid in by_id
    ]
    nodes_out.sort(key=lambda n: (n["generation"], n["name"]))

    return {
        "clan_family_id": str(family.id),
        "clan_family_name": family.name,
        "root_label": root_label,
        "branches": branches_out,
        "nodes": nodes_out,
    }


@router.post("/requests", status_code=201)
def submit_onboarding_request(
    body: ClanOnboardingSubmitInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    family, _ = _resolve_clan_family_and_root(db)
    if not family:
        raise HTTPException(status_code=404, detail="Үндсэн удмын орчин олдсонгүй.")

    existing_pending = db.scalar(
        select(TreeJoinRequest).where(
            TreeJoinRequest.user_id == user.id,
            TreeJoinRequest.status == "pending",
        )
    )
    if existing_pending:
        raise HTTPException(status_code=409, detail="Таны баталгаажуулах хүсэлт аль хэдийн илгээгдсэн, админ шалгаж байна.")

    payload_meta = {
        "branch_person_id": str(body.branch_person_id),
        "anchor_person_id": str(body.anchor_person_id),
        "user_note": (body.note or "").strip(),
        "relatives": [
            {
                "relation": r.relation,
                "first_name": r.first_name.strip(),
                "last_name": r.last_name.strip(),
                "gender": r.gender,
                "birth_date": r.birth_date.isoformat() if r.birth_date else None,
                "is_alive": r.is_alive,
                "email": normalize_email(str(r.email)) if r.email else None,
            }
            for r in body.relatives
        ],
    }

    req = TreeJoinRequest(
        id=uuid4(),
        family_id=family.id,
        user_id=user.id,
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        gender=body.gender if body.gender in {"male", "female"} else None,
        birth_date=body.birth_date,
        birth_place=(body.birth_place or "").strip() or None,
        claimed_generation=body.claimed_generation,
        father_person_id=body.anchor_person_id,
        note=PREFIX + json.dumps(payload_meta, ensure_ascii=False),
        status="pending",
    )
    db.add(req)
    db.add(
        AuditLog(
            id=uuid4(),
            family_id=family.id,
            actor_id=user.id,
            action="clan.onboarding.submitted",
            target_type="tree_join_request",
            target_id=req.id,
        )
    )
    db.commit()
    return {"id": str(req.id), "status": req.status}


def _parse_request_note(note: str | None) -> tuple[str, dict]:
    if not note:
        return "onboarding", {}
    if note.startswith(CORRECTION_PREFIX):
        try:
            return "correction", json.loads(note[len(CORRECTION_PREFIX) :])
        except (ValueError, TypeError):
            return "correction", {}
    if note.startswith(RELATIVES_PREFIX):
        try:
            return "relatives", json.loads(note[len(RELATIVES_PREFIX) :])
        except (ValueError, TypeError):
            return "relatives", {}
    if note.startswith(PREFIX):
        try:
            return "onboarding", json.loads(note[len(PREFIX) :])
        except (ValueError, TypeError):
            return "onboarding", {}
    return "onboarding", {}


def _serialize_relatives_payload(relatives: list[RelativeDraftInput]) -> list[dict]:
    return [
        {
            "relation": r.relation,
            "first_name": r.first_name.strip(),
            "last_name": r.last_name.strip(),
            "gender": r.gender,
            "birth_date": r.birth_date.isoformat() if r.birth_date else None,
            "is_alive": r.is_alive,
            "email": normalize_email(str(r.email)) if r.email else None,
        }
        for r in relatives
    ]


@router.post("/relatives-request", status_code=201)
def submit_relatives_request(
    body: ClanRelativesSubmitInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    family, _ = _resolve_clan_family_and_root(db)
    if not family:
        raise HTTPException(status_code=404, detail="Үндсэн удмын орчин олдсонгүй.")

    member = db.scalar(
        select(FamilyMember).where(
            FamilyMember.family_id == family.id,
            FamilyMember.user_id == user.id,
        )
    )
    if not member:
        raise HTTPException(status_code=403, detail="Эхлээд үндсэн удмын модонд баталгаажиж нэгдэнэ үү.")

    link = db.scalar(
        select(UserPersonLink)
        .join(FamilyPerson, FamilyPerson.person_id == UserPersonLink.person_id)
        .where(UserPersonLink.user_id == user.id, FamilyPerson.family_id == family.id)
    )
    if not link:
        raise HTTPException(status_code=400, detail="Таны аккаунт модон дахь хувийн бүртгэлтэй холбогдоогүй байна.")

    self_person = db.get(Person, link.person_id)
    if not self_person:
        raise HTTPException(status_code=404, detail="Хувийн бүртгэл олдсонгүй.")

    existing_pending = db.scalar(
        select(TreeJoinRequest).where(
            TreeJoinRequest.family_id == family.id,
            TreeJoinRequest.user_id == user.id,
            TreeJoinRequest.status == "pending",
        )
    )
    if existing_pending:
        raise HTTPException(
            status_code=409,
            detail="Таны өмнөх хүсэлт одоогоор админ эсвэл засагчийн хянаж буй төлөвт байна.",
        )

    payload_meta = {
        "self_person_id": str(self_person.id),
        "user_note": (body.note or "").strip(),
        "relatives": _serialize_relatives_payload(body.relatives),
    }

    req = TreeJoinRequest(
        id=uuid4(),
        family_id=family.id,
        user_id=user.id,
        first_name=self_person.first_name,
        last_name=self_person.last_name or "",
        gender=self_person.gender if self_person.gender in {"male", "female"} else None,
        father_person_id=self_person.id,
        note=RELATIVES_PREFIX + json.dumps(payload_meta, ensure_ascii=False),
        status="pending",
    )
    db.add(req)
    db.add(
        AuditLog(
            id=uuid4(),
            family_id=family.id,
            actor_id=user.id,
            action="clan.relatives.submitted",
            target_type="tree_join_request",
            target_id=req.id,
        )
    )
    db.commit()
    return {"id": str(req.id), "status": req.status, "relatives_count": len(body.relatives)}


@router.get("/my-requests")
def list_my_requests(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(TreeJoinRequest)
        .where(TreeJoinRequest.user_id == user.id)
        .order_by(TreeJoinRequest.created_at.desc())
        .limit(20)
    ).all()
    out = []
    for req in rows:
        request_kind, meta = _parse_request_note(req.note)
        out.append(
            {
                "id": str(req.id),
                "request_kind": request_kind,
                "status": req.status,
                "relatives_count": len(meta.get("relatives", [])),
                "review_note": req.review_note,
                "created_at": req.created_at.isoformat(),
            }
        )
    return out


def _serialize_quiz_request(db: Session, req: TreeJoinRequest) -> dict:
    request_kind, meta = _parse_request_note(req.note)
    branch_id_raw = meta.get("branch_person_id")
    anchor_id_raw = meta.get("anchor_person_id") or (str(req.father_person_id) if req.father_person_id else None)
    branch_name = None
    anchor_name = None
    if branch_id_raw:
        try:
            bp = db.get(Person, UUID(str(branch_id_raw)))
            if bp:
                branch_name = _person_label(bp)
        except (ValueError, TypeError):
            pass
    if anchor_id_raw:
        try:
            ap = db.get(Person, UUID(str(anchor_id_raw)))
            if ap:
                anchor_name = _person_label(ap)
        except (ValueError, TypeError):
            pass
    return {
        "id": str(req.id),
        "request_kind": request_kind,
        "status": req.status,
        "claimed_generation": req.claimed_generation,
        "branch_person_id": str(branch_id_raw) if branch_id_raw else None,
        "branch_name": branch_name,
        "anchor_person_id": str(anchor_id_raw) if anchor_id_raw else None,
        "anchor_name": anchor_name,
        "first_name": req.first_name,
        "last_name": req.last_name,
        "birth_date": req.birth_date.isoformat() if req.birth_date else None,
        "birth_place": req.birth_place,
        "user_note": meta.get("user_note") or "",
        "review_note": req.review_note,
        "created_at": req.created_at.isoformat(),
    }


@router.get("/my-quiz")
def get_my_onboarding_quiz(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the user's onboarding questionnaire summary and editability mode."""
    is_admin = db.get(AdminGrant, user.id) is not None
    member_family_ids = db.scalars(
        select(FamilyMember.family_id)
        .join(Family, Family.id == FamilyMember.family_id)
        .where(FamilyMember.user_id == user.id, Family.archived_at.is_(None))
    ).all()
    approved = bool(is_admin or len(member_family_ids) > 0)
    clan_family, _ = _resolve_clan_family_and_root(db)

    linked_person_id: str | None = None
    if clan_family is not None:
        link = db.scalar(
            select(UserPersonLink)
            .join(FamilyPerson, FamilyPerson.person_id == UserPersonLink.person_id)
            .where(UserPersonLink.user_id == user.id, FamilyPerson.family_id == clan_family.id)
        )
        if link:
            linked_person_id = str(link.person_id)

    rows = db.scalars(
        select(TreeJoinRequest)
        .where(TreeJoinRequest.user_id == user.id)
        .order_by(TreeJoinRequest.created_at.desc())
        .limit(20)
    ).all()

    pending_req: TreeJoinRequest | None = None
    latest_quiz: TreeJoinRequest | None = None
    for row in rows:
        req_kind, _ = _parse_request_note(row.note)
        if row.status == "pending" and pending_req is None and req_kind in {"onboarding", "correction"}:
            pending_req = row
        if latest_quiz is None and req_kind in {"onboarding", "correction"}:
            latest_quiz = row

    can_direct_edit = bool(pending_req is not None)
    return {
        "approved": approved,
        "can_direct_edit": can_direct_edit,
        "linked_person_id": linked_person_id,
        "pending_request": _serialize_quiz_request(db, pending_req) if pending_req else None,
        "latest_onboarding": _serialize_quiz_request(db, latest_quiz) if latest_quiz else None,
    }


@router.patch("/requests/{request_id}")
def update_pending_onboarding_request(
    request_id: UUID,
    body: ClanOnboardingCorrectionInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Allow a user to directly edit their own pending onboarding or correction request."""
    req = db.get(TreeJoinRequest, request_id)
    if req is None or req.user_id != user.id:
        raise HTTPException(status_code=404, detail="Хүсэлт олдсонгүй.")
    if req.status != "pending":
        raise HTTPException(
            status_code=409,
            detail="Баталгаажсан эсвэл шийдвэрлэгдсэн асуумжийг шууд засах боломжгүй. Засварлах хүсэлт илгээнэ үү.",
        )

    req_kind, meta = _parse_request_note(req.note)
    meta["branch_person_id"] = str(body.branch_person_id)
    meta["anchor_person_id"] = str(body.anchor_person_id)
    if body.reason is not None:
        meta["user_note"] = body.reason.strip()

    prefix = CORRECTION_PREFIX if req_kind == "correction" else PREFIX
    req.claimed_generation = body.claimed_generation
    req.father_person_id = body.anchor_person_id
    req.note = prefix + json.dumps(meta, ensure_ascii=False)

    db.add(
        AuditLog(
            id=uuid4(),
            family_id=req.family_id,
            actor_id=user.id,
            action="clan.onboarding.updated",
            target_type="tree_join_request",
            target_id=req.id,
        )
    )
    db.commit()
    return _serialize_quiz_request(db, req)


@router.post("/correction-request", status_code=201)
def submit_onboarding_correction_request(
    body: ClanOnboardingCorrectionInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit an admin-reviewed correction request for an already-approved user's generation/branch."""
    family, _ = _resolve_clan_family_and_root(db)
    if not family:
        raise HTTPException(status_code=404, detail="Үндсэн удмын орчин олдсонгүй.")

    existing_pending = db.scalar(
        select(TreeJoinRequest).where(
            TreeJoinRequest.user_id == user.id,
            TreeJoinRequest.status == "pending",
        )
    )
    if existing_pending:
        raise HTTPException(
            status_code=409,
            detail="Танд аль хэдийн хүлээгдэж буй хүсэлт байна. Тэр хүсэлтээ шууд засах боломжтой.",
        )

    link = db.scalar(
        select(UserPersonLink)
        .join(FamilyPerson, FamilyPerson.person_id == UserPersonLink.person_id)
        .where(UserPersonLink.user_id == user.id, FamilyPerson.family_id == family.id)
    )
    self_person = db.get(Person, link.person_id) if link else None
    parts = (user.display_name or "").strip().split()
    first_name = self_person.first_name if self_person else (parts[-1] if parts else "Гишүүн")
    last_name = self_person.last_name if self_person else (" ".join(parts[:-1]) if len(parts) > 1 else "")

    payload_meta = {
        "branch_person_id": str(body.branch_person_id),
        "anchor_person_id": str(body.anchor_person_id),
        "user_note": (body.reason or "").strip(),
        "self_person_id": str(self_person.id) if self_person else None,
        "relatives": [],
    }
    req = TreeJoinRequest(
        id=uuid4(),
        family_id=family.id,
        user_id=user.id,
        first_name=first_name,
        last_name=last_name,
        gender=self_person.gender if self_person else None,
        birth_date=self_person.birth_date if self_person else None,
        birth_place=self_person.birth_place if self_person else None,
        claimed_generation=body.claimed_generation,
        father_person_id=body.anchor_person_id,
        note=CORRECTION_PREFIX + json.dumps(payload_meta, ensure_ascii=False),
        status="pending",
    )
    db.add(req)
    db.add(
        AuditLog(
            id=uuid4(),
            family_id=family.id,
            actor_id=user.id,
            action="clan.onboarding.correction_submitted",
            target_type="tree_join_request",
            target_id=req.id,
        )
    )
    db.commit()
    return _serialize_quiz_request(db, req)


@admin_router.get("/requests")
def list_onboarding_requests(
    reviewer: tuple[User, str, UUID | None] = Depends(require_clan_reviewer),
    db: Session = Depends(get_db),
):
    _, _, scoped_family_id = reviewer
    stmt = select(TreeJoinRequest).where(TreeJoinRequest.status == "pending")
    if scoped_family_id is not None:
        stmt = stmt.where(TreeJoinRequest.family_id == scoped_family_id)
    rows = db.scalars(stmt.order_by(TreeJoinRequest.created_at.desc())).all()

    parsed_rows = [(req, *_parse_request_note(req.note)) for req in rows]
    user_ids = {req.user_id for req, _, _ in parsed_rows}
    person_ids: set[UUID] = set()
    for req, request_kind, meta in parsed_rows:
        if meta.get("branch_person_id"):
            person_ids.add(UUID(meta["branch_person_id"]))
        if request_kind == "relatives":
            if meta.get("self_person_id"):
                person_ids.add(UUID(meta["self_person_id"]))
            elif req.father_person_id:
                person_ids.add(req.father_person_id)
        else:
            if meta.get("anchor_person_id"):
                person_ids.add(UUID(meta["anchor_person_id"]))
            elif req.father_person_id:
                person_ids.add(req.father_person_id)

    users_by_id = (
        {u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids))).all()}
        if user_ids
        else {}
    )
    persons_by_id = (
        {p.id: p for p in db.scalars(select(Person).where(Person.id.in_(person_ids))).all()}
        if person_ids
        else {}
    )

    out = []
    for req, request_kind, meta in parsed_rows:
        u = users_by_id.get(req.user_id)
        branch_p = persons_by_id.get(UUID(meta["branch_person_id"])) if meta.get("branch_person_id") else None
        anchor_label: str | None
        if request_kind == "relatives":
            self_pid = UUID(meta["self_person_id"]) if meta.get("self_person_id") else req.father_person_id
            self_p = persons_by_id.get(self_pid) if self_pid else None
            anchor_label = _person_label(self_p) if self_p else f"{req.last_name} {req.first_name}".strip()
        else:
            anchor_pid = UUID(meta["anchor_person_id"]) if meta.get("anchor_person_id") else req.father_person_id
            anchor_p = persons_by_id.get(anchor_pid) if anchor_pid else None
            anchor_label = _person_label(anchor_p) if anchor_p else None
        out.append(
            {
                "id": str(req.id),
                "family_id": str(req.family_id),
                "request_kind": request_kind,
                "user_id": str(req.user_id),
                "user_email": u.email if u else None,
                "user_display_name": u.display_name if u else "",
                "first_name": req.first_name,
                "last_name": req.last_name,
                "gender": req.gender or "unknown",
                "birth_date": req.birth_date.isoformat() if req.birth_date else None,
                "birth_place": req.birth_place,
                "claimed_generation": req.claimed_generation,
                "branch_name": _person_label(branch_p) if branch_p else None,
                "anchor_name": anchor_label,
                "relatives": meta.get("relatives", []),
                "user_note": meta.get("user_note", ""),
                "created_at": req.created_at.isoformat(),
            }
        )
    return out


def _ensure_relative_account(
    db: Session,
    email: str,
    display_name: str,
    family_id: UUID,
    person_id: UUID,
    actor_id: UUID,
) -> str | None:
    """Create a verified account linked to the relative's person profile if email is unused."""
    norm = normalize_email(email)
    existing = db.scalar(select(User).where(User.email == norm))
    if existing:
        return None
    now = datetime.now(UTC)
    new_user = User(
        id=uuid4(),
        email=norm,
        display_name=display_name[:120] or "Гэр бүлийн гишүүн",
        password_hash=hash_password(secrets.token_urlsafe(32)),
        email_verified_at=now,
        is_active=True,
    )
    db.add(new_user)
    db.flush()
    db.add(
        LoginIdentity(
            id=uuid4(),
            user_id=new_user.id,
            provider="email",
            normalized_identifier=norm,
            display_identifier=norm,
            verified_at=now,
        )
    )
    db.add(FamilyMember(id=uuid4(), family_id=family_id, user_id=new_user.id, role="member"))
    db.add(UserPersonLink(id=uuid4(), user_id=new_user.id, person_id=person_id, linked_by=actor_id))
    return norm


def _ensure_parent_child(db: Session, parent_id: UUID | None, child_id: UUID, actor_id: UUID) -> bool:
    if not parent_id or parent_id == child_id:
        return False
    existing = db.scalar(
        select(ParentChildRelationship.id).where(
            ParentChildRelationship.parent_id == parent_id,
            ParentChildRelationship.child_id == child_id,
        )
    )
    if existing:
        return False
    db.add(
        ParentChildRelationship(
            id=uuid4(),
            parent_id=parent_id,
            child_id=child_id,
            relationship_type="biological",
            created_by=actor_id,
        )
    )
    return True


def _ensure_marriage(db: Session, person_a: UUID, person_b: UUID, actor_id: UUID) -> bool:
    if person_a == person_b:
        return False
    p1, p2 = canonical_pair(person_a, person_b)
    existing = db.scalar(
        select(Marriage.id).where(
            Marriage.person_1_id == p1,
            Marriage.person_2_id == p2,
            Marriage.status == "married",
            Marriage.deleted_at.is_(None),
        )
    )
    if existing:
        return False
    db.add(
        Marriage(
            id=uuid4(),
            person_1_id=p1,
            person_2_id=p2,
            status="married",
            created_by=actor_id,
        )
    )
    return True


def _attach_parents(
    db: Session,
    anchor_id: UUID | None,
    self_person_id: UUID,
    parent_relatives: list[dict],
    create_relative_fn,
    actor_id: UUID,
) -> list[UUID]:
    """Attach 0, 1, 2, or N missing parents cleanly without chaining spouses as parent-child."""
    if not parent_relatives:
        if anchor_id:
            _ensure_parent_child(db, anchor_id, self_person_id, actor_id)
            return [anchor_id]
        return []

    if len(parent_relatives) == 1:
        p0 = create_relative_fn(parent_relatives[0])
        _ensure_parent_child(db, anchor_id, p0.id, actor_id)
        _ensure_parent_child(db, p0.id, self_person_id, actor_id)
        return [p0.id]

    prev_id = anchor_id
    for pr in parent_relatives[:-2]:
        mid = create_relative_fn(pr)
        _ensure_parent_child(db, prev_id, mid.id, actor_id)
        prev_id = mid.id

    p_a = create_relative_fn(parent_relatives[-2])
    p_b = create_relative_fn(parent_relatives[-1])
    _ensure_parent_child(db, prev_id, p_a.id, actor_id)
    _ensure_marriage(db, p_a.id, p_b.id, actor_id)
    _ensure_parent_child(db, p_a.id, self_person_id, actor_id)
    _ensure_parent_child(db, p_b.id, self_person_id, actor_id)
    return [p_a.id, p_b.id]


def _attach_other_relatives(
    db: Session,
    self_person_id: UUID,
    direct_parent_ids: list[UUID],
    other_relatives: list[dict],
    create_relative_fn,
    actor_id: UUID,
) -> None:
    for r in other_relatives:
        rel_p = create_relative_fn(r)
        kind = r.get("relation")
        if kind == "spouse":
            _ensure_marriage(db, self_person_id, rel_p.id, actor_id)
        elif kind == "child":
            _ensure_parent_child(db, self_person_id, rel_p.id, actor_id)
        elif kind == "sibling":
            for dpid in direct_parent_ids:
                _ensure_parent_child(db, dpid, rel_p.id, actor_id)


@admin_router.post("/requests/{request_id}/approve")
def approve_onboarding_request(
    request_id: UUID,
    reviewer: tuple[User, str, UUID | None] = Depends(require_clan_reviewer),
    db: Session = Depends(get_db),
):
    actor, _, scoped_family_id = reviewer
    req = db.get(TreeJoinRequest, request_id)
    if not req or req.status != "pending":
        raise HTTPException(status_code=404, detail="Хүлээгдэж буй хүсэлт олдсонгүй.")
    if scoped_family_id is not None and req.family_id != scoped_family_id:
        raise HTTPException(status_code=403, detail="Өөр удмын орчны хүсэлтийг хянах эрхгүй.")

    request_kind, meta = _parse_request_note(req.note)
    relatives: list[dict] = meta.get("relatives", [])
    parent_relatives = [r for r in relatives if r.get("relation") == "parent"]
    other_relatives = [r for r in relatives if r.get("relation") != "parent"]
    created_accounts: list[str] = []

    def _create_relative_person(r: dict) -> Person:
        bdate = date.fromisoformat(r["birth_date"]) if r.get("birth_date") else None
        fn = str(r.get("first_name", "")).strip() or "Хүн"
        ln = str(r.get("last_name", "")).strip()
        p = Person(
            id=uuid4(),
            first_name=fn,
            last_name=ln,
            gender=r.get("gender") or "unknown",
            birth_date=bdate,
            is_alive=bool(r.get("is_alive", True)),
            visibility="family",
            search_first_name=normalize_search_name(fn),
            search_last_name=normalize_search_name(ln),
            created_by=req.user_id,
        )
        db.add(p)
        db.flush()
        db.add(FamilyPerson(id=uuid4(), family_id=req.family_id, person_id=p.id, added_by=actor.id))
        if r.get("email"):
            created_email = _ensure_relative_account(db, r["email"], _person_label(p), req.family_id, p.id, actor.id)
            if created_email:
                created_accounts.append(created_email)
        return p

    if request_kind == "relatives":
        raw_self_id = meta.get("self_person_id")
        self_id = UUID(raw_self_id) if raw_self_id else req.father_person_id
        self_person = db.get(Person, self_id) if self_id else None
        if not self_person:
            raise HTTPException(status_code=404, detail="Холбох гишүүний бүртгэл олдсонгүй.")

        family_person_ids = set(
            db.scalars(select(FamilyPerson.person_id).where(FamilyPerson.family_id == req.family_id)).all()
        )
        existing_parents = [
            pid
            for pid in db.scalars(
                select(ParentChildRelationship.parent_id).where(ParentChildRelationship.child_id == self_person.id)
            ).all()
            if pid in family_person_ids
        ]
        existing_siblings: list[UUID] = []
        if existing_parents:
            existing_siblings = [
                cid
                for cid in db.scalars(
                    select(ParentChildRelationship.child_id).where(
                        ParentChildRelationship.parent_id.in_(existing_parents),
                        ParentChildRelationship.child_id != self_person.id,
                    )
                ).all()
                if cid in family_person_ids
            ]

        current_parents = list(dict.fromkeys(existing_parents))
        for pr in parent_relatives:
            new_p = _create_relative_person(pr)
            _ensure_parent_child(db, new_p.id, self_person.id, actor.id)
            if len(current_parents) == 1:
                _ensure_marriage(db, current_parents[0], new_p.id, actor.id)
                for sib_id in existing_siblings:
                    _ensure_parent_child(db, new_p.id, sib_id, actor.id)
            current_parents.append(new_p.id)

        _attach_other_relatives(
            db,
            self_person.id,
            current_parents,
            other_relatives,
            _create_relative_person,
            actor.id,
        )
    elif request_kind == "correction":
        existing_link = db.scalar(
            select(UserPersonLink).where(UserPersonLink.user_id == req.user_id)
        )
        raw_self_id = meta.get("self_person_id")
        self_id = (
            existing_link.person_id
            if existing_link
            else (UUID(raw_self_id) if raw_self_id else None)
        )
        self_person = db.get(Person, self_id) if self_id else None
        if not self_person:
            raise HTTPException(
                status_code=404,
                detail="Засварлах гишүүний одоогийн бүртгэл олдсонгүй.",
            )

        # Update existing Person record in-place without creating a duplicate Person
        self_person.first_name = req.first_name
        self_person.last_name = req.last_name
        if req.gender:
            self_person.gender = req.gender
        if req.birth_date is not None:
            self_person.birth_date = req.birth_date
        if req.birth_place is not None:
            self_person.birth_place = req.birth_place
        self_person.search_first_name = normalize_search_name(req.first_name)
        self_person.search_last_name = normalize_search_name(req.last_name)

        anchor_id = (
            UUID(meta["anchor_person_id"])
            if meta.get("anchor_person_id")
            else req.father_person_id
        )
        if anchor_id and anchor_id != self_person.id:
            family_person_ids = set(
                db.scalars(
                    select(FamilyPerson.person_id).where(FamilyPerson.family_id == req.family_id)
                ).all()
            )
            old_parent_edges = db.scalars(
                select(ParentChildRelationship).where(
                    ParentChildRelationship.child_id == self_person.id,
                    ParentChildRelationship.parent_id.in_(family_person_ids),
                )
            ).all()
            for edge in old_parent_edges:
                db.delete(edge)
            db.flush()

            direct_parent_ids = _attach_parents(
                db,
                anchor_id,
                self_person.id,
                parent_relatives,
                _create_relative_person,
                actor.id,
            )
        else:
            direct_parent_ids = list(
                db.scalars(
                    select(ParentChildRelationship.parent_id).where(
                        ParentChildRelationship.child_id == self_person.id
                    )
                ).all()
            )

        _attach_other_relatives(
            db,
            self_person.id,
            direct_parent_ids,
            other_relatives,
            _create_relative_person,
            actor.id,
        )
    else:
        anchor_id = UUID(meta["anchor_person_id"]) if meta.get("anchor_person_id") else req.father_person_id

        # 1. Create requesting user's own Person profile (created_by = req.user_id)
        self_person = Person(
            id=uuid4(),
            first_name=req.first_name,
            last_name=req.last_name,
            gender=req.gender or "unknown",
            birth_date=req.birth_date,
            birth_place=req.birth_place,
            is_alive=True,
            visibility="family",
            search_first_name=normalize_search_name(req.first_name),
            search_last_name=normalize_search_name(req.last_name),
            created_by=req.user_id,
        )
        db.add(self_person)
        db.flush()
        db.add(FamilyPerson(id=uuid4(), family_id=req.family_id, person_id=self_person.id, added_by=actor.id))

        # 2. Ensure requesting user is a regular member of the clan family + linked to self_person
        existing_member = db.scalar(
            select(FamilyMember).where(
                FamilyMember.family_id == req.family_id,
                FamilyMember.user_id == req.user_id,
            )
        )
        if not existing_member:
            db.add(FamilyMember(id=uuid4(), family_id=req.family_id, user_id=req.user_id, role="member"))
        existing_link = db.scalar(
            select(UserPersonLink).where(UserPersonLink.user_id == req.user_id)
        )
        if not existing_link:
            db.add(UserPersonLink(id=uuid4(), user_id=req.user_id, person_id=self_person.id, linked_by=actor.id))

        # 3. Attach missing parent(s) cleanly without spouse-as-child chaining
        direct_parent_ids = _attach_parents(
            db,
            anchor_id,
            self_person.id,
            parent_relatives,
            _create_relative_person,
            actor.id,
        )

        # 4. Attach spouse / child / sibling relatives
        _attach_other_relatives(
            db,
            self_person.id,
            direct_parent_ids,
            other_relatives,
            _create_relative_person,
            actor.id,
        )

    req.status = "approved"
    req.reviewed_by = actor.id
    req.reviewed_at = datetime.now(UTC)
    req.created_person_id = self_person.id
    db.add(
        AuditLog(
            id=uuid4(),
            family_id=req.family_id,
            actor_id=actor.id,
            action=(
                "clan.relatives.approved"
                if request_kind == "relatives"
                else "clan.correction.approved"
                if request_kind == "correction"
                else "clan.onboarding.approved"
            ),
            target_type="tree_join_request",
            target_id=req.id,
        )
    )
    db.commit()
    return {
        "status": "approved",
        "request_kind": request_kind,
        "self_person_id": str(self_person.id),
        "created_relatives": len(relatives),
        "created_accounts": created_accounts,
    }


@admin_router.post("/requests/{request_id}/reject")
def reject_onboarding_request(
    request_id: UUID,
    body: ClanOnboardingRejectInput,
    reviewer: tuple[User, str, UUID | None] = Depends(require_clan_reviewer),
    db: Session = Depends(get_db),
):
    actor, _, scoped_family_id = reviewer
    req = db.get(TreeJoinRequest, request_id)
    if not req or req.status != "pending":
        raise HTTPException(status_code=404, detail="Хүлээгдэж буй хүсэлт олдсонгүй.")
    if scoped_family_id is not None and req.family_id != scoped_family_id:
        raise HTTPException(status_code=403, detail="Өөр удмын орчны хүсэлтийг хянах эрхгүй.")

    req.status = "rejected"
    req.reviewed_by = actor.id
    req.reviewed_at = datetime.now(UTC)
    req.review_note = (body.review_note or "").strip() or None

    if body.ban_user:
        target_user = db.get(User, req.user_id)
        if target_user and target_user.id != actor.id and db.get(AdminGrant, target_user.id) is None:
            target_user.is_active = False
            db.execute(delete(UserSession).where(UserSession.user_id == target_user.id))

    db.add(
        AuditLog(
            id=uuid4(),
            family_id=req.family_id,
            actor_id=actor.id,
            action="clan.onboarding.banned" if body.ban_user else "clan.onboarding.rejected",
            target_type="tree_join_request",
            target_id=req.id,
        )
    )
    db.commit()
    return {"status": "rejected", "banned": body.ban_user}


def _merge_person_summary(p: Person, linked_person_ids: set[UUID]) -> dict:
    return {
        "id": str(p.id),
        "name": _person_label(p),
        "birth_year": p.birth_date.year if p.birth_date else None,
        "has_account": p.id in linked_person_ids,
    }


@admin_router.get("/merge-candidates")
def get_merge_candidates(
    _current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    clan_family, _root_id = _resolve_clan_family_and_root(db)
    if not clan_family:
        return {"target_family": None, "source_families": []}

    linked_person_ids = set(db.scalars(select(UserPersonLink.person_id)).all())

    def _family_persons(fam_id: UUID) -> list[dict]:
        rows = db.scalars(
            select(Person)
            .join(FamilyPerson, FamilyPerson.person_id == Person.id)
            .where(FamilyPerson.family_id == fam_id)
            .order_by(Person.last_name, Person.first_name)
        ).all()
        return [_merge_person_summary(p, linked_person_ids) for p in rows]

    other_families = db.scalars(
        select(Family)
        .where(Family.archived_at.is_(None), Family.id != clan_family.id)
        .order_by(Family.created_at, Family.id)
    ).all()

    sources = []
    for fam in other_families:
        persons = _family_persons(fam.id)
        member_count = len(db.scalars(select(FamilyMember.id).where(FamilyMember.family_id == fam.id)).all())
        sources.append(
            {
                "id": str(fam.id),
                "name": fam.name,
                "person_count": len(persons),
                "member_count": member_count,
                "persons": persons,
            }
        )

    return {
        "target_family": {
            "id": str(clan_family.id),
            "name": clan_family.name,
            "persons": _family_persons(clan_family.id),
        },
        "source_families": sources,
    }


@admin_router.post("/merge-family")
def merge_family_into_clan(
    body: ClanFamilyMergeInput,
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    actor = current[0]
    lock_ancestry_writes(db)

    clan_family, _ = _resolve_clan_family_and_root(db)
    target_family_id = body.target_family_id or (clan_family.id if clan_family else None)
    if not target_family_id:
        raise HTTPException(status_code=404, detail="Үндсэн удмын орчин олдсонгүй.")
    if body.source_family_id == target_family_id:
        raise HTTPException(status_code=422, detail="Ижил гэр бүлийг өөртэй нь нэгтгэх боломжгүй.")

    source_family = db.get(Family, body.source_family_id)
    target_family = db.get(Family, target_family_id)
    if not source_family or source_family.archived_at is not None:
        raise HTTPException(status_code=404, detail="Нэгтгэх эх гэр бүл олдсонгүй эсвэл архивлагдсан байна.")
    if not target_family or target_family.archived_at is not None:
        raise HTTPException(status_code=404, detail="Үндсэн гэр бүл олдсонгүй эсвэл архивлагдсан байна.")

    source_fp = db.scalar(
        select(FamilyPerson).where(
            FamilyPerson.family_id == source_family.id,
            FamilyPerson.person_id == body.source_person_id,
        )
    )
    target_fp = db.scalar(
        select(FamilyPerson).where(
            FamilyPerson.family_id == target_family.id,
            FamilyPerson.person_id == body.target_person_id,
        )
    )
    if not source_fp:
        raise HTTPException(status_code=404, detail="Сонгосон эх хүн эх гэр бүлд олдсонгүй.")
    if not target_fp:
        raise HTTPException(status_code=404, detail="Сонгосон тулгуур хүн үндсэн удмын гэр бүлд олдсонгүй.")

    if body.mode == "bridge_parent" and body.bridge_parent is None:
        raise HTTPException(status_code=422, detail="Дунд үеийн эцэг/эхийн мэдээллийг оруулна уу.")

    source_person = db.get(Person, body.source_person_id)
    target_person = db.get(Person, body.target_person_id)
    if not source_person or not target_person:
        raise HTTPException(status_code=404, detail="Холбох хүний бүртгэл олдсонгүй.")

    all_edges = db.execute(
        select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id)
    ).all()

    if body.mode == "attach_child":
        if body.target_person_id == body.source_person_id:
            raise HTTPException(status_code=422, detail="Хүнийг өөрийнх нь хүүхэд болгох боломжгүй.")
        try:
            assert_parent_child_is_acyclic(all_edges, body.target_person_id, body.source_person_id)
        except RelationshipError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err
        existing_parents = {p for p, c in all_edges if c == body.source_person_id}
        if body.target_person_id not in existing_parents and len(existing_parents) >= 2:
            raise HTTPException(status_code=409, detail="Энэ хүн аль хэдийн хоёр эцэг/эхтэй байна.")

    source_link: UserPersonLink | None = None
    target_link: UserPersonLink | None = None
    if body.mode == "merge_duplicate":
        shared = db.get(SharedAncestry, 1)
        if shared and shared.root_person_id == body.source_person_id:
            raise HTTPException(status_code=409, detail="Үндсэн эх хүнийг устгаж нэгтгэх боломжгүй.")
        source_link = db.scalar(select(UserPersonLink).where(UserPersonLink.person_id == body.source_person_id))
        target_link = db.scalar(select(UserPersonLink).where(UserPersonLink.person_id == body.target_person_id))
        if source_link and target_link and source_link.user_id != target_link.user_id:
            raise HTTPException(
                status_code=409,
                detail="Хоёр хүн хоёулаа тусдаа аккаунттай холбогдсон тул шууд нэгтгэх боломжгүй.",
            )
        remapped_edges: list[tuple[UUID, UUID]] = []
        seen_pairs: set[tuple[UUID, UUID]] = set()
        for p_id, c_id in all_edges:
            np = body.target_person_id if p_id == body.source_person_id else p_id
            nc = body.target_person_id if c_id == body.source_person_id else c_id
            if np == nc:
                raise HTTPException(status_code=422, detail="Давхардуулан нэгтгэхэд эцэг-хүүхдийн тойрог үүсэж байна.")
            if (np, nc) not in seen_pairs:
                seen_pairs.add((np, nc))
                remapped_edges.append((np, nc))
        if sum(1 for _, c in remapped_edges if c == body.target_person_id) > 2:
            raise HTTPException(status_code=409, detail="Нэгтгэсний дараа энэ хүн хоёроос олон эцэг/эхтэй болох тул боломжгүй.")
        # Check remapped edges contain no directed cycles
        for np, nc in remapped_edges:
            others = [(x, y) for x, y in remapped_edges if not (x == np and y == nc)]
            try:
                assert_parent_child_is_acyclic(others, np, nc)
            except RelationshipError as err:
                raise HTTPException(status_code=422, detail=str(err)) from err

    # 1. Copy FamilyPerson rows to target_family (excluding duplicate source_person in merge_duplicate)
    source_person_ids = db.scalars(
        select(FamilyPerson.person_id).where(FamilyPerson.family_id == source_family.id)
    ).all()
    existing_target_person_ids = set(
        db.scalars(select(FamilyPerson.person_id).where(FamilyPerson.family_id == target_family.id)).all()
    )
    moved_persons = 0
    for pid in source_person_ids:
        if body.mode == "merge_duplicate" and pid == body.source_person_id:
            continue
        if pid not in existing_target_person_ids:
            db.add(FamilyPerson(id=uuid4(), family_id=target_family.id, person_id=pid, added_by=actor.id))
            existing_target_person_ids.add(pid)
            moved_persons += 1
    db.flush()

    def _remap_pid(pid: UUID) -> UUID:
        if body.mode == "merge_duplicate" and pid == body.source_person_id:
            return body.target_person_id
        return pid

    # 2. Migrate Story + StoryPerson preserving composite FKs
    story_person_rows = db.scalars(
        select(StoryPerson).where(StoryPerson.family_id == source_family.id)
    ).all()
    story_snapshot = [(sp.story_id, _remap_pid(sp.person_id)) for sp in story_person_rows]
    if story_person_rows:
        db.execute(delete(StoryPerson).where(StoryPerson.family_id == source_family.id))
    db.execute(
        update(Story).where(Story.family_id == source_family.id).values(family_id=target_family.id)
    )
    db.flush()
    seen_story_links: set[tuple[UUID, UUID]] = set()
    for story_id, person_id in story_snapshot:
        if (story_id, person_id) not in seen_story_links:
            seen_story_links.add((story_id, person_id))
            db.add(StoryPerson(id=uuid4(), story_id=story_id, family_id=target_family.id, person_id=person_id))

    # 3. Migrate Archive + ArchivePerson preserving composite FKs
    archive_person_rows = db.scalars(
        select(ArchivePerson).where(ArchivePerson.family_id == source_family.id)
    ).all()
    archive_snapshot = [(ap.archive_id, _remap_pid(ap.person_id)) for ap in archive_person_rows]
    if archive_person_rows:
        db.execute(delete(ArchivePerson).where(ArchivePerson.family_id == source_family.id))
    db.execute(
        update(Archive).where(Archive.family_id == source_family.id).values(family_id=target_family.id)
    )
    db.flush()
    seen_archive_links: set[tuple[UUID, UUID]] = set()
    for archive_id, person_id in archive_snapshot:
        if (archive_id, person_id) not in seen_archive_links:
            seen_archive_links.add((archive_id, person_id))
            db.add(ArchivePerson(id=uuid4(), archive_id=archive_id, family_id=target_family.id, person_id=person_id))

    # 4. Migrate Memory, Photo, ChatMessage, FamilyFund, Donation, FamilyEvent
    for model in (Memory, Photo, ChatMessage, FamilyFund, Donation, FamilyEvent):
        db.execute(
            update(model).where(model.family_id == source_family.id).values(family_id=target_family.id)
        )

    # 5. Migrate FamilyMember rows (preserving existing target roles, adding new members as 'member')
    source_members = db.scalars(
        select(FamilyMember).where(FamilyMember.family_id == source_family.id)
    ).all()
    existing_target_member_ids = set(
        db.scalars(select(FamilyMember.user_id).where(FamilyMember.family_id == target_family.id)).all()
    )
    moved_members = 0
    for m in source_members:
        if m.user_id not in existing_target_member_ids:
            db.add(FamilyMember(id=uuid4(), family_id=target_family.id, user_id=m.user_id, role="member"))
            existing_target_member_ids.add(m.user_id)
            moved_members += 1

    # 6. Apply graph connection according to mode
    created_accounts: list[str] = []
    if body.mode == "attach_child":
        _ensure_parent_child(db, body.target_person_id, body.source_person_id, actor.id)
    elif body.mode == "attach_spouse":
        _ensure_marriage(db, body.target_person_id, body.source_person_id, actor.id)
    elif body.mode == "bridge_parent":
        bp = body.bridge_parent
        assert bp is not None
        fn = bp.first_name.strip()
        ln = bp.last_name.strip()
        bridge_person = Person(
            id=uuid4(),
            first_name=fn,
            last_name=ln,
            gender=bp.gender,
            birth_date=bp.birth_date,
            is_alive=bp.is_alive,
            visibility="family",
            search_first_name=normalize_search_name(fn),
            search_last_name=normalize_search_name(ln),
            created_by=actor.id,
        )
        db.add(bridge_person)
        db.flush()
        db.add(FamilyPerson(id=uuid4(), family_id=target_family.id, person_id=bridge_person.id, added_by=actor.id))
        existing_target_person_ids.add(bridge_person.id)
        if bp.email:
            created_email = _ensure_relative_account(
                db,
                str(bp.email),
                _person_label(bridge_person),
                target_family.id,
                bridge_person.id,
                actor.id,
            )
            if created_email:
                created_accounts.append(created_email)
        _ensure_parent_child(db, body.target_person_id, bridge_person.id, actor.id)
        _ensure_parent_child(db, bridge_person.id, body.source_person_id, actor.id)
    elif body.mode == "merge_duplicate" and body.source_person_id != body.target_person_id:
        # Transfer UserPersonLink if source had one and target did not
        if source_link and not target_link:
            source_link.person_id = body.target_person_id
            db.flush()

        # Re-point ParentChildRelationship edges
        old_pc_rows = db.scalars(
            select(ParentChildRelationship).where(
                or_(
                    ParentChildRelationship.parent_id == body.source_person_id,
                    ParentChildRelationship.child_id == body.source_person_id,
                )
            )
        ).all()
        pc_pairs = [
            (
                body.target_person_id if row.parent_id == body.source_person_id else row.parent_id,
                body.target_person_id if row.child_id == body.source_person_id else row.child_id,
            )
            for row in old_pc_rows
        ]
        if old_pc_rows:
            db.execute(
                delete(ParentChildRelationship).where(
                    or_(
                        ParentChildRelationship.parent_id == body.source_person_id,
                        ParentChildRelationship.child_id == body.source_person_id,
                    )
                )
            )
            db.flush()
        for np, nc in pc_pairs:
            _ensure_parent_child(db, np, nc, actor.id)

        # Re-point Marriage rows
        old_marriages = db.scalars(
            select(Marriage).where(
                or_(
                    Marriage.person_1_id == body.source_person_id,
                    Marriage.person_2_id == body.source_person_id,
                )
            )
        ).all()
        spouse_other_ids = [
            row.person_2_id if row.person_1_id == body.source_person_id else row.person_1_id
            for row in old_marriages
            if row.deleted_at is None
        ]
        if old_marriages:
            db.execute(
                delete(Marriage).where(
                    or_(
                        Marriage.person_1_id == body.source_person_id,
                        Marriage.person_2_id == body.source_person_id,
                    )
                )
            )
            db.flush()
        for other_id in spouse_other_ids:
            if other_id != body.target_person_id:
                _ensure_marriage(db, body.target_person_id, other_id, actor.id)

        # Re-point LifeEvent, MemoryPersonTag, PhotoPersonTag
        db.execute(
            update(LifeEvent)
            .where(LifeEvent.person_id == body.source_person_id)
            .values(person_id=body.target_person_id)
        )
        existing_mem_ids = set(
            db.scalars(select(MemoryPersonTag.memory_id).where(MemoryPersonTag.person_id == body.target_person_id)).all()
        )
        for tag in db.scalars(select(MemoryPersonTag).where(MemoryPersonTag.person_id == body.source_person_id)).all():
            if tag.memory_id in existing_mem_ids:
                db.delete(tag)
            else:
                tag.person_id = body.target_person_id
                existing_mem_ids.add(tag.memory_id)

        existing_photo_ids = set(
            db.scalars(select(PhotoPersonTag.photo_id).where(PhotoPersonTag.person_id == body.target_person_id)).all()
        )
        for ptag in db.scalars(select(PhotoPersonTag).where(PhotoPersonTag.person_id == body.source_person_id)).all():
            if ptag.photo_id in existing_photo_ids:
                db.delete(ptag)
            else:
                ptag.person_id = body.target_person_id
                existing_photo_ids.add(ptag.photo_id)

        # Merge missing bio & profile fields onto target_person
        if not target_person.birth_date and source_person.birth_date:
            target_person.birth_date = source_person.birth_date
        if not target_person.birth_place and source_person.birth_place:
            target_person.birth_place = source_person.birth_place
        if not target_person.death_date and source_person.death_date:
            target_person.death_date = source_person.death_date
        if not target_person.death_place and source_person.death_place:
            target_person.death_place = source_person.death_place
        if not target_person.short_description and source_person.short_description:
            target_person.short_description = source_person.short_description
        if target_person.gender == "unknown" and source_person.gender in {"male", "female", "other"}:
            target_person.gender = source_person.gender

        source_bio = db.scalar(select(Biography).where(Biography.person_id == body.source_person_id))
        target_bio = db.scalar(select(Biography).where(Biography.person_id == body.target_person_id))
        if source_bio:
            if not target_bio and source_bio.body:
                source_bio.person_id = body.target_person_id
            else:
                db.delete(source_bio)

        # Clean up ancillary & RESTRICT references before deleting duplicate Person
        db.execute(
            update(TreeJoinRequest)
            .where(TreeJoinRequest.father_person_id == body.source_person_id)
            .values(father_person_id=None)
        )
        db.execute(
            update(TreeJoinRequest)
            .where(TreeJoinRequest.mother_person_id == body.source_person_id)
            .values(mother_person_id=None)
        )
        db.execute(
            update(TreeJoinRequest)
            .where(TreeJoinRequest.created_person_id == body.source_person_id)
            .values(created_person_id=body.target_person_id)
        )
        db.execute(
            update(Family)
            .where(Family.root_person_id == body.source_person_id)
            .values(root_person_id=None)
        )
        db.execute(
            update(Family)
            .where(Family.featured_person_id == body.source_person_id)
            .values(featured_person_id=None)
        )
        db.execute(
            delete(RootConnection).where(
                or_(
                    RootConnection.person_id == body.source_person_id,
                    RootConnection.target_person_id == body.source_person_id,
                )
            )
        )
        db.execute(
            delete(SharedAncestryRequest).where(
                or_(
                    SharedAncestryRequest.person_id == body.source_person_id,
                    SharedAncestryRequest.target_person_id == body.source_person_id,
                )
            )
        )
        db.execute(
            delete(FamilyClanLink).where(
                or_(
                    FamilyClanLink.household_person_id == body.source_person_id,
                    FamilyClanLink.clan_anchor_person_id == body.source_person_id,
                )
            )
        )
        db.execute(delete(SharedAncestryPerson).where(SharedAncestryPerson.person_id == body.source_person_id))
        db.execute(
            delete(SharedAncestryRelationship).where(
                or_(
                    SharedAncestryRelationship.parent_id == body.source_person_id,
                    SharedAncestryRelationship.child_id == body.source_person_id,
                )
            )
        )
        db.execute(delete(PersonLineageAssignment).where(PersonLineageAssignment.person_id == body.source_person_id))
        db.execute(delete(PersonLinkRequest).where(PersonLinkRequest.person_id == body.source_person_id))
        db.execute(delete(FamilyTrashRecord).where(FamilyTrashRecord.person_id == body.source_person_id))
        db.execute(delete(FamilyPerson).where(FamilyPerson.person_id == body.source_person_id))
        db.flush()
        db.delete(source_person)
        db.flush()

    # 7. Clean up remaining source_family links & archive source_family
    db.execute(delete(RootConnection).where(RootConnection.family_id == source_family.id))
    db.execute(delete(SharedAncestryRequest).where(SharedAncestryRequest.family_id == source_family.id))
    db.execute(
        delete(FamilyClanLink).where(
            or_(
                FamilyClanLink.household_family_id == source_family.id,
                FamilyClanLink.clan_family_id == source_family.id,
            )
        )
    )
    db.execute(
        update(SharedAncestryPerson)
        .where(SharedAncestryPerson.family_id == source_family.id)
        .values(family_id=target_family.id)
    )
    db.execute(delete(FamilyPerson).where(FamilyPerson.family_id == source_family.id))
    source_family.root_person_id = None
    source_family.featured_person_id = None
    source_family.archived_at = datetime.now(UTC)

    total_clan_persons = len(
        db.scalars(select(FamilyPerson.id).where(FamilyPerson.family_id == target_family.id)).all()
    )
    db.add(
        AuditLog(
            id=uuid4(),
            family_id=target_family.id,
            actor_id=actor.id,
            action="clan.family.merged",
            target_type="family",
            target_id=source_family.id,
        )
    )
    db.commit()
    return {
        "status": "merged",
        "mode": body.mode,
        "target_family_id": str(target_family.id),
        "source_family_id": str(source_family.id),
        "moved_persons": moved_persons,
        "moved_members": moved_members,
        "created_accounts": created_accounts,
        "total_clan_persons": total_clan_persons,
    }


@admin_router.post("/bootstrap-root")
def bootstrap_clan_root(
    current: tuple[User, AdminRole] = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Idempotently create the founding ГУУЛИНГИЙНХАН clan tree (Ядамсүрэн ⚭ Гүнд + 4 branches)."""
    actor = current[0]
    lock_ancestry_writes(db)

    clan_family, root_pid = _resolve_clan_family_and_root(db)
    if clan_family is not None and root_pid is not None:
        existing_member = db.scalar(
            select(FamilyMember).where(
                FamilyMember.family_id == clan_family.id,
                FamilyMember.user_id == actor.id,
            )
        )
        if existing_member is None:
            db.add(
                FamilyMember(
                    id=uuid4(),
                    family_id=clan_family.id,
                    user_id=actor.id,
                    role="owner",
                )
            )
            db.commit()
        return {
            "clan_family_id": str(clan_family.id),
            "root_person_id": str(root_pid),
            "created": False,
        }

    fam = Family(
        id=uuid4(),
        name="ГУУЛИНГИЙНХАН",
        description="Гуулингийнхны нэгдсэн удмын мод",
        created_by=actor.id,
    )
    db.add(fam)
    db.flush()
    db.add(FamilyMember(id=uuid4(), family_id=fam.id, user_id=actor.id, role="owner"))

    def _make_ancestor(first_name: str, gender: str) -> Person:
        p = Person(
            id=uuid4(),
            first_name=first_name,
            last_name="",
            gender=gender,
            is_alive=False,
            visibility="family",
            search_first_name=normalize_search_name(first_name),
            search_last_name="",
            created_by=actor.id,
        )
        db.add(p)
        db.flush()
        db.add(FamilyPerson(id=uuid4(), family_id=fam.id, person_id=p.id, added_by=actor.id))
        return p

    yadam = _make_ancestor("Ядамсүрэн", "male")
    gund = _make_ancestor("Гүнд", "female")
    _ensure_marriage(db, yadam.id, gund.id, actor.id)

    branch_specs = [
        ("Баавай", "male"),
        ("Бадамдорж", "male"),
        ("Долгор", "female"),
        ("Нансалмаа", "female"),
    ]
    for b_name, b_gender in branch_specs:
        child = _make_ancestor(b_name, b_gender)
        _ensure_parent_child(db, yadam.id, child.id, actor.id)
        _ensure_parent_child(db, gund.id, child.id, actor.id)

    fam.root_person_id = yadam.id
    shared = db.get(SharedAncestry, 1)
    if shared is None:
        db.add(SharedAncestry(id=1, root_person_id=yadam.id, created_by=actor.id))
    else:
        shared.root_person_id = yadam.id

    db.add(
        AuditLog(
            id=uuid4(),
            family_id=fam.id,
            actor_id=actor.id,
            action="clan.root.bootstrapped",
            target_type="family",
            target_id=fam.id,
        )
    )
    db.commit()
    return {
        "clan_family_id": str(fam.id),
        "root_person_id": str(yadam.id),
        "branches": [name for name, _ in branch_specs],
        "created": True,
    }

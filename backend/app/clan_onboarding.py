"""Unified Clan Guided Onboarding Quiz + 1-Click Admin Approval + Auto-Account Creation.

Uses existing tables (TreeJoinRequest, SharedAncestry, Person, FamilyMember, User)
so zero Alembic DDL migrations are required.
"""

from __future__ import annotations

import json
import secrets
from collections import deque
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import _password_hash as hash_password
from app.auth import get_current_user, normalize_email
from app.db import get_db
from app.models import (
    AdminGrant,
    AuditLog,
    Family,
    FamilyMember,
    FamilyPerson,
    LoginIdentity,
    Marriage,
    ParentChildRelationship,
    Person,
    SharedAncestry,
    TreeJoinRequest,
    User,
    UserPersonLink,
    UserSession,
)
from app.person_search import normalize_search_name
from app.relationships import canonical_pair

PREFIX = "CLAN_ONBOARDING_V1:"
RELATIVES_PREFIX = "CLAN_RELATIVES_V1:"

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


class ClanOnboardingRejectInput(BaseModel):
    review_note: str | None = Field(default=None, max_length=500)
    ban_user: bool = False


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
    if note.startswith(RELATIVES_PREFIX):
        try:
            return "relatives", json.loads(note[len(RELATIVES_PREFIX) :])
        except Exception:
            return "relatives", {}
    if note.startswith(PREFIX):
        try:
            return "onboarding", json.loads(note[len(PREFIX) :])
        except Exception:
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

    out = []
    for req in rows:
        request_kind, meta = _parse_request_note(req.note)
        u = db.get(User, req.user_id)
        branch_p = db.get(Person, UUID(meta["branch_person_id"])) if meta.get("branch_person_id") else None
        if request_kind == "relatives":
            self_p = db.get(Person, UUID(meta["self_person_id"])) if meta.get("self_person_id") else (
                db.get(Person, req.father_person_id) if req.father_person_id else None
            )
            anchor_label = _person_label(self_p) if self_p else f"{req.last_name} {req.first_name}".strip()
        else:
            anchor_p = db.get(Person, UUID(meta["anchor_person_id"])) if meta.get("anchor_person_id") else (
                db.get(Person, req.father_person_id) if req.father_person_id else None
            )
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
            action="clan.relatives.approved" if request_kind == "relatives" else "clan.onboarding.approved",
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

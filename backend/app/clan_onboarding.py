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

from app.admin import AdminRole, require_admin
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

PREFIX = "CLAN_ONBOARDING_V1:"

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


def _parse_onboarding_meta(note: str | None) -> dict:
    if not note or not note.startswith(PREFIX):
        return {}
    try:
        return json.loads(note[len(PREFIX) :])
    except Exception:
        return {}


@admin_router.get("/requests")
def list_onboarding_requests(
    _: tuple[User, AdminRole] = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(TreeJoinRequest)
        .where(TreeJoinRequest.status == "pending")
        .order_by(TreeJoinRequest.created_at.desc())
    ).all()

    out = []
    for req in rows:
        meta = _parse_onboarding_meta(req.note)
        u = db.get(User, req.user_id)
        branch_p = db.get(Person, UUID(meta["branch_person_id"])) if meta.get("branch_person_id") else None
        anchor_p = db.get(Person, UUID(meta["anchor_person_id"])) if meta.get("anchor_person_id") else (
            db.get(Person, req.father_person_id) if req.father_person_id else None
        )
        out.append(
            {
                "id": str(req.id),
                "family_id": str(req.family_id),
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
                "anchor_name": _person_label(anchor_p) if anchor_p else None,
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


@admin_router.post("/requests/{request_id}/approve")
def approve_onboarding_request(
    request_id: UUID,
    current: tuple[User, AdminRole] = Depends(require_admin),
    db: Session = Depends(get_db),
):
    actor = current[0]
    req = db.get(TreeJoinRequest, request_id)
    if not req or req.status != "pending":
        raise HTTPException(status_code=404, detail="Хүлээгдэж буй хүсэлт олдсонгүй.")

    meta = _parse_onboarding_meta(req.note)
    anchor_id = UUID(meta["anchor_person_id"]) if meta.get("anchor_person_id") else req.father_person_id
    relatives: list[dict] = meta.get("relatives", [])

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

    # 2. Ensure requesting user is a regular member (viewer/member) of the clan family + linked to self_person
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

    # 3. Create missing middle-generation parents first, chaining from anchor_id -> parent(s) -> self_person
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

    direct_parent_id_for_self = anchor_id
    if parent_relatives:
        # Chain missing intermediate parents: anchor -> parent_0 -> ... -> self_person
        prev_id = anchor_id
        for pr in parent_relatives:
            p_node = _create_relative_person(pr)
            if prev_id:
                db.add(
                    ParentChildRelationship(
                        id=uuid4(),
                        parent_id=prev_id,
                        child_id=p_node.id,
                        relationship_type="biological",
                        created_by=actor.id,
                    )
                )
            prev_id = p_node.id
        direct_parent_id_for_self = prev_id

    if direct_parent_id_for_self:
        db.add(
            ParentChildRelationship(
                id=uuid4(),
                parent_id=direct_parent_id_for_self,
                child_id=self_person.id,
                relationship_type="biological",
                created_by=actor.id,
            )
        )

    # 4. Create spouse / child / sibling relatives
    for r in other_relatives:
        rel_p = _create_relative_person(r)
        kind = r.get("relation")
        if kind == "spouse":
            p1, p2 = sorted([self_person.id, rel_p.id], key=str)
            db.add(
                Marriage(
                    id=uuid4(),
                    person_1_id=p1,
                    person_2_id=p2,
                    status="married",
                    created_by=actor.id,
                )
            )
        elif kind == "child":
            db.add(
                ParentChildRelationship(
                    id=uuid4(),
                    parent_id=self_person.id,
                    child_id=rel_p.id,
                    relationship_type="biological",
                    created_by=actor.id,
                )
            )
        elif kind == "sibling" and direct_parent_id_for_self:
            db.add(
                ParentChildRelationship(
                    id=uuid4(),
                    parent_id=direct_parent_id_for_self,
                    child_id=rel_p.id,
                    relationship_type="biological",
                    created_by=actor.id,
                )
            )

    req.status = "approved"
    req.reviewed_by = actor.id
    req.reviewed_at = datetime.now(UTC)
    db.add(
        AuditLog(
            id=uuid4(),
            family_id=req.family_id,
            actor_id=actor.id,
            action="clan.onboarding.approved",
            target_type="tree_join_request",
            target_id=req.id,
        )
    )
    db.commit()
    return {
        "status": "approved",
        "self_person_id": str(self_person.id),
        "created_relatives": len(relatives),
        "created_accounts": created_accounts,
    }


@admin_router.post("/requests/{request_id}/reject")
def reject_onboarding_request(
    request_id: UUID,
    body: ClanOnboardingRejectInput,
    current: tuple[User, AdminRole] = Depends(require_admin),
    db: Session = Depends(get_db),
):
    actor = current[0]
    req = db.get(TreeJoinRequest, request_id)
    if not req or req.status != "pending":
        raise HTTPException(status_code=404, detail="Хүлээгдэж буй хүсэлт олдсонгүй.")

    req.status = "rejected"
    req.reviewed_by = actor.id
    req.reviewed_at = datetime.now(UTC)
    req.review_note = (body.review_note or "").strip() or None

    if body.ban_user:
        target_user = db.get(User, req.user_id)
        if target_user:
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

"""Persisted interactions, authorized by the existing Memory visibility boundary."""
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import Table, delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.auth import _consume_otp_rate, get_current_user
from app.db import get_db
from app.families import _audit
from app.models import AdminGrant, Family, FamilyMember, Memory, MemoryComment, MemoryLike, User

router = APIRouter(prefix="/memories", tags=["memory interactions"])


class LikeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    liked: bool


class CommentEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Сэтгэгдэл хоосон байж болохгүй.")
        return value.strip()


class CommentInput(CommentEdit):
    request_key: UUID


def _accessible_memory(db: Session, memory_id: UUID, user: User) -> Memory:
    memory = db.scalar(select(Memory).join(Family, Family.id == Memory.family_id).where(
        Memory.id == memory_id, Family.archived_at.is_(None),
    ))
    if memory is None:
        raise HTTPException(404, "Дурсамж олдсонгүй.")
    member = db.scalar(select(FamilyMember).where(
        FamilyMember.family_id == memory.family_id, FamilyMember.user_id == user.id,
    ))
    if member is not None:
        from app.memory_photos import _visible_memory
        return _visible_memory(db, memory.family_id, memory_id, user)
    if memory.visibility != "public":
        raise HTTPException(404, "Дурсамж олдсонгүй.")
    # Public text uses the existing explicit-public policy. No Person, family
    # identifier, media URL or membership is returned by these endpoints.
    return memory


def interaction_summaries(db: Session, ids: list[UUID], user: User) -> dict[UUID, dict]:
    if not ids:
        return {}
    like_rows = db.execute(select(MemoryLike.memory_id, func.count()).where(
        MemoryLike.memory_id.in_(ids)).group_by(MemoryLike.memory_id)).all()
    likes: dict[UUID, int] = {mid: count for mid, count in like_rows}
    comment_rows = db.execute(select(MemoryComment.memory_id, func.count()).where(
        MemoryComment.memory_id.in_(ids)).group_by(MemoryComment.memory_id)).all()
    comments: dict[UUID, int] = {mid: count for mid, count in comment_rows}
    mine = set(db.scalars(select(MemoryLike.memory_id).where(
        MemoryLike.memory_id.in_(ids), MemoryLike.user_id == user.id)).all())
    return {mid: {"like_count": likes.get(mid, 0), "comment_count": comments.get(mid, 0),
                  "liked": mid in mine} for mid in ids}


def _can_moderate(db: Session, memory: Memory, user: User) -> bool:
    role = db.scalar(select(FamilyMember.role).where(
        FamilyMember.family_id == memory.family_id, FamilyMember.user_id == user.id))
    grant = db.get(AdminGrant, user.id)
    return role in {"owner", "editor"} or (
        memory.visibility == "public" and grant is not None
        and grant.role in {"SUPER_ADMIN", "ADMIN", "MODERATOR"})


def _comment_payload(db: Session, comment: MemoryComment, memory: Memory, user: User) -> dict:
    author = db.get(User, comment.user_id)
    return {"id": comment.id, "body": comment.body,
            "author_name": author.display_name if author else "Гэр бүлийн гишүүн",
            "created_at": comment.created_at, "updated_at": comment.updated_at,
            "can_edit": comment.user_id == user.id,
            "can_delete": comment.user_id == user.id or _can_moderate(db, memory, user)}


@router.get("/{memory_id}/interactions")
def summary(memory_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _accessible_memory(db, memory_id, user)
    return interaction_summaries(db, [memory_id], user)[memory_id]


@router.put("/{memory_id}/like")
def set_like(memory_id: UUID, body: LikeInput, user: User = Depends(get_current_user),
             db: Session = Depends(get_db)):
    memory = _accessible_memory(db, memory_id, user)
    if not _consume_otp_rate(db, "memory_like", str(user.id), 60):
        raise HTTPException(429, "Түр хүлээгээд дахин оролдоно уу.")
    # Desired-state PUT is idempotent; a retry never toggles the result back.
    if body.liked:
        insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
        db.execute(insert(cast(Table, MemoryLike.__table__)).values(
            memory_id=memory_id, user_id=user.id, created_at=datetime.now(UTC)
        ).on_conflict_do_nothing(index_elements=["memory_id", "user_id"]))
    else:
        db.execute(delete(MemoryLike).where(MemoryLike.memory_id == memory_id,
                                            MemoryLike.user_id == user.id))
    _audit(db, user, memory.family_id, "memory.like_set", "memory", memory_id)
    db.commit()
    return interaction_summaries(db, [memory_id], user)[memory_id]


@router.get("/{memory_id}/comments")
def comments(memory_id: UUID, page: int = Query(1, ge=1, le=1000),
             page_size: int = Query(20, ge=1, le=50),
             user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    memory = _accessible_memory(db, memory_id, user)
    total = db.scalar(select(func.count()).select_from(MemoryComment).where(
        MemoryComment.memory_id == memory_id)) or 0
    rows = db.execute(select(MemoryComment, User.display_name).join(
        User, User.id == MemoryComment.user_id).where(MemoryComment.memory_id == memory_id)
        .order_by(MemoryComment.created_at, MemoryComment.id)
        .offset((page - 1) * page_size).limit(page_size)).all()
    moderator = _can_moderate(db, memory, user)
    return {"items": [{"id": c.id, "body": c.body, "author_name": name,
                       "created_at": c.created_at, "updated_at": c.updated_at,
                       "can_edit": c.user_id == user.id,
                       "can_delete": c.user_id == user.id or moderator} for c, name in rows],
            "page": page, "total": total, "has_next": page * page_size < total}


@router.post("/{memory_id}/comments", status_code=201)
def create_comment(memory_id: UUID, body: CommentInput, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    memory = _accessible_memory(db, memory_id, user)
    if not _consume_otp_rate(db, "memory_comment", str(user.id), 20):
        raise HTTPException(429, "Хэт олон сэтгэгдэл. Түр хүлээнэ үү.")
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    now = datetime.now(UTC)
    db.execute(insert(cast(Table, MemoryComment.__table__)).values(
        id=uuid4(), memory_id=memory_id, user_id=user.id, request_key=body.request_key,
        body=body.body, created_at=now, updated_at=now,
    ).on_conflict_do_nothing(index_elements=["memory_id", "user_id", "request_key"]))
    comment = db.scalar(select(MemoryComment).where(
        MemoryComment.memory_id == memory_id, MemoryComment.user_id == user.id,
        MemoryComment.request_key == body.request_key))
    assert comment is not None
    if comment.body != body.body:
        db.rollback()
        raise HTTPException(409, "Өмнөх хүсэлт өөр агуулгаар хадгалагдсан байна.")
    _audit(db, user, memory.family_id, "memory.comment_created", "memory_comment", comment.id)
    db.commit()
    return _comment_payload(db, comment, memory, user)


@router.patch("/{memory_id}/comments/{comment_id}")
def edit_comment(memory_id: UUID, comment_id: UUID, body: CommentEdit,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    memory = _accessible_memory(db, memory_id, user)
    comment = db.scalar(select(MemoryComment).where(MemoryComment.id == comment_id,
                                                   MemoryComment.memory_id == memory_id))
    if comment is None:
        raise HTTPException(404, "Сэтгэгдэл олдсонгүй.")
    if comment.user_id != user.id:
        raise HTTPException(403, "Зөвхөн өөрийн сэтгэгдлийг засна.")
    if not _consume_otp_rate(db, "memory_comment", str(user.id), 20):
        raise HTTPException(429, "Түр хүлээнэ үү.")
    comment.body = body.body
    comment.updated_at = datetime.now(UTC)
    _audit(db, user, memory.family_id, "memory.comment_updated", "memory_comment", comment.id)
    db.commit()
    return _comment_payload(db, comment, memory, user)


@router.delete("/{memory_id}/comments/{comment_id}", status_code=204)
def delete_comment(memory_id: UUID, comment_id: UUID,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    memory = _accessible_memory(db, memory_id, user)
    comment = db.scalar(select(MemoryComment).where(MemoryComment.id == comment_id,
                                                   MemoryComment.memory_id == memory_id))
    if comment is None:
        return Response(status_code=204)
    if comment.user_id != user.id and not _can_moderate(db, memory, user):
        raise HTTPException(403, "Сэтгэгдлийг устгах эрхгүй.")
    _audit(db, user, memory.family_id, "memory.comment_deleted", "memory_comment", comment.id)
    db.delete(comment)
    db.commit()
    return Response(status_code=204)

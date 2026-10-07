"""Authenticated, cross-family feed of explicitly public heritage records."""

import re
from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.heritage_links import LINK_TOKEN
from app.memory_interactions import interaction_summaries
from app.memory_photos import _expected_object_keys
from app.models import (
    Archive,
    Family,
    Memory,
    MemoryPersonTag,
    Person,
    Photo,
    PhotoPersonTag,
    Story,
    User,
)
from app.privacy import is_minor
from app.storage import ObjectStorage, get_storage

router = APIRouter(prefix="/community", tags=["community"])
_STORY_PHOTO_TOKEN = re.compile(
    r"\[\[photo:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\|[^\]\n]{0,180})?\]\]"
)


class PublicPost(BaseModel):
    id: UUID
    kind: str
    family_id: UUID
    family_name: str
    author_name: str
    title: str
    content: str
    event_date: date | None
    created_at: datetime
    thumbnail_url: str | None = None
    photos: list[str] = Field(default_factory=list)
    liked: bool | None = None
    like_count: int | None = None
    comment_count: int | None = None


class PublicFeed(BaseModel):
    items: list[PublicPost]
    page: int
    page_size: int
    total: int
    has_next: bool


def _public_photo(db: Session, photo_id: UUID) -> Photo | None:
    photo = db.scalar(
        select(Photo).join(Memory, Memory.id == Photo.memory_id)
        .join(Family, Family.id == Photo.family_id)
        .where(Photo.id == photo_id, Photo.storage_status == "ready",
               Memory.visibility == "public", Family.archived_at.is_(None))
    )
    if photo is None or photo.memory_id is None or photo.mime_type not in {
        "image/jpeg", "image/png", "image/webp",
    }:
        return None
    # Photo tags are an explicit publication boundary. Untagged pictures cannot
    # be checked for a minor or private subject, so they stay family-only.
    photo_people = db.scalars(select(Person).join(
        PhotoPersonTag, PhotoPersonTag.person_id == Person.id,
    ).where(PhotoPersonTag.photo_id == photo.id)).all()
    memory_people = db.scalars(select(Person).join(
        MemoryPersonTag, MemoryPersonTag.person_id == Person.id,
    ).where(MemoryPersonTag.memory_id == photo.memory_id)).all()
    if not photo_people or any(
        person.visibility != "public" or is_minor(person.birth_date) is not False
        for person in [*photo_people, *memory_people]
    ):
        return None
    return photo


@router.get("/feed", response_model=PublicFeed)
def public_feed(
    page: int = Query(default=1, ge=1, le=1000),
    page_size: int = Query(default=12, ge=1, le=30),
    kind: Literal["all", "story", "memory", "archive"] = "all",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Show public posts from every active family; never expose family/private records."""
    models = (
        ("story", Story, Story.body, Story.event_date),
        ("memory", Memory, Memory.description, Memory.memory_date),
        ("archive", Archive, Archive.description, Archive.document_date),
    )
    total = 0
    candidates: list[PublicPost] = []
    per_kind_limit = page * page_size
    for item_kind, model, content_column, date_column in models:
        if kind != "all" and item_kind != kind:
            continue
        scope = (model.visibility == "public", Family.archived_at.is_(None))
        total += db.scalar(
            select(func.count()).select_from(model).join(Family, Family.id == model.family_id).where(*scope)
        ) or 0
        rows = db.execute(
            select(model.id, model.family_id, Family.name, User.display_name,
                   model.title, content_column, date_column, model.created_at)
            .join(Family, Family.id == model.family_id)
            .join(User, User.id == model.created_by)
            .where(*scope)
            .order_by(model.created_at.desc(), model.id.desc())
            .limit(per_kind_limit)
        ).all()
        candidates.extend(PublicPost(
            id=row[0], kind=item_kind, family_id=row[1], family_name=row[2],
            author_name=row[3], title=row[4],
            content=LINK_TOKEN.sub("", _STORY_PHOTO_TOKEN.sub("", row[5] or "")).strip(),
            event_date=row[6], created_at=row[7],
        ) for row in rows)
    candidates.sort(key=lambda item: (item.created_at.replace(tzinfo=None), str(item.id)), reverse=True)
    start = (page - 1) * page_size
    items = candidates[start:start + page_size]
    summaries = interaction_summaries(db, [item.id for item in items if item.kind == "memory"], user)
    for item in items:
        if item.kind == "memory":
            item.liked = summaries[item.id]["liked"]
            item.like_count = summaries[item.id]["like_count"]
            item.comment_count = summaries[item.id]["comment_count"]
            photos = db.scalars(select(Photo).where(
                Photo.memory_id == item.id, Photo.storage_status == "ready",
            ).order_by(Photo.created_at.desc(), Photo.id.desc()).limit(12)).all()
            approved = next((photo for photo in photos if _public_photo(db, photo.id)), None)
            if approved:
                item.thumbnail_url = f"/community/photos/{approved.id}/thumbnail"
        elif item.kind in {"story", "archive"}:
            body = (db.scalar(select(Story.body).where(Story.id == item.id)) if item.kind == "story" else db.scalar(select(Archive.description).where(Archive.id == item.id))) or ""
            for match in _STORY_PHOTO_TOKEN.finditer(body):
                photo = _public_photo(db, UUID(match.group(1)))
                if photo is not None and photo.family_id == item.family_id:
                    item.thumbnail_url = f"/community/photos/{photo.id}/thumbnail"
                    break
    return PublicFeed(items=items, page=page,
                      page_size=page_size, total=total, has_next=page * page_size < total)


@router.get("/{kind}/{post_id}", response_model=PublicPost)
def public_post(
    kind: Literal["story", "memory", "archive"], post_id: UUID,
    _: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """A public post is readable across families, without exposing related Persons."""
    variants: dict[str, tuple[Any, Any, Any]] = {
        "story": (Story, Story.body, Story.event_date),
        "memory": (Memory, Memory.description, Memory.memory_date),
        "archive": (Archive, Archive.description, Archive.document_date),
    }
    model, content_column, date_column = variants[kind]
    row = db.execute(select(
        model, Family.name, User.display_name, content_column, date_column,
    ).join(Family, Family.id == model.family_id)
        .join(User, User.id == model.created_by)
        .where(model.id == post_id, model.visibility == "public",
               Family.archived_at.is_(None))).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Нийтэд хуваалцсан бичлэг олдсонгүй.")
    item, family_name, author_name, content, event_date = row
    photos = []
    if kind == "memory":
        candidates = db.scalars(select(Photo).where(
            Photo.memory_id == item.id, Photo.storage_status == "ready",
        ).order_by(Photo.created_at, Photo.id).limit(24)).all()
        photos = [f"/community/photos/{photo.id}/thumbnail" for photo in candidates
                  if _public_photo(db, photo.id)]
    elif kind in {"story", "archive"}:
        for match in _STORY_PHOTO_TOKEN.finditer(content or ""):
            photo_id = UUID(match.group(1))
            photo = _public_photo(db, photo_id)
            if photo is not None and photo.family_id == item.family_id:
                photos.append(f"/community/photos/{photo_id}/thumbnail")
    return PublicPost(
        id=item.id, kind=kind, family_id=item.family_id, family_name=family_name,
        author_name=author_name, title=item.title, content=LINK_TOKEN.sub("", content or ""),
        event_date=event_date, created_at=item.created_at,
        thumbnail_url=photos[0] if photos else None, photos=photos,
    )


@router.get("/photos/{photo_id}/thumbnail")
def public_thumbnail(
    photo_id: UUID,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    photo = _public_photo(db, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Нийтийн зураг олдсонгүй.")
    _original_key, thumbnail_key = _expected_object_keys(photo)
    try:
        data = storage.get(thumbnail_key)
    except Exception as error:
        raise HTTPException(status_code=503, detail="Зургийг ачаалж чадсангүй.") from error
    return Response(content=data, media_type="image/jpeg", headers={
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin",
    })

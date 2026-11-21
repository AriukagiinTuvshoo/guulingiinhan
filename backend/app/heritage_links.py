"""Authorized references in existing heritage text; no parallel content database."""
import re
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import Archive, LifeEvent, Memory, Story, User

LINK_TOKEN = re.compile(r"\[\[link:(story|memory|archive|event):([0-9a-fA-F-]{36})\]\]")
router = APIRouter(prefix="/families", tags=["heritage references"])
Kind = Literal["story", "memory", "archive", "event"]


def visible_target(db: Session, family_id: UUID, user: User, kind: str, target_id: UUID):
    from app.families import (
        _archive_visible,
        _assert_person_visible,
        _memory_visible_to_member,
        _person_in_family,
        _require_minor_scope,
        _story_visible,
    )
    if kind == "event":
        event = db.get(LifeEvent, target_id)
        if event is None:
            raise HTTPException(404, "Материал олдсонгүй.")
        person = _person_in_family(db, family_id, event.person_id)
        _assert_person_visible(db, person, user)
        _require_minor_scope(db, family_id, person, user, "manage_events")
        return event
    if kind == "story":
        story = db.scalar(select(Story).where(Story.id == target_id, Story.family_id == family_id))
        if story is not None and _story_visible(db, story, user):
            return story
    elif kind == "archive":
        archive = db.scalar(select(Archive).where(Archive.id == target_id, Archive.family_id == family_id))
        if archive is not None and _archive_visible(archive, user):
            return archive
    elif kind == "memory":
        memory = db.scalar(select(Memory).where(Memory.id == target_id, Memory.family_id == family_id))
        if (memory is not None and (memory.visibility != "private" or memory.created_by == user.id)
                and memory.id in _memory_visible_to_member(db, family_id, user, [memory.id])):
            return memory
    raise HTTPException(404, "Материал олдсонгүй.")


def validate_content_links(db: Session, family_id: UUID, user: User, content: str | None):
    matches = LINK_TOKEN.findall(content or "")
    if len(matches) != (content or "").count("[[link:"):
        raise HTTPException(422, "Материалын холбоос буруу байна.")
    if len(matches) > 20:
        raise HTTPException(422, "Нэг материалд 20 хүртэл холбоос оруулна уу.")
    for kind, raw_id in set(matches):
        try:
            target_id = UUID(raw_id)
        except ValueError:
            raise HTTPException(422, "Материалын холбоос буруу байна.") from None
        visible_target(db, family_id, user, kind, target_id)


@router.get("/{family_id}/content-links/{kind}/{source_id}")
def content_links(family_id: UUID, kind: Kind, source_id: UUID, response: Response,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.families import _member
    _member(db, family_id, user)
    response.headers["Cache-Control"] = "private, no-store"
    source = visible_target(db, family_id, user, kind, source_id)
    content = source.body if isinstance(source, Story) else source.description or ""
    items = []
    seen = set()
    for target_kind, raw_id in LINK_TOKEN.findall(content)[:20]:
        if (target_kind, raw_id) in seen:
            continue
        seen.add((target_kind, raw_id))
        try:
            target = visible_target(db, family_id, user, target_kind, UUID(raw_id))
        except (HTTPException, ValueError):
            continue  # Revoked access/deleted targets are omitted, including their titles.
        paths = {"story": "stories", "memory": "memories", "archive": "archives"}
        href = (f"/profile?family={family_id}&person={target.person_id}" if isinstance(target, LifeEvent)
                else f"/{paths[target_kind]}/{target.id}?family={family_id}")
        items.append({"id": target.id, "kind": target_kind, "title": target.title, "href": href})
    return {"items": items}

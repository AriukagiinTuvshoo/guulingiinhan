"""Paginated memory/photo APIs with family, visibility, and guardian checks."""

from __future__ import annotations

import io
import logging
import re
import warnings
from pathlib import PurePath
from urllib.parse import unquote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import get_settings
from app.db import get_db
from app.families import (
    _assert_memory_minor_scopes,
    _assert_person_visible,
    _audit,
    _member,
    _memory_visible_to_member,
    _person_in_family,
    _require_minor_scope,
)
from app.models import (
    FamilyMember,
    FamilyPerson,
    Memory,
    MemoryPersonTag,
    Person,
    Photo,
    PhotoPersonTag,
    User,
    UserPersonLink,
)
from app.storage import ObjectStorage, get_storage

router = APIRouter(prefix="/families", tags=["memories and photos"])
logger = logging.getLogger("guulingiinhan.storage")

SUPPORTED_FORMATS = {
    "JPEG": ("image/jpeg", {".jpg", ".jpeg"}),
    "PNG": ("image/png", {".png"}),
    "WEBP": ("image/webp", {".webp"}),
}
THUMBNAIL_MAX_SIZE = (1200, 1200)
MAX_IMAGE_PIXELS = 40_000_000


class PhotoTagsInput(BaseModel):
    person_ids: list[UUID] = Field(max_length=100)


def _visible_people_query(user: User, family_id: UUID):
    linked_people = select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id)
    return select(Person.id).join(FamilyPerson, FamilyPerson.person_id == Person.id).where(
        FamilyPerson.family_id == family_id,
        or_(Person.visibility != "private", Person.created_by == user.id,
            Person.id.in_(linked_people)),
    )


def _can_edit_memory(memory: Memory, member: FamilyMember, user: User) -> bool:
    return member.role in {"owner", "editor"} or memory.created_by == user.id


def _visible_memory(db: Session, family_id: UUID, memory_id: UUID, user: User) -> Memory:
    memory = db.scalar(select(Memory).where(
        Memory.id == memory_id, Memory.family_id == family_id,
    ))
    if memory is None or (memory.visibility == "private" and memory.created_by != user.id):
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    person_ids = db.scalars(select(MemoryPersonTag.person_id).where(
        MemoryPersonTag.memory_id == memory_id
    )).all()
    try:
        _assert_memory_minor_scopes(db, family_id, user, person_ids)
    except HTTPException as error:
        if error.status_code == 403:
            raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.") from error
        raise
    return memory


def _photo_payload(photo: Photo, person_ids: list[UUID] | None = None) -> dict:
    return {
        "id": photo.id,
        "title": photo.title,
        "original_filename": photo.original_filename,
        "mime_type": photo.mime_type,
        "file_size": photo.file_size,
        "width": photo.width,
        "height": photo.height,
        "created_at": photo.created_at,
        "thumbnail_url": f"/families/{photo.family_id}/photos/{photo.id}/content?variant=thumbnail",
        "content_url": f"/families/{photo.family_id}/photos/{photo.id}/content",
        "person_ids": person_ids or [],
    }


def _image_payload(filename: str, data: bytes) -> tuple[str, int, int, bytes]:
    suffix = PurePath(filename.replace("\\", "/")).suffix.lower()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                image.verify()
            with Image.open(io.BytesIO(data)) as image:
                fmt = (image.format or "").upper()
                if fmt not in SUPPORTED_FORMATS:
                    raise HTTPException(status_code=415, detail="JPEG, PNG эсвэл WebP зураг оруулна уу.")
                mime_type, extensions = SUPPORTED_FORMATS[fmt]
                if suffix not in extensions:
                    raise HTTPException(status_code=415, detail="Файлын өргөтгөл зурагтай тохирохгүй байна.")
                width, height = image.size
                if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
                    raise HTTPException(status_code=413, detail="Зургийн пикселийн хэмжээ хэт том байна.")
                image = ImageOps.exif_transpose(image)
                image.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)
                image = image.convert("RGB")
                thumbnail = io.BytesIO()
                image.save(thumbnail, format="JPEG", quality=82, optimize=True)
                return mime_type, width, height, thumbnail.getvalue()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as error:
        raise HTTPException(status_code=415, detail="Зургийн файл гэмтсэн эсвэл дэмжигдэхгүй байна.") from error


def _delete_objects(storage: ObjectStorage, keys: list[str]) -> None:
    for key in keys:
        if not key:
            continue
        try:
            storage.delete(key)
        except Exception as error:
            logger.warning("Object storage deletion failed", extra={"error_type": type(error).__name__})
            raise HTTPException(
                status_code=503,
                detail="Зургийн файлыг хадгалах сангаас устгаж чадсангүй.",
            ) from error


def _memory_page_payload(db: Session, family_id: UUID, user: User, memory: Memory) -> dict:
    tag_rows = db.execute(
        select(MemoryPersonTag.person_id, Person.first_name, Person.last_name, Person.middle_name)
        .join(Person, Person.id == MemoryPersonTag.person_id)
        .where(
            MemoryPersonTag.memory_id == memory.id,
            MemoryPersonTag.person_id.in_(_visible_people_query(user, family_id)),
        )
        .order_by(Person.last_name, Person.first_name)
    ).all()
    return {
        "id": memory.id,
        "title": memory.title,
        "description": memory.description,
        "memory_date": memory.memory_date,
        "visibility": memory.visibility,
        "person_ids": [row[0] for row in tag_rows],
        "person_names": [" ".join(filter(None, (row[2], row[1], row[3]))) for row in tag_rows],
        "created_at": memory.created_at,
    }


@router.get("/{family_id}/memories")
def list_memories(
    family_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    candidates = db.scalars(
        select(Memory).where(
            Memory.family_id == family_id,
            or_(Memory.visibility != "private", Memory.created_by == user.id),
        ).order_by(Memory.memory_date.desc().nullslast(), Memory.created_at.desc())
    ).all()
    visible_ids = _memory_visible_to_member(
        db, family_id, user, [memory.id for memory in candidates]
    )
    visible = [memory for memory in candidates if memory.id in visible_ids]
    total = len(visible)
    page_items = visible[(page - 1) * page_size : page * page_size]
    ids = [memory.id for memory in page_items]
    photo_rows = db.scalars(
        select(Photo).where(Photo.memory_id.in_(ids))
        .order_by(Photo.created_at.desc())
    ).all() if ids else []
    photos_by_memory: dict[UUID, list[Photo]] = {memory_id: [] for memory_id in ids}
    for photo in photo_rows:
        if len(photos_by_memory[photo.memory_id]) < 12:
            photos_by_memory[photo.memory_id].append(photo)
    photo_ids = [photo.id for batch in photos_by_memory.values() for photo in batch]
    tags_by_photo: dict[UUID, list[UUID]] = {photo_id: [] for photo_id in photo_ids}
    tag_rows = db.execute(
        select(PhotoPersonTag.photo_id, PhotoPersonTag.person_id).where(
            PhotoPersonTag.photo_id.in_(photo_ids),
            PhotoPersonTag.person_id.in_(_visible_people_query(user, family_id)),
        )
    ).all() if photo_ids else []
    for photo_id, person_id in tag_rows:
        tags_by_photo[photo_id].append(person_id)
    items = []
    for memory in page_items:
        item = _memory_page_payload(db, family_id, user, memory)
        item["photos"] = [
            _photo_payload(photo, tags_by_photo[photo.id])
            for photo in photos_by_memory[memory.id]
        ]
        items.append(item)
    return {"items": items, "page": page, "page_size": page_size, "total": total}


@router.post("/{family_id}/memories/{memory_id}/photos", status_code=201)
async def upload_photo(
    family_id: UUID,
    memory_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    member, _ = _member(db, family_id, user)
    memory = _visible_memory(db, family_id, memory_id, user)
    if not _can_edit_memory(memory, member, user):
        raise HTTPException(status_code=403, detail="Энэ дурсамжид зураг нэмэх эрхгүй.")
    settings = get_settings()
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > settings.photo_max_upload_bytes:
            raise HTTPException(status_code=413, detail="Зургийн файл тохируулсан хэмжээнээс хэтэрлээ.")
        data.extend(chunk)
    if not data:
        raise HTTPException(status_code=422, detail="Зургийн файл хоосон байна.")
    filename = unquote(request.headers.get("x-file-name", "photo"))
    mime_type, width, height, thumbnail = _image_payload(filename, bytes(data))
    safe_filename = re.sub(
        r"[^\w.\- ]", "_", PurePath(filename.replace("\\", "/")).name
    )[:255] or "photo"
    photo_id = uuid4()
    object_prefix = f"families/{family_id}/memories/{memory_id}/photos/{photo_id}"
    original_key, thumbnail_key = f"{object_prefix}/original", f"{object_prefix}/thumbnail.jpg"
    try:
        storage.put(original_key, bytes(data), mime_type)
        storage.put(thumbnail_key, thumbnail, "image/jpeg")
    except Exception as error:
        try:
            storage.delete(thumbnail_key)
            storage.delete(original_key)
        except Exception:
            logger.exception("Photo upload cleanup failed")
        raise HTTPException(status_code=503, detail="Зургийг хадгалж чадсангүй.") from error
    photo = Photo(
        id=photo_id, family_id=family_id, memory_id=memory_id, object_key=original_key,
        thumbnail_object_key=thumbnail_key, original_filename=safe_filename,
        mime_type=mime_type, file_size=len(data), width=width, height=height,
        uploaded_by=user.id,
    )
    db.add(photo)
    try:
        db.flush()
        _audit(db, user, family_id, "photo.created", "photo", photo.id)
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        _delete_objects(storage, [thumbnail_key, original_key])
        raise HTTPException(status_code=500, detail="Зургийн мэдээллийг хадгалж чадсангүй.") from error
    return _photo_payload(photo)


@router.get("/{family_id}/memories/{memory_id}/photos")
def list_memory_photos(
    family_id: UUID,
    memory_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    _visible_memory(db, family_id, memory_id, user)
    photos = db.scalars(
        select(Photo).where(Photo.family_id == family_id, Photo.memory_id == memory_id)
        .order_by(Photo.created_at.desc()).limit(limit)
    ).all()
    ids = [photo.id for photo in photos]
    tags = db.execute(
        select(PhotoPersonTag.photo_id, PhotoPersonTag.person_id).where(
            PhotoPersonTag.photo_id.in_(ids),
            PhotoPersonTag.person_id.in_(_visible_people_query(user, family_id)),
        )
    ).all() if ids else []
    tags_by_photo: dict[UUID, list[UUID]] = {photo_id: [] for photo_id in ids}
    for photo_id, person_id in tags:
        tags_by_photo[photo_id].append(person_id)
    return [_photo_payload(photo, tags_by_photo[photo.id]) for photo in photos]


@router.get("/{family_id}/persons/{person_id}/photos")
def list_person_photos(
    family_id: UUID,
    person_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    _require_minor_scope(db, family_id, person, user, "view_profile")
    visible_memory_ids = select(Memory.id).where(
        Memory.family_id == family_id,
        or_(Memory.visibility != "private", Memory.created_by == user.id),
    )
    conditions = (
        Photo.family_id == family_id,
        Photo.memory_id.in_(visible_memory_ids),
        Photo.id.in_(select(PhotoPersonTag.photo_id).where(
            PhotoPersonTag.person_id == person_id
        )),
    )
    total = db.scalar(select(func.count()).select_from(Photo).where(*conditions)) or 0
    photos = db.scalars(
        select(Photo).where(*conditions).order_by(Photo.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {
        "items": [_photo_payload(photo, [person_id]) for photo in photos],
        "page": page, "page_size": page_size, "total": total,
    }


@router.put("/{family_id}/photos/{photo_id}/tags")
def set_photo_tags(
    family_id: UUID,
    photo_id: UUID,
    body: PhotoTagsInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    photo = db.scalar(select(Photo).where(Photo.id == photo_id, Photo.family_id == family_id))
    if photo is None or photo.memory_id is None:
        raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
    memory = _visible_memory(db, family_id, photo.memory_id, user)
    if not _can_edit_memory(memory, member, user):
        raise HTTPException(status_code=403, detail="Зурагт хүн tag хийх эрхгүй.")
    people = set(body.person_ids)
    for person_id in people:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        _require_minor_scope(db, family_id, person, user, "manage_memories")
    from sqlalchemy import delete

    db.execute(delete(PhotoPersonTag).where(PhotoPersonTag.photo_id == photo_id))
    db.add_all(PhotoPersonTag(photo_id=photo_id, person_id=person_id) for person_id in people)
    _audit(db, user, family_id, "photo.tags_updated", "photo", photo_id)
    db.commit()
    return {"photo_id": photo_id, "person_ids": list(people)}


@router.get("/{family_id}/photos/{photo_id}/content")
def get_photo_content(
    family_id: UUID,
    photo_id: UUID,
    variant: str = Query(default="original", pattern="^(original|thumbnail)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    _member(db, family_id, user)
    photo = db.scalar(select(Photo).where(Photo.id == photo_id, Photo.family_id == family_id))
    if photo is None or photo.memory_id is None:
        raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
    _visible_memory(db, family_id, photo.memory_id, user)
    for person_id in db.scalars(select(PhotoPersonTag.person_id).where(
        PhotoPersonTag.photo_id == photo_id
    )).all():
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        _require_minor_scope(db, family_id, person, user, "view_profile")
    key = photo.thumbnail_object_key if variant == "thumbnail" else photo.object_key
    if not key:
        raise HTTPException(status_code=404, detail="Зургийн хувилбар олдсонгүй.")
    try:
        data = storage.get(key)
    except Exception as error:
        logger.warning("Photo read failed", extra={"error_type": type(error).__name__})
        raise HTTPException(status_code=503, detail="Зураг ачаалж чадсангүй.") from error
    return Response(
        content=data, media_type="image/jpeg" if variant == "thumbnail" else photo.mime_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/{family_id}/photos/{photo_id}", status_code=204)
def delete_photo(
    family_id: UUID,
    photo_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    member, _ = _member(db, family_id, user)
    photo = db.scalar(select(Photo).where(Photo.id == photo_id, Photo.family_id == family_id))
    if photo is None or photo.memory_id is None:
        raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
    memory = _visible_memory(db, family_id, photo.memory_id, user)
    if not _can_edit_memory(memory, member, user):
        raise HTTPException(status_code=403, detail="Зураг устгах эрхгүй.")
    _delete_objects(storage, [photo.thumbnail_object_key or "", photo.object_key])
    _audit(db, user, family_id, "photo.deleted", "photo", photo.id)
    db.delete(photo)
    db.commit()
    return Response(status_code=204)

"""Paginated memory/photo APIs with family, visibility, and guardian checks."""

from __future__ import annotations

import io
import logging
import re
import time
import warnings
from datetime import UTC, date, datetime, timedelta
from pathlib import PurePath
from urllib.parse import unquote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import _consume_otp_rate, _normalized_ip, get_current_user
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
from app.privacy import active_guardian_scopes, is_minor
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


class PhotoStorageFailure(HTTPException):
    def __init__(self, *, retryable: bool, error_code: str):
        self.retryable = retryable
        self.error_code = error_code
        super().__init__(status_code=503, detail="Зургийг хадгалах сангаас боловсруулах боломжгүй байна.")


class PhotoTagsInput(BaseModel):
    person_ids: list[UUID] = Field(max_length=100)


class PhotoResponse(BaseModel):
    id: UUID
    title: str | None
    created_at: datetime
    thumbnail_url: str
    content_url: str
    person_ids: list[UUID] = Field(default_factory=list)


class PhotoPageResponse(BaseModel):
    items: list[PhotoResponse]
    page: int
    page_size: int


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
        "created_at": photo.created_at,
        "thumbnail_url": f"/families/{photo.family_id}/photos/{photo.id}/content?variant=thumbnail",
        "content_url": f"/families/{photo.family_id}/photos/{photo.id}/content",
        "person_ids": person_ids or [],
    }


def _image_payload(filename: str, content_type: str, data: bytes) -> tuple[str, int, int, bytes]:
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
                declared_type = content_type.split(";", 1)[0].strip().lower()
                if declared_type != mime_type:
                    raise HTTPException(status_code=415, detail="Зургийн MIME төрөл агуулгатай тохирохгүй байна.")
                if suffix not in extensions:
                    raise HTTPException(status_code=415, detail="Файлын өргөтгөл зурагтай тохирохгүй байна.")
                width, height = image.size
                if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
                    raise HTTPException(status_code=413, detail="Зургийн пикселийн хэмжээ хэт том байна.")
                image = ImageOps.exif_transpose(image)
                image.info.clear()
                image.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)
                image = image.convert("RGB")
                image.info.clear()
                thumbnail = io.BytesIO()
                image.save(thumbnail, format="JPEG", quality=82, optimize=True, exif=b"")
                return mime_type, width, height, thumbnail.getvalue()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as error:
        raise HTTPException(status_code=415, detail="Зургийн файл гэмтсэн эсвэл дэмжигдэхгүй байна.") from error


def _delete_objects(storage: ObjectStorage, keys: list[str]) -> None:
    started = time.perf_counter()
    for key in keys:
        if not key:
            continue
        try:
            storage.delete(key)
        except Exception as error:
            metadata = getattr(error, "response", {})
            status_code = metadata.get("ResponseMetadata", {}).get("HTTPStatusCode")
            retryable = status_code is None or status_code == 429 or status_code >= 500
            error_code = "STORAGE_UNAVAILABLE" if retryable else "STORAGE_REJECTED"
            logger.warning(
                "Object storage deletion failed",
                extra={"event": "storage_operation_failed", "operation": "delete",
                       "error_code": error_code, "error_type": type(error).__name__,
                       "provider": get_settings().storage_provider},
            )
            raise PhotoStorageFailure(retryable=retryable, error_code=error_code) from error
    logger.info(
        "Photo objects deleted",
        extra={"event": "storage_operation_completed", "operation": "delete",
               "storage_duration_ms": round((time.perf_counter() - started) * 1000, 2),
               "provider": get_settings().storage_provider},
    )


def _expected_object_keys(photo: Photo) -> tuple[str, str]:
    if photo.memory_id is None:
        raise HTTPException(status_code=503, detail="Зургийн хадгалалтын мэдээллийг шалгаж чадсангүй.")
    prefix = f"families/{photo.family_id}/memories/{photo.memory_id}/photos/{photo.id}"
    expected = (f"{prefix}/original", f"{prefix}/thumbnail.jpg")
    if photo.object_key != expected[0] or photo.thumbnail_object_key != expected[1]:
        logger.warning("Photo object key rejected", extra={"photo_id": str(photo.id)})
        raise HTTPException(status_code=503, detail="Зургийн хадгалалтын мэдээллийг шалгаж чадсангүй.")
    return expected


def _tagged_photo_visibility(
    db: Session, family_id: UUID, user: User, photos: list[Photo]
) -> set[UUID]:
    """Return photos whose every tag is visible in this family and guardian context."""
    photo_ids = [photo.id for photo in photos]
    if not photo_ids:
        return set()
    rows = db.execute(
        select(
            PhotoPersonTag.photo_id,
            Person.id,
            Person.birth_date,
            Person.visibility,
            Person.created_by,
            FamilyPerson.person_id,
        )
        .join(Person, Person.id == PhotoPersonTag.person_id)
        .outerjoin(
            FamilyPerson,
            (FamilyPerson.person_id == Person.id) & (FamilyPerson.family_id == family_id),
        )
        .where(PhotoPersonTag.photo_id.in_(photo_ids))
    ).all()
    linked_ids = set(db.scalars(
        select(UserPersonLink.person_id).where(UserPersonLink.user_id == user.id)
    ).all())
    person_ids = list({row[1] for row in rows if row[5] is not None})
    scopes = {}
    if person_ids:
        from app.privacy import active_guardian_scopes

        scopes = active_guardian_scopes(db, user.id, family_id, person_ids)
    allowed = {photo.id for photo in photos}
    for photo_id, person_id, birth_date, visibility, created_by, family_person_id in rows:
        private_hidden = visibility == "private" and created_by != user.id and person_id not in linked_ids
        guardian_hidden = is_minor(birth_date) is True and "view_profile" not in scopes.get(person_id, set())
        if family_person_id is None or private_hidden or guardian_hidden:
            allowed.discard(photo_id)
    return allowed


def _record_denied_access(
    db: Session, user: User, family_id: UUID, target_id: UUID, action: str
) -> None:
    try:
        from app.models import Family

        if db.get(Family, family_id) is None:
            return
        _audit(db, user, family_id, action, "photo", target_id)
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        logger.warning("Photo security audit write failed", extra={"error_type": type(error).__name__})


def _retry_pending_cleanup(
    db: Session, storage: ObjectStorage, family_id: UUID, user: User, limit: int = 20
) -> None:
    max_attempts = get_settings().photo_cleanup_max_attempts
    cutoff = datetime.now(UTC) - timedelta(minutes=15)
    pending_ids = list(db.scalars(
        select(Photo.id).where(
            Photo.family_id == family_id,
            or_(
                Photo.storage_status == "deletion_pending",
                (Photo.storage_status == "uploading") & (Photo.created_at < cutoff),
            ),
            Photo.cleanup_attempts < max_attempts,
        ).order_by(Photo.created_at).limit(limit)
    ).all())
    for photo_id in pending_ids:
        photo = db.get(Photo, photo_id)
        if photo is None:
            continue
        photo.storage_status = "deletion_pending"
        try:
            original_key, thumbnail_key = _expected_object_keys(photo)
        except HTTPException:
            photo.cleanup_attempts = max_attempts
            db.commit()
            logger.error(
                "Photo cleanup stopped for invalid storage metadata",
                extra={"event": "photo_cleanup_exhausted", "error_code": "INVALID_STORAGE_KEY",
                       "photo_id": str(photo.id), "memory_id": str(photo.memory_id),
                       "family_id": str(family_id), "attempt": max_attempts,
                       "max_attempts": max_attempts},
            )
            continue
        photo.cleanup_attempts += 1
        photo_id_for_log = str(photo.id)
        memory_id_for_log = str(photo.memory_id) if photo.memory_id else None
        attempt_number = photo.cleanup_attempts
        try:
            db.commit()
            _delete_objects(storage, [thumbnail_key, original_key])
            db.delete(photo)
            _audit(db, user, family_id, "photo.cleanup_retried", "photo", photo_id)
            db.commit()
        except HTTPException as error:
            retryable = getattr(error, "retryable", True)
            db.rollback()
            if error.status_code != 503:
                raise
            if not retryable:
                exhausted = db.get(Photo, photo_id)
                if exhausted is not None:
                    exhausted.cleanup_attempts = max_attempts
                    db.commit()
            logger.warning(
                "Photo cleanup attempt failed",
                extra={"event": "photo_cleanup_failed", "operation": "delete",
                       "error_code": getattr(error, "error_code", "STORAGE_UNAVAILABLE"),
                       "photo_id": photo_id_for_log,
                       "memory_id": memory_id_for_log, "family_id": str(family_id),
                       "attempt": attempt_number, "max_attempts": max_attempts},
            )
        except SQLAlchemyError as error:
            db.rollback()
            logger.warning(
                "Photo cleanup retry database failure",
                extra={"event": "photo_cleanup_state_failed", "error_code": "DATABASE_UNAVAILABLE",
                       "error_type": type(error).__name__, "photo_id": photo_id_for_log,
                       "family_id": str(family_id)},
            )


def _require_photo_scope(
    db: Session, family_id: UUID, user: User, photo: Photo, scope: str
) -> None:
    tag_ids = list(db.scalars(
        select(PhotoPersonTag.person_id).where(PhotoPersonTag.photo_id == photo.id)
    ).all())
    _require_person_ids_scope(db, family_id, user, tag_ids, scope)


def _require_person_ids_scope(
    db: Session, family_id: UUID, user: User, person_ids: list[UUID], scope: str
) -> None:
    for person_id in set(person_ids):
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        _require_minor_scope(db, family_id, person, user, scope)


def _memory_person_ids(db: Session, memory_id: UUID) -> list[UUID]:
    return list(db.scalars(
        select(MemoryPersonTag.person_id).where(MemoryPersonTag.memory_id == memory_id)
    ).all())


def _memory_media_visible(db: Session, family_id: UUID, user: User, memory: Memory) -> bool:
    try:
        _require_person_ids_scope(
            db, family_id, user, _memory_person_ids(db, memory.id), "view_profile"
        )
    except HTTPException as error:
        if error.status_code in {403, 404}:
            return False
        raise
    return True


def delete_memory_photos(
    db: Session, storage: ObjectStorage, family_id: UUID, memory_id: UUID, user: User
) -> None:
    """Mark photos hidden before idempotent object deletion; callers retry on 503."""
    photos = db.scalars(select(Photo).where(
        Photo.family_id == family_id, Photo.memory_id == memory_id
    )).all()
    if not photos:
        return
    memory_person_ids = _memory_person_ids(db, memory_id)
    _require_person_ids_scope(db, family_id, user, memory_person_ids, "manage_media")
    for photo in photos:
        _expected_object_keys(photo)
        _require_photo_scope(db, family_id, user, photo, "manage_media")
        photo.storage_status = "deletion_pending"
        _audit(db, user, family_id, "photo.delete_requested", "photo", photo.id)
    db.commit()
    for photo in photos:
        _delete_objects(storage, list(_expected_object_keys(photo)))
        db.delete(photo)
        _audit(db, user, family_id, "photo.deleted", "photo", photo.id)
        db.commit()


def _memory_page_payload(
    memory: Memory, tag_rows: list[tuple[UUID, str | None, str | None, str | None]]
) -> dict:
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



class MemoryPersonOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    middle_name: str | None


class MemoryListItem(BaseModel):
    id: UUID
    title: str
    description: str | None
    memory_date: date | None
    visibility: str
    author_id: UUID
    author_name: str
    related_people_count: int
    created_at: datetime
    updated_at: datetime


class MemoryPageResponse(BaseModel):
    items: list[MemoryListItem]
    page: int
    page_size: int
    total: int
    has_next: bool


class MemoryOut(MemoryListItem):
    related_people: list[MemoryPersonOut] = Field(default_factory=list)
    photos: list[PhotoResponse] = Field(default_factory=list)


class MemoryInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=100000)
    memory_date: datetime.date | None = None
    visibility: str = Field(default="family", pattern="^(private|family|public)$")
    person_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @classmethod
    def validate_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Дурсамжийн гарчиг хоосон байж болохгүй.")
        return value


class MemoryPatch(MemoryInput):
    pass


def _validate_memory_input(body: MemoryInput) -> tuple[str, list[UUID]]:
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Дурсамжийн гарчиг хоосон байж болохгүй.")
    person_ids = list(dict.fromkeys(body.person_ids))
    if len(person_ids) != len(body.person_ids):
        raise HTTPException(status_code=422, detail="Ижил хүнийг давхар сонгох боломжгүй.")
    return title, person_ids


def _memory_author_name(db: Session, author_id: UUID) -> str:
    user = db.get(User, author_id)
    return user.display_name if user else "Тодорхойгүй"


def _memory_people(
    db: Session, family_id: UUID, memory_id: UUID, user: User
) -> list[MemoryPersonOut]:
    rows = db.execute(
        select(Person)
        .join(MemoryPersonTag, MemoryPersonTag.person_id == Person.id)
        .where(
            MemoryPersonTag.memory_id == memory_id,
            MemoryPersonTag.person_id.in_(_visible_people_query(user, family_id)),
        )
        .order_by(Person.last_name, Person.first_name, Person.id)
    ).scalars().all()
    return [MemoryPersonOut.model_validate(person) for person in rows]


def _memory_list_item(
    db: Session, memory: Memory, related_people_count: int
) -> MemoryListItem:
    return MemoryListItem(
        id=memory.id,
        title=memory.title,
        description=memory.description,
        memory_date=memory.memory_date,
        visibility=memory.visibility,
        author_id=memory.created_by,
        author_name=_memory_author_name(db, memory.created_by),
        related_people_count=related_people_count,
        created_at=memory.created_at,
        updated_at=memory.updated_at,
    )


def _restricted_memory_person_ids(
    db: Session, family_id: UUID, user: User
) -> set[UUID]:
    rows = db.execute(
        select(Person.id, Person.birth_date)
        .join(FamilyPerson, FamilyPerson.person_id == Person.id)
        .where(FamilyPerson.family_id == family_id)
    ).all()
    minor_ids = [person_id for person_id, birth_date in rows if is_minor(birth_date) is True]
    if not minor_ids:
        return set()
    scopes = active_guardian_scopes(db, user.id, family_id, minor_ids)
    return {
        person_id for person_id in minor_ids
        if "manage_memories" not in scopes.get(person_id, set())
    }


def _memory_query(
    db: Session, family_id: UUID, user: User, q: str
):
    from sqlalchemy import exists, not_
    restricted = _restricted_memory_person_ids(db, family_id, user)
    conditions = [
        Memory.family_id == family_id,
        or_(Memory.visibility != "private", Memory.created_by == user.id),
    ]
    if restricted:
        conditions.append(
            not_(
                exists(
                    select(MemoryPersonTag.id).where(
                        MemoryPersonTag.memory_id == Memory.id,
                        MemoryPersonTag.person_id.in_(restricted),
                    )
                )
            )
        )
    if q.strip():
        term = "%" + q.strip().lower() + "%"
        conditions.append(
            or_(
                func.lower(Memory.title).like(term),
                func.lower(func.coalesce(Memory.description, "")).like(term),
            )
        )
    return select(Memory).where(*conditions)


def _memory_person_count_query(db: Session, memory_ids: list[UUID]):
    if not memory_ids:
        return {}
    rows = db.execute(
        select(MemoryPersonTag.memory_id, func.count(MemoryPersonTag.id))
        .where(MemoryPersonTag.memory_id.in_(memory_ids))
        .group_by(MemoryPersonTag.memory_id)
    ).all()
    return {memory_id: count for memory_id, count in rows}


def _set_memory_people(
    db: Session, family_id: UUID, user: User, memory_id: UUID, person_ids: list[UUID]
) -> None:
    _assert_memory_minor_scopes(db, family_id, user, person_ids)
    db.execute(delete(MemoryPersonTag).where(MemoryPersonTag.memory_id == memory_id))
    db.add_all(
        MemoryPersonTag(memory_id=memory_id, person_id=person_id)
        for person_id in person_ids
    )


@router.post("/{family_id}/memories", response_model=MemoryOut, status_code=201)
def create_memory(
    family_id: UUID,
    body: MemoryInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user, {"owner", "editor"})
    title, person_ids = _validate_memory_input(body)
    for person_id in person_ids:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
    _assert_memory_minor_scopes(db, family_id, user, person_ids)
    memory = Memory(
        family_id=family_id,
        title=title,
        description=body.description,
        memory_date=body.memory_date,
        visibility=body.visibility,
        created_by=user.id,
    )
    db.add(memory)
    db.flush()
    _set_memory_people(db, family_id, user, memory.id, person_ids)
    _audit(db, user, family_id, "memory.created", "memory", memory.id)
    db.commit()
    db.refresh(memory)
    return _memory_detail(db, family_id, memory, user)


@router.get("/{family_id}/memories/{memory_id}", response_model=MemoryOut)
def get_memory(
    family_id: UUID,
    memory_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    memory = _visible_memory(db, family_id, memory_id, user)
    return _memory_detail(db, family_id, memory, user)


@router.put("/{family_id}/memories/{memory_id}", response_model=MemoryOut)
def update_memory(
    family_id: UUID,
    memory_id: UUID,
    body: MemoryPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member, _ = _member(db, family_id, user)
    memory = _visible_memory(db, family_id, memory_id, user)
    if not _can_edit_memory(memory, member, user):
        raise HTTPException(status_code=403, detail="Энэ дурсамжийг засах эрхгүй.")
    title, person_ids = _validate_memory_input(body)
    for person_id in person_ids:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
    _assert_memory_minor_scopes(db, family_id, user, person_ids)
    memory.title = title
    memory.description = body.description
    memory.memory_date = body.memory_date
    memory.visibility = body.visibility
    _set_memory_people(db, family_id, user, memory.id, person_ids)
    _audit(db, user, family_id, "memory.updated", "memory", memory.id)
    db.commit()
    db.refresh(memory)
    return _memory_detail(db, family_id, memory, user)


@router.delete("/{family_id}/memories/{memory_id}", status_code=204)
def delete_memory(
    family_id: UUID,
    memory_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    member, _ = _member(db, family_id, user)
    memory = _visible_memory(db, family_id, memory_id, user)
    if not _can_edit_memory(memory, member, user):
        raise HTTPException(status_code=403, detail="Энэ дурсамжийг устгах эрхгүй.")
    _assert_memory_minor_scopes(db, family_id, user, _memory_person_ids(db, memory.id))
    delete_memory_photos(db, storage, family_id, memory.id, user)
    db.delete(memory)
    _audit(db, user, family_id, "memory.deleted", "memory", memory.id)
    db.commit()
    return Response(status_code=204)


@router.get("/{family_id}/persons/{person_id}/memories", response_model=MemoryPageResponse)
def list_person_memories(
    family_id: UUID,
    person_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=5, ge=1, le=25),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    _require_minor_scope(db, family_id, person, user, "view_profile")
    memory_ids = select(MemoryPersonTag.memory_id).where(
        MemoryPersonTag.person_id == person_id
    )
    base = _memory_query(db, family_id, user, "").where(Memory.id.in_(memory_ids))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    memories = db.scalars(
        base.order_by(Memory.memory_date.desc().nullslast(), Memory.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    counts = _memory_person_count_query(db, [memory.id for memory in memories])
    return {
        "items": [
            _memory_list_item(db, memory, counts.get(memory.id, 0))
            for memory in memories
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_next": page * page_size < total,
    }


def _memory_detail(
    db: Session, family_id: UUID, memory: Memory, user: User
) -> MemoryOut:
    people = _memory_people(db, family_id, memory.id, user)
    photos = db.scalars(
        select(Photo).where(
            Photo.family_id == family_id,
            Photo.memory_id == memory.id,
            Photo.storage_status == "ready",
        ).order_by(Photo.created_at.desc(), Photo.id.desc()).limit(50)
    ).all()
    visible_photo_ids = _tagged_photo_visibility(db, family_id, user, photos)
    photo_ids = [photo.id for photo in photos if photo.id in visible_photo_ids]
    tags_by_photo: dict[UUID, list[UUID]] = {photo_id: [] for photo_id in photo_ids}
    if photo_ids:
        rows = db.execute(
            select(PhotoPersonTag.photo_id, PhotoPersonTag.person_id).where(
                PhotoPersonTag.photo_id.in_(photo_ids),
                PhotoPersonTag.person_id.in_(_visible_people_query(user, family_id)),
            )
        ).all()
        for photo_id, person_id in rows:
            tags_by_photo[photo_id].append(person_id)
    photos = [
        _photo_payload(photo, tags_by_photo[photo.id])
        for photo in photos if photo.id in visible_photo_ids
    ]
    return MemoryOut(
        **_memory_list_item(db, memory, len(people)).model_dump(),
        related_people=people,
        photos=photos,
    )

@router.get("/{family_id}/memories", response_model=MemoryPageResponse)
def list_memories(
    family_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    q: str = Query(default="", max_length=120),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _member(db, family_id, user)
    base = _memory_query(db, family_id, user, q)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    memories = db.scalars(
        base.order_by(Memory.memory_date.desc().nullslast(), Memory.created_at.desc(), Memory.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    counts = _memory_person_count_query(db, [memory.id for memory in memories])
    return {
        "items": [_memory_list_item(db, memory, counts.get(memory.id, 0)) for memory in memories],
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_next": page * page_size < total,
    }

@router.post("/{family_id}/memories/{memory_id}/photos", status_code=201, response_model=PhotoResponse)

async def upload_photo(
    family_id: UUID,
    memory_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    member, _ = _member(db, family_id, user)
    _retry_pending_cleanup(db, storage, family_id, user)
    memory = _visible_memory(db, family_id, memory_id, user)
    if not _can_edit_memory(memory, member, user):
        raise HTTPException(status_code=403, detail="Энэ дурсамжид зураг нэмэх эрхгүй.")
    _require_person_ids_scope(
        db, family_id, user, _memory_person_ids(db, memory.id), "manage_media"
    )
    settings = get_settings()
    remote_ip = _normalized_ip(request)
    limits = (
        ("photo_upload_user", str(user.id), settings.photo_upload_user_per_minute),
        ("photo_upload_family", str(family_id), settings.photo_upload_family_per_minute),
        ("photo_upload_ip", remote_ip, settings.photo_upload_ip_per_minute),
    )
    if any(not _consume_otp_rate(db, kind, value, limit) for kind, value, limit in limits):
        raise HTTPException(status_code=429, detail="Зургийг хэт олон удаа оруулах гэж байна. Түр хүлээнэ үү.")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > settings.photo_max_upload_bytes:
                raise HTTPException(status_code=413, detail="Зургийн файл тохируулсан хэмжээнээс хэтэрлээ.")
        except ValueError:
            raise HTTPException(status_code=400, detail="Хүсэлтийн хэмжээний мэдээлэл буруу байна.") from None
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > settings.photo_max_upload_bytes:
            raise HTTPException(status_code=413, detail="Зургийн файл тохируулсан хэмжээнээс хэтэрлээ.")
        data.extend(chunk)
    if not data:
        raise HTTPException(status_code=422, detail="Зургийн файл хоосон байна.")
    filename = unquote(request.headers.get("x-file-name", "photo"))
    mime_type, width, height, thumbnail = _image_payload(
        filename, request.headers.get("content-type", ""), bytes(data)
    )
    safe_filename = re.sub(
        r"[^\w.\- ]", "_", PurePath(filename.replace("\\", "/")).name
    )[:255] or "photo"
    photo_id = uuid4()
    object_prefix = f"families/{family_id}/memories/{memory_id}/photos/{photo_id}"
    original_key, thumbnail_key = f"{object_prefix}/original", f"{object_prefix}/thumbnail.jpg"
    photo = Photo(
        id=photo_id, family_id=family_id, memory_id=memory_id, object_key=original_key,
        thumbnail_object_key=thumbnail_key, original_filename=safe_filename,
        mime_type=mime_type, file_size=len(data), width=width, height=height,
        uploaded_by=user.id, storage_status="uploading",
    )
    db.add(photo)
    try:
        db.flush()
        _audit(db, user, family_id, "photo.upload_started", "photo", photo.id)
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        logger.warning(
            "Photo upload metadata initialization failed",
            extra={"event": "photo_upload_metadata_failed", "error_code": "DATABASE_UNAVAILABLE",
                   "error_type": type(error).__name__, "memory_id": str(memory_id),
                   "family_id": str(family_id)},
        )
        raise HTTPException(status_code=503, detail="Зургийг бүртгэж чадсангүй.") from error
    storage_started = time.perf_counter()
    try:
        storage.put(original_key, bytes(data), mime_type)
        storage.put(thumbnail_key, thumbnail, "image/jpeg")
        storage_duration_ms = round((time.perf_counter() - storage_started) * 1000, 2)
        photo = db.get(Photo, photo_id)
        if photo is None:
            raise SQLAlchemyError("Photo upload record disappeared")
        photo.storage_status = "ready"
        _audit(db, user, family_id, "photo.created", "photo", photo.id)
        db.commit()
        logger.info(
            "Photo objects stored",
            extra={"event": "photo_upload_completed", "operation": "upload",
                   "storage_duration_ms": storage_duration_ms, "photo_id": str(photo_id),
                   "memory_id": str(memory_id), "family_id": str(family_id),
                   "provider": settings.storage_provider},
        )
    except Exception as error:
        db.rollback()
        photo = db.get(Photo, photo_id)
        if photo is not None:
            photo.storage_status = "deletion_pending"
            photo.cleanup_attempts += 1
            _audit(db, user, family_id, "photo.upload_failed", "photo", photo.id)
            try:
                db.commit()
            except SQLAlchemyError as state_error:
                db.rollback()
                logger.warning(
                    "Photo failure state update failed",
                    extra={"event": "photo_cleanup_state_failed", "error_code": "DATABASE_UNAVAILABLE",
                           "error_type": type(state_error).__name__, "photo_id": str(photo_id),
                           "family_id": str(family_id)},
                )
        try:
            _delete_objects(storage, [thumbnail_key, original_key])
            current = db.get(Photo, photo_id)
            if current is not None:
                db.delete(current)
                db.commit()
        except (HTTPException, SQLAlchemyError) as cleanup_error:
            db.rollback()
            if isinstance(cleanup_error, PhotoStorageFailure) and not cleanup_error.retryable:
                failed = db.get(Photo, photo_id)
                if failed is not None:
                    failed.cleanup_attempts = settings.photo_cleanup_max_attempts
                    db.commit()
            logger.warning(
                "Photo upload cleanup deferred",
                extra={"event": "photo_cleanup_failed", "operation": "delete",
                       "error_code": getattr(cleanup_error, "error_code", "STORAGE_UNAVAILABLE"),
                       "error_type": type(cleanup_error).__name__,
                       "photo_id": str(photo_id), "memory_id": str(memory_id),
                       "family_id": str(family_id), "provider": settings.storage_provider},
            )
        logger.warning(
            "Photo upload failed",
            extra={"event": "photo_upload_failed", "error_code": "STORAGE_UNAVAILABLE",
                   "error_type": type(error).__name__, "photo_id": str(photo_id),
                   "memory_id": str(memory_id), "family_id": str(family_id),
                   "provider": settings.storage_provider},
        )
        raise HTTPException(status_code=503, detail="Зургийг хадгалж чадсангүй.") from error
    return _photo_payload(photo)


@router.get("/{family_id}/memories/{memory_id}/photos", response_model=list[PhotoResponse])
def list_memory_photos(
    family_id: UUID,
    memory_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    _member(db, family_id, user)
    _retry_pending_cleanup(db, storage, family_id, user)
    memory = _visible_memory(db, family_id, memory_id, user)
    if not _memory_media_visible(db, family_id, user, memory):
        raise HTTPException(status_code=404, detail="Дурсамж олдсонгүй.")
    photos = db.scalars(
        select(Photo).where(
            Photo.family_id == family_id, Photo.memory_id == memory_id,
            Photo.storage_status == "ready",
        )
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
    visible_photo_ids = _tagged_photo_visibility(db, family_id, user, photos)
    return [
        _photo_payload(photo, tags_by_photo[photo.id])
        for photo in photos if photo.id in visible_photo_ids
    ]


@router.get("/{family_id}/persons/{person_id}/photos", response_model=PhotoPageResponse)
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
        Photo.storage_status == "ready",
        Photo.memory_id.in_(visible_memory_ids),
        Photo.id.in_(select(PhotoPersonTag.photo_id).where(
            PhotoPersonTag.person_id == person_id
        )),
    )
    memory_rows = db.scalars(
        select(Memory).where(Memory.id.in_(visible_memory_ids))
    ).all()
    visible_memory_ids = {
        memory.id for memory in memory_rows
        if _memory_media_visible(db, family_id, user, memory)
    }
    conditions = (*conditions, Photo.memory_id.in_(visible_memory_ids))
    photos = db.scalars(
        select(Photo).where(*conditions).order_by(Photo.created_at.desc(), Photo.id.desc())
        .offset((page - 1) * page_size).limit(page_size + 1)
    ).all()
    photos = photos[:page_size]
    visible_photo_ids = _tagged_photo_visibility(db, family_id, user, photos)
    photos = [photo for photo in photos if photo.id in visible_photo_ids]
    return {
        "items": [_photo_payload(photo, [person_id]) for photo in photos],
        "page": page, "page_size": page_size,
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
    if photo is None or photo.memory_id is None or photo.storage_status != "ready":
        raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
    memory = _visible_memory(db, family_id, photo.memory_id, user)
    if not _can_edit_memory(memory, member, user):
        raise HTTPException(status_code=403, detail="Зурагт хүн tag хийх эрхгүй.")
    _require_person_ids_scope(
        db, family_id, user, _memory_person_ids(db, memory.id), "manage_media"
    )
    people = set(body.person_ids)
    for person_id in people:
        person = _person_in_family(db, family_id, person_id)
        _assert_person_visible(db, person, user)
        _require_minor_scope(db, family_id, person, user, "manage_media")
    previous = set(db.scalars(
        select(PhotoPersonTag.person_id).where(PhotoPersonTag.photo_id == photo_id)
    ).all())
    if previous == people:
        return {"photo_id": photo_id, "person_ids": list(people)}
    db.execute(delete(PhotoPersonTag).where(PhotoPersonTag.photo_id == photo_id))
    db.add_all(PhotoPersonTag(photo_id=photo_id, person_id=person_id) for person_id in people)
    action = "photo.tags_removed" if previous - people and not people - previous else (
        "photo.tagged" if people - previous and not previous - people else "photo.tags_updated"
    )
    _audit(db, user, family_id, action, "photo", photo_id)
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
    try:
        _member(db, family_id, user)
    except HTTPException:
        _record_denied_access(db, user, family_id, photo_id, "photo.access_denied")
        raise
    photo = db.scalar(select(Photo).where(Photo.id == photo_id, Photo.family_id == family_id))
    if photo is None or photo.memory_id is None or photo.storage_status != "ready":
        _record_denied_access(db, user, family_id, photo_id, "photo.access_denied")
        raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
    try:
        memory = _visible_memory(db, family_id, photo.memory_id, user)
        if not _memory_media_visible(db, family_id, user, memory):
            raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
        _require_photo_scope(db, family_id, user, photo, "view_profile")
        if photo_id not in _tagged_photo_visibility(db, family_id, user, [photo]):
            raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
    except HTTPException as error:
        if error.status_code in {403, 404}:
            _record_denied_access(db, user, family_id, photo_id, "photo.access_denied")
            raise HTTPException(status_code=404, detail="Зураг олдсонгүй.") from error
        raise
    try:
        original_key, thumbnail_key = _expected_object_keys(photo)
    except HTTPException:
        _record_denied_access(db, user, family_id, photo_id, "photo.storage_key_rejected")
        raise
    if photo.mime_type not in {"image/jpeg", "image/png", "image/webp"}:
        _record_denied_access(db, user, family_id, photo_id, "photo.mime_rejected")
        raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
    key = thumbnail_key if variant == "thumbnail" else original_key
    if not key:
        raise HTTPException(status_code=404, detail="Зургийн хувилбар олдсонгүй.")
    storage_started = time.perf_counter()
    try:
        data = storage.get(key)
    except Exception as error:
        logger.warning(
            "Photo read failed",
            extra={"event": "storage_operation_failed", "operation": "read",
                   "error_code": "STORAGE_UNAVAILABLE", "error_type": type(error).__name__,
                   "photo_id": str(photo_id), "memory_id": str(photo.memory_id),
                   "family_id": str(family_id), "provider": get_settings().storage_provider,
                   "storage_duration_ms": round((time.perf_counter() - storage_started) * 1000, 2)},
        )
        raise HTTPException(status_code=503, detail="Зураг ачаалж чадсангүй.") from error
    logger.info(
        "Photo object retrieved",
        extra={"event": "photo_read_completed", "operation": "read",
               "photo_id": str(photo_id), "memory_id": str(photo.memory_id),
               "family_id": str(family_id), "provider": get_settings().storage_provider,
               "storage_duration_ms": round((time.perf_counter() - storage_started) * 1000, 2)},
    )
    return Response(
        content=data, media_type="image/jpeg" if variant == "thumbnail" else photo.mime_type,
        headers={
            "Cache-Control": "private, no-store",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cross-Origin-Resource-Policy": "same-site",
        },
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
    _require_person_ids_scope(
        db, family_id, user, _memory_person_ids(db, memory.id), "manage_media"
    )
    _require_photo_scope(db, family_id, user, photo, "manage_media")
    max_attempts = get_settings().photo_cleanup_max_attempts
    try:
        original_key, thumbnail_key = _expected_object_keys(photo)
    except HTTPException:
        photo.storage_status = "deletion_pending"
        photo.cleanup_attempts = max_attempts
        db.commit()
        logger.error(
            "Photo cleanup stopped for invalid storage metadata",
            extra={"event": "photo_cleanup_exhausted", "error_code": "INVALID_STORAGE_KEY",
                   "photo_id": str(photo.id), "memory_id": str(photo.memory_id),
                   "family_id": str(family_id), "attempt": max_attempts,
                   "max_attempts": max_attempts},
        )
        raise
    if photo.cleanup_attempts >= max_attempts:
        logger.error(
            "Photo cleanup retry limit reached",
            extra={"event": "photo_cleanup_exhausted", "error_code": "RETRY_LIMIT_REACHED",
                   "photo_id": str(photo.id), "memory_id": str(photo.memory_id),
                   "family_id": str(family_id), "attempt": photo.cleanup_attempts,
                   "max_attempts": max_attempts},
        )
        raise HTTPException(status_code=503, detail="Зургийг устгах оролдлогын хязгаарт хүрлээ.")
    if photo.storage_status != "deletion_pending":
        photo.storage_status = "deletion_pending"
        _audit(db, user, family_id, "photo.delete_requested", "photo", photo.id)
    photo.cleanup_attempts += 1
    db.commit()
    try:
        _delete_objects(storage, [thumbnail_key, original_key])
    except HTTPException as error:
        if not getattr(error, "retryable", True):
            failed = db.get(Photo, photo_id)
            if failed is not None:
                failed.cleanup_attempts = max_attempts
                db.commit()
        logger.warning(
            "Photo deletion deferred",
            extra={"event": "photo_cleanup_failed", "operation": "delete",
                   "error_code": getattr(error, "error_code", "STORAGE_UNAVAILABLE"),
                   "photo_id": str(photo.id), "memory_id": str(photo.memory_id),
                   "family_id": str(family_id), "attempt": photo.cleanup_attempts,
                   "max_attempts": max_attempts},
        )
        raise
    _audit(db, user, family_id, "photo.deleted", "photo", photo.id)
    db.delete(photo)
    db.commit()
    return Response(status_code=204)

"""Private person portrait upload and delivery through the existing object store."""

from __future__ import annotations

import logging
import time
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import _consume_otp_rate, _normalized_ip, get_current_user
from app.config import get_settings
from app.db import get_db
from app.families import (
    _assert_person_visible,
    _audit,
    _can_edit_person_profile,
    _member,
    _person_in_family,
)
from app.memory_photos import _image_payload
from app.models import FamilyMember, Person, User
from app.privacy import require_minor_scope
from app.storage import ObjectStorage, get_storage

router = APIRouter(prefix="/families", tags=["person profile photos"])
logger = logging.getLogger("guulingiinhan.storage")


def _object_key(person_id: UUID, version: str) -> str:
    return f"profile-photos/{person_id}/{version}.jpg"


def _can_edit_photo(
    db: Session, family_id: UUID, member: FamilyMember, person: Person, user: User
) -> bool:
    return _can_edit_person_profile(db, family_id, person, user)


def _request_photo_edit(
    db: Session, family_id: UUID, member: FamilyMember, person: Person, user: User
) -> None:
    if not _can_edit_photo(db, family_id, member, person, user):
        raise HTTPException(status_code=403, detail="Энэ хүний зургийг өөрчлөх эрхгүй.")


async def _read_sanitized_profile_upload(
    request: Request, user: User, family_id: UUID, db: Session
) -> bytes:
    """Apply the shared portrait rate, size, format, and metadata-stripping rules."""
    settings = get_settings()
    ip = _normalized_ip(request)
    if any(
        not _consume_otp_rate(db, kind, value, limit)
        for kind, value, limit in (
            ("profile_photo_user", str(user.id), settings.photo_upload_user_per_minute),
            ("profile_photo_family", str(family_id), settings.photo_upload_family_per_minute),
            ("profile_photo_ip", ip, settings.photo_upload_ip_per_minute),
        )
    ):
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

    filename = request.headers.get("x-file-name", "profile-photo")
    _, _, _, sanitized_jpeg = _image_payload(filename, request.headers.get("content-type", ""), bytes(data))
    return sanitized_jpeg


def _store_profile_photo(
    db: Session,
    user: User,
    family_id: UUID,
    person: Person,
    storage: ObjectStorage,
    sanitized_jpeg: bytes,
    *,
    operation: str,
) -> str:
    version = str(uuid4())
    key = _object_key(person.id, version)
    old_key = person.profile_photo_key
    settings = get_settings()
    storage_started = time.perf_counter()
    try:
        storage.put(key, sanitized_jpeg, "image/jpeg")
        person.profile_photo_key = key
        person.profile_photo_url = None
        _audit(db, user, family_id, "person.profile_photo_uploaded", "person", person.id)
        db.commit()
    except Exception as error:
        db.rollback()
        try:
            storage.delete(key)
        except Exception as cleanup_error:  # noqa: BLE001 - cleanup is best effort after storage failure.
            logger.warning(
                "Failed profile photo cleanup deferred",
                extra={"event": "photo_cleanup_failed", "operation": f"{operation}_rollback",
                       "error_code": "STORAGE_UNAVAILABLE", "error_type": type(cleanup_error).__name__,
                       "family_id": str(family_id), "provider": settings.storage_provider},
            )
        logger.warning(
            "Profile photo upload failed",
            extra={"event": "photo_upload_failed", "operation": operation,
                   "error_code": "STORAGE_UNAVAILABLE", "error_type": type(error).__name__,
                   "family_id": str(family_id), "provider": settings.storage_provider},
        )
        raise HTTPException(status_code=503, detail="Профайл зургийг хадгалж чадсангүй.") from error

    if old_key and old_key != key:
        try:
            storage.delete(old_key)
        except Exception as error:  # noqa: BLE001 - do not fail a committed replacement.
            logger.warning(
                "Previous profile photo cleanup failed",
                extra={"event": "photo_cleanup_failed", "operation": f"{operation}_replace",
                       "error_code": "STORAGE_UNAVAILABLE", "error_type": type(error).__name__,
                       "family_id": str(family_id), "provider": settings.storage_provider},
            )
    logger.info(
        "Profile photo stored",
        extra={"event": "photo_upload_completed", "operation": operation,
               "storage_duration_ms": round((time.perf_counter() - storage_started) * 1000, 2),
               "family_id": str(family_id), "provider": settings.storage_provider},
    )
    return version


@router.post("/{family_id}/persons/{person_id}/profile-photo", status_code=201)
async def upload_profile_photo(
    family_id: UUID,
    person_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    member, _ = _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    _request_photo_edit(db, family_id, member, person, user)

    sanitized_jpeg = await _read_sanitized_profile_upload(request, user, family_id, db)
    version = _store_profile_photo(db, user, family_id, person, storage, sanitized_jpeg,
                                   operation="profile_upload")
    return {"profile_photo_url": f"/families/{family_id}/persons/{person.id}/profile-photo?v={version}"}


@router.get("/{family_id}/persons/{person_id}/profile-photo")
def get_profile_photo(
    family_id: UUID,
    person_id: UUID,
    version: str = Query(alias="v", min_length=36, max_length=36, pattern=r"^[0-9a-fA-F-]{36}$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    require_minor_scope(db, user.id, family_id, person, "view_profile")
    key = _object_key(person.id, version)
    if person.profile_photo_key != key:
        raise HTTPException(status_code=404, detail="Зураг олдсонгүй.")
    try:
        data = storage.get(key)
    except Exception as error:
        raise HTTPException(status_code=503, detail="Зургийг уншиж чадсангүй.") from error
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/{family_id}/persons/{person_id}/profile-photo", status_code=204)
def delete_profile_photo(
    family_id: UUID,
    person_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
):
    member, _ = _member(db, family_id, user)
    person = _person_in_family(db, family_id, person_id)
    _assert_person_visible(db, person, user)
    _request_photo_edit(db, family_id, member, person, user)
    old_key = person.profile_photo_key
    if old_key is None and person.profile_photo_url is None:
        return Response(status_code=204)
    person.profile_photo_key = None
    person.profile_photo_url = None
    _audit(db, user, family_id, "person.profile_photo_deleted", "person", person.id)
    try:
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        raise HTTPException(status_code=503, detail="Профайл зургийг шинэчилж чадсангүй.") from error
    if old_key:
        try:
            storage.delete(old_key)
        except Exception as error:  # noqa: BLE001 - private object has no public reference now.
            logger.warning(
                "Profile photo cleanup failed",
                extra={"event": "photo_cleanup_failed", "operation": "profile_delete",
                       "error_code": "STORAGE_UNAVAILABLE", "error_type": type(error).__name__,
                       "family_id": str(family_id), "provider": get_settings().storage_provider},
            )
    return Response(status_code=204)

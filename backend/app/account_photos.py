"""Private account portraits, independent of canonical Person portraits."""
import io
import json
import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin import AdminRole, require_super_admin
from app.auth import _audit_auth_event, _consume_otp_rate, _normalized_ip, get_current_user
from app.config import get_settings
from app.db import get_db
from app.memory_photos import _image_payload
from app.models import User
from app.storage import ObjectStorage, get_storage

router = APIRouter(tags=["private account portraits"])
logger = logging.getLogger("guulingiinhan.storage")


def _owned_key(user: User, key: str) -> str:
    prefix = f"account-photos/{user.id}/"
    if not key.startswith(prefix) or not key.endswith(".jpg"):
        raise HTTPException(503, "Зургийн хадгалалтын мэдээлэл буруу байна.")
    try:
        UUID(key.removeprefix(prefix).removesuffix(".jpg"))
    except ValueError:
        raise HTTPException(503, "Зургийн хадгалалтын мэдээлэл буруу байна.") from None
    return key


def _cleanup(db: Session, target: User, storage: ObjectStorage) -> None:
    locked = db.scalar(select(User).where(User.id == target.id).with_for_update()
                       .execution_options(populate_existing=True))
    if locked is None:
        raise HTTPException(404, "Хэрэглэгч олдсонгүй.")
    target = locked
    pending = json.loads(target.profile_photo_cleanup or "[]")
    remaining = []
    for key in pending:
        try:
            storage.delete(_owned_key(target, key))
        except Exception:  # noqa: BLE001 - storage failures remain private and retryable.
            remaining.append(key)
            logger.warning("Account photo cleanup deferred", extra={"event": "photo_cleanup_failed",
                "operation": "account_photo_cleanup", "error_code": "STORAGE_UNAVAILABLE"})
    target.profile_photo_cleanup = json.dumps(remaining) if remaining else None
    db.commit()


async def _upload(request: Request, actor: User, target: User, db: Session, storage: ObjectStorage):
    if (not _consume_otp_rate(db, "account-photo-user", str(actor.id), 10)
        or not _consume_otp_rate(db, "account-photo-ip", _normalized_ip(request), 30)):
        raise HTTPException(429, "Түр хүлээгээд дахин оролдоно уу.")
    maximum = get_settings().photo_max_upload_bytes
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > maximum:
            raise HTTPException(413, "Зургийн файл хэт том байна.")
        data.extend(chunk)
    _, _, _, clean = _image_payload(request.headers.get("x-file-name", "portrait.jpg"),
        request.headers.get("content-type", ""), bytes(data))
    with Image.open(io.BytesIO(clean)) as image:
        image.thumbnail((640, 640))
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=88)
    _cleanup(db, target, storage)
    locked = db.scalar(select(User).where(User.id == target.id).with_for_update()
                       .execution_options(populate_existing=True))
    if locked is None:
        raise HTTPException(404, "Хэрэглэгч олдсонгүй.")
    target = locked
    pending = json.loads(target.profile_photo_cleanup or "[]")
    if len(pending) >= 10:
        raise HTTPException(503, "Өмнөх зургийн цэвэрлэгээ хүлээгдэж байна. Түр хүлээнэ үү.")
    key = f"account-photos/{target.id}/{uuid4()}.jpg"
    old_key = target.profile_photo_key
    try:
        storage.put(key, output.getvalue(), "image/jpeg")
        target.profile_photo_key = key
        target.profile_photo_cleanup = json.dumps(pending + ([old_key] if old_key else [])) or None
        _audit_auth_event(db, actor.id, "account.photo_uploaded", "user", target.id)
        db.commit()
    except Exception:  # noqa: BLE001 - storage failures remain private and retryable.
        db.rollback()
        # Record rollback objects for retry rather than silently orphaning uploads.
        try:
            storage.delete(key)
        except Exception:  # noqa: BLE001 - storage failures remain private and retryable.
            target.profile_photo_cleanup = json.dumps(pending + [key])
            db.commit()
        raise HTTPException(503, "Зургийг хадгалж чадсангүй.") from None
    _cleanup(db, target, storage)
    return {"profile_photo_url": "/auth/me/photo", "cleanup_pending": bool(target.profile_photo_cleanup)}


def _read(target: User, storage: ObjectStorage) -> Response:
    if not target.profile_photo_key:
        raise HTTPException(404, "Профайл зураг алга.")
    key = _owned_key(target, target.profile_photo_key)
    try:
        data = storage.get(key)
    except Exception:  # noqa: BLE001 - storage failures remain private and retryable.
        raise HTTPException(503, "Зургийг ачаалж чадсангүй.") from None
    return Response(data, media_type="image/jpeg", headers={
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'inline; filename="portrait.jpg"',
    })


def _remove(actor: User, target: User, db: Session, storage: ObjectStorage) -> Response:
    locked = db.scalar(select(User).where(User.id == target.id).with_for_update()
                       .execution_options(populate_existing=True))
    if locked is None:
        raise HTTPException(404, "Хэрэглэгч олдсонгүй.")
    target = locked
    pending = json.loads(target.profile_photo_cleanup or "[]")
    if target.profile_photo_key:
        pending.append(target.profile_photo_key)
    target.profile_photo_key = None
    target.profile_photo_cleanup = json.dumps(pending)
    _audit_auth_event(db, actor.id, "account.photo_removed", "user", target.id)
    db.commit()
    _cleanup(db, target, storage)
    return Response(status_code=204)


@router.get("/auth/me/photo")
def my_photo(user: User = Depends(get_current_user), storage: ObjectStorage = Depends(get_storage)):
    return _read(user, storage)


@router.post("/auth/me/photo", status_code=201)
async def upload_my_photo(request: Request, user: User = Depends(get_current_user),
                           db: Session = Depends(get_db), storage: ObjectStorage = Depends(get_storage)):
    return await _upload(request, user, user, db, storage)


@router.delete("/auth/me/photo", status_code=204)
def remove_my_photo(user: User = Depends(get_current_user), db: Session = Depends(get_db),
                     storage: ObjectStorage = Depends(get_storage)):
    return _remove(user, user, db, storage)


@router.post("/auth/me/photo/cleanup", status_code=204)
def retry_my_cleanup(user: User = Depends(get_current_user), db: Session = Depends(get_db),
                      storage: ObjectStorage = Depends(get_storage)):
    _cleanup(db, user, storage)
    return Response(status_code=204)


def _target(db: Session, user_id: UUID) -> User:
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Хэрэглэгч олдсонгүй.")
    return target


@router.get("/admin/users/{user_id}/photo")
def admin_photo(user_id: UUID, _: tuple[User, AdminRole] = Depends(require_super_admin),
                 db: Session = Depends(get_db), storage: ObjectStorage = Depends(get_storage)):
    return _read(_target(db, user_id), storage)


@router.post("/admin/users/{user_id}/photo", status_code=201)
async def admin_upload_photo(user_id: UUID, request: Request,
                             actor: tuple[User, AdminRole] = Depends(require_super_admin),
                             db: Session = Depends(get_db), storage: ObjectStorage = Depends(get_storage)):
    return await _upload(request, actor[0], _target(db, user_id), db, storage)


@router.delete("/admin/users/{user_id}/photo", status_code=204)
def admin_remove_photo(user_id: UUID, actor: tuple[User, AdminRole] = Depends(require_super_admin),
                        db: Session = Depends(get_db), storage: ObjectStorage = Depends(get_storage)):
    return _remove(actor[0], _target(db, user_id), db, storage)

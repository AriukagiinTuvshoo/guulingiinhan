"""Read-only PostgreSQL/object-storage consistency checks for photos."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Photo
from app.storage import ObjectStorage, _validate_key


@dataclass
class ConsistencyReport:
    orphaned_metadata: list[str] = field(default_factory=list)
    orphaned_objects: list[str] = field(default_factory=list)
    missing_thumbnails: list[str] = field(default_factory=list)
    broken_photos: list[str] = field(default_factory=list)
    invalid_metadata: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any((self.orphaned_metadata, self.orphaned_objects,
                        self.missing_thumbnails, self.broken_photos, self.invalid_metadata))

    def as_dict(self) -> dict[str, object]:
        return {
            "ok": self.ok,
            "ORPHANED_METADATA": self.orphaned_metadata,
            "ORPHANED_OBJECT": self.orphaned_objects,
            "MISSING_THUMBNAIL": self.missing_thumbnails,
            "BROKEN_PHOTO": self.broken_photos,
            "INVALID_STORAGE_METADATA": self.invalid_metadata,
        }


def _expected_key(photo: Photo, thumbnail: bool = False) -> str:
    if photo.memory_id is None:
        raise ValueError("Photo is missing memory_id")
    prefix = f"families/{photo.family_id}/memories/{photo.memory_id}/photos/{photo.id}"
    return f"{prefix}/thumbnail.jpg" if thumbnail else f"{prefix}/original"


def check_storage_consistency(
    db: Session, storage: ObjectStorage, *, prefix: str = "families/"
) -> ConsistencyReport:
    """Inspect DB photo rows and storage objects without modifying either system."""
    report = ConsistencyReport()
    photos = db.scalars(select(Photo)).all()
    expected_objects: set[str] = set()

    for photo in photos:
        photo_id = str(photo.id)
        try:
            expected_original = _expected_key(photo)
            expected_thumbnail = _expected_key(photo, thumbnail=True)
            _validate_key(expected_original)
            _validate_key(expected_thumbnail)
            _validate_key(photo.object_key)
            if photo.thumbnail_object_key:
                _validate_key(photo.thumbnail_object_key)
        except (TypeError, ValueError):
            report.invalid_metadata.append(photo_id)
            continue

        if photo.object_key != expected_original or photo.thumbnail_object_key != expected_thumbnail:
            report.invalid_metadata.append(photo_id)

        thumbnail_key = photo.thumbnail_object_key or expected_thumbnail
        expected_objects.update((photo.object_key, thumbnail_key))
        original_exists = storage.exists(photo.object_key)
        thumbnail_exists = storage.exists(thumbnail_key)

        if not original_exists:
            report.orphaned_metadata.append(photo_id)
            if thumbnail_exists:
                report.broken_photos.append(photo_id)
        elif not thumbnail_exists:
            report.missing_thumbnails.append(photo_id)

    actual_objects = set(storage.list_keys(prefix))
    report.orphaned_objects.extend(sorted(actual_objects - expected_objects))
    return report

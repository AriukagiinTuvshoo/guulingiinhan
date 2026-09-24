from __future__ import annotations

from uuid import UUID, uuid4

from app.models import Photo
from app.tools.storage_consistency import check_storage_consistency


class MemoryStorage:
    def __init__(self, keys: set[str] | None = None):
        self.keys = set(keys or ())
        self.delete_called = False

    def put(self, key, data, content_type):
        self.keys.add(key)

    def get(self, key):
        raise KeyError(key)

    def exists(self, key):
        return key in self.keys

    def delete(self, key):
        self.delete_called = True
        self.keys.discard(key)

    def list_keys(self, prefix=""):
        return sorted(key for key in self.keys if key.startswith(prefix))


class FakeScalarResult:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return list(self.rows)


class FakeSession:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self, _query):
        return FakeScalarResult(self.rows)


def make_photo(family_id: UUID, memory_id: UUID, photo_id: UUID) -> Photo:
    prefix = f"families/{family_id}/memories/{memory_id}/photos/{photo_id}"
    return Photo(
        id=photo_id,
        family_id=family_id,
        memory_id=memory_id,
        object_key=f"{prefix}/original",
        thumbnail_object_key=f"{prefix}/thumbnail.jpg",
        original_filename="synthetic.png",
        uploaded_by=uuid4(),
        storage_status="ready",
    )


def test_consistency_report_detects_expected_failure_classes():
    family_id, memory_id, photo_id = uuid4(), uuid4(), uuid4()
    photo = make_photo(family_id, memory_id, photo_id)
    extra = "families/synthetic/unknown/original"
    storage = MemoryStorage({photo.object_key, extra})

    report = check_storage_consistency(FakeSession([photo]), storage)

    assert report.orphaned_metadata == [str(photo_id)]
    assert report.missing_thumbnails == [str(photo_id)]
    assert report.broken_photos == []
    assert report.orphaned_objects == [extra]


def test_consistency_report_detects_broken_photo():
    family_id, memory_id, photo_id = uuid4(), uuid4(), uuid4()
    photo = make_photo(family_id, memory_id, photo_id)

    report = check_storage_consistency(
        FakeSession([photo]), MemoryStorage({photo.thumbnail_object_key})
    )

    assert report.orphaned_metadata == [str(photo_id)]
    assert report.broken_photos == [str(photo_id)]


def test_checker_is_read_only():
    family_id, memory_id, photo_id = uuid4(), uuid4(), uuid4()
    photo = make_photo(family_id, memory_id, photo_id)
    storage = MemoryStorage({photo.object_key, photo.thumbnail_object_key})

    report = check_storage_consistency(FakeSession([photo]), storage)

    assert report.ok
    assert not storage.delete_called


def test_invalid_storage_metadata_is_reported():
    family_id, memory_id, photo_id = uuid4(), uuid4(), uuid4()
    photo = make_photo(family_id, memory_id, photo_id)
    photo.object_key = "../outside"

    report = check_storage_consistency(FakeSession([photo]), MemoryStorage())

    assert report.invalid_metadata == [str(photo_id)]

"""PostgreSQL row-lock tests; explicitly opt in with a disposable empty database."""
import os
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Thread
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.family_admin import restore_trash
from app.models import (
    Family,
    FamilyAdminGrant,
    FamilyMember,
    FamilyPerson,
    FamilyTrashRecord,
    Person,
    User,
)


@pytest.fixture(scope="module")
def pg_sessions():
    url = os.getenv("TEST_CONCURRENCY_DATABASE_URL")
    if not url:
        pytest.skip("requires explicitly provisioned disposable PostgreSQL database")
    parsed = make_url(url)
    if (parsed.get_backend_name() != "postgresql" or parsed.host not in {"127.0.0.1", "localhost"}
            or not parsed.database or not parsed.database.startswith("guulingiinhan_concurrency_")):
        pytest.fail("refusing non-disposable concurrency database")
    engine = create_engine(url, pool_size=5)
    # Never drop data or reuse an existing schema.
    if inspect(engine).get_table_names():
        pytest.fail("concurrency database must be empty")
    Base.metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


def seed(sessions):
    with sessions() as db:
        owner = User(email=f"owner-{uuid4()}@example.com", display_name="Owner")
        delegate = User(email=f"delegate-{uuid4()}@example.com", display_name="Delegate")
        db.add_all([owner, delegate]); db.flush()
        family = Family(name="Concurrency", created_by=owner.id)
        db.add(family); db.flush()
        db.add(FamilyMember(family_id=family.id, user_id=owner.id, role="owner"))
        member = FamilyMember(family_id=family.id, user_id=delegate.id, role="member")
        db.add(member); db.flush()
        db.add(FamilyAdminGrant(member_id=member.id, scope="manage_trash", granted_by=owner.id))
        person = Person(first_name="Person", created_by=owner.id)
        db.add(person); db.flush()
        record = FamilyTrashRecord(family_id=family.id, person_id=person.id, deleted_by=owner.id)
        db.add(record); db.flush()
        result = family.id, person.id, record.id, member.id, delegate.id
        db.commit()
        return result


def test_two_restores_are_serialized(pg_sessions):
    family_id, person_id, trash_id, _, user_id = seed(pg_sessions)
    from threading import Barrier
    barrier = Barrier(2)
    def worker():
        with pg_sessions() as db:
            user = db.get(User, user_id)
            barrier.wait(timeout=10)
            try:
                return restore_trash(family_id, trash_id, user, db).status_code
            except HTTPException as exc:
                db.rollback()
                return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: worker(), range(2)))
    assert sorted(results) == [204, 404]
    with pg_sessions() as db:
        assert len(db.scalars(select(FamilyPerson).where(FamilyPerson.person_id == person_id)).all()) == 1
        assert db.get(FamilyTrashRecord, trash_id) is None


def test_revocation_preceding_family_lock_blocks_restore(pg_sessions):
    family_id, person_id, trash_id, member_id, user_id = seed(pg_sessions)
    started = Event()
    def worker():
        with pg_sessions() as db:
            user = db.get(User, user_id)
            started.set()
            try:
                return restore_trash(family_id, trash_id, user, db).status_code
            except HTTPException as exc:
                db.rollback()
                return exc.status_code
    with pg_sessions() as owner_db, ThreadPoolExecutor(max_workers=1) as pool:
        owner_db.execute(select(Family.id).where(Family.id == family_id).with_for_update())
        future = pool.submit(worker)
        assert started.wait(10)
        grant = owner_db.scalar(select(FamilyAdminGrant).where(FamilyAdminGrant.member_id == member_id))
        assert grant is not None
        owner_db.delete(grant)
        owner_db.commit()
        assert future.result(timeout=10) == 403
    with pg_sessions() as db:
        assert db.get(FamilyTrashRecord, trash_id) is not None
        assert db.scalar(select(FamilyPerson.id).where(FamilyPerson.person_id == person_id)) is None


class _BlockingStorage:
    """Object storage whose first delete blocks, to open the cleanup window."""

    def __init__(self) -> None:
        self.inside = Event()
        self.release = Event()
        self.deleted: list[str] = []
        self._block_next = True

    def delete(self, key: str) -> None:
        self.deleted.append(key)
        if self._block_next:
            self._block_next = False
            self.inside.set()
            assert self.release.wait(10), "cleanup worker was never released"

    def put(self, key: str, data: bytes, content_type: str) -> None:  # pragma: no cover
        raise AssertionError("unexpected write during cleanup")


def _seed_photo(sessions):
    from app.models import Family, FamilyMember, Memory, Photo, User

    with sessions() as db:
        owner = User(email=f"photo-owner-{uuid4()}@example.com", display_name="Owner")
        db.add(owner)
        db.flush()
        family = Family(name="Photos", created_by=owner.id)
        db.add(family)
        db.flush()
        db.add(FamilyMember(family_id=family.id, user_id=owner.id, role="owner"))
        memory = Memory(family_id=family.id, title="Trip", created_by=owner.id)
        db.add(memory)
        db.flush()
        photo_id = uuid4()
        prefix = f"families/{family.id}/memories/{memory.id}/photos/{photo_id}"
        db.add(Photo(id=photo_id, family_id=family.id, memory_id=memory.id,
                     object_key=f"{prefix}/original",
                     thumbnail_object_key=f"{prefix}/thumbnail.jpg",
                     uploaded_by=owner.id, storage_status="ready"))
        ids = (family.id, photo_id, owner.id)
        db.commit()
        return ids


def test_concurrent_photo_cleanup_deletes_the_row_once(pg_sessions):
    """A blocked cleanup worker must not stale-delete a row its peer removed."""
    from app.memory_photos import delete_photo
    from app.models import AuditLog, Photo, User

    family_id, photo_id, owner_id = _seed_photo(pg_sessions)
    storage = _BlockingStorage()
    results: dict[str, object] = {}

    def worker(name: str) -> None:
        with pg_sessions() as db:
            user = db.get(User, owner_id)
            try:
                results[name] = delete_photo(family_id, photo_id, user, db, storage).status_code
            except HTTPException as exc:
                db.rollback()
                results[name] = exc.status_code
            except Exception as exc:  # noqa: BLE001 - the regression signal
                db.rollback()
                results[name] = type(exc).__name__

    first = Thread(target=worker, args=("first",))
    first.start()
    assert storage.inside.wait(10), "first worker never reached object deletion"
    second = Thread(target=worker, args=("second",))
    second.start()

    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        with pg_sessions() as db:
            if db.get(Photo, photo_id) is None:
                break
        time.sleep(0.02)
    else:  # pragma: no cover - diagnostic failure path
        pytest.fail("second cleanup worker did not remove the photo row")

    storage.release.set()
    first.join(10)
    second.join(10)
    # Both callers succeed: the second one finds the row already gone. Before
    # the atomic claim the loser raised StaleDataError and returned HTTP 500.
    assert results == {"first": 204, "second": 204}
    with pg_sessions() as db:
        assert db.get(Photo, photo_id) is None
        assert len(db.scalars(
            select(AuditLog).where(AuditLog.action == "photo.deleted",
                                   AuditLog.target_id == photo_id)
        ).all()) == 1


def test_guardian_grant_serializes_behind_family_detach(pg_sessions):
    """A guardianship insert must not slip past the detachment cascade guard."""
    from app.families import GuardianshipCreate, create_guardian_grants, remove_person_from_family
    from app.models import Family, FamilyMember, FamilyPerson, Person, PersonGuardianship, User

    with pg_sessions() as db:
        owner = User(email=f"race-owner-{uuid4()}@example.com", display_name="Owner")
        guardian = User(email=f"race-guardian-{uuid4()}@example.com", display_name="Guardian")
        db.add_all([owner, guardian])
        db.flush()
        family = Family(name="Race", created_by=owner.id)
        db.add(family)
        db.flush()
        db.add(FamilyMember(family_id=family.id, user_id=owner.id, role="owner"))
        db.add(FamilyMember(family_id=family.id, user_id=guardian.id, role="member"))
        person = Person(first_name="Adult", created_by=owner.id)
        db.add(person)
        db.flush()
        db.add(FamilyPerson(family_id=family.id, person_id=person.id, added_by=owner.id))
        ids = (family.id, person.id, owner.id, guardian.id)
        db.commit()

    done = Event()
    outcome: dict[str, object] = {}

    def worker() -> None:
        with pg_sessions() as db:
            try:
                create_guardian_grants(
                    ids[0], ids[1],
                    GuardianshipCreate(guardian_user_id=ids[3], scopes=["view_profile"]),
                    db.get(User, ids[2]), db,
                )
                outcome["status"] = "created"
            except HTTPException as exc:
                db.rollback()
                outcome["status"] = exc.status_code
            except Exception as exc:  # noqa: BLE001 - the pre-fix race signal
                db.rollback()
                outcome["status"] = f"unhandled:{type(exc).__name__}"
            finally:
                done.set()

    with pg_sessions() as owner_db:
        owner_db.execute(select(Family.id).where(Family.id == ids[0]).with_for_update())
        thread = Thread(target=worker)
        thread.start()
        assert not done.wait(1), "guardian grant did not serialize behind the family lock"
        remove_person_from_family(ids[0], ids[1], owner_db.get(User, ids[2]), owner_db)
        assert done.wait(10)

    assert outcome["status"] == 404
    with pg_sessions() as db:
        assert db.scalars(
            select(PersonGuardianship).where(PersonGuardianship.person_id == ids[1])
        ).all() == []
        assert db.scalar(select(FamilyPerson.id).where(FamilyPerson.person_id == ids[1])) is None

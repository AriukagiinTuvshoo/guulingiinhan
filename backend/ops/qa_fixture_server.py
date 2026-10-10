"""Start the real API against disposable local-only E2E fixtures.

Run from the repository root with ``APP_ENV=test``. The API binds only to
127.0.0.1:8840. Fixture credentials are written to the ignored
``.integrated-qa/fixture.json`` file and are never printed.
"""

from __future__ import annotations

import json
import os
import secrets
import socket
import sys
import tempfile
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPOSITORY_ROOT / "backend"
QA_ROOT = REPOSITORY_ROOT / ".integrated-qa"
FIXTURE_PATH = QA_ROOT / "fixture.json"
API_HOST = "127.0.0.1"
API_PORT = 8840

EMAILS = {
    "superAdmin": "qa-root-admin@example.com",
    "globalAdmin": "qa-global-admin@example.com",
    "globalModerator": "qa-global-moderator@example.com",
    "familyAOwner": "qa-family-a-owner@example.com",
    "familyAEditor": "qa-family-a-editor@example.com",
    "familyAMember": "qa-family-a-member@example.com",
    "familyBOwner": "qa-family-b-owner@example.com",
}


def _person(
    *,
    person_id: UUID,
    first_name: str,
    last_name: str,
    created_by: UUID,
    birth_date: date,
    is_alive: bool = False,
    death_date: date | None = None,
    visibility: str = "public",
    gender: str = "unknown",
):
    from app.models import Person
    from app.person_search import normalize_search_name

    return Person(
        id=person_id,
        first_name=first_name,
        last_name=last_name,
        gender=gender,
        birth_date=birth_date,
        is_alive=is_alive,
        death_date=death_date,
        visibility=visibility,
        search_first_name=normalize_search_name(first_name),
        search_last_name=normalize_search_name(last_name),
        created_by=created_by,
    )


def seed_fixture(db, password: str) -> dict[str, Any]:
    """Seed clearly synthetic records; callers provide a disposable DB session."""
    from app.auth import _password_hash
    from app.models import (
        AdminGrant,
        Family,
        FamilyMember,
        FamilyPerson,
        LoginIdentity,
        Marriage,
        ParentChildRelationship,
        SharedAncestry,
        SharedAncestryPerson,
        User,
        UserPersonLink,
    )

    now = datetime.now(UTC)
    user_ids = {key: uuid4() for key in EMAILS}
    # All synthetic accounts share one disposable password so automation only
    # needs one credential; each account still gets its own hash salt.
    users = {}
    for key, email in EMAILS.items():
        user = User(
            id=user_ids[key],
            email=email,
            display_name=f"E2E {key}",
            password_hash=_password_hash(password),
            email_verified_at=now,
            is_active=True,
        )
        users[key] = user
        db.add(user)
    db.flush()
    for key, email in EMAILS.items():
        user = users[key]
        db.add(LoginIdentity(
            user_id=user.id,
            provider="email",
            normalized_identifier=email,
            display_identifier=email,
            verified_at=now,
        ))
    db.flush()

    admin_id = user_ids["superAdmin"]
    db.add_all((
        AdminGrant(user_id=admin_id, role="SUPER_ADMIN", granted_by=admin_id),
        AdminGrant(user_id=user_ids["globalAdmin"], role="ADMIN", granted_by=admin_id),
        AdminGrant(user_id=user_ids["globalModerator"], role="MODERATOR", granted_by=admin_id),
    ))

    family_a_id, family_b_id = uuid4(), uuid4()
    family_a = Family(id=family_a_id, name="E2E TEST DATA — Family A", created_by=admin_id)
    family_b = Family(id=family_b_id, name="E2E TEST DATA — Family B", created_by=admin_id)
    db.add_all((family_a, family_b))
    memberships = (
        FamilyMember(family_id=family_a_id, user_id=user_ids["familyAOwner"], role="owner"),
        FamilyMember(family_id=family_a_id, user_id=user_ids["familyAEditor"], role="editor"),
        FamilyMember(family_id=family_a_id, user_id=user_ids["familyAMember"], role="member"),
        FamilyMember(family_id=family_b_id, user_id=user_ids["familyBOwner"], role="owner"),
    )
    db.add_all(memberships)

    root_father_id, root_mother_id = uuid4(), uuid4()
    child_ids = {
        "dolgor": uuid4(),
        "nansalmaa": uuid4(),
        "baavai": uuid4(),
        "badamdorj": uuid4(),
    }
    root_people = [
        _person(person_id=root_father_id, first_name="QA Yadamsuren", last_name="Fixture",
                created_by=admin_id, birth_date=date(1910, 1, 1), death_date=date(1980, 1, 1),
                gender="male"),
        _person(person_id=root_mother_id, first_name="QA Gund", last_name="Fixture",
                created_by=admin_id, birth_date=date(1912, 1, 1), death_date=date(1982, 1, 1),
                gender="female"),
    ]
    child_people = [
        _person(person_id=child_ids["dolgor"], first_name="QA Dolgor", last_name="Fixture",
                created_by=admin_id, birth_date=date(1932, 1, 1), death_date=date(2000, 1, 1)),
        _person(person_id=child_ids["nansalmaa"], first_name="QA Nansalmaa", last_name="Fixture",
                created_by=admin_id, birth_date=date(1935, 1, 1), death_date=date(2002, 1, 1)),
        _person(person_id=child_ids["baavai"], first_name="QA Baavai", last_name="Fixture",
                created_by=admin_id, birth_date=date(1938, 1, 1), death_date=date(2004, 1, 1)),
        _person(person_id=child_ids["badamdorj"], first_name="QA Badamdorj", last_name="Fixture",
                created_by=admin_id, birth_date=date(1941, 1, 1), death_date=date(2006, 1, 1)),
    ]
    owner_person_id = uuid4()
    deceased_child_candidate_id = uuid4()
    spouse_candidate_id = uuid4()
    family_b_person_id = uuid4()
    owner_person = _person(
        person_id=owner_person_id, first_name="QA Account Holder", last_name="Fixture",
        created_by=user_ids["familyAOwner"], birth_date=date(1988, 1, 1), is_alive=True,
        visibility="family",
    )
    deceased_child_candidate = _person(
        person_id=deceased_child_candidate_id, first_name="QA Deceased Child Candidate", last_name="Fixture",
        created_by=user_ids["familyAOwner"], birth_date=date(1955, 1, 1),
        death_date=date(2020, 1, 1),
    )
    spouse_candidate = _person(
        person_id=spouse_candidate_id, first_name="QA Spouse Candidate", last_name="Fixture",
        created_by=user_ids["familyAOwner"], birth_date=date(1950, 1, 1),
        death_date=date(2018, 1, 1),
    )
    family_b_person = _person(
        person_id=family_b_person_id, first_name="QA Private Family B Person", last_name="Fixture",
        created_by=user_ids["familyBOwner"], birth_date=date(1985, 1, 1), is_alive=True,
        visibility="private",
    )
    db.add_all([*root_people, *child_people, owner_person, deceased_child_candidate,
                spouse_candidate, family_b_person])
    db.flush()

    family_a_person_ids = [root_father_id, root_mother_id, *child_ids.values(), owner_person_id,
                           deceased_child_candidate_id, spouse_candidate_id]
    db.add_all(
        FamilyPerson(family_id=family_a_id, person_id=person_id, added_by=admin_id)
        for person_id in family_a_person_ids[:6]
    )
    db.add_all((
        FamilyPerson(family_id=family_a_id, person_id=owner_person_id,
                     added_by=user_ids["familyAOwner"]),
        FamilyPerson(family_id=family_a_id, person_id=deceased_child_candidate_id,
                     added_by=user_ids["familyAOwner"]),
        FamilyPerson(family_id=family_a_id, person_id=spouse_candidate_id,
                     added_by=user_ids["familyAOwner"]),
        FamilyPerson(family_id=family_b_id, person_id=family_b_person_id,
                     added_by=user_ids["familyBOwner"]),
        UserPersonLink(user_id=user_ids["familyAOwner"], person_id=owner_person_id,
                       linked_by=user_ids["familyAOwner"]),
        UserPersonLink(user_id=user_ids["familyBOwner"], person_id=family_b_person_id,
                       linked_by=user_ids["familyBOwner"]),
    ))

    # Synthetic fixture: use the linked adult to verify dashboard portrait refresh.
    family_a.featured_person_id = owner_person_id
    first, second = sorted((root_father_id, root_mother_id), key=str)
    db.add(Marriage(person_1_id=first, person_2_id=second, status="widowed", created_by=admin_id))
    db.add_all(
        ParentChildRelationship(parent_id=parent_id, child_id=child_id,
                                relationship_type="biological", created_by=admin_id)
        for child_id in child_ids.values()
        for parent_id in (root_father_id, root_mother_id)
    )
    # The owner's linked adult has a canonical family relationship to branch
    # one but is not shared until they submit an explicit reviewed request.
    db.add(ParentChildRelationship(parent_id=child_ids["dolgor"], child_id=owner_person_id,
                                  relationship_type="biological",
                                  created_by=user_ids["familyAOwner"]))
    db.add(ParentChildRelationship(parent_id=child_ids["dolgor"],
                                  child_id=deceased_child_candidate_id,
                                  relationship_type="biological",
                                  created_by=user_ids["familyAOwner"]))
    db.add(SharedAncestry(id=1, root_person_id=root_father_id, created_by=admin_id))
    db.add_all(
        SharedAncestryPerson(person_id=person_id, family_id=family_a_id, added_by=admin_id)
        for person_id in [root_father_id, root_mother_id, *child_ids.values()]
    )
    db.flush()

    return {
        "emails": dict(EMAILS),
        "userIds": {key: str(value) for key, value in user_ids.items()},
        "familyIds": {
            "rootFamily": str(family_a_id),
            "familyA": str(family_a_id),
            "familyB": str(family_b_id),
        },
        "personIds": {
            "rootFather": str(root_father_id),
            "rootMother": str(root_mother_id),
            "rootChildren": {key: str(value) for key, value in child_ids.items()},
            "rootChildOrder": [str(person_id) for person_id in child_ids.values()],
            "familyAOwnerPerson": str(owner_person_id),
            "familyADeceasedChildCandidate": str(deceased_child_candidate_id),
            "familyASpouseCandidate": str(spouse_candidate_id),
            "familyBPrivatePerson": str(family_b_person_id),
        },
        "adminRoles": {"superAdmin": "SUPER_ADMIN", "globalAdmin": "ADMIN",
                       "globalModerator": "MODERATOR"},
        "familyRoles": {
            "familyAOwner": "owner",
            "familyAEditor": "editor",
            "familyAMember": "member",
            "familyBOwner": "owner",
        },
    }


def _set_isolated_test_environment(run_dir: Path) -> Path:
    """Ignore repo/user .env files and force local-only service settings."""
    if os.environ.get("APP_ENV") != "test":
        raise RuntimeError("QA fixture server requires APP_ENV=test.")

    # Settings read a .env file relative to CWD. Isolate CWD and remove every
    # Settings field inherited from the host process before setting safe values.
    if str(BACKEND_ROOT) not in sys.path:
        sys.path.insert(0, str(BACKEND_ROOT))
    from app.config import Settings

    for field in Settings.model_fields:
        os.environ.pop(field.upper(), None)

    db_path = (run_dir / "qa-fixture.sqlite").resolve()
    storage_path = (run_dir / "private-storage").resolve()
    os.environ.update({
        "APP_ENV": "test",
        "DATABASE_URL": f"sqlite:///{db_path.as_posix()}",
        "STORAGE_PROVIDER": "local",
        "STORAGE_LOCAL_PATH": str(storage_path),
        "EMAIL_PROVIDER": "fake",
        "SMS_PROVIDER": "fake",
        "GOOGLE_OIDC_ENABLED": "false",
        "CORS_ORIGINS": (
            "http://localhost:3000,http://127.0.0.1:3000,"
            "http://localhost:8841,http://127.0.0.1:8841"
        ),
        "DB_POOL_SIZE": "1",
        "DB_MAX_OVERFLOW": "0",
        "LOG_LEVEL": "WARNING",
    })
    os.chdir(run_dir)
    return db_path


def _verify_runtime_is_local(settings, db_path: Path, run_dir: Path) -> None:
    actual_url = settings.database_url
    expected_url = f"sqlite:///{db_path.as_posix()}"
    if actual_url != expected_url or not actual_url.startswith("sqlite:///"):
        raise RuntimeError("Refusing to start: database is not the generated local SQLite fixture.")
    if settings.app_env.lower() != "test":
        raise RuntimeError("Refusing to start outside the test environment.")
    if settings.storage_provider.lower() != "local":
        raise RuntimeError("Refusing to start without local private storage.")
    if Path(settings.storage_local_path).resolve().parent != run_dir.resolve():
        raise RuntimeError("Refusing to start: storage escaped the disposable fixture directory.")
    if settings.email_provider.lower() != "fake" or settings.sms_provider.lower() != "fake":
        raise RuntimeError("Refusing to start with external email or SMS providers.")
    if settings.google_oidc_enabled:
        raise RuntimeError("Refusing to start with external identity providers enabled.")


def _require_loopback_port() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server_socket:
        try:
            server_socket.bind((API_HOST, API_PORT))
        except OSError as error:
            raise RuntimeError("Local QA port 8840 is unavailable; stop its existing process first.") from error


def _write_manifest(fixture: dict[str, Any], password: str) -> None:
    payload = {
        **fixture,
        "baseUrl": f"http://{API_HOST}:{API_PORT}/api/v1",
        "password": password,
        "generatedAt": datetime.now(UTC).isoformat(),
        "runnerPid": os.getpid(),
        "runId": os.environ.get("GUULINGIINHAN_QA_RUN_ID"),
        "disposableLocalFixture": True,
    }
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = FIXTURE_PATH.with_suffix(f".json.{uuid4().hex}.tmp")
    temporary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        temporary_path.chmod(0o600)
        temporary_path.replace(FIXTURE_PATH)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> int:
    if os.environ.get("APP_ENV") != "test":
        print("Refusing to start: set APP_ENV=test for disposable local QA.", file=sys.stderr)
        return 2

    run_root = QA_ROOT / "runs"
    run_root.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix="api-", dir=run_root)).resolve()
    try:
        _require_loopback_port()
        db_path = _set_isolated_test_environment(run_dir)

        import uvicorn

        from app import models  # noqa: F401 - register ORM metadata before create_all
        from app.config import get_settings
        from app.db import Base, SessionLocal, engine
        from app.storage import get_storage

        get_settings.cache_clear()
        get_storage.cache_clear()
        settings = get_settings()
        _verify_runtime_is_local(settings, db_path, run_dir)
        if db_path.exists():
            raise RuntimeError("Refusing to reuse an existing QA database file.")
        Base.metadata.create_all(engine)

        password = f"Qa-{secrets.token_urlsafe(32)}-9!"
        with SessionLocal.begin() as db:
            fixture = seed_fixture(db, password)
        from PIL import Image

        image_path = run_dir / "qa-photo.png"
        Image.new("RGB", (96, 96), (20, 76, 52)).save(image_path)
        fixture["imagePath"] = str(image_path)
        alternate_image_path = run_dir / "qa-alternate-photo.png"
        Image.new("RGB", (96, 96), (172, 76, 52)).save(alternate_image_path)
        fixture["alternateImagePath"] = str(alternate_image_path)
        _write_manifest(fixture, password)

        from app.main import app

        print(f"Local fixture metadata: {FIXTURE_PATH}")
        print(f"Disposable API: http://{API_HOST}:{API_PORT}")
        uvicorn.run(app, host=API_HOST, port=API_PORT, access_log=False, log_level="warning")
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as error:  # noqa: BLE001 - avoid printing setup details or credentials
        print(f"QA fixture server stopped safely ({type(error).__name__}).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Opt-in actual PostgreSQL concurrency gates, restricted to a fresh local test DB.

Set DOMAIN_POSTGRES_TEST_URL to a loopback postgresql+psycopg database whose name
starts with guulingiinhan_domain_test_. Existing tables are refused. No production
or staging URL is accepted, and no normal DATABASE_URL is read by this fixture.
"""

import hashlib
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.db import Base, get_db
from app.main import app
from app.models import (
    Family,
    FamilyMember,
    FamilyPerson,
    ParentChildRelationship,
    Person,
    User,
    UserPersonLink,
    UserSession,
)

PREFIX = "guulingiinhan_domain_test_"


def _safe_test_url(value):
    url = make_url(value)
    if (url.drivername != "postgresql+psycopg"
        or url.host not in {"localhost", "127.0.0.1", "::1"}
        or not url.database or not url.database.startswith(PREFIX)
        or url.database == PREFIX or url.query):
        raise ValueError("Refusing database: use an explicit disposable loopback PostgreSQL test DB.")
    return url


@pytest.mark.parametrize("unsafe", [
    "sqlite:///guulingiinhan_domain_test_example",
    "postgresql+psycopg://localhost/guulingiinhan",
    "postgresql+psycopg://remote.invalid/guulingiinhan_domain_test_example",
    "postgresql+psycopg://localhost/guulingiinhan_domain_test_",
    "postgresql+psycopg://localhost/guulingiinhan_domain_test_example?host=remote.invalid",
])
def test_postgres_concurrency_fixture_refuses_unsafe_database(unsafe):
    with pytest.raises(ValueError):
        _safe_test_url(unsafe)


@pytest.fixture(scope="module")
def postgres_database():
    configured = os.getenv("DOMAIN_POSTGRES_TEST_URL")
    if not configured:
        pytest.skip("Set DOMAIN_POSTGRES_TEST_URL for isolated actual PostgreSQL concurrency tests.")
    engine = create_engine(_safe_test_url(configured), pool_size=4, max_overflow=2,
                           pool_pre_ping=True, connect_args={"connect_timeout": 5})
    try:
        if inspect(engine).get_table_names():
            pytest.fail("Refusing existing tables: PostgreSQL concurrency tests need a fresh empty test DB.")
        Base.metadata.create_all(engine)
        yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False), engine
        Base.metadata.drop_all(engine)
    finally:
        engine.dispose()


@pytest.fixture
def postgres_api(postgres_database):
    factory, engine = postgres_database
    previous = dict(app.dependency_overrides)

    def override_db():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        yield factory, engine
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def _account(db):
    user = User(email=f"postgres-audit-{uuid4().hex}@example.invalid",
                display_name="Synthetic concurrency account", email_verified_at=datetime.now(UTC))
    db.add(user)
    db.flush()
    token = uuid4().hex + uuid4().hex
    db.add(UserSession(user_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
                       expires_at=datetime.now(UTC) + timedelta(hours=1)))
    return user, token


@contextmanager
def _overlap_lock_attempts(engine, predicate):
    """Both independent requests reach their actual DB lock before either acquires it."""
    barrier = threading.Barrier(2)
    seen = set()
    mutex = threading.Lock()

    def before_execute(connection, cursor, statement, parameters, context, executemany):
        if not predicate(statement.upper()):
            return
        thread = threading.get_ident()
        with mutex:
            if thread in seen:
                return
            seen.add(thread)
        barrier.wait(timeout=15)

    event.listen(engine, "before_cursor_execute", before_execute)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", before_execute)


def _parallel_posts(token, requests):
    cookie_name = get_settings().session_cookie_name

    def send(item):
        # No lifespan/bootstrap runs: each client makes actual API requests using
        # the isolated get_db override and its own real synthetic session cookie.
        with_request = TestClient(app, raise_server_exceptions=False)
        try:
            with_request.cookies.set(cookie_name, token)
            return with_request.post(item[0], json=item[1])
        finally:
            with_request.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(send, requests))


def test_postgres_inverse_parent_edges_across_families_serialize(postgres_api):
    factory, engine = postgres_api
    with factory() as db:
        user, token = _account(db)
        families = [Family(name="Synthetic inverse-edge family", created_by=user.id) for _ in range(2)]
        people = [Person(first_name="Synthetic adult", birth_date=date(1950, 1, 1),
                         visibility="family", created_by=user.id) for _ in range(2)]
        db.add_all([*families, *people])
        db.flush()
        for family in families:
            db.add(FamilyMember(family_id=family.id, user_id=user.id, role="owner"))
            db.add_all([FamilyPerson(family_id=family.id, person_id=person.id, added_by=user.id)
                        for person in people])
        db.commit()
        first, second = [person.id for person in people]
        family_ids = [family.id for family in families]
    requests = [
        (f"/api/v1/families/{family_ids[0]}/relationships/parent-child",
         {"parent_id": str(first), "child_id": str(second), "relationship_type": "biological"}),
        (f"/api/v1/families/{family_ids[1]}/relationships/parent-child",
         {"parent_id": str(second), "child_id": str(first), "relationship_type": "biological"}),
    ]
    with _overlap_lock_attempts(engine, lambda sql: "PG_ADVISORY_XACT_LOCK" in sql) as attempts:
        responses = _parallel_posts(token, requests)
    assert len(attempts) == 2
    assert sorted(response.status_code for response in responses) == [201, 422]
    with factory() as db:
        edges = db.execute(select(ParentChildRelationship.parent_id, ParentChildRelationship.child_id)
            .where(ParentChildRelationship.parent_id.in_((first, second)),
                   ParentChildRelationship.child_id.in_((first, second)))).all()
        assert len(edges) == 1 and edges[0] in {(first, second), (second, first)}


@pytest.mark.parametrize("same_request_key", [True, False])
def test_postgres_atomic_onboarding_concurrent_retries_do_not_duplicate(postgres_api, same_request_key):
    factory, engine = postgres_api
    with factory() as db:
        user, token = _account(db)
        db.commit()
        user_id = user.id
    first_key = str(uuid4())
    bodies = [{"request_key": key, "family_name": "Synthetic atomic family", "first_name": "Self"}
              for key in (first_key, first_key if same_request_key else str(uuid4()))]
    predicate = lambda sql: "FROM USERS" in sql and "FOR UPDATE" in sql
    with _overlap_lock_attempts(engine, predicate) as attempts:
        responses = _parallel_posts(token, [("/api/v1/families/onboarding", body) for body in bodies])
    assert len(attempts) == 2
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json()["family_id"] == responses[1].json()["family_id"]
    assert responses[0].json()["person_id"] == responses[1].json()["person_id"]
    with factory() as db:
        for model, condition in (
            (Family, Family.created_by == user_id), (Person, Person.created_by == user_id),
            (FamilyMember, FamilyMember.user_id == user_id),
            (FamilyPerson, FamilyPerson.added_by == user_id),
            (UserPersonLink, UserPersonLink.user_id == user_id),
        ):
            assert db.scalar(select(func.count()).select_from(model).where(condition)) == 1

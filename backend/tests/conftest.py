import os
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.config import get_settings
from app.db import Base, get_db
from app.email import FakeEmailProvider, get_email_provider
from app.main import app

# Central dummy credentials for the whole suite. These are not real
# secrets: they only exist so tests can register and log in against the
# isolated in-memory database. Real credentials are never stored in this
# repository (see .env.example); CI may override the default via env.
TEST_PASSWORD = os.environ.get("TEST_PASSWORD", "strong-passphrase-123")
# The engine under test is chosen explicitly, never implicitly. Default is the
# historical in-memory SQLite database; CI may export TEST_DATABASE_URL to run the
# same suite on the production engine (FOR UPDATE, real constraints, real isolation).
TEST_DATABASE_URL_ENV = "TEST_DATABASE_URL"
TEST_POSTGRES_PREFIX = "guulingiinhan_test_"
LOCAL_POSTGRES_HOSTS = {"127.0.0.1", "localhost"}
CI_ENV_MARKERS = ("CI", "GITHUB_ACTIONS")


def running_in_ci() -> bool:
    """True when a CI runner declared itself, even if a step masked the exit code."""
    values = {os.environ.get(name, "").strip().lower() for name in CI_ENV_MARKERS}
    return any(value not in {"", "0", "false"} for value in values)


def _assert_never_production() -> None:
    if get_settings().app_env.lower() == "production":
        pytest.fail("refusing to run the test suite with APP_ENV=production", pytrace=False)


def requested_test_database_url() -> str:
    """Return the validated test URL, defaulting to in-memory SQLite.

    A PostgreSQL URL must be a local server and a disposable ``guulingiinhan_test_*``
    database, so a mistyped or production connection string can never be picked up by
    accident. Anything other than SQLite in-memory or a validated PostgreSQL database
    is a hard error: there is no silent fallback between engines.
    """
    _assert_never_production()
    url = os.environ.get(TEST_DATABASE_URL_ENV, "").strip()
    if not url:
        return "sqlite://"
    parsed = make_url(url)
    if parsed.get_backend_name() == "postgresql":
        problems: list[str] = []
        if parsed.host not in LOCAL_POSTGRES_HOSTS:
            problems.append(f"host {parsed.host!r} is not local")
        if not (parsed.database or "").startswith(TEST_POSTGRES_PREFIX):
            problems.append(
                f"database {parsed.database!r} must start with {TEST_POSTGRES_PREFIX!r}"
            )
        if problems:
            pytest.fail(
                f"refusing {TEST_DATABASE_URL_ENV}: " + "; ".join(problems)
                + f" (expected e.g. postgresql+psycopg://user:pass@localhost:5432/"
                  f"{TEST_POSTGRES_PREFIX}ci)",
                pytrace=False,
            )
        return url
    if url != "sqlite://":
        pytest.fail(
            f"{TEST_DATABASE_URL_ENV} must be either 'sqlite://' (in-memory) or a disposable "
            "local PostgreSQL database named guulingiinhan_test_*; a file-backed SQLite database "
            "would leak state between tests.",
            pytrace=False,
        )
    return "sqlite://"


def postgres_test_database(env_var: str, *, prefix: str, label: str) -> str:
    """Validate a PostgreSQL-only suite URL, skip locally, fail when CI lost it.

    Missing configuration must never degrade into a green-but-untested job: on a CI
    runner the absence of the variable is a failure, while a developer without a local
    PostgreSQL server still gets an explicit skip with the reason and the fix.
    """
    url = os.environ.get(env_var, "").strip()
    reason = (
        f"{env_var} is not set: create an empty disposable PostgreSQL 16 database named "
        f"{prefix}… and export {env_var} to run the {label} suite"
    )
    if not url:
        if running_in_ci():
            pytest.fail(f"{reason}\nThe {label} suite must not be skipped in CI.", pytrace=False)
        pytest.skip(reason)
    parsed = make_url(url)
    if (
        parsed.get_backend_name() != "postgresql"
        or parsed.host not in LOCAL_POSTGRES_HOSTS
        or not (parsed.database or "").startswith(prefix)
    ):
        pytest.fail(f"refusing non-disposable {label} database", pytrace=False)
    _assert_never_production()
    return url


def _sqlite_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # The "connect" event hands over the raw DBAPI connection, so this is a plain
    # string on purpose: SQLAlchemy's text() is only for Connection.execute().
    event.listen(
        engine,
        "connect",
        lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"),
    )
    Base.metadata.create_all(engine)
    return engine


def _truncate_all_tables(engine) -> None:
    """Empty every modelled table between tests so each one starts from a clean schema.

    The identifier list comes from this project's own ``Base.metadata`` (not from user
    input), which keeps the statement static while still tracking the model.
    """
    tables = sorted({str(table.fullname) for table in Base.metadata.sorted_tables})
    if not tables:
        return
    quoted = ", ".join(f'"{name}"' for name in tables)
    statement = f"TRUNCATE {quoted} RESTART IDENTITY CASCADE"
    with engine.begin() as connection:
        connection.execute(text(statement))


class CsrfTestClient(TestClient):
    """Test client that models the browser's Origin and signed CSRF header."""

    def request(self, method, url, *args, csrf=True, **kwargs):
        if csrf and method.upper() in {"POST", "PUT", "PATCH", "DELETE"}:
            headers = dict(kwargs.get("headers") or {})
            lowered = {key.lower() for key in headers}
            if "origin" not in lowered:
                headers["Origin"] = "http://localhost:3000"
            if "x-csrf-token" not in lowered:
                token_response = super().get("/api/v1/auth/csrf")
                assert token_response.status_code == 200, token_response.text
                headers["X-CSRF-Token"] = token_response.json()["csrf_token"]
            kwargs["headers"] = headers
        return super().request(method, url, *args, **kwargs)


def confirm_registration_email(client, email_provider, email):
    delivery = next(
        item
        for item in reversed(email_provider.deliveries)
        if item.recipient == email.strip().casefold()
        and item.subject.startswith("Гуулингийнхан — имэйл")
    )
    token = urlsplit(delivery.text.rsplit(" ", 1)[-1]).fragment.removeprefix("token=")
    return client.post("/api/v1/auth/email/verification/confirm", json={"token": token})


def register_verified(client, email, password=TEST_PASSWORD, email_provider=None):
    response = client.post(
        "/api/v1/auth/register", json={"email": email, "password": password}
    )
    if response.status_code == 201:
        provider = email_provider or app.dependency_overrides[get_email_provider]()
        confirmed = confirm_registration_email(client, provider, email)
        assert confirmed.status_code == 200
        signed_in = client.post(
            "/api/v1/auth/login", json={"email": email, "password": password}
        )
        assert signed_in.status_code == 200
    return response


@pytest.fixture(scope="session")
def postgres_engine():
    """One schema for the whole session, only when the suite was pointed at PostgreSQL.

    The database has to be empty of application tables before it is used, and it is
    left empty afterwards, so a run cannot quietly inherit another environment's data.
    """
    url = requested_test_database_url()
    if not url.startswith("postgresql"):
        yield None
        return
    engine = create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 10})
    try:
        existing = set(inspect(engine).get_table_names()) - {"alembic_version"}
        if existing:
            pytest.fail(
                "the PostgreSQL test database must start empty; found table(s): "
                + ", ".join(sorted(existing)),
                pytrace=False,
            )
        Base.metadata.create_all(engine)
        yield engine
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def database(postgres_engine):
    if postgres_engine is not None:
        # Real commits on the production engine; TRUNCATE keeps tests isolated.
        _truncate_all_tables(postgres_engine)
        yield sessionmaker(bind=postgres_engine, autoflush=False, expire_on_commit=False)
        _truncate_all_tables(postgres_engine)
        return
    engine = _sqlite_engine()
    test_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    yield test_session
    engine.dispose()


@pytest.fixture
def email_provider():
    return FakeEmailProvider()


@pytest.fixture
def client(database, email_provider):
    def override_db():
        with database() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_email_provider] = lambda: email_provider
    with CsrfTestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()

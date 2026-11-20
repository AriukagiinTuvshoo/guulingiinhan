"""Run the privacy-sensitive pagination contract against an empty disposable PostgreSQL DB."""
import os

import pytest
from conftest import CsrfTestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from test_memory_photos import (
    test_memory_pagination_counts_only_visible_records_and_updates_on_guardian_revocation as _check_memory_pagination,
)

from app.db import Base, get_db
from app.email import FakeEmailProvider, get_email_provider
from app.main import app


def test_postgres_memory_pagination_privacy():
    url = os.getenv("TEST_PAGINATION_DATABASE_URL")
    if not url:
        pytest.skip("requires explicitly provisioned disposable PostgreSQL database")
    parsed = make_url(url)
    if (parsed.get_backend_name() != "postgresql" or parsed.host not in {"127.0.0.1", "localhost"}
            or not parsed.database or not parsed.database.startswith("guulingiinhan_pagination_")):
        pytest.fail("refusing non-disposable pagination database")
    engine = create_engine(url)
    if inspect(engine).get_table_names():
        pytest.fail("pagination database must be empty")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False, autoflush=False)

    def override_db():
        with sessions() as session:
            yield session

    provider = FakeEmailProvider()
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_email_provider] = lambda: provider
    try:
        with CsrfTestClient(app, raise_server_exceptions=False) as client:
            _check_memory_pagination(client, sessions)
    finally:
        app.dependency_overrides.clear()
        engine.dispose()

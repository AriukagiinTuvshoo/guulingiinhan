import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db import Base, get_db
from app.email import FakeEmailProvider, get_email_provider
from app.main import app


@pytest.fixture
def database():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(
        engine,
        "connect",
        lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"),
    )
    Base.metadata.create_all(engine)
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
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()

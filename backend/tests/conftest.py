from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db import Base, get_db
from app.email import FakeEmailProvider, get_email_provider
from app.main import app


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


def register_verified(client, email, password="strong-passphrase-123", email_provider=None):
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
    with CsrfTestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()

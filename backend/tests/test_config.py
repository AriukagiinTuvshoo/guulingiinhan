import pytest
from pydantic import ValidationError

from app.config import Settings


def test_production_requires_postgresql_and_explicit_https_origins():
    with pytest.raises(ValidationError):
        Settings(app_env="production", database_url="sqlite:///app.db")
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            database_url="postgresql+psycopg://user:pass@host/db",
            cors_origins="*",
        )
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            database_url="postgresql+psycopg://user:pass@host/db",
            cors_origins="http://example.com",
        )


def test_production_accepts_postgresql_and_https_origin():
    settings = Settings(
        app_env="production",
        database_url="postgresql+psycopg://user:pass@host/db",
        cors_origins="https://guulingiinhan.mn",
    )
    assert settings.cors_origin_list == ["https://guulingiinhan.mn"]

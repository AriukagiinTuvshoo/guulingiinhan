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
        otp_hash_secret="x" * 40,
        sms_provider="twilio",
        twilio_account_sid="AC" + "x" * 32,
        twilio_auth_token="x" * 32,
        twilio_from_number="+12025550100",
        email_provider="smtp",
        email_from="no-reply@guulingiinhan.mn",
        email_public_base_url="https://guulingiinhan.mn",
        email_smtp_host="smtp.example.net",
        email_smtp_username="smtp-user",
        email_smtp_password="smtp-password",
        storage_provider="s3",
        storage_endpoint="https://objects.example.net",
        storage_bucket="family-photos",
        storage_access_key="access-key",
        storage_secret_key="secret-key",
    )
    assert settings.cors_origin_list == ["https://guulingiinhan.mn"]


def test_production_rejects_missing_otp_secret_or_sms_provider():
    values = {
        "app_env": "production",
        "database_url": "postgresql+psycopg://user:pass@host/db",
        "cors_origins": "https://guulingiinhan.mn",
    }
    with pytest.raises(ValidationError):
        Settings(**values)
    with pytest.raises(ValidationError):
        Settings(**values, otp_hash_secret="x" * 40, sms_provider="fake")


def test_production_rejects_fake_email_provider_and_requires_tls():
    values = {
        "app_env": "production",
        "database_url": "postgresql+psycopg://user:pass@host/db",
        "cors_origins": "https://guulingiinhan.mn",
        "otp_hash_secret": "x" * 40,
        "sms_provider": "twilio",
        "twilio_account_sid": "AC" + "x" * 32,
        "twilio_auth_token": "x" * 32,
        "twilio_from_number": "+12025550100",
    }
    with pytest.raises(ValidationError):
        Settings(**values)
    with pytest.raises(ValidationError):
        Settings(
            **values,
            email_provider="smtp",
            email_from="no-reply@guulingiinhan.mn",
            email_public_base_url="https://guulingiinhan.mn",
            email_smtp_host="smtp.example.net",
            email_smtp_username="smtp-user",
            email_smtp_password="smtp-password",
            email_smtp_starttls=False,
        )


def test_observability_and_database_pool_settings_are_validated():
    settings = Settings(
        db_pool_size=8,
        db_max_overflow=12,
        db_pool_timeout_seconds=45,
        db_pool_recycle_seconds=900,
        db_connect_timeout_seconds=12,
        log_level="WARNING",
        slow_request_threshold_ms=1500,
        photo_cleanup_max_attempts=4,
    )
    assert settings.db_pool_size == 8
    assert settings.slow_request_threshold_ms == 1500
    assert settings.photo_cleanup_max_attempts == 4
    with pytest.raises(ValidationError):
        Settings(log_level="VERBOSE")
    with pytest.raises(ValidationError):
        Settings(photo_cleanup_max_attempts=21)

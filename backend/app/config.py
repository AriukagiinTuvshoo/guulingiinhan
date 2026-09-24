from functools import lru_cache

from pydantic import EmailStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./guulingiinhan.db"
    cors_origins: str = "http://localhost:3000"
    session_cookie_name: str = "guulingiinhan_session"
    storage_provider: str = "local"
    storage_local_path: str = "./uploads"
    storage_endpoint: str | None = None
    storage_bucket: str | None = None
    storage_region: str = "auto"
    storage_access_key: str | None = None
    storage_secret_key: str | None = None
    photo_max_upload_bytes: int = 10 * 1024 * 1024
    otp_hash_secret: str | None = None
    sms_provider: str = "fake"
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None
    google_oidc_enabled: bool = False
    google_oidc_client_id: str | None = None
    google_oidc_client_secret: str | None = None
    google_oidc_redirect_uri: str | None = None
    google_oidc_issuer: str = "https://accounts.google.com"
    google_oidc_state_secret: str | None = None
    email_provider: str = "fake"
    email_from: EmailStr | None = None
    email_public_base_url: str = "http://localhost:3000"
    email_verification_ttl_seconds: int = 86400
    email_password_reset_ttl_seconds: int = 1800
    email_smtp_host: str | None = None
    email_smtp_port: int = 587
    email_smtp_username: str | None = None
    email_smtp_password: str | None = None
    email_smtp_starttls: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def validate_production_settings(self):
        if self.email_provider.lower() not in {"fake", "smtp"}:
            raise ValueError("EMAIL_PROVIDER must be fake or smtp.")
        if self.email_verification_ttl_seconds < 300 or self.email_verification_ttl_seconds > 86400:
            raise ValueError("EMAIL_VERIFICATION_TTL_SECONDS must be between 300 and 86400.")
        if self.email_password_reset_ttl_seconds < 300 or self.email_password_reset_ttl_seconds > 86400:
            raise ValueError("EMAIL_PASSWORD_RESET_TTL_SECONDS must be between 300 and 86400.")
        if self.app_env.lower() == "production":
            if not self.database_url.startswith(("postgresql://", "postgresql+psycopg://")):
                raise ValueError("Production requires PostgreSQL in DATABASE_URL.")
            origins = self.cors_origin_list
            if not origins or "*" in origins:
                raise ValueError("Production CORS_ORIGINS must list explicit HTTPS origins.")
            if any(not origin.startswith("https://") for origin in origins):
                raise ValueError("Production CORS_ORIGINS may contain HTTPS origins only.")
            if not self.otp_hash_secret or len(self.otp_hash_secret) < 32:
                raise ValueError("Production requires OTP_HASH_SECRET with at least 32 characters.")
            if (
                self.sms_provider.lower() != "twilio"
                or not self.twilio_account_sid
                or not self.twilio_auth_token
                or not self.twilio_from_number
            ):
                raise ValueError("Production requires a configured SMS provider.")
            if self.email_provider.lower() != "smtp":
                raise ValueError("Production requires a real EMAIL_PROVIDER; fake is development/test only.")
            if not all(
                (self.email_from, self.email_smtp_host, self.email_smtp_username, self.email_smtp_password)
            ):
                raise ValueError("Production email requires sender and authenticated SMTP configuration.")
            if not self.email_smtp_starttls:
                raise ValueError("Production SMTP must use STARTTLS.")
            if not self.email_public_base_url.startswith("https://"):
                raise ValueError("Production EMAIL_PUBLIC_BASE_URL must use HTTPS.")
        if self.google_oidc_enabled:
            if not all(
                (
                    self.google_oidc_client_id,
                    self.google_oidc_client_secret,
                    self.google_oidc_redirect_uri,
                )
            ):
                raise ValueError("Google OIDC requires client ID, client secret, and redirect URI.")
            if not self.google_oidc_issuer.rstrip("/") == "https://accounts.google.com":
                raise ValueError("Google OIDC issuer must be https://accounts.google.com.")
            if self.app_env.lower() == "production":
                if not self.google_oidc_redirect_uri.startswith("https://"):
                    raise ValueError("Production Google OIDC redirect URI must use HTTPS.")
                if not self.google_oidc_state_secret or len(self.google_oidc_state_secret) < 32:
                    raise ValueError(
                        "Production Google OIDC requires GOOGLE_OIDC_STATE_SECRET with at least 32 characters."
                    )
        elif self.sms_provider.lower() not in {"fake", "twilio"}:
            raise ValueError("SMS_PROVIDER must be fake or twilio.")
        if self.storage_provider.lower() not in {"local", "s3"}:
            raise ValueError("STORAGE_PROVIDER must be local or s3.")
        if not 1 <= self.photo_max_upload_bytes <= 50 * 1024 * 1024:
            raise ValueError("PHOTO_MAX_UPLOAD_BYTES must be between 1 and 50 MiB.")
        if self.app_env.lower() == "production":
            if self.storage_provider.lower() != "s3" or not all((
                self.storage_endpoint, self.storage_bucket, self.storage_access_key,
                self.storage_secret_key,
            )):
                raise ValueError("Production requires complete S3-compatible storage settings.")
            if not self.storage_endpoint.startswith("https://"):
                raise ValueError("Production STORAGE_ENDPOINT must use HTTPS.")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

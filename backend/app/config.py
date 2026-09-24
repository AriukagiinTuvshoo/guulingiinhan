from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./guulingiinhan.db"
    cors_origins: str = "http://localhost:3000"
    session_cookie_name: str = "guulingiinhan_session"
    otp_hash_secret: str | None = None
    sms_provider: str = "fake"
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def validate_production_settings(self):
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
        elif self.sms_provider.lower() not in {"fake", "twilio"}:
            raise ValueError("SMS_PROVIDER must be fake or twilio.")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

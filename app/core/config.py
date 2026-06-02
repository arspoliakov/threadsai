from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/app.db",
        validation_alias="DATABASE_URL",
    )
    deepinfra_api_key: str = Field(
        default="",
        validation_alias="DEEPINFRA_API_KEY",
    )
    telegram_bot_token: str = Field(
        default="",
        validation_alias="TELEGRAM_BOT_TOKEN",
    )
    telegram_bot_username: str = Field(
        default="",
        validation_alias="TELEGRAM_BOT_USERNAME",
    )
    admin_chat_id: int | None = Field(
        default=None,
        validation_alias="ADMIN_CHAT_ID",
    )
    admin_bot_token: str = Field(
        default="",
        validation_alias="ADMIN_BOT_TOKEN",
    )
    admin_tg_id: int | None = Field(
        default=None,
        validation_alias="ADMIN_TG_ID",
    )
    queue_alert_delay_minutes: int = Field(
        default=30,
        validation_alias="QUEUE_ALERT_DELAY_MINUTES",
    )
    alert_cooldown_minutes: int = Field(
        default=180,
        validation_alias="ALERT_COOLDOWN_MINUTES",
    )
    proxy_host: str = Field(
        default="",
        validation_alias="PROXY_HOST",
    )
    proxy_login: str = Field(
        default="",
        validation_alias="PROXY_LOGIN",
    )
    proxy_password: str = Field(
        default="",
        validation_alias="PROXY_PASSWORD",
    )
    proxy_port_start: int = Field(
        default=10000,
        validation_alias="PROXY_PORT_START",
    )
    proxy_port_end: int = Field(
        default=10999,
        validation_alias="PROXY_PORT_END",
    )
    proxy_rotation_seconds: int = Field(
        default=300,
        validation_alias="PROXY_ROTATION_SECONDS",
    )
    selenium_deadline_seconds: int = Field(
        default=250,
        validation_alias="SELENIUM_DEADLINE_SECONDS",
    )
    max_concurrent_browsers: int = Field(
        default=3,
        validation_alias="MAX_CONCURRENT_BROWSERS",
    )
    proxy_failure_threshold: int = Field(
        default=3,
        validation_alias="PROXY_FAILURE_THRESHOLD",
    )
    chrome_driver_backend: str = Field(
        default="selenium",
        validation_alias="CHROME_DRIVER_BACKEND",
    )
    chrome_profiles_dir: str = Field(
        default="./data/chrome_profiles",
        validation_alias="CHROME_PROFILES_DIR",
    )
    proxy_extensions_dir: str = Field(
        default="./data/proxy_extensions",
        validation_alias="PROXY_EXTENSIONS_DIR",
    )
    web_admin_token: str = Field(
        default="dev-admin-token",
        validation_alias="WEB_ADMIN_TOKEN",
    )
    web_admin_password: str = Field(
        default="Arsarsars5!",
        validation_alias="WEB_ADMIN_PASSWORD",
    )
    jwt_secret_key: str = Field(
        default="change-me-local-jwt-secret",
        validation_alias="JWT_SECRET_KEY",
    )
    jwt_access_token_expire_minutes: int = Field(
        default=60 * 24 * 7,
        validation_alias="JWT_ACCESS_TOKEN_EXPIRE_MINUTES",
    )
    telegram_auth_max_age_seconds: int = Field(
        default=60 * 60 * 24,
        validation_alias="TELEGRAM_AUTH_MAX_AGE_SECONDS",
    )
    approved_telegram_ids: str = Field(
        default="641434769",
        validation_alias="APPROVED_TELEGRAM_IDS",
    )
    public_app_url: str = Field(
        default="https://threadsgo.ru",
        validation_alias="PUBLIC_APP_URL",
    )

    def approved_telegram_id_set(self) -> set[int]:
        raw_ids = self.approved_telegram_ids.replace(";", ",").replace(" ", ",")
        approved_ids: set[int] = set()

        for raw_id in raw_ids.split(","):
            value = raw_id.strip()
            if not value:
                continue

            try:
                approved_ids.add(int(value))
            except ValueError:
                continue

        return approved_ids

    def is_telegram_id_approved(self, telegram_id: int | None) -> bool:
        if telegram_id is None:
            return False

        return telegram_id in self.approved_telegram_id_set()


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

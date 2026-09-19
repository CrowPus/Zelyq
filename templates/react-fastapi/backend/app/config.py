from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")
    # Local-first: a project has its own SQLite database unless it is pointed
    # somewhere else, so a new application can save things immediately and an
    # exported one still runs with no configuration at all.
    database_engine: Literal["none", "sqlite", "postgresql", "mysql", "supabase"] = "sqlite"
    database_url: str = ""
    # Read-only protects data somebody else owns; an application's own schema
    # is writable. Zelyq sends both explicitly for a connected database.
    database_read_only: bool = False
    database_ownership: Literal["external", "application"] = "application"
    database_schema: str | None = None
    database_tables: str = ""
    # Path to a CA bundle for a database behind a private or self-signed CA.
    # TLS verification stays on; this only says who to trust.
    database_ssl_root_cert: str = ""
    zelyq_data_dir: str = "../.runtime-data"
    auth_mode: Literal["none", "jwt"] = "none"
    auth_issuer: str = ""
    auth_audience: str = ""
    auth_jwks_url: str = ""
    supabase_url: str = ""
    supabase_publishable_key: str = ""

    @model_validator(mode="after")
    def validate_auth(self) -> "Settings":
        if self.auth_mode == "jwt" and not all(
            [self.auth_issuer, self.auth_audience, self.auth_jwks_url]
        ):
            raise ValueError("JWT authentication requires issuer, audience, and JWKS URL")
        return self


@lru_cache
def settings() -> Settings:
    return Settings()

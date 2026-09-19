"""Bring this app's own database up to date before the server starts.

The preview does this for you. A deployed container has nobody to do it, so
without this step a fresh deploy starts with no tables and every request that
touches data fails.

Only the SQLite file this app owns is migrated here — the same rule the preview
follows. A database somebody else owns (their PostgreSQL or MySQL, an existing
schema) is never changed on startup: run `alembic upgrade head` against it on
purpose, when you mean to.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

from .config import settings


def owns_local_database() -> bool:
    config = settings()
    return (
        config.database_engine == "sqlite"
        and config.database_ownership == "application"
        and not config.database_url
    )


def main() -> None:
    if not owns_local_database():
        print("prestart: not this app's own SQLite database; leaving the schema alone")
        return
    alembic_ini = Path(__file__).resolve().parents[1] / "alembic.ini"
    command.upgrade(Config(str(alembic_ini)), "head")
    print("prestart: database is up to date")


if __name__ == "__main__":
    main()

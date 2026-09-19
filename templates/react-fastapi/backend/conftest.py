"""Test setup shared by every test in this project.

Tests get their own throwaway database in a temporary directory, created fresh
for each run. They never touch the database the preview uses, and they can
never reach a configured PostgreSQL or MySQL: the environment is replaced
before the application reads it.
"""

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

# Set before importing anything from `app`: configuration is read once and
# cached, so this has to be in place first.
_TEMPORARY = tempfile.mkdtemp(prefix="app-tests-")
os.environ.update(
    ZELYQ_DATA_DIR=_TEMPORARY,
    DATABASE_ENGINE="sqlite",
    DATABASE_URL="",
    DATABASE_OWNERSHIP="application",
    DATABASE_READ_ONLY="false",
    AUTH_MODE="none",
)

from app.config import settings
from app.db import engine
from app.models import Base


@pytest.fixture(scope="session", autouse=True)
def _schema() -> Iterator[None]:
    """Create the tables once for the run.

    `create_all` is the right tool here and the wrong one in production: it
    builds whatever the models currently describe, which is what a test wants
    and is not a reviewed migration. Schema changes still go through Alembic.
    """
    settings.cache_clear()
    engine.cache_clear()
    Base.metadata.create_all(engine())
    yield
    engine().dispose()


@pytest.fixture(autouse=True)
def _clean_tables() -> Iterator[None]:
    """Each test starts from empty tables, so order cannot change a result."""
    yield
    with engine().begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())


def pytest_sessionfinish() -> None:
    for leftover in Path(_TEMPORARY).glob("*"):
        leftover.unlink(missing_ok=True)
    Path(_TEMPORARY).rmdir()

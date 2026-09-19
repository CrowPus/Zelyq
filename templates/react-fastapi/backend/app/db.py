from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from .config import settings


@lru_cache
def engine() -> Engine:
    config = settings()
    if config.database_engine in ("none", "supabase"):
        raise ValueError("Select a direct SQL database first")
    if config.database_engine == "sqlite":
        root = Path(config.zelyq_data_dir).resolve()
        root.mkdir(parents=True, exist_ok=True)
        url = make_url(config.database_url or f"sqlite:///{root / 'application.db'}")
        if url.get_backend_name() != "sqlite" or not url.database:
            raise ValueError("Expected a SQLite file")
        target = Path(url.database).resolve()
        if not target.is_relative_to(root):
            raise ValueError("SQLite files must be inside the project runtime data directory")
        return create_engine(url, connect_args={"check_same_thread": False, "timeout": 5})
    url = make_url(config.database_url)
    if url.get_backend_name() != config.database_engine:
        raise ValueError("Database engine and URL do not match")
    driver = "postgresql+psycopg" if config.database_engine == "postgresql" else "mysql+pymysql"
    url = url.set(drivername=driver)
    args: dict[str, Any] = {"connect_timeout": 5}
    # A database behind a private or self-signed CA can still be verified, but
    # only if its root certificate is available. Without a way to supply one,
    # verify-full makes those databases permanently unreachable — so the CA is
    # configuration, and verification stays on either way.
    ca_file = config.database_ssl_root_cert or None
    if ca_file and not Path(ca_file).is_file():
        raise ValueError("The configured database CA certificate file does not exist")
    if config.database_engine == "postgresql":
        args.update({"sslmode": "verify-full", "options": "-c statement_timeout=10000"})
        if ca_file:
            args["sslrootcert"] = ca_file
    else:
        args.update({"ssl_verify_cert": True, "ssl_verify_identity": True,
                     "read_timeout": 10, "write_timeout": 10})
        if ca_file:
            args["ssl_ca"] = ca_file
    return create_engine(url, connect_args=args, pool_size=3, max_overflow=2,
                         pool_timeout=5, pool_pre_ping=True, pool_recycle=300)


@contextmanager
def transaction(*, write: bool = False) -> Iterator[Session]:
    if write and settings().database_read_only:
        raise PermissionError("This connection is read-only")
    with Session(engine()) as session, session.begin():
        if settings().database_read_only:
            dialect = session.get_bind().dialect.name
            if dialect == "postgresql":
                session.execute(text("SET TRANSACTION READ ONLY"))
            elif dialect == "mysql":
                # MySQL has no per-transaction switch on an already-open
                # transaction, so start a read-only one explicitly rather than
                # leaving this to the credentials and calling it enforced.
                session.execute(text("COMMIT"))
                session.execute(text("START TRANSACTION READ ONLY"))
            elif dialect == "sqlite":
                session.execute(text("PRAGMA query_only = ON"))
        yield session


def describe_database() -> dict[str, Any]:
    """Metadata only. Never sample user rows.

    For a database the application owns, every table is described — it is this
    app's own schema and seeing it is how you work on it. For a database
    somebody else owns, only the tables explicitly selected for inspection are
    touched, and nothing is described until someone has chosen them.
    """
    config = settings()
    selected = [name for name in config.database_tables.split(",") if name]
    with engine().connect() as connection:
        connection.execute(text("SELECT 1"))
        inspector = inspect(connection)
        if not selected and config.database_ownership == "application":
            selected = [
                name
                for name in inspector.get_table_names(schema=config.database_schema)
                if name != "alembic_version"
            ]
        result = []
        for name in selected:
            if not inspector.has_table(name, schema=config.database_schema):
                raise ValueError("A selected table is unavailable")
            result.append({"name": name, "columns": [
                {"name": col["name"], "type": str(col["type"]), "nullable": col["nullable"]}
                for col in inspector.get_columns(name, schema=config.database_schema)
            ], "primaryKey": inspector.get_pk_constraint(name, schema=config.database_schema),
                "foreignKeys": inspector.get_foreign_keys(name, schema=config.database_schema)})
        return {"connected": True, "tables": result,
                "notice": "Connectivity and selected metadata only; write and DDL permissions were not tested."}

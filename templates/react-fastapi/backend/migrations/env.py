from alembic import context

from app.config import settings
from app.db import engine
from app.models import Base

if settings().database_ownership != "application":
    raise RuntimeError("This schema is externally managed. Migration ownership must be authorized first.")
if context.is_offline_mode():
    raise RuntimeError("Generate/review migrations against a disposable database of the selected engine.")

with engine().connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata,
                      include_schemas=bool(settings().database_schema),
                      version_table_schema=settings().database_schema)
    with context.begin_transaction():
        context.run_migrations()

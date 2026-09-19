from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Every table in this application inherits from this.

    Alembic autogenerates migrations from whatever is imported here, so a model
    defined in another module must be imported into this one or its table will
    be silently left out of the next migration.
    """


class Note(Base):
    """A worked example of persistence — replace it with the real thing.

    Kept deliberately small: it exists so the path from model to migration to
    API route to screen is already proven in a new project, not so that every
    application has notes in it.
    """

    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    body: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

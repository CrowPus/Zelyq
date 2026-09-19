import csv
import io
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from .auth import current_user
from .config import settings
from .db import engine, transaction
from .models import Note

app = FastAPI(title="Python application API", version="1.0.0", docs_url="/api/docs",
              openapi_url="/api/openapi.json", redoc_url=None)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"error": {"message": str(exc.detail)}}, status_code=exc.status_code,
                        headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Say which field is wrong and why. "Invalid request" alone leaves whoever
    # sent it — a form, a test, the agent building the UI — guessing. The
    # submitted value itself is left out, so a rejected password or token is
    # never echoed back.
    fields = [
        {"field": ".".join(str(part) for part in error["loc"][1:]) or "body",
         "message": error["msg"]}
        for error in exc.errors()
    ]
    return JSONResponse({"error": {"message": "Invalid request", "fields": fields}},
                        status_code=422)


class Health(BaseModel):
    status: str


@app.get("/api/health/live", response_model=Health)
def live() -> Health:
    return Health(status="ok")


@app.get("/api/health/ready", response_model=Health)
def ready() -> Health:
    config = settings()
    if config.database_engine not in ("none", "supabase"):
        try:
            with engine().connect() as connection:
                connection.execute(text("SELECT 1"))
        except (SQLAlchemyError, ValueError, OSError):
            raise HTTPException(503, "Configured database is unavailable") from None
    return Health(status="ready")


class Identity(BaseModel):
    subject: str


@app.get("/api/me", response_model=Identity)
def me(user: Annotated[dict[str, object], Depends(current_user)]) -> Identity:
    return Identity(subject=str(user["sub"]))


class CsvReport(BaseModel):
    columns: list[str]
    rows: int


@app.post("/api/reports/csv", response_model=CsvReport)
async def report(request: Request) -> CsvReport:
    # This demo processes bytes without persistence. Protect it with current_user
    # when the application's requirements call for authenticated processing.
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 1_000_000:
            raise HTTPException(413, "CSV files must be at most 1 MB")
    try:
        rows = csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True)
        columns = next(rows)
        if not columns or len(columns) > 100 or len(set(columns)) != len(columns):
            raise ValueError()
        count = 0
        for row in rows:
            if len(row) != len(columns):
                raise ValueError()
            count += 1
            if count > 10000:
                raise HTTPException(413, "CSV files must have at most 10,000 rows")
        return CsvReport(columns=columns, rows=count)
    except (UnicodeDecodeError, csv.Error, ValueError, StopIteration):
        raise HTTPException(422, "Provide valid UTF-8 CSV with unique headers and consistent columns") from None


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=500)


class NoteOut(BaseModel):
    id: int
    body: str
    created_at: datetime


# A worked persistence example: model -> migration -> route -> screen. Every
# project starts with its own SQLite database, so this works with no setup.
# Replace these routes with the application's real ones.
def _require_database() -> None:
    if settings().database_engine == "none":
        raise HTTPException(503, "This application has no database configured")


@app.get("/api/notes", response_model=list[NoteOut])
def list_notes() -> list[NoteOut]:
    _require_database()
    with transaction() as session:
        rows = session.scalars(select(Note).order_by(Note.id.desc()).limit(100))
        # Build the response inside the transaction. A SQLAlchemy row read
        # after its session closes raises DetachedInstanceError the moment
        # anything touches an attribute, so never return ORM objects.
        return [NoteOut(id=r.id, body=r.body, created_at=r.created_at) for r in rows]


@app.post("/api/notes", response_model=NoteOut, status_code=201)
def create_note(note: NoteIn) -> NoteOut:
    _require_database()
    try:
        with transaction(write=True) as session:
            row = Note(body=note.body)
            session.add(row)
            # flush assigns the primary key and defaults without ending the
            # transaction, so they can be read back here.
            session.flush()
            return NoteOut(id=row.id, body=row.body, created_at=row.created_at)
    except PermissionError:
        raise HTTPException(403, "This database is connected read-only") from None


# Build output is optional in development. The API namespace is reserved even
# when the frontend uses a catch-all route for browser refreshes.
frontend = Path(__file__).resolve().parents[2] / "dist"
if (frontend / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")


@app.get("/{resource:path}", include_in_schema=False)
def spa(resource: str) -> FileResponse:
    if resource == "api" or resource.startswith("api/"):
        raise HTTPException(404, "API endpoint not found")
    candidate = (frontend / resource).resolve()
    if not candidate.is_relative_to(frontend.resolve()):
        raise HTTPException(404, "Not found")
    if candidate.is_file():
        return FileResponse(candidate)
    if (frontend / "index.html").is_file():
        return FileResponse(frontend / "index.html")
    raise HTTPException(404, "Frontend build not found")

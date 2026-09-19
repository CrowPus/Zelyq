"""Behaviour tests for the starter API.

These run against the real app through HTTPX, not against mocks, and they are
the pattern to follow when you add routes: assert the status code, the response
shape, and what happens when the input is wrong — not only the happy path.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _fresh_settings() -> None:
    """Configuration is cached per process; tests must not inherit each other's."""
    settings.cache_clear()


# --- health -----------------------------------------------------------------


def test_liveness_and_readiness_without_a_database() -> None:
    assert client.get("/api/health/live").json() == {"status": "ok"}
    # No database configured is a valid application, not a degraded one.
    assert client.get("/api/health/ready").json() == {"status": "ready"}


def test_health_does_not_disclose_configuration() -> None:
    body = client.get("/api/health/ready").text
    for leak in ("DATABASE_URL", "postgresql://", "password", "secret"):
        assert leak not in body


# --- the reference CSV workflow ---------------------------------------------


def test_csv_report_counts_rows_and_columns() -> None:
    result = client.post("/api/reports/csv", content="name,total\nA,4\nB,7\n")
    assert result.status_code == 200
    assert result.json() == {"columns": ["name", "total"], "rows": 2}


def test_csv_report_accepts_a_utf8_bom_and_an_empty_body_of_rows() -> None:
    # Spreadsheet exports routinely start with a BOM.
    assert client.post("/api/reports/csv", content="﻿name,total\nA,1\n").json() == {
        "columns": ["name", "total"],
        "rows": 1,
    }
    assert client.post("/api/reports/csv", content="name,total\n").json()["rows"] == 0


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        ("name,total\nA\n", "a short row"),
        ("name,name\nA,B\n", "duplicate headers"),
        ("", "no header at all"),
        (b"\xff\xfe\x00bad", "not UTF-8"),
    ],
)
def test_csv_report_rejects_malformed_input(body: str | bytes, reason: str) -> None:
    result = client.post("/api/reports/csv", content=body)
    assert result.status_code == 422, reason
    assert "error" in result.json()


def test_csv_report_bounds_the_work_it_accepts() -> None:
    assert client.post("/api/reports/csv", content="x" * 1_000_001).status_code == 413
    too_many = "n\n" + "".join(f"{i}\n" for i in range(10_001))
    assert client.post("/api/reports/csv", content=too_many).status_code == 413


# --- failing closed ---------------------------------------------------------


def test_protected_routes_are_unavailable_until_auth_is_configured() -> None:
    # A private route must never become public because nothing is configured.
    result = client.get("/api/me")
    assert result.status_code in (401, 503)
    assert result.json()["error"]["message"]


def test_a_rejected_request_never_returns_the_frontend() -> None:
    for path in ("/api/missing", "/api/reports/nope"):
        result = client.get(path)
        assert result.status_code == 404
        assert result.headers["content-type"].startswith("application/json")
        assert result.json()["error"]["message"] == "API endpoint not found"


def test_errors_share_one_shape() -> None:
    body = client.post("/api/reports/csv", content="a,a\n1,2\n").json()
    assert set(body) == {"error"}
    assert isinstance(body["error"]["message"], str)


def test_the_spa_catch_all_never_serves_a_file_outside_the_build() -> None:
    # An unknown browser route legitimately returns index.html, and whether a
    # build exists depends on where the tests run — so asserting a status code
    # would test the environment. What must hold either way is that no file
    # from outside the build directory comes back.
    for path in ("/../../etc/passwd", "/%2e%2e%2f%2e%2e%2fetc/passwd", "/..%2f..%2fetc/passwd"):
        result = client.get(path)
        assert result.status_code in (200, 404)
        assert "root:x:" not in result.text, f"{path} escaped the build directory"


# --- persistence ------------------------------------------------------------


def test_notes_persist_and_come_back_newest_first() -> None:
    first = client.post("/api/notes", json={"body": "first note"})
    assert first.status_code == 201
    assert first.json()["body"] == "first note"
    assert first.json()["id"] > 0

    second = client.post("/api/notes", json={"body": "second note"})
    assert second.status_code == 201

    listed = client.get("/api/notes")
    assert listed.status_code == 200
    bodies = [note["body"] for note in listed.json()]
    assert bodies[:2] == ["second note", "first note"]


def test_a_note_survives_a_new_client() -> None:
    client.post("/api/notes", json={"body": "written once"})
    # A separate client is a separate connection, so this reads from the
    # database rather than from anything held in memory.
    with TestClient(app) as fresh:
        assert any(n["body"] == "written once" for n in fresh.get("/api/notes").json())


@pytest.mark.parametrize("body", ["", "x" * 501])
def test_notes_reject_invalid_input(body: str) -> None:
    result = client.post("/api/notes", json={"body": body})
    assert result.status_code == 422
    # The response names the field, so a form can show the error next to it.
    assert result.json()["error"]["fields"][0]["field"] == "body"


def test_a_rejected_value_is_never_echoed_back() -> None:
    result = client.post("/api/notes", json={"body": "x" * 501})
    assert "x" * 501 not in result.text


def test_writes_are_refused_on_a_read_only_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    # Connecting somebody's database read-only must actually stop writes, not
    # merely label them.
    monkeypatch.setenv("DATABASE_READ_ONLY", "true")
    settings.cache_clear()
    assert client.post("/api/notes", json={"body": "should not be written"}).status_code == 403

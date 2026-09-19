---
name: python-backend
description: Build and verify a Zelyq React/FastAPI project with Python backend logic and the user's chosen database or identity provider. Use for projects declaring the react-fastapi runtime, not standalone frontend changes in other stacks.
---

# Python backend

## The user's request wins

Everything below describes the starter's defaults. When the user's request says
otherwise, **follow the request**: their file layout, their component names,
their Python version, their database file name, their README. A default is what
you do when they have not said.

- **A named structure** — `database.py`, `schemas.py`, `crud.py`, `routes/`,
  `LeadTable.tsx`, `services/api.ts` — gets built as named. Keep one database
  layer underneath: put the engine and `transaction()` in the file they asked
  for and have `db.py` re-export them, rather than running two engines.
- **`requirements.txt`**, when asked for, is generated from the lock so it cannot
  drift: `uv export --no-hashes --no-dev --format requirements-txt -o requirements.txt`
  in `backend/`. `uv.lock` stays what the preview installs from.
- **A Python version** (e.g. "3.12+"): set `backend/.python-version`,
  `requires-python` and `[tool.ruff] target-version` / `[tool.mypy] python_version`
  in `backend/pyproject.toml`, and the `FROM python:` line in `Dockerfile`. The next
  `start_preview` re-locks and fetches that Python itself — nothing to install, and
  no order to get right.
- **A database file name** (e.g. `leadflow.db`): change the default name in
  `backend/app/db.py`. It stays inside the project's runtime-data directory.
- **"Don't put everything in App.tsx"** or a listed component set: split the UI
  into those files. One file of 700 lines is not a finished frontend.
- **Anything the user rules out** — "no authentication", "no Supabase" — means the
  starter's examples of it go: `/api/me` and `backend/app/auth.py`,
  `backend/app/supabase.py`, the CSV example, the `Note` example. Keep the health
  routes, the error handlers and the SPA fallback.
- **README.md** is rewritten for the app you built: what it is, and exactly how to
  run both halves — in Zelyq and on a laptop, with the commands the user asked for.

## You have a step budget — spend it building

A turn has a fixed number of steps, and a full-stack feature needs most of them.
The map below is so you do not have to explore: it is accurate for a new project.

- **Do not verify the starter before changing it.** It is known-good and every
  check passes. Zelyq runs all of the checks in `zelyq.runtime.json` itself when
  your turn ends and hands you anything that fails.
- **To check your work, run `npm run check` — once, as one step.** It runs
  exactly the project's checks, the same ones Zelyq runs. Never chain your own
  commands, and never add stricter ones (`ruff format --check`, `mypy` on the
  tests): they are not this project's checks, and passing them proves nothing
  more — failing them just costs you rewrite steps.
- **Do not install anything by hand.** Call `start_preview` once, early: it
  installs both toolchains, applies migrations, starts both services, and gives
  you something to look at. Never run `npm ci`, `uv sync`, or Uvicorn yourself.
- **Read each file whole, once.** A file of up to 600 lines comes back complete
  in one call however you ask, so never page one in slices. Several `read_file`
  calls in one reply run together and cost a single step. Read only what you are
  about to change, and never the same file twice.
- **`start_preview` once.** Calling it again on a running preview does nothing;
  use `preview_logs` if something looks wrong.
- **Write code by your fifth step.** If you are still reading, you are over-reading.

## Starter map

Python commands run in `backend/`. Frontend commands run at the project root.

| File | What it is | What to do with it |
| --- | --- | --- |
| `backend/app/main.py` | The FastAPI app: error handlers, `/api/health/*`, the `Note` example routes, the CSV example, the SPA fallback | Add routes here, or in `backend/app/routes/` included from here. Keep the health routes, error handlers and SPA fallback. |
| `backend/app/models.py` | `Base` and the `Note` example model | Define every table here (or import it here). |
| `backend/app/db.py` | `engine()`, `transaction(write=...)`, the SQLite file name | Query through `transaction()`. Never run a second engine; if the user wants `database.py`, move these there and re-export them. |
| `backend/app/config.py` | `settings()` from the environment | Read configuration only through this. |
| `backend/app/auth.py`, `backend/app/supabase.py` | `current_user` (verified bearer tokens); a Supabase Data API client | Use them when the app signs people in or uses Supabase. Delete them, and `/api/me`, when it does not. |
| `backend/migrations/` | Alembic, with the initial `notes` migration | Leave existing revisions alone; add new ones. |
| `backend/tests/test_api.py`, `backend/conftest.py` | API tests on a throwaway database | Replace the note tests with tests for your routes. |
| `backend/pyproject.toml` + `uv.lock` | Dependencies, Python version, lint rules (`[tool.ruff.lint]`) | `uv add <pkg>` in `backend/`. `uv.lock` is what installs; a `requirements.txt` is only ever exported from it. |
| `src/App.tsx` | The page: the notes list and the CSV upload | Replace with the real UI, split into components — not one long file. |
| `src/index.css`, `index.html` | Tailwind; dark mode driven by a `dark` class on `<html>` | See "Dark mode" below. |
| `README.md` | The starter's own notes | Rewrite for the app, with how to run it. |
| `src/lib/api/schema.d.ts` | TypeScript types generated from the API | Never edit by hand. `npm run api:generate` after any change to a route or response model. |

**The `Note` example spans five places**: `models.py`, the routes in `main.py`,
its tests, `App.tsx`, and the generated client. When you replace it, replace it
in all of them in the same pass — and regenerate the client *before* touching
`App.tsx`, or the UI will reference types that no longer exist. Drop the CSV
example the same way if the app has no use for it.

React stays in `src/`; Python stays in `backend/app/`.

**After writing Python, run `uv run ruff check --fix .` in `backend/` once.** It
corrects import order and outdated syntax — the rules are listed in
`backend/pyproject.toml` — which otherwise fail the lint check and cost a pass.

## Dark mode

`dark:` classes follow a `dark` class on `<html>`, which `index.html` sets before
first paint from `localStorage.theme` or, failing that, the OS. So:

- A theme toggle flips the class and saves the choice —
  `const on = document.documentElement.classList.toggle("dark"); localStorage.setItem("theme", on ? "dark" : "light");`
  — and never reads `prefers-color-scheme` itself.
- **Click the toggle in the preview before saying it works**, and check the page
  actually changes colour. A toggle that only flips a class nobody reads looks
  finished in code and does nothing on screen.

## The project already has a database

Every project of this stack owns a SQLite database at `.runtime-data/application.db`.
It is there from the moment the project exists, it is writable, and the app owns
its schema. **Never ask the user for a database, a connection string, or a
Supabase project before you can save data.** Saving things is the default; an
app with no persistence is the special case.

To add or change a table:

1. Define the model in `backend/app/models.py` (a model in another module must be
   imported there, or autogenerate will miss its table).
2. Run **`npm run db:revision -- "what changed"`** at the project root. It brings
   the database current, generates the migration, tidies it so it passes lint,
   and applies it — in the order that works. Do not run the `alembic` commands
   yourself: autogenerate against a database that is not current fails with
   "Target database is not up to date".
3. **Read the generated migration and correct it** — autogenerate guesses,
   particularly at renames, server defaults and type changes. Commit it with the
   code. `start_preview` applies it on its own from then on.

Query through `transaction()`. Build responses **inside** the session: a
SQLAlchemy row read after its session closes raises `DetachedInstanceError`.
Use `transaction(write=True)` for writes, and parameterised queries and explicit
user/tenant filters throughout.

### When the user brings their own database

PostgreSQL, MySQL or Supabase are an upgrade the user chooses, configured in the
editor's Backend panel — not something to build toward on your own. The models
and routes you wrote carry over. Then the rules change and they are strict:
an existing external schema is mapped, never migrated; automatic migration is
off; discovery reads metadata for selected tables only and never samples rows;
and a read-only connection stays read-only. A connection is not permission to
change a schema or read production data.

Use the editor's Backend configuration for credentials. Secrets are injected
into the backend by the server, never into the agent, browser, source, or logs.
Project `DATABASE_URL` is unrelated to the Zelyq platform's database. For missing
configuration, name what is needed; do not invent values or swap databases.

Keep HTTP models explicit and regenerate the TypeScript client after API changes
with `npm run api:generate`. Use request-scoped database sessions, parameterized
queries, transactions, and explicit user/tenant filters. A database service
credential does not authenticate application users. Protect private routes with
verified access tokens and enforce authorization after verification. Supabase
Data API calls must preserve the caller's JWT if they rely on RLS.

AI calls in this stack run in Python with a backend secret and the provider's
installed Python SDK or documented HTTP API. Do not introduce Supabase Edge
Functions merely to hold an API key. User-owned credentials need explicit user
ownership and encrypted storage; project-wide credentials use Backend settings.

Use `uv add` in `backend/` for necessary dependencies and commit `uv.lock`. Zelyq
runs every check in `zelyq.runtime.json` — lint, types, pytest, the OpenAPI
contract — when your turn ends; fix what it reports. Test cross-user access and
transaction failures when modifying persistence. Source undo does not roll back
databases.

Use the starter's production Dockerfile for a portable deployment; Vite proxying
is a development mechanism. Keep `.runtime-data`, virtual environments, caches,
and credentials out of Git and snapshots. Report which services and checks
passed, failed, or could not run. A frontend build alone does not verify Python.

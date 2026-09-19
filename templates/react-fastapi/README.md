# {{projectName}}

React + TypeScript frontend with a Python 3.11/FastAPI backend. Supabase is optional.

## Development

In Zelyq, start the preview to install locked dependencies, apply migrations, and
run both services. There is nothing to configure first — this project already has
its own database. Use **Backend** later if you want to point it at your own
PostgreSQL or MySQL, or to add an identity provider; those changes stop the
preview, so start it again to pick them up.

Zelyq installs the Python toolchain for you, so there is nothing to set up
first. To run this project outside Zelyq you need Node 22 and
[uv](https://docs.astral.sh/uv/getting-started/installation/) (it fetches its
own Python), then:

```sh
npm ci
cd backend
uv sync --locked --all-extras
uv run --locked uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

In another terminal at the project root, run `npm run dev`. Vite proxies `/api`
to `http://127.0.0.1:8000`; override `ZELYQ_API_TARGET` when needed.

The CSV example processes at most 1 MB/10,000 rows without saving input. The
`/api/me` route remains unavailable until authentication is configured. For a
private application, protect business routes with `current_user` and explicit
authorization. Configure an API-specific audience with the identity provider;
OIDC ID tokens are not API access tokens.

## Data

This project owns a SQLite database at `.runtime-data/application.db` (or under
`ZELYQ_DATA_DIR`). It exists from the start, it is writable, and it sits outside
the source tree — so it is not in git, not in snapshots, and code undo never
touches your data.

To add a table:

1. Add the model to `backend/app/models.py`. A model defined elsewhere must be
   imported there, or autogenerate will miss its table.
2. `uv run alembic revision --autogenerate -m "what changed"` in `backend/`.
3. **Read the generated migration and correct it** — autogenerate guesses,
   especially at renames, server defaults and type changes.
4. Start the preview. Migrations for this local database are applied before the
   API starts. Commit the migration alongside the code.

Query through `transaction()` in `backend/app/db.py`, and build responses inside
the session: a SQLAlchemy row read after its session closes raises
`DetachedInstanceError`. The `notes` table is a worked example — replace it.

### Using your own database

Choose PostgreSQL, MySQL or a linked Supabase project in **Backend** settings.
Your models and routes carry over. From then on the rules are stricter, because
the data is not this app's to lose:

- An existing schema is **externally managed**: it is mapped, never migrated,
  and migrations are never applied automatically.
- Inspection reads metadata for the tables you select. It does not read rows.
- A read-only connection is enforced per transaction, and read-only database
  credentials remain the real boundary.
- Remote connections verify TLS. Set `DATABASE_SSL_ROOT_CERT` for a private CA.

Tests never touch any of this: `conftest.py` gives each run its own throwaway
database and overrides the environment before the app reads it.

## Verification

`zelyq.runtime.json` lists all checks. Run Python commands from `backend/`:

```sh
uv run --locked --all-extras ruff check .
uv run --locked --all-extras mypy app
uv run --locked --all-extras pytest -q
```

Run `npm run typecheck`, `npm run build`, and `npm run api:check` from the root.
After changing the API, run `npm run api:generate` and review/commit both generated
schema files. Tests use isolated fixtures, not configured production data.

## Deployment

Build `docker build -t my-python-app .`, then run it with port 8000 published and
backend environment variables supplied by your deployment platform. Mount a
persistent volume at `/data` when using SQLite or saved files. On start, the
container brings this app's own SQLite database up to date (`app/prestart.py`)
before the API accepts requests; a database you connected yourself is never
migrated on start — run `alembic upgrade head` against it deliberately. This image serves
the built React app and API without Vite or a Zelyq connection. Terminate HTTPS at
your platform's proxy. SQLite is a single-instance configuration; independent
replicas require a shared database service. Unknown `/api` routes return JSON 404s.

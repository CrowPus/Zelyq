# React + Python application

Frontend: React/TypeScript in `src/`. Backend: FastAPI in `backend/app/`, with
its own SQLite database already set up. `zelyq.runtime.json` declares how the
project installs, runs and is checked.

- What the person asked for wins over the starter's layout: their file names,
  structure, Python version and README. The python-backend guide says how.
- Start both services with Zelyq's `start_preview`; do not run Uvicorn or
  `npm run dev` yourself.
- Add or change a table with `npm run db:revision -- "what changed"`, then read
  the migration it writes. Migrations never run on API startup or code undo.
- After changing a route or response model, `npm run api:generate`.
- After writing Python, `uv run ruff check --fix .` in `backend/`.
- To check your work, `npm run check` — once. Zelyq also runs every check when a
  turn ends.
- Credentials go in the editor's Backend settings, never in source or logs.

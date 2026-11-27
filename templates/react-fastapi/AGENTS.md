# React + Python application

Frontend: React/TypeScript in `src/`. Backend: FastAPI in `backend/app/`, with
its own SQLite database already set up. `zelyq.runtime.json` declares how the
project installs, runs and is checked.

- What the person asked for wins over the starter's layout: their file names,
  structure, Python version and README. The python-backend guide says how.
- Start both services with Zelyq's `start_preview`; do not run Uvicorn or
  `npm run dev` yourself.
- Add or change a table with `npm run db:revision -- "what changed"`, then read
  the migration it writes. Migrations run before the API starts (the preview,
  and `app/prestart.py` in the container), only against the app's own SQLite,
  and never on code undo.
- After changing a route or response model, `npm run api:generate`.
- After writing Python, `uv run ruff check --fix .` in `backend/`.
- To check your work, `npm run check` — once. Zelyq also runs every check when a
  turn ends.
- Credentials go in the editor's Backend settings, never in source or logs.

## Design system

The frontend has one in place. Colours are roles in `src/index.css` (`background`, `foreground`,
`card`, `primary`, `muted`, `accent`, `destructive`, `border`, `ring`, `chart-1…5`), light and
dark, with `--radius` and `--font-sans` (Inter); use the roles in classes (`bg-primary`,
`text-muted-foreground`), never a raw colour, and give the app its identity by changing the values
there. Components are in `src/components/ui/` (shadcn/ui: button, input, label, textarea, field,
card, badge, separator, checkbox, switch, radio-group, select, dialog, sheet, popover,
dropdown-menu, tabs, tooltip, table, alert, progress, skeleton, sonner for toasts). Build with
them rather than hand-styled raw elements; add more with `npx shadcn@latest add <name>` and keep
its `cn` import at `@/lib/utils`. New interface matches what is around it: the same components,
spacing and control heights, related controls grouped, an example value as each placeholder.
Frontend logic tests: `*.test.ts` beside the code, `npm test` (Vitest).

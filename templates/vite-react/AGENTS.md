# Project instructions

Notes for the coding agent about *this* project. Edit this file — keep it short — and every
session reads it before it starts work. It wins over the agent's general defaults; it does not
override what you actually ask for in a message.

## Stack

React 19 + TypeScript + Vite + Tailwind CSS v4, with a design system already in place:

- **Tokens** in `src/index.css`: every colour has a role (`background`, `foreground`, `card`,
  `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `chart-1…5`),
  with light and dark values, plus `--radius` and `--font-sans` (Inter). Use the roles in classes
  (`bg-primary`, `text-muted-foreground`, `border-border`), never a raw colour like `bg-blue-600`.
  To give the app its identity, change the token values there, once.
- **Components** in `src/components/ui/` (shadcn/ui, new-york): button, input, label, textarea,
  field, card, badge, separator, checkbox, switch, radio-group, select, dialog, sheet, popover,
  dropdown-menu, tabs, tooltip, table, alert, progress, skeleton, sonner (toasts:
  `import { toast } from "sonner"`). Use them instead of hand-styling a raw `<button>` or
  `<input>`; restyle one with `className` and `cn()` from `@/lib/utils`. More:
  `npx shadcn@latest add <name>`; afterwards make sure its `cn` import is `@/lib/utils`.
- **Icons:** `lucide-react`.

## Conventions

- Components in `src/components/`, one component per file, named the same as the file.
- Prefer function components and hooks. No class components.
- Reach for a design token (a colour role, `--radius`, a Tailwind spacing step) before a one-off
  size or colour.
- New interface on an existing page matches what is already there: the same components, spacing
  and control heights, related controls grouped, an example value as each input's placeholder.
- Keep files readable — split a component up before it gets long.
- Logic that computes something (a conversion, a total, a rule) lives in `src/lib/`, with a
  `*.test.ts` file beside it. `npm test` runs them with Vitest.

## What this project is not

A single-page frontend. There is no backend, no database, and no deploy pipeline in this repo
unless you add one because a request needs it.

## Dark mode

`dark:` classes follow a `dark` class on `<html>`, set before first paint by
`index.html` from `localStorage.theme` or the OS, so the app follows the OS with
nothing more to build. Add a theme toggle only when the person asks for one; it
flips that class and saves `"dark"` or `"light"` under `theme` — it never reads
`prefers-color-scheme` itself. Click it in the preview and check the page
actually changes before calling it done.

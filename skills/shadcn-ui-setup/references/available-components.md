# Components worth knowing about

Not exhaustive — the CLI's own catalog is the source of truth
(`npx shadcn@latest add`, no argument, lists everything current). This is
the subset that comes up often enough to be worth recognizing by name
before reaching for the CLI, grouped by what they're actually for.

## Overlays — content that sits above the page

- **dialog** — a modal that takes focus and blocks the page behind it.
  Reach for this when the request says "confirm", "modal", or describes
  something that must be dismissed before continuing.
- **sheet** — the same idea, sliding in from an edge instead of centered.
  Reach for this for a cart, a filter panel, or anything the request
  describes as a "drawer" or "panel".
- **popover** / **dropdown-menu** — anchored to a trigger element, not
  blocking. A popover holds arbitrary content; a dropdown-menu holds a
  list of actions. Do not use a dialog for either — the focus-trapping
  behavior is wrong for something meant to stay lightweight.
- **tooltip** — a hint on hover/focus, never a click target itself.

## Input and forms

- **input**, **textarea**, **select**, **checkbox**, **radio-group**,
  **switch** — the primitives. Prefer these over a hand-rolled `<input>`
  whenever the request names a form field; they carry the right ARIA
  attributes and focus styles by default.
- **form** — wraps `react-hook-form` with the project's validation
  pattern. Only add this when the task genuinely needs validation
  (required fields, format checks) — a two-field contact form with no
  validation logic does not need this dependency at all.
- **combobox** — a searchable select. This is a composition of
  **popover** + **command**, not a single `add` — the CLI's own docs show
  the pairing. Reach for it only when the request implies search-as-you-
  type over a list, not for an ordinary dropdown.

## Feedback and status

- **toast** (via **sonner**) — a transient notification after an action
  completes. Use this instead of an inline "Saved!" message that never
  goes away.
- **alert** — a persistent, inline message (a warning banner, an error
  summary) that stays until dismissed or the condition changes.
- **skeleton** — a loading placeholder shaped like the content it's
  standing in for. Reach for this over a spinner when the layout of the
  eventual content is already known.

## Layout

- **card** — the default container for a grouped, titled block of
  content. This is usually what "a card" in a request means before
  reaching for a hand-rolled bordered div.
- **tabs** — only when the request actually describes switching between
  views in place, not for ordinary page navigation.
- **separator** — a styled `<hr>`-equivalent; use it over a manual
  border utility when the intent is "divide these sections", not "style
  this specific edge".

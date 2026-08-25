---
name: shadcn-ui-setup
description: Install and wire shadcn/ui components into this React + Vite + Tailwind template correctly. Use when asked for shadcn, or for a component (dialog, dropdown, combobox, form) that shadcn provides and hand-rolling would be slower and worse.
---

# shadcn/ui in this template

shadcn/ui is not a package you install and import from — the CLI copies
real component source files straight into the project, which then belong
to it like any other file the agent wrote. Treating it as a normal
dependency (guessing at an import from `@shadcn/ui` or similar) is the
most common way this goes wrong, because no such package exists.

## Order matters

1. **Check first whether it is already set up** — look for
   `components.json` at the project root and a `src/components/ui/`
   directory before doing anything. A second init overwrites configuration
   a previous turn (or the person who started this project) may have
   already customized.
2. **If it is not set up yet**, this template already has everything the
   CLI's own init step would otherwise ask about — Vite, TypeScript,
   Tailwind, a `src/` root — so running it is close to a formality, not a
   real configuration decision. It needs a path alias (`@/*` →
   `./src/*`) in both `tsconfig.json` and `vite.config.ts` if one is not
   already there; the CLI will not add the second one for you.
3. **Add components with the CLI, one command per component** —
   `npx shadcn@latest add button dialog` and so on — never hand-write a
   file that imitates shadcn's shape. A hand-written stand-in drifts from
   the real component's accessibility behaviour (focus trapping, ARIA
   attributes, keyboard handling) in ways that are easy to miss and
   unpleasant to hit.
4. **Import from where the CLI put it** —
   `import { Button } from "@/components/ui/button"` — not from a package
   name. If an import does not resolve, the component was not actually
   added; add it, do not invent the module.

## What not to build

- Do not hand-roll a component shadcn already provides (a dialog, a
  dropdown menu, a select, a combobox, a form field) when one was asked
  for by name or by clear description — that is strictly worse than what
  the CLI installs, on both correctness and effort.
- Do not add components nobody asked for "while you're in there." A
  request for a dialog is a request for a dialog, not for the whole
  library — same discipline the agent's own scope rules already hold
  everywhere else.
- Do not skip verification. After adding a component, `start_preview` (or
  confirm it is already running) and check that the page still compiles —
  a missing path alias or an unset Tailwind content glob shows up
  immediately as a build error, not a subtle runtime bug.

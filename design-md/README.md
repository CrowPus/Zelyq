# Design references

One folder per reference, each with a `DESIGN.md` — an analysis of a real
product's design language: token front-matter (colour roles, a type scale
with an **open-source font substitute** for any proprietary face, spacing,
radius, elevation, component conventions) followed by prose (Overview,
Colors, Typography, Layout, Elevation, Shapes, Components, Do's & Don'ts,
Responsive, Iteration Guide).

`Agent.md` is a brand-neutral MUST/SHOULD/NEVER checklist for accessible,
fast, delightful UIs — keyboard and focus, forms, animation, layout,
accessibility, performance, dark mode, hydration, design detail.

## How the agent uses these

- **Architect Mode.** When the Architect writes a project's
  `architecture/DESIGN.md`, it sees a catalog of these references (slug +
  one-line summary), picks the one closest to the project's product
  category and personality, reads it with `use_design_ref("<slug>")`, and
  **adapts** it — renamed to the project's domain, trimmed of what doesn't
  apply, recoloured to the product's own identity. The reference informs
  roles and rhythm, not identity: the built app is never skinned as the
  referenced brand and never uses its logo. `DESIGN.md` records which
  reference it started from and what changed.
- **`Agent.md`** is inlined into the Architect and Engineer prompts. Its
  observable rules become gate items in the verification and design
  passes — a failing MUST (missing focus style, hydration-unsafe input,
  `<div onClick>` navigation, layout-shift images, …) is fixed or blocks
  "done".

## Adding your own

Point `ZELYQ_DESIGN_REFS_DIR` at a directory of the same shape. Your
entries are merged over the bundled set and win on a slug collision — so a
team can drop its **own** design system in as a reference and have every
build start from it. Loaded once at boot; restart to pick up changes.

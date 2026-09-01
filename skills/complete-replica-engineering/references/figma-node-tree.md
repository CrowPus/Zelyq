# Reference — the pruned Figma node → web mapping

The trees in `design/<key>/tree/<frame>.json` are already pruned (proposal 068).
Each node has a subset of: `id`, `name`, `type`, `bbox` (frame-relative,
rounded), `layout`, `constraints`, `fills`, `stroke`, `effects`, `radius`,
`opacity`, `text`, `component`, `children`, `truncated`.

## Layout

| Pruned field | Build as |
|---|---|
| `layout.mode: "row"` / `"col"` | `display: flex`; `flex-direction: row` / `column` |
| `layout.gap` | `gap` |
| `layout.padding: [t, r, b, l]` | `padding` |
| `layout.justify` (`flex-start` / `center` / `flex-end` / `space-between`) | `justify-content` |
| `layout.align` | `align-items` |
| `layout.wrap: true` | `flex-wrap: wrap` |
| **no `layout`** (Figma had `layoutMode: NONE`) | infer from `bbox`: equal-width siblings at one `y` → a flex row / `grid-template-columns`; stacked → a column. **Never `position: absolute`.** |
| `constraints.h: "stretch"` / `v: "stretch"` | fluid width / height (`width: 100%`, `flex: 1`) |
| `constraints.h: "center"` | centered, `margin-inline: auto` + a `max-width` |
| `constraints.h: "scale"` | fluid relative to the parent |
| `constraints` = `start` / `end` only | a fixed offset from that edge — still inside a flex/grid parent, not `absolute` |

`bbox` is for **verification and inference**, not for hardcoding `left`/`top`.

## Paint

| Pruned field | Build as |
|---|---|
| `fills: ["#rrggbb"]` | `background-color` (map to the nearest token) |
| `fills: ["rgba(…)"]` | `background-color` with alpha |
| `fills: ["linear-gradient(…)"]` / `["radial-gradient(…)"]` | `background-image` |
| `fills: ["image"]` | `<img>` (semantic) or `background-image` from `design/<key>/assets/` |
| `stroke: { color, weight }` | `border: <weight>px solid <color>` |
| `effects: ["shadow: x y blur spread color"]` | `box-shadow` |
| `effects: ["inner-shadow: …"]` | `box-shadow` with `inset` |
| `effects: ["blur: Npx"]` | `filter: blur(Npx)` |
| `effects: ["backdrop-blur: Npx"]` | `backdrop-filter: blur(Npx)` |
| `radius: 12` | `border-radius: 12px` |
| `radius: [tl, tr, br, bl]` | per-corner `border-radius` |
| `opacity: 0.6` | `opacity` |

## Text

`text: { content, fontFamily, fontWeight, fontSize, lineHeightPx?, letterSpacing?, align?, case?, decoration? }`

- Pick the **element by role**: biggest top text → `h1`; section leads → `h2`/`h3`;
  paragraphs → `p`; a short label on a filled, radius'd box → a `button` / `a`.
- `fontFamily` → the type token / `font-family` stack (load a Google font; else
  substitute + log).
- `lineHeightPx` → `line-height` (as px, or divide by `fontSize` for unitless).
- `letterSpacing` → `letter-spacing` (px).
- `case: "upper"` → `text-transform: uppercase`; `decoration: "underline"` →
  `text-decoration`.
- `content` may be clipped to 400 chars in the tree — read the render if you
  need the full string for a wrap-sensitive block.

## Components

- `component: { id, name }` on a node = it's an `INSTANCE` / `COMPONENT`.
- Same `component.id` on ≥ 2 nodes → **one** component in code, data mapped over
  it. Use `name` for the component's name.
- A `COMPONENT_SET`'s variants → props for each variant axis.

## Frame names as semantic hints

`Header` / `Nav` / `Navbar` → `<header>` / `<nav>`; `Footer` → `<footer>`;
`Hero` / `CTA` / `Section …` → a `<section>` with a matching class. Don't ship
the Figma layer names as class names verbatim — translate to the project's
convention.

## Tokens

`design/<key>/tokens.json` (Figma Variables) shape: `variables` keyed by id,
each with `name` (often `color/brand/500`, `space/4`, `radius/lg`),
`resolvedType`, and `valuesByMode`. `variableCollections` names the modes
(e.g. `Light`, `Dark`).

- `color/*` → CSS custom properties + the Tailwind `colors` scale.
- `space/*`, `radius/*`, `size/*` → the spacing / radius scale.
- Two modes named light/dark → the same properties redefined under `.dark`.
- **No `tokens.json`** (no Enterprise seat): build the palette from the most
  frequent `fills` across the frames and the `styles.json` color styles; build
  the type scale from the distinct `text` styles. Mark it inferred in
  `DESIGN.md`.

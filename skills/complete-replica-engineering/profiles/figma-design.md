# Profile — Figma design → website (`/figma`, proposal 068)

Load with `references/figma-node-tree.md` and `references/layout-and-computed-style.md`.

## The reference is a design file, not a running page

`/figma <link>` extracts server-side into **`design/<file-key>/`**:

- `tree/<frame>.json` — the pruned node tree per frame: geometry (`bbox`,
  frame-relative), `layout` (auto-layout → flex), resolved `fills`, `effects`,
  `radius`, `text` + text style, `component` identity, `constraints`.
- `render/<frame>.png` — a 2× PNG of the frame. **This is the visual truth for
  the diff loop**, the same role a screenshot plays for `/clone`.
- `assets/…` — image-fill bitmaps, already downloaded.
- `tokens.json` — Figma Variables (color/number, light/dark modes) **if the
  seat allowed it**; otherwise absent and you infer from `styles.json` + the
  frames.
- `styles.json` — shared text/color/effect styles.
- `manifest.json`, `EXTRACT.md` — what was pulled, what was capped, notes.

You do **not** call the Figma API. Work from these files. Read one frame's
tree at a time.

## The tree already has the numbers — do NOT measure the render

Every value you need is in `tree/<frame>.json`: `bbox` (position + size),
`radius`, `fills` (resolved hex / gradient), `stroke`, `effects` (shadow /
blur), `opacity`, and `text` with `fontSize` / `fontWeight` / `lineHeightPx` /
`letterSpacing` / `align`. **Use those.**

Do **NOT**:

- decode `render/<frame>.png` pixel by pixel (no `zlib.inflateSync` PNG
  readers, no manual filter reconstruction, no least-squares radius fitting, no
  colour sampling scripts);
- write `node -e` / `python3 -c` scripts to probe the image for geometry,
  radii, gradients, or colours;
- install or reach for `sharp` / image libraries to inspect the render.

This burns the whole turn (and, on an expensive model, real money) to
re-derive numbers you were already handed. If a value is genuinely missing
from the tree, pick a sensible one from the design system and move on — the
diff loop (step 4) is what catches a wrong radius or colour, not a pixel
probe. `inspect_image_asset` on the render once, to see the overall layout, is
fine; scripting the pixels is not.

## This is a REPLICA — reproduce, do not reinvent

The tree lists **every** text node with its exact `content` and `bbox`, and
every rectangle (`VECTOR` / `RECTANGLE`) with its `bbox`, `fills`, `radius`.
That is the whole design. Your build:

- **Must contain every string in the tree, verbatim** — every heading, label,
  number, caption. If the tree has `"Open tasks"`, `"18"`, `"+4 this week"`,
  `"Agent runs"`, `"42"`, `"87% verified"` … then those exact strings appear in
  your output. Substituting "representative" metrics, "plausible" copy, or a
  "similar" set of cards is a **failure**, not an acceptable approximation.
- **Must contain every section the render shows.** Count the distinct panels /
  cards / rows in `render/<frame>.png` and in the tree; build all of them, in
  the same order and the same grid. A stat-card row, a chart panel, a status
  panel, a table — if it's in the render, it's in your build. Skipping one
  because it's "hard to infer" is a failure.
- If a value or a sub-tree is genuinely missing from the data (a `truncated`
  marker, a chart with no data points), say so in `REPLICA.md` and render a
  faithful placeholder of the right size — do not invent plausible content to
  fill it.

## Reading a flat tree (no auto-layout)

Many Figma files use no auto-layout: the frame's children are a **flat list**
of `VECTOR`/`RECTANGLE` nodes (card and panel backgrounds) and `TEXT` nodes
positioned over them, all as direct children with absolute-ish `bbox`es and no
`layout`. To rebuild one:

1. Sort the children by `bbox.y`, then `bbox.x`.
2. A `VECTOR`/`RECTANGLE` with a large `bbox` is a **container** (a card, a
   panel, the sidebar). The `TEXT` and small `VECTOR` nodes whose `bbox` falls
   inside its rectangle are its **contents** — nest them under it.
3. Group the top-level containers into **rows** (nodes sharing a `bbox.y`
   band) and **columns** (by `bbox.x`). Four cards at the same `y` → a
   `grid-template-columns: repeat(4, 1fr)` / flex row. A tall box on the left
   + content on the right → a two-column layout.
4. Build every container and every text node you grouped. Size the grid and
   the gaps from the bboxes (a card `bbox.w` of 255 in a 1440 frame → roughly
   `minmax(0,1fr)` in a 4-up grid with the observed gap).
5. Still **never `position: absolute`** for page content — the bboxes tell you
   the structure; you express it with flex/grid.

## Order of work

1. **`design/<key>/REPLICA.md` first — no component code before it exists.**
   From the trees + renders: per-frame section inventory (shell, nav, hero,
   repeated blocks, footer), the typography roles and the palette in use, which
   frames are **routes** vs. **sections of one long page**, the responsive
   intent you can read from `constraints`/`layout`, and the target acceptance
   level (A/B/C).
2. **Tokens → the project's theme.** Turn `tokens.json` (or the values inferred
   from `styles.json` + the frames) into CSS custom properties + the Tailwind
   config, and a root `DESIGN.md`. A light/dark mode axis in the variables →
   `.dark`. Record in `DESIGN.md` whether the tokens came from Variables or were
   inferred — never present inferred tokens as authoritative.
3. **Build in the project's own framework**, macro geometry first
   (`references/layout-and-computed-style.md` §13). Map the tree per
   `references/figma-node-tree.md`.
4. **Diff loop — not optional, and not "one pass".** `start_preview`, then
   `capture_reference` (`mode: "single"`, `width` = the frame's `bbox.w`,
   `url` = the preview route, `diffAgainst: "design/<key>/render/<frame>.png"`).
   **Iterate until `changedRatio` < 0.10, or you have done 4 passes** —
   whichever comes first. One pass at 0.28 is not done. After each pass:
   `inspect_image_asset` the diff PNG, find the **largest red region**, name
   what it is (a missing section, wrong column count, wrong font size, wrong
   background), fix that one thing, recapture. Record each pass's ratio in
   `REPLICA.md`.
5. **Finish** with the §22 audit table (per frame/width: render vs. replica,
   largest remaining delta, acceptance level) + **token provenance** (Variables
   / inferred) + the asset list (copied / substituted). No "pixel-perfect"
   without the diff numbers.

## MUST

- **Never `position: absolute` for page content.** Auto-layout (`layout` on a
  node) → flexbox/grid directly. A node with **no** `layout` (Figma
  `layoutMode: NONE`) → infer the arrangement from the children's `bbox`
  alignment and spacing: a row of similar-width boxes at the same `y` → a flex
  row / grid; stacked boxes → a column. If you genuinely cannot infer a
  structure, say so in `REPLICA.md` and ask — do not freeze the coordinates.
- **Text is a role, not a size.** The largest top text becomes an `h1`, body
  runs become `p`, a short bold label on a filled box is a button. Use the text
  style to set the typography tokens, not inline styles on every node.
- **A repeated component is one component.** Two or more nodes with the same
  `component.id` → build one component and map data over it, never paste the
  markup twice.
- **Assets are local.** Copy what you use from `design/<key>/assets/` into the
  project; for a fill the extract couldn't fetch, substitute a dimension-matched
  placeholder and log it in `design/<key>/asset-gaps.md`.
- **Fonts:** a Google-hosted family → load it; otherwise substitute the closest
  system/Google stack and record the gap.
- `truncated: true` on a node means its subtree was cut for the node budget —
  build what is there and note the gap; do not invent the missing detail.
- **Do not decode or pixel-probe the render.** The tree has `radius`, `fills`,
  `stroke`, `effects`, and text metrics already (see the section above). A
  wrong value is corrected by the diff loop, not by a PNG reader.

## Acceptance flags

- **Any invented content** — a metric, label, card, or section that is not in
  the tree — ⇒ the replica has failed. Redo it from the actual strings.
- A section visible in `render/<frame>.png` that is missing from the build ⇒
  **not** acceptance level A or B.
- Fewer than 2 diff passes, or a final `changedRatio` over 0.15 with no
  explanation in `REPLICA.md` ⇒ not done.
- Any `position: absolute` on a content node ⇒ **not** acceptance level A.
- Tokens dumped raw (a variable per hex with no scale) ⇒ not a design system —
  fold them into a coherent scale in `DESIGN.md`.

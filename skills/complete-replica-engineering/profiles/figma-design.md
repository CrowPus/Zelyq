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
4. **Diff loop.** `start_preview`, then `capture_reference` (`mode: "single"`,
   `url` = the preview route, `diffAgainst: "design/<key>/render/<frame>.png"`).
   Read the changed ratio, classify the largest delta, fix, recapture. **Max 4
   passes per frame.**
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

## Acceptance flags

- Any `position: absolute` on a content node ⇒ **not** acceptance level A.
- Tokens dumped raw (a variable per hex with no scale) ⇒ not a design system —
  fold them into a coherent scale in `DESIGN.md`.

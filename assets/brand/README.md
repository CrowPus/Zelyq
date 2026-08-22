# Brand assets

`zelyq-logo.png` is the source mark. Everything the application loads is derived
from it and lives in [`apps/web/public/`](../../apps/web/public).

| File | Size | Used for |
| --- | --- | --- |
| `favicon.ico` | 16 + 32 | Browser tab, legacy browsers |
| `zelyq-mark-64.png` | 64 | Rail and top bar, rendered at 20px |
| `zelyq-mark-64-dark.png` | 64 | The same, on dark surfaces |
| `zelyq-mark-128.png` | 128 | PNG favicon for modern browsers |
| `zelyq-mark-128-dark.png` | 128 | Reserved for larger dark-surface uses |
| `apple-touch-icon.png` | 180 | iOS home screen, with 14px padding |

## Deriving them

Two things matter more than the exact tool used:

**Trim the transparent padding first.** The source has roughly 250px of empty
space around the mark. Scaled without trimming, the glyph occupies about half of
its box and looks accidentally small next to everything else in the interface.
Content bounds in the current source are 870×900 at offset (256, 128).

**Produce a reversed variant for dark surfaces.** The navy end of the gradient
measures about 1.1:1 against the dark theme's surface — invisible. The shipped
dark variant lifts any pixel below 0.46 lightness into the 0.46–0.86 range,
proportionally, so the gradient keeps its internal contrast instead of
flattening. Hue is untouched and saturation is reduced slightly. That takes the
worst-case contrast to 2.8:1 and the mean to 5.7:1.

If you have a proper reversed logo drawn by a designer, replace
`zelyq-mark-*-dark.png` with it — the stylesheet picks it up with no code
change. The swap is CSS-only (`.brand-mark--light` / `.brand-mark--dark` in
`apps/web/src/index.css`), so the correct variant is right on the first paint.

## Checking a change

Contrast against the surfaces it sits on is the test that matters:

- light surface `#ffffff` — mean should stay near 7.7:1
- dark surface `#161616` — mean should stay above 4.5:1, worst case above 2.5:1

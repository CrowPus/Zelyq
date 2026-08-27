# Layout and Computed Style

## Measure the final browser result

`getBoundingClientRect()` provides viewport-relative geometry including padding and border.

`getComputedStyle()` provides resolved CSS property values after cascade and inheritance; for layout-dependent properties, browsers may expose used/resolved values.

Use these to investigate discrepancies.

## High-value geometry

Record:
- x/y;
- width/height;
- margin;
- padding;
- gap;
- border widths;
- radius;
- display;
- position;
- top/right/bottom/left;
- grid/flex properties;
- max/min dimensions;
- overflow;
- object-fit/position.

## Computed typography
Record:
- font-family;
- font-size;
- font-weight;
- line-height;
- letter-spacing;
- text-transform;
- color.

## Layout diagnosis

If many descendants shift together, inspect ancestors first.

Common root causes:
- wrong container max width;
- box sizing;
- font;
- root font size;
- wrong viewport/DPR;
- missing scrollbar;
- incorrect grid track;
- intrinsic image width.

## DevTools

Chrome DevTools exposes dimensions, padding, margin, font information, Grid/Flex overlays, and the final Computed pane. Use those for live-reference inspection.

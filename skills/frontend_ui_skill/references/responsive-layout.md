# Responsive Layout

## Principle

Responsive design is constraint-driven, not device-list-driven.

## Use the right mechanism

### Intrinsic layout
Start with normal flow, flex/grid, `minmax()`, wrapping, `min()`, `max()`, `clamp()`, aspect ratio, and sensible content constraints.

### Media queries
Use when behavior depends on viewport/user environment.

### Container queries
Use when a reusable component should adapt to the space its parent gives it. MDN documents container size queries as widely available and specifically useful when component width is not equivalent to viewport width.

Source: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries

## Mobile first is not dogma

A mobile-first cascade is often convenient. The deeper rule is to begin from the least-assumptive layout and add complexity when space allows.

## Test constraints, not only breakpoints

Test:
- ~320px/narrow phone;
- common portrait mobile;
- short viewport;
- tablet-ish widths;
- desktop;
- very wide viewport;
- component placed in narrow sidebar vs wide main content;
- 200% browser zoom/reflow where applicable.

## Overflow

Check:
- long words/URLs/IDs;
- code/preformatted text;
- tables;
- fixed-width media;
- chip/tag collections;
- translated labels;
- browser zoom.

Do not hide global horizontal overflow to conceal broken layout.

## Touch

Do not rely on hover for essential functionality. Preserve comfortable targets and spacing between adjacent actions.

WCAG 2.2 adds a minimum target-size success criterion and a dragging alternative requirement at AA.

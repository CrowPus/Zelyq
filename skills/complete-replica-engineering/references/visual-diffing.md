# Visual Diffing

## Why

Visual regression tools compare what users see in rendered pixels, rather than only HTML structure.

Playwright's `toHaveScreenshot()` supports:
- max differing pixels;
- max diff ratio;
- perceptual threshold;
- deterministic screenshot options.

Storybook/Chromatic uses baseline screenshots and visual diffs for component states.

## Comparison methods

### Side by side
Best for semantic/large layout review.

### Opacity overlay
Excellent for alignment drift.

### Pixel diff
Excellent for locating changed regions.

### Geometry diff
Excellent for explaining pixel differences.

Use more than one.

## Thresholds

There is no universal correct tolerance.

Define based on:
- capture environment;
- anti-aliasing stability;
- expected fidelity.

Never increase threshold because a known mismatch is inconvenient.

## Diff prioritization

Fix:
1. global shifts;
2. large-area typography/layout;
3. large assets;
4. component dimensions;
5. paint;
6. tiny anti-aliasing noise.

## Baselines

A baseline is accepted evidence, not a screenshot generated from the current replica.

Never regenerate the reference baseline from the clone to make tests pass.

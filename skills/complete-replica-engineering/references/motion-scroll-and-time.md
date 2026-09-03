# Motion, Scroll, and Time

## Where the evidence comes from

`browse_page <url>` walks the page in stages and reports what actually runs: every animation's real
duration, delay, easing and animated properties, grouped by how often each is used. `/clone` runs
the same walk on the entry page and writes `reference/<page>/motion.json`.

Read that before writing the motion section of a replica plan. Do not infer motion from CSS text or
from a screenshot — a settled screenshot is taken with animations disabled and records none of it,
and a page's motion is mostly scroll-triggered, so nothing at the top of the page tells you about it.

Frequency is the signal. A signature used 164 times is the site's design system; one used once is a
cookie banner. Reproduce the first and ignore the second.

## Motion fingerprint

For meaningful transitions record:
- trigger;
- duration;
- easing/spring;
- delay/stagger;
- property/transform;
- origin;
- entering/exiting state.

## Static screenshot baselines

Disable or settle motion for static comparison.

Separately test animation behavior where motion itself is part of the fidelity requirement.

## Scroll

`browse_page` reports sticky and fixed layers whose appearance changes between the top of the page
and further down — background, backdrop-filter, shadow, height, transform, opacity. That covers the
header state change; the rest of this list is still yours to check.

Inspect:
- sticky/fixed layers;
- scroll containers;
- header state changes;
- scroll-linked reveal;
- anchor offsets;
- section pinning;
- horizontal tracks.

Capture scroll checkpoints.

## Time-sensitive UI

Freeze/reference:
- clock;
- countdown;
- relative dates;
- live metrics

when static comparison requires determinism.

Do not "fix" a reference animation by making the clone static if animation is in scope.

## Media

`browse_page` plays each `<video>` and reports what it is for: a full-width muted loop with no
controls is a background, and the same file at 600px with controls is content. They are rebuilt
differently, so record the role, not just the file.

# Frontend Performance

## User-centric targets

Current common Core Web Vitals “good” thresholds at the 75th percentile:
- LCP ≤ 2.5 seconds;
- INP ≤ 200 ms;
- CLS ≤ 0.1.

Sources:
- https://web.dev/articles/optimize-lcp
- https://web.dev/articles/optimize-inp
- https://web.dev/articles/optimize-cls

## Performance is more than load

Interactive applications can render quickly but feel slow after load. INP includes input delay, handler processing, and presentation delay.

## JavaScript

Treat JavaScript as a cost:
- download;
- parse/compile;
- execute;
- hydration;
- ongoing main-thread work.

Do not add a large dependency for a small convenience without understanding bundle/runtime cost.

## Rendering strategy

Use the project's framework appropriately:
- avoid moving static content into client JS unnecessarily;
- defer/lazy-load non-critical interactive code;
- split expensive features at meaningful boundaries.

Do not cargo-cult server or client components; follow framework semantics and user-performance evidence.

## Interaction responsiveness

Keep event handlers short. Defer non-urgent work. Avoid large synchronous DOM/render work in an input event.

web.dev recommends investigating long tasks, unnecessary script work, large DOMs, and layout thrashing when INP is poor.

## Layout thrashing

Avoid alternating DOM writes and synchronous layout reads in loops/tasks. Batch reads/writes where possible.

## Images

- reserve dimensions/aspect ratio;
- use responsive sources/sizes;
- do not lazy-load the likely LCP image blindly;
- lazy-load below-the-fold media;
- choose dimensions close to rendered need;
- use suitable modern formats when supported by the pipeline.

## CLS

Common causes include media without dimensions, async injected content without reserved space, and font swaps.

Reserve space for late content. Do not hide layout mistakes with `overflow-x: hidden`.

## Lists / virtualization

Virtualization is useful for genuinely large expensive lists, but it adds complexity for accessibility, browser find, variable heights, and scroll restoration. Measure first.

## React rendering

Fix state/data architecture before sprinkling memoization.

React's current guidance notes redundant state creates extra updates and many calculations can remain in render; profile before manual optimization.

## Production measurement

Benchmark production builds. Development mode, source maps, Strict Mode, and local machine speed can mislead.

Use field data when available because real devices/content/networks differ from local development.

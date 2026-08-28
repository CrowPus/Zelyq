---
name: web-performance
description: Diagnose and improve web loading speed, Core Web Vitals, bundle size, rendering cost, and runtime responsiveness. Use for measured frontend performance work, not generic cleanup.
---

# Web Performance

Measure the user-visible bottleneck before optimizing. Protect correctness, accessibility, and visual stability.

## Establish the scenario

Define route, device, network/CPU conditions, cache/auth state, representative data, and target metric. Capture a repeatable baseline with browser tooling.

Map server response, blocking CSS/fonts/scripts, bundles, media/3D assets, hydration and data requests, long tasks, layout shifts, and third-party scripts.

## Choose the owner-level fix

- LCP: prioritize the actual LCP resource, stable dimensions, server latency, and blocking work.
- INP: reduce long tasks, unnecessary renders, synchronous parsing, and expensive handlers.
- CLS: reserve geometry for media, fonts, ads, async content, and transitions.
- Bundles: remove unused code and split at meaningful route/capability boundaries.
- Lists: paginate or virtualize only when scale justifies it.
- Images: use correct dimensions, formats, responsive sources, and priority.

Do not add memoization, lazy loading, workers, caching, or virtualization without evidence. Do not improve a score by delaying functionality users immediately need.

## Verification

Repeat the same scenario, compare medians or distributions, and inspect correctness, accessibility, visual quality, memory, and network regressions. Report before/after values, conditions, variance, and remaining bottlenecks. Treat development-mode results as directional only.

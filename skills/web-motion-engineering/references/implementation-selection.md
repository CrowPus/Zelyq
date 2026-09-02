# Implementation selection and recipes

Use this reference when choosing an engine or translating a motion brief into code. Prefer an existing capable dependency over adding another one.

## Decision matrix

| Approach | Strength | Avoid when |
| --- | --- | --- |
| CSS transition/keyframes | Small, declarative, excellent for known states | Complex interruption, sequencing, measurement, or dynamic gesture physics |
| Web Animations API | Native playback control and imperative timelines | The framework already provides safer lifecycle/layout primitives |
| View Transition API | DOM/page snapshots and shared transitions with low JS | The transition needs live interacting old/new DOM or unsupported browsers lack a clean fallback |
| Motion for React | Presence, layout continuity, shared elements, gestures, springs | A two-line CSS transition is enough, or project is not React |
| GSAP | Precise timelines, SVG, complex sequencing, scroll scrubbing/pinning | Basic component microinteraction or dependency cost is not justified |
| Native scroll-driven CSS | Scroll/view timelines without a JS scroll loop | Required browser support/fallback cannot be met |
| IntersectionObserver | Triggering coarse in-view state efficiently | Continuous progress/scrubbing is required |
| Rive/Lottie | Authored vector sequences with designer handoff | DOM/layout interaction, large runtime for tiny decoration, inaccessible essential meaning |
| Three.js/R3F | Actual 3D camera/material/light/shader work | A video, frame sequence, CSS transform, or SVG can deliver the same story |

## CSS state transition

Use state selectors and preserve final state without JavaScript-owned inline cleanup:

```css
.popover {
  opacity: 0;
  transform: translateY(-0.375rem) scale(0.98);
  transform-origin: top center;
  transition:
    opacity var(--motion-duration-fast) var(--motion-ease-enter),
    transform var(--motion-duration-fast) var(--motion-ease-enter);
}

.popover[data-state="open"] {
  opacity: 1;
  transform: translateY(0) scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .popover { transform: none; }
}
```

Use discrete transition support only after confirming the target browser contract; otherwise keep an explicit mounted/exiting state.

## Hover and press

```css
.action {
  transition:
    transform var(--motion-duration-instant) var(--motion-ease-standard),
    background-color var(--motion-duration-instant) ease;
}

@media (hover: hover) and (pointer: fine) {
  .action:hover { transform: translateY(-1px); }
}

.action:active { transform: scale(0.98); }
```

Never remove focus styling. Ensure press transform does not make the target escape the pointer.

## View Transition progressive enhancement

```js
function updateWithTransition(update) {
  if (!document.startViewTransition) {
    update();
    return;
  }

  document.startViewTransition(update);
}
```

Keep the underlying state update correct without the API. Use stable, unique `view-transition-name` values only for objects whose identity persists across states.

## Motion for React

When the project already uses Motion or the brief requires React presence/layout/gesture behavior:

```jsx
import { MotionConfig, motion } from "motion/react";

export function MotionRoot({ children }) {
  return (
    <MotionConfig reducedMotion="user">
      {children}
    </MotionConfig>
  );
}

export function Selection({ active }) {
  return (
    <button>
      {active && <motion.span layoutId="active-indicator" />}
      Label
    </button>
  );
}
```

`x`, `y`, `scale`, and related Motion values are composed into transforms; they are not inherently unaccelerated. Do not rewrite them as raw transform strings based on that misconception. Use `AnimatePresence` when exit must complete before unmount, and test rapid reversal.

## GSAP and ScrollTrigger

Use one scoped timeline per component/scene. In React, use the official `useGSAP` integration when available or a scoped `gsap.context`, and revert/kill work on cleanup. Recalculate after fonts/assets and meaningful layout changes.

Use `scrub` only when progress should be controlled by scroll position. Numeric scrub introduces catch-up time; confirm that lag is intentional. `pin` should not trap reading or create excessive blank scroll. Use `gsap.matchMedia()` for breakpoints and reduced-motion branches so setup is reverted when conditions change.

## Native scroll-driven CSS

```css
@supports (animation-timeline: view()) {
  .reveal {
    animation: reveal both linear;
    animation-timeline: view();
    animation-range: entry 15% cover 35%;
  }
}

@keyframes reveal {
  from { opacity: 0; transform: translateY(1rem); }
  to { opacity: 1; transform: none; }
}
```

The base state outside `@supports` must remain visible. A progressive enhancement must not turn unsupported content invisible.

## Lifecycle checklist

On unmount, route change, media-query change, or scene replacement:

- cancel animation frames and Web Animations;
- disconnect observers;
- remove listeners;
- revert timelines and ScrollTriggers;
- release captured pointers;
- stop video/audio when appropriate;
- dispose WebGL textures, geometries, materials, render targets, and controls;
- remove temporary inline styles/classes only if the current state no longer owns them.

# Research sources

Use these primary and first-party sources when a recommendation needs current evidence. Recheck version-sensitive API or library behavior before making a strong compatibility claim.

## Standards and accessibility

- [WCAG 2.2 — Understanding 2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) — non-essential interaction-triggered motion must be disableable at AAA; identifies parallax and large spatial motion as potential vestibular triggers.
- [WCAG 2.2 — Understanding 2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) — control requirements for automatic movement lasting more than five seconds and for auto-updating content.
- [MDN — `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) — operating-system preference detection and an example that replaces scale motion with a muted dissolve rather than requiring every visual transition to disappear.

## Platform APIs

- [MDN — View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) — same-document and cross-document transition model, snapshot behavior, and accessibility context.
- [MDN — CSS scroll-driven animations](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations) — scroll and view progress timelines.
- [MDN — Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) — asynchronous visibility/intersection observation for coarse in-view triggers.
- [MDN — `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) — frame-synchronized callback behavior.

## Motion systems and libraries

- [Microsoft Fluent 2 — Motion](https://fluent2.microsoft.design/motion) — functional, natural, consistent, appealing motion; choreography, hierarchy, and accessible motion.
- [IBM Carbon — Motion](https://carbondesignsystem.com/elements/motion/overview/) — productive versus expressive motion, easing roles, dynamic duration, strategy, and evaluation criteria.
- [Motion for React — MotionConfig](https://motion.dev/docs/react-motion-config) — site-wide transition and reduced-motion policy; transform/layout motion is removed while non-spatial properties can remain.
- [Motion for React — Layout animation](https://motion.dev/docs/react-layout-animations) — layout/shared-element behavior, transform-based implementation, and lifecycle/troubleshooting considerations.
- [Motion for React — Gestures](https://motion.dev/docs/react-gestures) — hover, tap, focus, pan, drag, in-view, and keyboard behavior for tap gestures.
- [GSAP — ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) — trigger, scrub, pin, snap, progress, refresh, and scroll-update behavior.
- [GSAP — `gsap.matchMedia()`](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/) — breakpoint and reduced-motion setup with automatic reversion.

## Performance and lifecycle

- [web.dev — High-performance CSS animations](https://web.dev/articles/animations-guide) — transform/opacity preference, layout/paint cost, and caution against premature `will-change`.
- [web.dev — Web Vitals](https://web.dev/articles/vitals) — current LCP, INP, and CLS thresholds plus field/lab measurement guidance.
- [Chrome DevTools — Rendering performance](https://developer.chrome.com/docs/devtools/rendering/performance) — paint flashing, layout-shift regions, layers, frame stats, GPU memory, and scroll issue diagnostics.
- [React — `useLayoutEffect`](https://react.dev/reference/react/useLayoutEffect) — pre-paint measurement, cleanup, Strict Mode behavior, and performance warning.
- [Three.js manual — Cleanup](https://threejs.org/manual/en/cleanup.html) — explicit disposal of textures, geometries, materials, and scene resources.

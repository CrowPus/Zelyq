# Motion performance and delivery

Use this reference before shipping complex motion and when debugging jank, delayed input, layout shift, battery use, or memory growth.

## Rendering model

Browser animation cost can include JavaScript, style calculation, layout, paint, rasterization, compositing, and GPU memory. CSS is not automatically off-main-thread; an animation can stay compositor-friendly only when its properties and layer conditions allow it.

Prefer transform and opacity for frequent movement. Animate layout or paint properties only when the effect cannot be represented safely with transforms, and confirm the result by profiling. Beware large filters, shadows, masks, backdrop filters, blend modes, and huge translucent layers: visual area matters.

## Frame work

At 60 Hz, a frame is about 16.7 ms; browser overhead leaves less time for application work. Higher-refresh displays have smaller budgets. Avoid JavaScript or React state work on every animation frame unless the architecture requires it.

- Use `requestAnimationFrame` for visual writes tied to frames.
- Read layout together, then write styles together.
- Cache stable measurements and refresh them on meaningful resize/content/font changes.
- Use observers for state changes rather than polling.
- Skip a draw when the visible value/frame did not change.
- Cancel work on unmount, visibility loss, breakpoint change, and reduced-motion change.

React's `useLayoutEffect` blocks paint; use it only for measurement/state that must be resolved before paint, keep it small, and clean it up correctly under Strict Mode.

## `will-change`

Browsers usually make their own layer decisions. Add `will-change` only after profiling identifies a benefit, shortly before likely animation when practical, and remove it afterward. Permanent promotion across many nodes can waste memory and make performance worse.

## Loading budgets

Set route-specific budgets before adding cinematic assets:

- core message and primary action do not wait for optional motion;
- no 3D runtime/model or frame sequence is eager-loaded below the fold;
- poster/fallback has explicit dimensions;
- fonts and images cannot move trigger positions after timelines are calculated without a refresh;
- optional animation code is split from the critical route where the framework allows it;
- mobile receives right-sized textures/video, not merely CSS-scaled desktop assets.

Do not invent a universal kilobyte limit. Compare the measured experience before and after the motion feature under the project's network/device targets.

## Core Web Vitals guardrails

Google's current “good” thresholds at the 75th percentile are:

- LCP at or below 2.5 s;
- INP at or below 200 ms;
- CLS at or below 0.1.

Treat these as release guardrails, not proof that an animation is smooth. Capture field data when possible; lab testing cannot fully represent user devices and real interaction.

## Media and frame sequences

- Use modern codecs/formats supported by the delivery contract and keep fallback sources.
- Preload metadata/poster or the first useful frame, not the entire experience by default.
- Decode and draw at display dimensions; very large source pixels still consume decode/GPU memory.
- Cap retained decoded frames. Avoid keeping a complete high-resolution sequence resident on mobile.
- Pause hidden/offscreen video and canvas updates.

## WebGL

- Cap device pixel ratio and adapt quality to device/viewport.
- Reuse geometries, materials, textures, and instancing.
- Reduce draw calls and transparent overdraw.
- Prefer baked lighting and limited post-processing for marketing scenes.
- Render on demand when the scene is not continuously changing.
- Dispose textures, geometries, materials, render targets, controls, and listeners when no longer used. Three.js cannot automatically release all GPU resources.
- Test context loss and asset failure; restore a useful poster/static scene.

## Profiling sequence

1. Record the highest-risk interaction/scroll sequence in the browser Performance panel.
2. Check long main-thread tasks, layout/paint work, event timing, and dropped/partially presented frames.
3. Enable paint flashing and layout-shift regions.
4. Inspect layer count and GPU memory for unexpected promotion.
5. Check scroll performance issues and passive/input handlers.
6. Emulate CPU/network constraint, then repeat on a real lower-power phone.
7. Compare full and reduced branches.
8. Re-record after the fix; keep evidence for material tradeoffs.

## Common fixes by symptom

| Symptom | Inspect first | Likely direction |
| --- | --- | --- |
| Stutter during scroll | Main-thread scroll work, paint area, image decode | Native timeline/GSAP rAF, compositor properties, smaller assets |
| First interaction freezes | Lazy import/compile, synchronous setup, model decode | Prewarm small code, defer heavy scene, respond before setup |
| Text shimmers/warps | Parent scale/layout FLIP | Position-only layout mode, animate container, avoid text scaling |
| Memory grows after routes | Timelines/observers/WebGL disposal | Lifecycle cleanup and resource ownership |
| Trigger positions drift | Late fonts/images/content | Reserve geometry and refresh after stable layout |
| Mobile overheats | Continuous canvas, DPR, post effects | On-demand render, DPR cap, lower-quality/static branch |

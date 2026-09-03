---
name: web-motion-engineering
description: Design, implement, review, and debug professional web motion systems for product interfaces and marketing experiences. Use for UI transitions, microinteractions, layout or shared-element animation, page transitions, scroll choreography, animated heroes, SVG/canvas/WebGL motion, gestures, easing, timing, reduced-motion behavior, or animation performance. Do not use for offline video editing or character animation that is not part of a web experience.
metadata:
  author: Zelyq
  version: "1.1.0"
---

# Web Motion Engineering

Create motion that makes a website feel intentional, understandable, responsive, and distinctive. Motion is part of interaction design; it is not a layer of decoration added after the interface works.

## Non-negotiable outcome

The final experience must remain clear and complete when animation is unavailable, reduced, interrupted, slow to load, or unsupported. Motion may improve continuity, feedback, hierarchy, narrative, or delight, but must never carry essential meaning alone.

## Classify the surface first

| Surface | Motion posture | Typical treatment |
| --- | --- | --- |
| Repeated product workflow | Productive: fast, quiet, interruptible | State continuity, spatial origin, press feedback, restrained layout motion |
| Major product moment | Expressive but brief | One focal celebration or shared-element transition; keep controls responsive |
| Marketing page | Editorial and narrative | Deliberate reveal hierarchy, section transitions, one signature motif |
| Cinematic product story | Immersive and scroll-linked | Storyboard, pinned scenes, camera/object choreography, robust static/mobile fallback |

When a page mixes surfaces, apply the posture per region. Never make a dashboard behave like a showreel.

## Choose an editorial transition grammar

For a motion-led marketing site, choose the dominant grammar before choosing effects:

| Grammar | Character | Best fit |
| --- | --- | --- |
| Continuity | Restrained, luxurious, image-led, seamless | Heritage, fashion, architecture, hospitality, premium products |
| Rupture | Experimental, surprising, collage-led, deliberately unstable | Creative studios, culture, entertainment, campaigns |
| Hybrid | Calm foundation with one bounded disruptive scene | Brands that need trust first and memorability second |

Do not mix continuity and rupture effect-by-effect. A hybrid must change grammar at an explicit scene boundary and then settle back into a stable system. For the evidence-derived patterns, decision rules, and scene vocabulary, read [references/editorial-transition-systems.md](references/editorial-transition-systems.md).

## Working method

1. **Inspect before choosing a library.** Identify the framework, rendering mode, installed motion tools, design tokens, component primitives, target browsers, input types, and existing motion conventions. Preserve a coherent existing system unless it is the problem being fixed.
2. **Write a compact motion brief.** For each meaningful motion define: trigger, purpose, subject, start and end state, spatial origin, priority, timing, interrupt/cancel behavior, reduced-motion replacement, breakpoint/input behavior, and performance risk.
3. **Establish hierarchy.** Choose at most one signature motion idea per page or journey. Use two or three supporting pattern families. Repetition should feel like a language, not a preset.
4. **Prototype the highest-risk motion first.** Test scroll pinning, shared layout, long sequences, 3D, and gesture physics before polishing small fades.
5. **Implement progressively.** Semantic content and state change work first; animation enhances them. Feature-detect newer platform APIs and provide a stable fallback.
6. **Verify in a real browser.** Test entry, reversal, rapid repeated input, resize, route change, background/foreground, slow device/network, keyboard, touch, and reduced motion. Inspect both the intended choreography and the final resting states.

For the full planning language, read [references/motion-language.md](references/motion-language.md).

## Choose the smallest sufficient engine

| Need | Default choice |
| --- | --- |
| Hover, press, focus, simple enter/exit | CSS transitions or keyframes |
| Native imperative playback, pause, reverse, or scrubbing | Web Animations API |
| React layout, shared element, presence, or gestures | Motion for React when present or justified |
| Complex multi-element timeline or advanced scroll story | GSAP timeline/ScrollTrigger when present or justified |
| DOM/page state transition with progressive enhancement | View Transition API |
| Simple viewport reveal | IntersectionObserver plus CSS, or the framework's existing in-view primitive |
| Authored vector illustration | Rive or Lottie only when the asset and runtime justify the cost |
| Real 3D, camera, lighting, or shader scene | Three.js/React Three Fiber, gated by narrative value and performance budget |
| Photoreal linear transformation | Optimized video or frame sequence can be simpler than live 3D |

Do not install two libraries that solve the same layer of the problem. Do not introduce a motion dependency for a basic opacity/transform transition. Read [references/implementation-selection.md](references/implementation-selection.md) before selecting or adding an engine.

## Motion tokens, not scattered numbers

Create or reuse named duration, easing, distance, spring, and stagger tokens. Tune them to the brand and measured result; these are starting bands, not universal laws:

| Token role | Starting band | Intended use |
| --- | --- | --- |
| Instant feedback | 70–110 ms | Press, toggle, small color/opacity response |
| Product transition | 140–220 ms | Menu, tooltip, compact disclosure, short move |
| Deliberate transition | 220–320 ms | Dialog, drawer, larger layout change |
| Expressive moment | 320–600 ms | Rare hero, route, or success moment |
| Stagger step | 20–60 ms | Small related groups only; cap total cascade |

Duration scales with visual distance and area, not DOM complexity. Immediate input feedback starts without a perceptible delay. Exit may be faster than entry when removal is final; nearby panels may decelerate as they leave to preserve spatial continuity.

Prefer curves with a decisive start and controlled settlement. Use linear motion only when constant progress or velocity communicates truth. Use spring physics for direct manipulation, interruptible gestures, and organic settling—not as a universal styling effect. Read [references/timing-easing-springs.md](references/timing-easing-springs.md).

## Implementation invariants

- Animate from and toward a meaningful origin. Menus originate near their trigger; expanding cards preserve object identity; drawers move from their attached edge.
- Keep paired elements synchronized: dialog/backdrop, tooltip/arrow, drawer/scrim, moving object/shadow.
- Keep content usable during animation. Do not trap pointer input behind stale overlays or delay focus management until a decorative exit ends.
- Make animation interruptible. A second click, route change, drag reversal, or breakpoint change must settle into the newest valid state without teleporting or leaving orphaned styles.
- Keep transforms visually plausible. Avoid large scale-from-zero entrances, random rotation, overshoot on serious surfaces, and text distortion.
- Prefer `transform` and `opacity` for frequent motion. Layout or paint animation is allowed only when the visual requirement justifies it and profiling shows it is safe.
- Treat `will-change` as a measured, temporary optimization, not boilerplate.
- Read and write layout in batches. Avoid per-frame React state, layout thrashing, and uncleaned observers, timelines, animation frames, or WebGL resources.
- A loading animation reflects real state. Never hide an unknown wait behind a fake fixed-duration sequence.

For component behaviors read [references/product-patterns.md](references/product-patterns.md). For narrative pages, read [references/marketing-scroll-and-cinematic.md](references/marketing-scroll-and-cinematic.md). For premium editorial or experimental studio transitions, also read [references/editorial-transition-systems.md](references/editorial-transition-systems.md) and load only the recipe needed:

- [recipes/luxury-editorial-reveal.md](recipes/luxury-editorial-reveal.md)
- [recipes/experimental-collage.md](recipes/experimental-collage.md)
- [recipes/media-takeover.md](recipes/media-takeover.md)
- [recipes/route-curtain.md](recipes/route-curtain.md)

## Accessibility is a design branch

Respect `prefers-reduced-motion` and, for motion-heavy experiences, consider a visible site-level motion control. Reduced motion does not always mean deleting every transition: replace large translation, zoom, spin, parallax, auto-pan, and rapid spatial movement with an instant state change or short opacity/color change.

- Never communicate status, order, direction, or success only through motion.
- Auto-starting motion that lasts more than five seconds alongside other content needs a pause, stop, or hide mechanism unless essential.
- Avoid flashing patterns; do not exceed the WCAG flash threshold.
- Preserve keyboard behavior, focus visibility, focus order, announcements, and touch alternatives.
- Hover effects must not be the sole affordance and should be gated to hover-capable pointers.
- Do not split readable text into inaccessible fragments. Keep an intact accessible text equivalent.

Read [references/accessibility.md](references/accessibility.md) for implementation patterns and test cases.

## Performance and loading gate

Motion quality includes loading cost and responsiveness. A beautiful hero that delays the product, drops frames, or overheats a phone is not professional.

- Reserve geometry and final states to avoid layout shift.
- Lazy-load below-the-fold and optional motion runtimes/assets.
- Pause or stop work when a scene is offscreen, the document is hidden, or reduced motion selects a static branch.
- Compress and right-size video, textures, models, and frame sequences; provide a poster/static fallback.
- Reuse WebGL geometry/materials and dispose resources when a scene leaves.
- Profile before and after. Inspect frame rendering, main-thread work, paint flashing, layer count/GPU memory, scroll handlers, and Core Web Vitals.
- Test representative low-power mobile hardware, not only a desktop development machine.

Use [references/performance.md](references/performance.md) for budgets and diagnosis. Run `node scripts/audit-motion.mjs <project>` for a fast, dependency-free static risk scan in Node.js 18+; treat findings as review leads, not proof of defects. It takes `--json` and `--fail-on <severity>`.

## Definition of done

Do not call motion finished until:

1. Every motion has a stated purpose and correct resting state.
2. The page works with JavaScript failure or unsupported enhancement where the architecture allows it.
3. Reduced-motion behavior was exercised, not merely coded.
4. Keyboard, touch, pointer, resize, reversal, and rapid repeat paths are stable.
5. No animation lifecycle leak remains after unmount or route change.
6. Performance was recorded on the highest-risk sequence and a mobile-sized viewport.
7. The motion feels like one brand system across the page.

Follow the test matrix in [references/qa.md](references/qa.md). Cite current authoritative guidance from [references/sources.md](references/sources.md) when explaining a consequential recommendation.

## Review output

Lead with the verdict. Then report findings in priority order with: location, observed behavior, user impact, recommended behavior, implementation direction, and verification method. Include a before/after table only when it makes exact comparisons clearer; do not force every review into one format.

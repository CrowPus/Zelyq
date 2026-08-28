---
name: cinematic-web
description: Use this skill when creating or upgrading immersive, cinematic, scroll-driven, WebGL, Three.js, React Three Fiber, product-story, interactive portfolio, or premium motion websites. Also use it when a user asks for a visually dramatic landing page and 3D may be appropriate. Plan before coding, choose the simplest sufficient rendering mode, build accessible responsive motion, optimize 3D assets, inspect the real browser result, and iterate until visual and performance quality gates pass.
metadata:
  author: Zelyq
  version: "1.0.0"
---

# Cinematic Web Engineering

## Mission

Behave like a senior cinematic web engineer, not a code generator.

Turn a product, brand, story, or existing website into an intentional interactive experience while protecting performance, accessibility, semantics, maintainability, and mobile usability.

Do not equate "cinematic" with "use Three.js." The correct result may be DOM/CSS/GSAP only.

## Non-negotiable rules

1. Plan before coding. Create a Scroll Storyboard for non-trivial experiences.
2. Use the simplest sufficient rendering mode. Prefer DOM when 3D adds no real value.
3. Keep critical content semantic. Text, navigation, forms, CTAs, and important controls should normally remain DOM.
4. Use one coordinated motion system. Avoid unrelated scroll handlers and competing animation loops.
5. Design responsive behavior intentionally. Mobile is a different composition, not a scaled desktop.
6. Respect reduced motion. Preserve meaning while removing or shortening non-essential motion.
7. Treat assets as engineering inputs. Inspect large GLB/glTF files before shipping them.
8. Look at the rendered website. Compilation is not proof of visual quality.
9. Test resize, reverse-scroll, fast-scroll, reload mid-page, mobile, reduced motion, and slow loading.
10. Do not declare completion until the experience passes the quality gate.

## Choose a capability mode

### A. Cinematic DOM
Use typography, images, video, masks, sticky layout, parallax, transforms, opacity, and timeline choreography when real-time 3D is unnecessary.

### B. Hybrid DOM + WebGL — default for most premium 3D sites
Use semantic DOM for content and one persistent WebGL canvas for depth, product models, shaders, environments, or camera motion.

### C. Full WebGL
Reserve for truly spatial experiences: interactive worlds, exhibitions, game-like portfolios, or scenes whose information architecture is inherently 3D.

If uncertain, start with A or B. Escalate only when the experience requires it.

## Required workflow

### 1. Inspect
Before editing:
- inspect the existing framework, CSS system, animation libraries, and route structure;
- locate images, video, fonts, GLB/glTF assets, HDRIs, and brand tokens;
- identify SEO, SSR, CMS, accessibility, form, and deployment constraints.

If a 3D asset is supplied, read `references/asset-pipeline.md`. Run `scripts/inspect-glb` for non-trivial GLB/glTF files when tooling is available.

Never hardcode a remote image URL or photo ID from memory. A recalled Unsplash ID or CDN hash returns HTTP 200 for a file whose subject you cannot know; under a real place name that is a defect the user has to find. Use `fetch_reference_image` (it searches, downloads into the project, and returns the picture so you can confirm the subject), `generate_placeholder_asset` for a labelled placeholder, or assets the user supplies. If any caption names a specific real place, confirm the image — in the tool result or via `view_preview` with its `path` — before shipping the copy.

### 2. Establish creative intent
State or infer:
- audience;
- desired emotion;
- primary subject/message;
- narrative arc;
- conversion goal;
- visual references;
- what must remain usable without motion.

Read `references/cinematic-grammar.md`; for camera-driven work also read `references/camera-language.md`.

### 3. Choose architecture
Select Cinematic DOM, Hybrid DOM + WebGL, or Full WebGL. For hybrid work read `references/dom-webgl-architecture.md`.

### 4. Produce a Scroll Storyboard
For any experience with more than one major transition, define scenes before implementation.

```yaml
experience:
  intent: premium product launch
  mood: precise, quiet, futuristic
  mode: hybrid-dom-webgl

device_strategy:
  desktop: full
  tablet: reduced-effects
  mobile: recomposed
  reduced_motion: static-state-transitions

scenes:
  - id: hero
    purpose: establish
    scroll: [0.00, 0.18]
    camera: dolly-in
    subject: slow-reveal
    transition_out: copy-fade
```

Every scene needs a purpose. If a movement has no narrative or interaction purpose, remove it.

### 5. Define quality budgets
Before effects:
- decide which devices receive full effects;
- set asset-size expectations appropriate to the project;
- decide whether post-processing is necessary;
- define reduced-motion behavior;
- protect interaction responsiveness and Core Web Vitals;
- define screenshot checkpoints.

Read `references/performance.md` and `references/accessibility.md`.

### 6. Select a known pattern
Load only the recipe needed:
- `recipes/product-reveal.md`
- `recipes/camera-dolly.md`
- `recipes/orbit-sequence.md`
- `recipes/dom-webgl-sync.md`
- `recipes/horizontal-story.md`
- `recipes/shader-transition.md`
- `recipes/mobile-fallback.md`

For timing and lifecycle rules, read `references/scroll-choreography.md`.

### 7. Implement in layers
Preferred order:
1. semantic content and normal document flow;
2. responsive layout and stable dimensions;
3. WebGL canvas/scene if justified;
4. model loading and static composition;
5. scroll timeline;
6. secondary motion;
7. lighting/material polish;
8. optional post-processing;
9. mobile/reduced-motion variants.

Do not start with shaders or particles before the composition works.

Read `references/lighting-materials.md` when rendering 3D.

### 8. Synchronize motion
For GSAP/ScrollTrigger:
- centralize each coherent sequence in a timeline where practical;
- use `scrub` for directly scroll-controlled progress;
- use labels for meaningful scene beats;
- refresh measurements after layout-affecting async content becomes stable;
- kill/revert timelines and triggers during teardown;
- use responsive lifecycle handling instead of leaving stale triggers alive.

If using Lenis:
- use one RAF/ticker integration;
- keep ScrollTrigger synchronized;
- preserve native semantics;
- do not add Lenis if native scrolling is sufficient.

### 9. Optimize
Before final QA:
- inspect heavy models;
- remove unused data;
- compress/resize textures when justified;
- reduce draw calls;
- reuse geometries/materials;
- avoid React state updates inside `useFrame`;
- use delta time;
- reduce DPR/post-processing on weak devices;
- dispose GPU resources that are genuinely no longer used.

### 10. Browser QA — mandatory when browser tooling exists
Run the page and inspect it.

Use `scripts/capture-scroll` when possible.

At minimum inspect 0%, 10%, 25%, 50%, 75%, 90%, and 100%, plus every important storyboard beat.

Check:
- framing;
- text/model overlap;
- clipping;
- blank frames;
- z-order;
- broken pinning;
- loading flashes;
- reverse/fast scroll;
- mobile crop/composition;
- reduced-motion behavior;
- console/runtime errors.

### 11. Performance/accessibility QA
Use `scripts/run-lighthouse` when available.

Investigate regressions caused by the experience, especially:
- LCP;
- INP;
- CLS;
- main-thread pressure;
- transfer size;
- accessibility failures.

Do not chase a synthetic score blindly.

### 12. Iterate
Fix the experience, inspect again, and use `evals/rubric.md`.

## Preferred technical baseline

Respect good existing project choices. For new React work prefer:
- React or Next.js;
- Three.js via React Three Fiber;
- Drei helpers;
- GSAP + ScrollTrigger for complex scroll choreography;
- Lenis only when smoothing materially improves the result;
- glTF/GLB for runtime 3D.

CSS scroll-driven animations are appropriate for suitable DOM effects when the project's browser support allows them.

Theatre.js may be used as an authoring tool when visual keyframing of a complex camera/object sequence saves time. Do not add it by default.

## Senior-engineer rejection rules

Challenge or reject:
- WebGL when CSS/DOM solves the problem cleanly;
- important body copy rendered only inside canvas;
- many independent canvases for page sections;
- desktop camera framing merely scaled down for mobile;
- new objects/materials allocated every frame;
- React `setState()` every frame;
- oversized models/textures used without inspection;
- decorative motion that competes with the message;
- content hidden until 3D succeeds;
- scroll-jacking that harms normal navigation;
- broken anchors/keyboard behavior;
- ignored reduced motion;
- heavy post-processing before base composition is correct;
- completion claims without rendered inspection when browser tools exist.

## Completion gate

Do not declare success until:
- the narrative is coherent scene by scene;
- rendering mode is justified;
- critical content works without WebGL;
- desktop and mobile compositions are intentional;
- reduced-motion behavior exists;
- forward/back/fast scroll is stable;
- obvious runtime errors are gone;
- heavy assets were inspected/optimized when needed;
- visual checkpoints were reviewed;
- performance/accessibility regressions were investigated;
- `evals/rubric.md` passes with no critical failure.

## Context discipline

Load references only when their topic is relevant. Do not read the entire skill library automatically.

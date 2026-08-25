# Performance Engineering

## Principle

Performance is part of the visual design. A cinematic experience that stutters is not premium.

## Measure

Use evidence:
- browser Performance tooling;
- frame timing;
- `renderer.info`;
- transfer size;
- Lighthouse;
- real-user/Core Web Vitals when available.

## React Three Fiber

Important R3F guidance:
- never call React `setState()` inside `useFrame`;
- keep per-frame work slim;
- use delta time;
- reuse temporary objects;
- reuse geometry/materials;
- instance repeated objects;
- avoid unnecessary mount/unmount churn.

### Demand rendering

Use `frameloop="demand"` when a scene can become static, then invalidate when a frame is needed.

Continuous scroll motion may require active frames while scrolling; do not render forever after motion stops if the architecture can avoid it.

### DPR

Use a bounded DPR instead of always using the device maximum.

```jsx
<Canvas dpr={[1, 1.75]} />
```

On performance regression, reduce DPR and optional effects before degrading essential content.

## Draw calls

Prefer a few hundred or fewer where practical. R3F guidance treats ~1000 as an extreme ceiling, not a target.

Use:
- instancing;
- shared materials/geometries;
- fewer transparent layers;
- merged static geometry where appropriate.

## Post-processing

Each effect can add render passes. Build quality levels:
- high: selected effects;
- medium: lower DPR/fewer passes;
- low: no expensive DOF/bloom chains, fewer particles.

## DOM animation

For frequent DOM motion, prefer `transform` and `opacity` where possible because they generally avoid expensive layout/paint work.

Do not permanently apply `will-change` everywhere.

## Scroll work

Avoid:
- repeated expensive DOM measurement on every raw scroll event;
- many independent RAF loops;
- React re-rendering on every progress tick.

Prefer:
- one ticker;
- cached measurements;
- observers where suitable;
- deterministic progress mapping.

## Web quality

Protect normal website metrics. Current commonly used "good" Core Web Vitals thresholds:
- LCP ≤ 2.5s;
- INP ≤ 200ms;
- CLS ≤ 0.1.

These do not measure 3D smoothness by themselves.

## Frame budget

At 60 Hz the whole frame is about 16.7ms. If visual work consistently misses budget:
1. lower DPR;
2. remove expensive full-screen passes;
3. reduce shadows/lights;
4. reduce particles/draw calls;
5. simplify materials;
6. simplify the mobile scene.

## Resource lifetime

Dispose GPU resources that are no longer needed. Use `renderer.info` when investigating leaks.

## Sources

- https://r3f.docs.pmnd.rs/advanced/scaling-performance
- https://r3f.docs.pmnd.rs/advanced/pitfalls
- https://r3f.docs.pmnd.rs/api/hooks
- https://threejs.org/manual/en/how-to-dispose-of-objects.html
- https://web.dev/articles/animations-guide
- https://web.dev/articles/defining-core-web-vitals-thresholds

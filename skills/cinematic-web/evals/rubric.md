# Cinematic Web Evaluation Rubric

Score each category 0–5:
- 0 absent/broken
- 1 severe problems
- 2 demo quality
- 3 acceptable production baseline
- 4 strong professional quality
- 5 exceptional and deliberate

## Categories

1. **Creative direction** — coherent idea/narrative, not unrelated effects.
2. **Composition** — typography, subject, whitespace, depth, and intermediate frames are well composed.
3. **Scroll choreography** — intentional, deterministic, reversible, well paced.
4. **Engineering** — maintainable architecture, clear ownership/cleanup/measurement.
5. **Performance** — responsive runtime, responsible assets/effects.
6. **Accessibility** — reduced motion, semantic content, usable controls.
7. **Responsiveness** — mobile/tablet intentionally recomposed.
8. **Asset quality** — appropriate models/textures, optimized when necessary.
9. **Reliability** — no obvious errors, flashes, broken pinning, resize leaks, or blank frames.
10. **Restraint** — avoids unnecessary 3D, effects, dependencies, and complexity.

## Critical failures

Cannot pass if:
- core content is inaccessible when WebGL fails;
- significant non-essential motion ignores reduced-motion preference;
- canvas blocks important links/forms;
- persistent runtime errors remain;
- mobile is materially broken;
- completion is claimed without rendered inspection when browser tools were available.

## Threshold

Recommended production baseline:
- **≥ 38/50**
- no critical failure
- accessibility, reliability, and performance each **≥ 3**

Flagship showcase target: **44+/50**.

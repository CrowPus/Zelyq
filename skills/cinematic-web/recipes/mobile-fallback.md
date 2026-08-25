# Recipe: Mobile / Reduced Effects

## Principle
Mobile is a recomposition, not a shrink operation.

## Quality levels

### Level 0 — Static
Poster image/video frame + semantic content.

### Level 1 — Lightweight 3D
Static model or small rotation; no expensive post-processing.

### Level 2 — Simplified cinematic
Short transitions, bounded DPR, fewer lights/particles.

### Level 3 — Full
Only when target-device evidence shows it remains smooth.

## Reduced motion is separate
A powerful device may still request reduced motion.

Preserve content and feature states. Replace long travel/parallax/continuous rotation with static frames, cuts, or short fades.

## Adapt
Consider:
- aspect ratio;
- CPU/GPU behavior;
- input mode;
- transfer size;
- business importance of the effect.

Avoid pure user-agent brand lists as the only mechanism.

## Example

```jsx
<Canvas dpr={[1, 1.5]}>
```

Then reduce optional post-processing, shadows, particles, and material complexity.

Test multiple portrait heights, not just one phone size.

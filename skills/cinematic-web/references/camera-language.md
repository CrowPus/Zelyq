# Camera Language

## Principle

Camera movement is communication. Choose behavior based on what the viewer should perceive.

## Perspective

Large FOV values exaggerate perspective; narrower FOV values compress perspective and can feel more product-photographic. Do not animate FOV casually: it changes spatial perception, not just magnification.

## Movements

### Dolly / push-in
Move toward the subject. Use for intimacy, detail, or moving from overview to feature.

### Pull-back
Reveal context or resolve after a detail shot.

### Orbit
Move around a stable target. Use to explain dimensional form.

### Pan / truck
Move laterally for comparison or adjacent reveal.

### Vertical move
Use for scale, elevation, or vertically stacked features.

### Target shift
Keep camera mostly stable while changing the look target. Interpolate the target; abrupt `lookAt` changes feel robotic.

## Object vs camera motion

Avoid aggressive simultaneous motion unless the shot requires it.

Prefer:
- camera stable + object rotates for product inspection;
- camera moves + object stable for spatial travel;
- subtle counter-motion only when it adds depth.

## Compose keyframes first

Before animating, compose:
1. start;
2. main reveal;
3. feature close-up;
4. final CTA frame.

Interpolate between good frames instead of inventing arbitrary vectors.

## Responsive framing

Do not only change camera `z`.

Portrait variants may need:
- target shift;
- subject repositioning;
- FOV adjustment;
- object scale changes;
- swapping camera orbit for object rotation;
- fewer decorative objects.

## Clipping and scale

Choose near/far planes deliberately. Huge far/near ratios reduce depth precision.

If scene scale becomes enormous because pixels were mapped directly to world units, improve the scale system rather than reaching for costly depth workarounds first.

## Smoothing

Use frame-rate-independent interpolation or timeline progress. Never use a fixed per-frame movement when speed must be device-independent.

## Review

- Is movement necessary?
- Are start/end keyframes well composed?
- Does the subject remain readable mid-transition?
- Does reverse scroll look intentional?
- Does fast scroll break framing?
- Is portrait framing separately designed?

# Recipe: Camera Dolly

## Use when
The story moves from overview to detail or detail back to context.

## Principle
Prefer real camera translation for spatial perspective change. Animate FOV only when a lens change is actually desired.

## Steps
1. Compose start.
2. Compose end.
3. Define stable target.
4. Check clipping through the path.
5. Map position to one timeline segment.
6. Interpolate target if needed.
7. Test reverse/fast scroll.

## Ownership
Only one system should own camera transforms at a time. Do not let GSAP, controls, and `useFrame` fight the same camera.

## Mobile
Shorten travel and redesign target/subject placement rather than only changing `z`.

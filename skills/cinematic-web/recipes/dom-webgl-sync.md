# Recipe: DOM ↔ WebGL Sync

## Use when
A 3D object must align with, emerge from, or hand off to a DOM element.

## Architecture
One global canvas + a DOM proxy.

The proxy owns layout. WebGL follows it.

## Measure
Track viewport x/y and width/height. Recalculate on resize/layout change. Avoid full-document measurement loops every frame.

`@14islands/r3f-scroll-rig` is a proven reference implementation of this principle.

## Events
Default overlaid canvases to `pointer-events: none` unless WebGL interaction is needed. Route only intended events; never block DOM links.

## Handoff
1. Build DOM destination.
2. Track its bounds.
3. Animate WebGL subject to matching composition.
4. Crossfade representations.
5. Stop unnecessary 3D rendering after handoff where appropriate.

## QA
Resize during the scene. Drift between DOM and WebGL means the solution is incomplete.

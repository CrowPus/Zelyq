# Recipe: Shader Transition

## Use when
The transition needs per-pixel deformation, dissolve, refraction, distortion, or material blending that DOM/CSS cannot produce cleanly.

## Avoid for
Basic fades, wipes, image reveals, and ordinary masks.

## Architecture
Drive one normalized progress uniform:

```glsl
uniform float uProgress;
```

Then let the timeline own only progress:

```js
gsap.to(material.uniforms.uProgress, {
  value: 1,
  duration: 1
})
```

This makes reverse scrolling deterministic.

## Rules
- preserve composition;
- keep text readable at intermediate states;
- do not recompile shaders during scroll;
- keep branches/samples reasonable;
- test high-DPI mobile.

## Fallback
Provide non-shader behavior for reduced motion, low-performance mode, and WebGL failure.

Capture 0/25/50/75/100% of the transition.

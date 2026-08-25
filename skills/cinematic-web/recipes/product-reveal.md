# Recipe: Product Reveal

## Use when
One product should carry the narrative through multiple scroll scenes.

## Avoid when
- an image/video communicates the product better;
- the page is primarily dense comparison/commerce;
- target devices cannot justify real-time 3D.

## Architecture
Default to Hybrid DOM + one WebGL canvas.

DOM owns copy, CTA, navigation. WebGL owns model, lighting, camera, depth.

## Story
1. **Establish** — hero silhouette/composition.
2. **Inspect** — reveal important surfaces/features.
3. **Resolve** — return to a stable conversion frame.

## Build
1. Semantic DOM first.
2. Static 3D hero composition.
3. Lighting/material polish.
4. Mobile static composition.
5. One scroll timeline.
6. Copy transitions.
7. Secondary effects only if needed.
8. Reduced-motion keyframes.
9. Visual QA.

## Timeline shape

```js
const tl = gsap.timeline({
  scrollTrigger: {
    trigger: section,
    start: "top top",
    end: "+=2600",
    pin: true,
    scrub: 0.8,
  }
})

tl
  .addLabel("hero")
  .to(product.rotation, { y: 0.45, duration: 1.4 })
  .addLabel("detail")
  .to(product.rotation, { y: 1.15, duration: 1.6 })
  .to(product.position, { x: 0.55, duration: 1.2 }, "<0.2")
  .addLabel("resolve")
  .to(product.position, { x: 0, duration: 1.2 })
```

Tune actual values from art-directed keyframes.

## Failure modes
- model covers headline mid-transition;
- drifted orbit target;
- too much pin distance for too little change;
- model pops after load;
- CTA depends on WebGL;
- desktop orbit is reused unchanged on mobile.

## QA
Capture every label plus transition midpoints.

# Scroll Choreography

## Goal

Map scroll progress to a few meaningful timelines while keeping layout measurements stable, cleanup correct, and reverse scrolling deterministic.

## Scroll is input, not story

Define narrative beats first. Then map them to scroll distance.

## GSAP + ScrollTrigger

Prefer one timeline per coherent sequence.

```js
const tl = gsap.timeline({
  scrollTrigger: {
    trigger: section,
    start: "top top",
    end: "+=1800",
    pin: true,
    scrub: 0.8,
  }
})

tl
  .addLabel("establish")
  .to(camera.position, { z: 3.2, duration: 1.2 })
  .addLabel("focus")
  .to(product.rotation, { y: Math.PI * 0.35, duration: 1.8 })
  .addLabel("resolve")
```

With `scrub`, tween durations become relative shares of the total scroll-linked timeline. Use them for pacing.

## Pinning

Pin only when a visual must remain spatially fixed while progress advances.

Avoid:
- many long pins;
- pins inside transformed ancestors without understanding fixed-position consequences;
- pinning content users need to skim quickly.

## Refresh

ScrollTrigger recalculates measurements on refresh. Manually refresh after layout-affecting async changes when automatic refresh is insufficient:
- web fonts;
- dynamic content;
- route transitions;
- responsive assets.

Do not refresh every scroll event.

## Responsive variants

Responsive choreography may need different timelines, not just different values. Use lifecycle-aware media queries and ensure previous timelines/triggers are reverted when breakpoints change.

Follow the installed GSAP version; do not cargo-cult deprecated APIs.

## Lenis

If Lenis is justified, keep one synchronized loop:

```js
lenis.on("scroll", ScrollTrigger.update)

gsap.ticker.add((time) => {
  lenis.raf(time * 1000)
})

gsap.ticker.lagSmoothing(0)
```

Do not add another unmanaged RAF loop.

## CSS scroll-driven animations

Use native CSS scroll/view timelines when the effect is DOM-only and project browser support is acceptable. Do not use novelty as a reason to replace a more reliable orchestration path.

## Determinism

Test:
- forward;
- backward;
- trackpad fling;
- scrollbar drag;
- mid-page reload;
- resize.

Prefer state as a function of progress, not a pile of one-way callbacks.

## Cleanup

On unmount/route change:
- revert/kill timelines and triggers;
- remove listeners;
- destroy owned Lenis instances;
- cancel owned RAF callbacks.

## Sources

- https://gsap.com/docs/v3/Plugins/ScrollTrigger/
- https://github.com/darkroomengineering/lenis
- https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations

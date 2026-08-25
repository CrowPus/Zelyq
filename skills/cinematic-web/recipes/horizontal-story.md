# Recipe: Horizontal Story

## Use when
A horizontal sequence improves comparison or narrative while the user continues normal vertical scrolling.

## Pattern

```js
const distance = () => track.scrollWidth - window.innerWidth

gsap.to(track, {
  x: () => -distance(),
  ease: "none",
  scrollTrigger: {
    trigger: section,
    start: "top top",
    end: () => `+=${distance()}`,
    pin: true,
    scrub: true,
    invalidateOnRefresh: true,
  }
})
```

Art-direct scroll distance; do not assume one horizontal pixel must equal one vertical scroll pixel.

## Accessibility
Keep DOM reading/focus order logical.

## Mobile
Usually switch to vertical flow, swipe gallery, or simplified sequence rather than forcing a desktop pinned track.

## QA
Resize, dynamic content width, keyboard, reverse scroll, and scrollbar drag.

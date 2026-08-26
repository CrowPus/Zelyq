# Browser Platform and Interaction

## Progressive enhancement

Use the platform first when it provides the behavior reliably. Enhance when richer behavior provides value.

## Baseline / compatibility

Check project browser requirements before adopting newer APIs. Web Platform Baseline provides current cross-browser availability information.

Source: https://web.dev/baseline/

Do not transpile/polyfill everything automatically; do not assume the latest Chromium feature is universally available.

## Input diversity

Design for:
- mouse;
- touch;
- keyboard;
- trackpad;
- assistive technology;
- zoom;
- reduced motion.

Hover may enrich an interaction but should not be the only way to discover or execute an essential action.

## Pointer behavior

Avoid making click/tap targets depend on tiny icons with no surrounding hit area. Avoid hover-only tooltips for critical information.

## Motion

Respect `prefers-reduced-motion` for non-essential animation.

Use animations to clarify state and continuity. Avoid large motion that delays task completion.

## Browser navigation

For application routing and filters, preserve expected:
- back/forward;
- deep links;
- refresh;
- scroll restoration where appropriate;
- open-in-new-tab for actual links.

Do not implement navigation using `<button>` plus imperative location changes when a link is semantically correct.

## Focus and overlays

Fixed headers, sticky bars, drawers, and overlays must be tested with keyboard focus and viewport resizing. A visually floating element can obscure the active control even when DOM order is correct.

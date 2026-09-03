# Route Curtain

Use when marketing-page navigation needs a branded transition and a shared-element transition is not the better model.

## Contract

The transition has four states:

1. **Idle** — overlay cannot receive pointer events.
2. **Covering** — overlay reveals from a meaningful origin.
3. **Covered** — route content swaps; focus and scroll policy run here.
4. **Revealing** — overlay exits and then returns to inert idle state.

The overlay must not remain interactive or focusable after interruption.

## Implementation direction

Prefer the View Transition API when it meets routing and support requirements. Feature-detect it and preserve normal navigation. Otherwise use one application-level overlay owned by the router shell, not one overlay per page.

A curtain may animate with `clip-path: inset(...)`, a translated pseudo-element, or a scale transform with a fixed transform origin. Use opacity only when a spatial transition would be misleading.

## Timing

- Cover quickly enough that navigation feels responsive.
- Swap content near full cover, never while both pages are visibly misaligned.
- The reveal may be slightly slower than the cover on expressive marketing sites.
- Skip or shorten the transition for repeated rapid navigation.

## Navigation behavior

- Preserve ordinary link semantics.
- Define scroll restoration per route.
- Move focus to the new page's appropriate landmark after navigation.
- Announce the new document/page title when the framework does not do so.
- Handle back/forward, hash navigation, external links, modified clicks, downloads, and route errors.

## Reduced motion and failure

Reduced motion: use an instant route change or a short opacity crossfade.

If animation fails or is interrupted, force the newest route to its valid final state, remove pointer blocking, and restore scrolling. Never leave a full-screen cover trapping the user.


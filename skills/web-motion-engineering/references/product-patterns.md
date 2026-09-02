# Product motion patterns

Use this reference for repeated application UI. Product motion must protect speed, clarity, focus, and state integrity.

## Buttons and controls

- Acknowledge press immediately with a small scale, surface, shadow, or color change.
- Do not move the hit target away from the pointer.
- Keep focus-visible treatment stable and at least as clear as the resting state.
- Loading state preserves geometry. Prevent duplicate submission by logic, not animation.
- Success transitions accompany, not replace, textual or programmatic state.

## Tooltip and popover

- Position first, then animate from the trigger-facing origin.
- Prefer opacity plus a few pixels of translation or restrained scale—not scale from zero.
- Avoid replaying elaborate motion as a user moves rapidly through adjacent controls.
- The arrow, surface, and shadow act as one object.

## Dialog and drawer

- Move focus at open according to the dialog pattern; do not wait for decorative motion.
- Keep backdrop and surface synchronized.
- Dialogs usually fade with small translation/scale. Drawers originate from their attached edge.
- During exit, prevent stale backdrop interception and clean up after cancellation/unmount.
- Under reduced motion, remove large translation/scale; retain an instant change or short opacity transition.

## Accordion and disclosure

- Preserve content readability and avoid scaling text vertically.
- Prefer layout animation/clip strategies supported by the stack; if animating measured height, handle dynamic content and resize.
- Rotate or morph the indicator in sync with the panel state.
- Rapid toggles should reverse from the current visual position.

## Tabs and segmented controls

- A shared underline/pill can preserve selection identity.
- Content transition should reflect relationship, not invent a direction unrelated to tab order.
- Keyboard navigation remains immediate; arrow-key moves should not wait for page-like transitions.

## Lists, sorting, and drag

- Animate reordering with layout continuity, not manual top/left loops.
- A dragged item needs a clear lift state; surrounding items make space without jitter.
- Maintain a keyboard alternative and communicate the result.
- Large or virtualized lists favor stability over staggered entrances.

## Toasts and status

- Enter near their anchored region and leave decisively.
- Do not make auto-dismiss timing depend on the entrance animation.
- Avoid stacking independent bouncy timelines; coordinate the toast region as a layout.

## Navigation and page transitions

- Preserve shared objects only when identity is real.
- Use a quick crossfade for unrelated top-level destinations; large lateral slides can imply a false hierarchy.
- Route state, history, focus, title, and scroll restoration remain correct.
- Feature-detect View Transitions and allow navigation to complete normally without them.

## Skeletons and progress

- Skeleton geometry matches final content to prevent a second layout shift.
- Avoid high-contrast perpetual shimmer. Reduced motion uses a static placeholder or subtle non-spatial pulse.
- Use determinate progress when progress is known. Do not fake completion.

## Text and numbers

- Keep one intact accessible string when using split text for visual sequencing.
- Do not animate every word in body copy.
- Tween numbers only when intermediate values are meaningful; otherwise update directly and emphasize the final value.
- Preserve tabular alignment for changing metrics.

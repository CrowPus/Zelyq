# Accessibility

## Principle

Cinematic enhancement must not make the underlying site harder to perceive, navigate, understand, or operate.

## Reduced motion

Respect `prefers-reduced-motion`.

Reduced motion does not mean deleting the narrative. Preserve information using:
- cuts;
- short fades;
- static keyframes;
- instant section-state changes.

Reduce or remove:
- large parallax;
- long camera travel;
- continuous background drift;
- rapid rotation;
- intense zoom/perspective motion.

Lenis currently respects reduced-motion by default in normal configuration; your own animations still need an intentional reduced-motion variant.

## Interaction-triggered animation

WCAG 2.2 Success Criterion 2.3.3 addresses motion animation triggered by interaction and requires a way to disable non-essential motion.

Treat scroll/pointer cinematic effects with the same user-respect principle even when a specific effect falls outside a narrow reading of one criterion.

## Semantic content

Keep critical information in DOM:
- headings;
- paragraphs;
- links;
- buttons;
- forms;
- validation.

Do not require assistive technology to interpret body copy rendered into WebGL.

## Keyboard and pointer

A fixed canvas must not accidentally intercept:
- navigation;
- links;
- forms;
- cookie dialogs;
- modals.

Route events deliberately.

## Focus

Pinned/transformed sections should not:
- reorder focus unpredictably;
- move keyboard focus automatically without a reason;
- hide focus indicators.

## Scroll

Avoid designs where:
- scrollbar dragging stops working;
- anchor links break;
- nested scroll traps the user;
- browser history restoration becomes unusable.

## Fallback

If WebGL fails, preserve:
- content;
- navigation;
- CTA;
- core layout;
- meaningful static media where possible.

## Contrast

Backgrounds can change under text across the timeline. Check contrast throughout the animation, not just at the hero screenshot.

## QA

Test reduced motion:
1. enabled before load;
2. toggled live where the stack supports it;
3. anchors/navigation;
4. keyboard order;
5. complete understanding without 3D motion.

## Sources

- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- https://github.com/darkroomengineering/lenis

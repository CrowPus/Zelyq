# Accessible and adaptive motion

Use this reference for every non-trivial motion implementation and whenever motion is automatic, large, scroll-linked, flashing, or interaction-triggered.

## Reduced motion is a replacement strategy

The operating-system preference means minimize non-essential motion. Preserve state clarity while removing vestibular triggers.

| Full motion | Reduced branch |
| --- | --- |
| Large slide/zoom/scale | Instant change or short opacity transition |
| Parallax/camera travel | Static composition at the most informative frame |
| Auto-rotating 3D | Static model/poster; manual controls if needed |
| Scrubbed frame sequence | A few discrete states or static proof image |
| Bouncy spring | Critically damped or instant settlement |
| Ambient loop | Stop it |
| Progress indicator | Keep essential progress, reduce decorative travel |

Do not globally hide content or force every duration to zero without checking component logic. Some presence systems need a minimal completion path to cleanly unmount.

## CSS preference pattern

Write the full animation inside `no-preference` when the base experience should be static:

```css
.hero-subject { opacity: 1; transform: none; }

@media (prefers-reduced-motion: no-preference) {
  .hero-subject {
    animation: hero-reveal 500ms var(--motion-ease-enter) both;
  }
}
```

For a product with many components, centralize policy with tokens or a provider and add component-specific replacements where needed. Motion for React can set `reducedMotion="user"`; GSAP can branch through `gsap.matchMedia()`.

## Optional site-level control

For a motion-heavy site, provide an obvious Motion control with System, Reduced, and Full options. Store the explicit choice, but default to the OS preference. Apply the setting before the first animated paint when possible to avoid a flash of full motion.

## WCAG-related checks

- Interaction-triggered non-essential motion must be disableable for WCAG 2.3.3 (AAA); respecting the OS preference is a supported technique.
- Automatically starting movement that lasts more than five seconds and appears alongside other content needs a pause, stop, or hide control under WCAG 2.2.2 (A), unless essential.
- Do not exceed three flashes in any one-second period unless the content is demonstrably below the general/red flash thresholds.
- Do not rely on movement alone to convey information. Pair it with visible state, text, iconography, position, or an accessible announcement.

## Input, focus, and semantics

- Use native interactive elements. Animation wrappers do not make a `div` into a button.
- Keep keyboard and touch alternatives for drag, hover, scrub, and spatial exploration.
- Manage dialog/menu focus according to the interaction pattern independent of decorative timing.
- Do not animate focus away, remove the focus ring, or move a focused target unpredictably.
- Announce meaningful async status through appropriate live regions; decorative animation stays hidden from accessibility APIs.
- When visually splitting text, keep an unsplit accessible label and hide duplicate fragments.
- Verify at 200% zoom and with text reflow; motion geometry must tolerate changed line breaks and component sizes.

## Test procedure

1. Enable OS reduced motion before loading the page.
2. Load, navigate, resize, and trigger every major interaction.
3. Toggle a site-level preference if present and confirm active timelines are reverted/rebuilt.
4. Complete the journey with keyboard only.
5. Check focus order and announcements with a screen reader for stateful components.
6. Confirm automatic/ambient motion can stop and stays stopped.
7. Verify no essential content exists only in video, canvas, or animated text fragments.

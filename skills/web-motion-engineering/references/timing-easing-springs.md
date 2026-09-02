# Timing, easing, and springs

Use this reference when defining tokens, tuning a transition, or diagnosing motion that feels slow, mechanical, floaty, or harsh.

## Duration is perceptual

Duration should respond to distance, visual area, apparent mass, frequency, information to perceive, input method, screen size, and concurrent choreography.

Start with the bands in `SKILL.md`, then tune in the real interface. Large does not automatically mean slow: a full-page navigation often benefits from a quick fade because moving the entire screen can disorient users.

## Easing roles

| Role | Shape | Use |
| --- | --- | --- |
| Entrance/response | Fast start, controlled settlement | Popovers, dialogs, new content, direct input response |
| Standard movement | Acceleration and deceleration | Reorder, resize, morph, on-screen movement |
| Final exit | Brief acceleration away | Toast or element removed from the working area |
| Nearby exit | Standard/decelerating | Drawer or panel that remains conceptually just offscreen |
| Linear | Constant rate | Progress tied exactly to time/scroll, continuous rotation, data truth |

Useful starting curves:

```css
:root {
  --motion-ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
  --motion-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --motion-ease-exit: cubic-bezier(0.4, 0, 1, 1);
}
```

These are defaults to tune, not a requirement to overwrite established tokens.

## Pair duration and curve

A strong ease-out reaches most of its distance early and can tolerate a slightly longer nominal duration without feeling slow. A gentle curve at the same duration can feel delayed. Judge the entire velocity profile, not the number alone.

Related parts should share a temporal relationship. They do not always need identical durations: a scrim may begin first and finish with the dialog, or a child may settle just after its container. The relationship must be intentional and tested.

## Springs

Use a spring when continuity of velocity matters: drag release, snap, interruptible expansion, direct manipulation, or organic settling. Use a duration curve when precise choreography and predictability matter.

| Outcome | Guidance |
| --- | --- |
| Productive | Critically or near-critically damped; little/no overshoot |
| Direct manipulation | Preserve input velocity; subtle overshoot only if it reinforces material feel |
| Expressive | Limited bounce may be acceptable at a rare brand/success moment |
| Serious/error/destructive | No playful bounce |

Never mix unrelated spring presets across components. Name and reuse a small set such as `snappy`, `settled`, and `expressive`.

## Stagger

Stagger communicates group order and direction. Use it when items belong to one event, not as a default entrance effect.

- Typical step: 20–60 ms.
- Shorten the step as group size grows.
- Cap the total stagger window.
- Virtualized or frequently refreshed lists should usually avoid entrance cascades.
- Reverse order only when exit direction or hierarchy makes it meaningful.

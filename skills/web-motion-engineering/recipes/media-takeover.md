# Media Takeover

Use when a video or image should begin as an immersive environment and resolve into an object displayed inside that environment.

## Scene model

Create three coordinated layers:

1. **Environment** — background image, color field, or scene.
2. **Subject frame** — the video/image that moves from oversized to contained.
3. **Grounding detail** — frame edge, shadow, reflection, caption, or nearby object that appears as the subject settles.

The spatial illusion comes from counter-motion: the subject shrinks while the environment zooms out or reveals more context.

## Timeline

```text
0.00–0.18  hold immersive state
0.18–0.72  subject scales and repositions; environment counter-scales
0.56–0.82  frame/shadow/reflection becomes visible
0.82–1.00  hold readable resolved state
```

Tune from the actual composition. Keep one normalized progress source and derive every layer from it.

## Reflection rule

A reflection is optional. If used, prefer a duplicated media layer with vertical inversion, gradient masking, reduced opacity, and bounded blur. Profile it on Safari and mobile. Remove it before sacrificing interaction responsiveness.

## Video rules

- Provide a poster and fixed aspect ratio.
- Start muted when autoplaying; expose a deliberate sound control.
- Do not tie `currentTime` to scroll unless frame-accurate scrubbing is actually required and tested.
- Pause when far offscreen.

## Mobile and reduced motion

Mobile: resolve quickly into the framed state or start framed. Avoid a huge scale delta that causes disorientation.

Reduced motion: show the resolved environment and frame immediately with no zoom; a short opacity reveal may remain.

## Failure checks

- The subject never exposes an unintended edge during scale.
- The final frame is sharp and not transformed by a fractional scale indefinitely.
- Background and subject focal points remain aligned.
- Slow video loading reveals the poster, not an empty rectangle.
- Blur/reflection does not dominate paint time.


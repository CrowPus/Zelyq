# DOM + WebGL Architecture

## Default

For most commercial cinematic 3D sites, use **hybrid DOM + one persistent WebGL canvas**.

DOM owns information. WebGL owns depth.

## DOM normally owns

- headings/body copy;
- navigation;
- links/buttons;
- forms;
- legal/accessibility content;
- SEO-critical text;
- loading fallbacks.

## WebGL normally owns

- 3D product models;
- depth/perspective;
- shader surfaces;
- environmental effects;
- spatial camera choreography.

## Why one canvas

Multiple contexts complicate limits, resource sharing, render scheduling, and routing. A persistent canvas also simplifies route transitions and adaptive quality.

`@14islands/r3f-scroll-rig` is a useful reference: one global canvas, DOM proxy elements, measured alignment, and synchronized scrolling.

## Layer pattern

```text
<body>
  semantic content
  sticky/pinned sections
  overlay UI
  fixed cinematic canvas
</body>
```

Default canvas CSS may be:

```css
.cinematic-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
}
```

If WebGL needs interaction, route events deliberately. Never let the canvas blanket-block links and controls.

## Synchronization strategies

### Global storyboard
Scroll progress drives camera, model transforms, uniforms, and DOM transitions.

### DOM proxy tracking
Use when a 3D object must align with a DOM card/image. Measure stable proxy bounds and update on layout changes.

### Scene handoff
For 3D-to-DOM transitions, build both end states, align composition, crossfade representations, then optionally stop rendering the 3D element.

## Stable layout first

Reserve dimensions using aspect ratios and stable section sizes. Avoid layout shifts during pinned sequences.

## SSR

In SSR frameworks:
- server-render semantic content;
- load WebGL client-side;
- provide static fallback media;
- never make core content depend on canvas readiness.

## Failure isolation

If WebGL fails, content, navigation, CTA, and page structure should remain usable.

## Source

- https://github.com/14islands/r3f-scroll-rig

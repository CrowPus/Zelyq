# Experimental Collage

Use when a creative brand needs controlled surprise through asymmetric imagery, cutout objects, letters, and depth.

## Art-direct before animating

Define 4–8 primary objects. For each object record:
- visual role: anchor, counterweight, accent, or connector;
- depth lane: near, middle, or far;
- start and end position;
- scale range;
- rotation range;
- overlap permissions;
- mobile placement;
- reduced-motion resting state.

Do not randomize final layout. Randomness may generate an exploratory draft, but the shipped resting composition must be deterministic.

## Choreography

- Give the largest object the smallest relative travel.
- Move smaller accents farther or slightly faster to imply depth.
- Separate entrances in time, but cap the total cascade so the scene becomes readable quickly.
- Allow at most one deliberately corrupted or scattered text motif.
- Keep primary navigation and conversion copy outside the moving object field.

## Rendering choice

Use DOM images for a small number of art-directed cutouts. Use canvas only when many objects, pixel masks, or post-processing justify it. Keep accessible text in DOM even if a canvas echoes it visually.

## Mobile and reduced motion

Mobile: reduce object count, compress depth, prevent overflow from creating horizontal scroll, and prefer a composed poster-like cluster.

Reduced motion: display all objects at deterministic resting positions; remove rotation, drift, glitch dispersion, and continuous loops.

## Failure checks

- No accidental overlap with navigation, CTA, or legal content.
- Objects stay inside intended crop zones at narrow and ultrawide ratios.
- Transparent assets have trimmed bounds and appropriate resolution.
- Pointer-events on decorative layers do not block content.
- Continuous motion pauses offscreen and on hidden tabs.


# Motion, Scroll, and Time

## Motion fingerprint

For meaningful transitions record:
- trigger;
- duration;
- easing/spring;
- delay/stagger;
- property/transform;
- origin;
- entering/exiting state.

## Static screenshot baselines

Disable or settle motion for static comparison.

Separately test animation behavior where motion itself is part of the fidelity requirement.

## Scroll

Inspect:
- sticky/fixed layers;
- scroll containers;
- header state changes;
- scroll-linked reveal;
- anchor offsets;
- section pinning;
- horizontal tracks.

Capture scroll checkpoints.

## Time-sensitive UI

Freeze/reference:
- clock;
- countdown;
- relative dates;
- live metrics

when static comparison requires determinism.

Do not "fix" a reference animation by making the clone static if animation is in scope.

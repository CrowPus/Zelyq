# Interaction and State Fidelity

A replica must reproduce observable state transitions, not only resting pixels.

## State matrix

For each component consider:
- default;
- hover;
- focus-visible;
- active/pressed;
- selected;
- open;
- disabled;
- loading;
- error;
- success;
- checked;
- expanded.

## Capture

Capture states independently when visual changes matter.

## Behavior map

Record:
- trigger;
- target/result;
- keyboard behavior;
- focus movement;
- dismissal;
- URL/history changes;
- persistence;
- async delay;
- animation.

## Overlays

For menus/dialogs/popovers record:
- anchor;
- placement;
- offset;
- collision/flip behavior;
- z-index layer;
- backdrop;
- focus/escape/outside-click behavior.

## Hidden behavior

Do not invent behavior from a static screenshot.

If reference is screenshot-only, state unverified interaction fidelity.

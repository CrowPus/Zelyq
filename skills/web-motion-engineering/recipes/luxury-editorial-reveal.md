# Luxury Editorial Reveal

Use for a calm, premium story in which one subject moves from detail to immersion and then into readable explanation.

## Structure

1. Establish one full-bleed visual with minimal interface.
2. Move into a quiet typography scene with generous space.
3. Introduce a centered cropped image behind or below the headline.
4. Expand the crop and scale inside a sticky scene until it fills the viewport.
5. If the story has stages, replace the image at named beats and move one short phrase with it.
6. Release into a normal-flow editorial section, preferably an asymmetric image-and-copy composition.

## DOM contract

Keep one sticky stage inside a tall scene wrapper. Within the stage, separate:
- media layers;
- a semantic headline/caption layer;
- optional progress markers;
- an invisible normal-flow spacer owned by the scene wrapper.

Use CSS custom properties such as `--scene-progress`, `--crop-x`, and `--media-scale` or an equivalent timeline. Do not derive every element from raw `scrollY` independently.

## Motion contract

- The crop opens while scale grows; they must end together.
- Keep the subject's focal point stable during growth.
- Crossfade, mask, or replace media only at named story beats.
- Use decisive but smooth interpolation without bounce.
- Let the final full-screen state rest before the next section pushes it away.

## Mobile and reduced motion

Mobile: use one strong hero, then stacked stage cards or short sticky states. Reframe the subject for portrait space.

Reduced motion: render the final crop immediately and present process stages as static semantic sections.

## Failure checks

- No blank viewport between hero and editorial content.
- No headline hidden behind a crop at the resting state.
- Sticky wrapper has enough height for every beat.
- Reloading mid-scene computes the correct state without playing from zero.
- Late image decode does not change geometry.


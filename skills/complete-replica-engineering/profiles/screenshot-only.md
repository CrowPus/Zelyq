# Profile: Screenshot-Only Reference

## Constraint
Only visible pixels are known.

## Required
- record screenshot pixel dimensions;
- infer likely viewport only if metadata/context supports it;
- measure visible geometry proportionally;
- identify uncertain fonts/assets;
- list unknown states/breakpoints.

## Do not claim
- exact hidden interactions;
- exact responsive behavior;
- exact font files;
- exact animation.

## Strategy
Build visible state faithfully, then make responsive behavior robust and conventional without pretending it was observed.

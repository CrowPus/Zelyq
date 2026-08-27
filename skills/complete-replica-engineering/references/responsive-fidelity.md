# Responsive Fidelity

## Observe transitions, do not assume breakpoints

Reference behavior may use:
- media queries;
- container queries;
- intrinsic wrapping;
- min/max sizing;
- JavaScript measurement.

Do not infer `768px` merely because it is common.

## Breakpoint discovery

1. capture known wide and narrow states;
2. resize gradually;
3. note first visible layout change;
4. probe around that width;
5. record transition behavior.

## Container-driven components

Container queries react to container attributes rather than only viewport width. Test embedded component widths where relevant.

## Interpolation

Test between golden widths.

Watch:
- overflow;
- awkward wrapping;
- premature menu changes;
- collapsed gutters;
- crop changes;
- fixed widths that exceed viewport.

## Mobile

Match behavior, not just scale:
- navigation;
- order;
- visibility;
- touch targets;
- bottom/fixed controls;
- viewport-safe areas where applicable.

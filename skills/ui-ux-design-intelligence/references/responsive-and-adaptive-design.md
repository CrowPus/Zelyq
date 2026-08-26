# Responsive and Adaptive Design

## Principle

Adapt **information and interaction**, not only dimensions.

## Context changes

Consider:
- viewport;
- container;
- orientation;
- touch vs pointer;
- keyboard;
- resizable windows;
- text size;
- safe areas;
- locale/RTL;
- device posture/platform.

Apple HIG emphasizes layouts that adapt to context while remaining recognizably consistent.

## Priority model

For each breakpoint/context decide:
- keep;
- move;
- collapse;
- disclose;
- replace;
- remove if truly nonessential.

Never hide essential functionality just because the screen is narrow.

## Navigation

Possible transformations:
- persistent sidebar → drawer/sheet;
- horizontal tabs → scrollable tabs/segmented/picker depending on platform/task;
- multi-column → master/detail navigation;
- dense toolbar → prioritized actions + overflow.

## Content

Reflow before truncating.

Large text may require:
- stacked layout;
- fewer columns;
- larger row height;
- relocated metadata.

## Touch

Increase target comfort and spacing. Hover cannot be required for essential discovery.

## Wide screens

Do not stretch line length and forms infinitely.

Use:
- max readable widths;
- multi-pane layouts where task benefits;
- anchored side context.

## Review matrix

Test states across:
- narrow portrait;
- medium;
- wide;
- constrained component container;
- large text/zoom;
- RTL if product supports it.

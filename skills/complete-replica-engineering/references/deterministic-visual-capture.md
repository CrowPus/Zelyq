# Deterministic Visual Capture

Visual diffing is useless if reference and replica change randomly.

Sources of nondeterminism:
- animations/transitions;
- blinking caret;
- current time/date;
- randomized IDs/content;
- ads;
- rotating carousels;
- network race;
- lazy loading;
- font swap;
- responsive image selection;
- asynchronous data;
- canvas/video;
- OS/browser font rasterization.

## Stabilization

Use:
- fixed viewport/DPR;
- fixed locale/timezone;
- fixed data fixtures;
- font readiness;
- animation disable/settling;
- deterministic seed where application permits;
- stable mock data;
- explicit readiness signal.

Playwright's screenshot assertions disable animations by default and hide carets by default. Use these features knowingly.

## Masking

Mask only content that is genuinely nondeterministic and irrelevant to fidelity.

Never mask:
- layout containers;
- typography;
- navigation;
- controls;
- core imagery;
- large sections

just to reduce diff.

Every mask should have a reason recorded in the Replica Contract.

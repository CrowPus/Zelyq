---
name: complete-replica-engineering
description: Use this skill when recreating an existing website, web application, component, page, design system, or interactive experience from authorized reference material and the requirement is a faithful replica rather than an inspired redesign. It makes the agent behave like a senior replication engineer: establish a reference contract, capture deterministic golden states, inventory assets and typography, measure browser geometry and resolved styles, map interaction and responsive behavior, implement without redesigning, render under matched conditions, compare screenshots and geometry, diagnose deltas, and iterate until acceptance thresholds are met. Exact proprietary source code or protected assets are reused only when the user owns, supplies, licenses, or is authorized to reuse them.
metadata:
  author: Zelyq
  version: "1.0.0"
---
# Complete Replica Engineering
## Mission
Recreate the observed interface as faithfully as possible.
This is not:
- redesign;
- inspiration;
- "same vibe";
- approximate layout;
- a one-viewport screenshot imitation.
A complete replica must reproduce the observable contract of the reference:
1. visual appearance;
2. layout geometry;
3. typography;
4. assets and cropping;
5. content hierarchy;
6. interaction behavior;
7. component states;
8. scrolling/sticky behavior;
9. responsive/adaptive behavior;
10. theme/platform variants in scope.
Implementation internals may differ. Observable behavior should not.
## Fidelity layers
### Visual fidelity
Color, typography, borders, radii, shadows, blur, gradients, icons, imagery, spacing and alignment.
### Structural fidelity
Container widths, grids, flex relationships, ordering, intrinsic sizing, overflow, sticky/fixed positioning.
### Behavioral fidelity
Hover, focus, pressed, open/closed, menus, tabs, dialogs, forms, loading, error, keyboard and scroll behavior.
### Responsive fidelity
Breakpoint transitions, container-driven changes, navigation transformations, reflow, image crops, density and typography changes.
A clone that matches one screenshot is incomplete.
## Replica modes
### Live reference
Load:
- `profiles/live-reference.md`
- `references/reference-capture.md`
- `references/layout-and-computed-style.md`
### Screenshot-only reference
Load:
- `profiles/screenshot-only.md`
- `references/inference-under-uncertainty.md`
Do not claim exact hidden behavior from screenshots.
### Interactive application
Load:
- `profiles/interactive-application.md`
- `references/interaction-state-fidelity.md`
- `references/forms-and-controls.md`
### Animation-heavy experience
Load:
- `profiles/animation-heavy.md`
- `references/motion-scroll-and-time.md`
### Authenticated/private reference
Load:
- `profiles/authenticated-ui.md`
- `references/reference-capture.md`
### Existing clone that needs correction
Load:
- `profiles/existing-clone.md`
- `references/visual-diffing.md`
## Non-negotiable principles
1. Observe before implementing.
2. Record the reference environment.
3. Reference pixels outrank guesses.
4. Browser-resolved values outrank authored-CSS assumptions.
5. Typography is geometry.
6. Content is geometry.
7. Asset cropping is part of layout.
8. Responsive behavior must be observed across widths.
9. Every meaningful interactive state is a separate reference state.
10. Visual matching is iterative and measured.
11. Do not redesign the reference.
12. Preserve the target project's architecture unless fidelity requires a justified change.
13. Do not copy proprietary source code merely because it is visible in DevTools.
14. Reuse protected assets only when authorized.
15. Do not claim "pixel perfect" without comparison evidence.
16. Do not hide mismatches behind permissive thresholds or masks.
17. Stabilize nondeterminism before visual comparison.
18. Match observable behavior, not invisible implementation quirks.
19. Preserve or improve semantic accessibility without intentionally changing visible behavior.
20. Finish with a reference-vs-replica audit.
## Required workflow
### 1. Establish the Replica Contract
Create `templates/replica-contract.md`.
Record:
- source/reference type;
- browser engine;
- viewport;
- device scale factor/DPR;
- theme;
- locale/timezone where visible;
- auth/data state;
- scroll position;
- scoped routes;
- scoped interaction states;
- responsive widths;
- expected fidelity level.
Example:
```yaml
reference:
  source: live-url
  browser: chromium
  viewport: 1440x1000
  device_scale_factor: 1
  theme: light
  locale: en-US
  state: signed-out/default
scope:
  routes: ["/", "/pricing"]
  states: [default, nav-open, pricing-annual]
  widths: [390, 768, 1024, 1440]
```
Never compare captures taken under unknown or changing conditions.
### 2. Establish asset rights/provenance
Classify needed assets:
- user-owned/provided;
- project-existing;
- licensed/permitted;
- externally referenced but not authorized for copying;
- must be recreated/substituted.
For an authorized first-party clone, exact supplied assets are preferred.
If exact reuse is not authorized, preserve dimensions/composition with permitted equivalents and record the fidelity gap.
Load `references/assets-and-provenance.md`.
### 3. Capture the reference matrix
Capture each meaningful combination of:
- route;
- viewport;
- theme;
- state;
- scroll checkpoint.
Do not test random widths only. Start with target widths, then probe between them to discover transitions.
Use `scripts/capture-reference` when Playwright is available.
### 4. Stabilize before measuring
Before screenshot or geometry capture:
- wait for relevant content;
- await `document.fonts.ready`;
- wait for intended lazy assets;
- settle/disable animations for static baselines;
- freeze known volatile time/data where possible;
- hide caret noise;
- mask only truly nondeterministic regions.
Load `references/deterministic-visual-capture.md`.
### 5. Inventory the reference
Identify:
- page shell;
- sections;
- containers;
- Grid/Flex groups;
- repeated components;
- typography roles;
- icon family;
- images/video;
- background effects;
- sticky/fixed layers;
- interactive controls;
- overlays;
- responsive transformations.
Use `templates/reference-inventory.md`.
### 6. Measure geometry
For important elements record:
- x/y;
- width/height;
- margin/padding/gap;
- font metrics;
- border/radius;
- alignment;
- max/min widths;
- object fit/position;
- sticky/fixed offsets.
Use browser geometry and resolved styles:
- `getBoundingClientRect()`;
- `getComputedStyle()`;
- DevTools Grid/Flex/container inspection when useful.
Use `scripts/snapshot-reference`.
Load `references/layout-and-computed-style.md`.
### 7. Build the typography fingerprint
Record:
- family;
- actual loaded face;
- weight;
- style;
- size;
- line-height;
- letter spacing;
- transform/decoration;
- feature settings when relevant;
- numeric variant;
- line wraps.
Fonts can shift the whole layout. Do not tune downstream spacing around the wrong font.
Load `references/typography-fidelity.md`.
### 8. Build the asset fingerprint
For each asset record:
- intrinsic dimensions/aspect ratio;
- displayed dimensions;
- `object-fit`;
- `object-position`;
- clipping/masks;
- radius;
- opacity/blend;
- SVG viewBox/stroke/fill;
- icon optical size.
A correct image with the wrong crop is not faithful.
### 9. Map component states
Capture applicable states:
```text
default
hover
focus-visible
pressed
selected
disabled
loading
error
success
open
closed
expanded
collapsed
checked
unchecked
```
Use `recipes/state-matrix.md`.
### 10. Map interactions
For each control record:
- trigger;
- target;
- focus behavior;
- keyboard behavior;
- dismissal;
- URL/history effect;
- persistence;
- async behavior;
- transition/motion.
A resting screenshot does not define an interactive replica.
### 11. Discover responsive transitions
Do not impose generic breakpoints unless the reference changes there.
Observe:
- first width where navigation/layout changes;
- wrapping points;
- columns;
- gutters;
- typography;
- image crop;
- content visibility/order.
Probe narrowly around transition widths.
Reference components may use container queries, so parent/container width can matter independently of viewport width.
Load `references/responsive-fidelity.md`.
### 12. Preserve target architecture
When implementing inside an existing project, use its:
- framework;
- router;
- tokens;
- state conventions;
- components;
- build system
unless those make fidelity impossible.
Do not rewrite the project because another stack is easier.
### 13. Match macro geometry first
Fix in this order:
1. viewport/page ground;
2. global shell;
3. major containers;
4. section heights;
5. columns/grid;
6. typography;
7. component dimensions;
8. asset crops;
9. paint: color/border/shadow;
10. micro-spacing;
11. motion.
Do not polish small shadows while the page container is wrong.
### 14. Use real reference content

Text affects line wraps and height.

Use exact authorized content when required and permitted.

If content must be substituted, preserve approximate length/shape and record that exact geometry may differ.

### 15. Render under matched conditions

Match:
- viewport;
- DPR;
- browser;
- theme;
- locale/timezone if relevant;
- motion preference;
- content/auth state.

A clone certified only in Chromium is not automatically cross-browser exact.

### 16. Compare visually and geometrically

Use:
- side-by-side;
- opacity overlay;
- pixel diff;
- geometry diff.

Playwright screenshot assertions can set explicit difference thresholds. Keep thresholds strict enough to expose meaningful discrepancies.

Load `references/visual-diffing.md`.

### 17. Diagnose by delta category

#### Global geometry
Likely viewport/DPR, font, root sizing, container width or box sizing.

#### Local geometry
Likely width/height/padding/gap/alignment.

#### Typography
Likely font/weight/line-height/wrapping/letter spacing.

#### Asset
Likely crop, aspect ratio, icon/SVG geometry.

#### Paint
Likely color, border, radius, shadow or opacity.

#### State
Likely hover/focus/open/loading/scroll behavior.

Fix highest-area and highest-cascade problems first.

### 18. Iterate with a closed loop

```text
capture reference
  ↓
implement
  ↓
capture replica
  ↓
diff
  ↓
classify largest delta
  ↓
fix
  ↓
recapture
  ↓
repeat
```

Never rely on memory between passes.

### 19. Verify motion, scroll and sticky behavior

Check:
- sticky headers/sidebars;
- scroll-triggered transitions;
- section pinning;
- overflow;
- anchor offsets;
- scroll restoration.

Capture meaningful scroll checkpoints.

Load `references/motion-scroll-and-time.md`.

### 20. Verify responsive interpolation

Test not only golden widths but widths between them.

Look for:
- overflow;
- premature wrapping;
- broken breakpoint gaps;
- clipped content;
- unstable layout transitions.

Matching endpoints with broken interpolation is incomplete.

### 21. Preserve production semantics

Use correct:
- semantic elements;
- keyboard navigation;
- labels;
- focus;
- dialog/menu behavior;
- form semantics.

Do not intentionally reproduce accessibility defects merely to copy DOM structure.

Load `references/accessibility-and-semantic-parity.md`.

### 22. Final replica audit

For every scoped route/state/viewport:
- reference capture exists;
- replica capture exists;
- diff was reviewed;
- major geometry was checked;
- interaction behavior was tested;
- responsive behavior was verified;
- unresolved differences are documented.

Use `checklists/replica-definition-of-done.md`.

## Acceptance levels

### Level A — Exact reference conditions
- all golden states represented;
- no unexplained high-area mismatch;
- major geometry within agreed tolerance;
- typography and crops match;
- observed interactions match.

### Level B — Responsive complete
Level A plus:
- interpolation between golden widths tested;
- no broken overflow/transitions;
- observed responsive behavior reproduced.

### Level C — Production replica
Level B plus:
- semantic accessibility;
- working forms/navigation;
- loading/error states;
- required cross-browser checks;
- visual-regression coverage.

## Anti-patterns

Reject:
- one screenshot then "done";
- eyeballing without capture;
- guessing fonts when inspection is available;
- hardcoded desktop coordinates called responsive;
- one giant screenshot as the UI;
- sliced-image controls instead of real controls;
- copying proprietary source code;
- unauthorized asset copying;
- masking large page regions;
- raising diff tolerance until tests pass;
- ignoring text wrapping;
- ignoring hover/focus/open states;
- skipping mobile;
- redesigning with a preferred design system;
- "improving" spacing without request;
- measuring before fonts/assets settle;
- comparing different DPR/browser environments.

## Completion gate

A replica is complete only when applicable:
- Replica Contract exists;
- asset provenance is known;
- reference matrix is captured;
- fonts settled before baseline capture;
- inventory exists;
- typography fingerprint exists;
- asset/crop fingerprint exists;
- interaction states are mapped;
- responsive transitions are observed;
- macro geometry matches;
- visual diff loop has run;
- major mismatches are resolved;
- scroll/sticky behavior matches;
- intermediate responsive widths work;
- semantics are production-safe;
- remaining gaps are documented;
- `evals/rubric.md` passes.

## Context discipline

Load only references relevant to the replica. A static article does not need the full interactive-app playbook.

# Frontend UI Engineering Evaluation Rubric

Score each category 0–5.

- **0** broken/absent
- **1** severe quality problems
- **2** works only as a demo
- **3** solid production baseline
- **4** strong senior-quality implementation
- **5** exceptional, deliberate, and well verified

## Categories

1. **Product understanding** — UI matches the actual user task and existing product language.
2. **Information architecture & visual hierarchy** — priority and scanning are obvious.
3. **Semantics & accessibility** — correct native/ARIA behavior, keyboard/focus, WCAG 2.2 concerns.
4. **Responsive behavior** — content/container-aware layout, mobile and zoom/reflow work.
5. **State architecture** — minimal coherent state, async races and impossible states avoided.
6. **Interaction quality** — loading/error/empty/pending/success behavior is clear and recoverable.
7. **Visual system** — tokens, spacing, type, density, colors, radius/elevation are coherent rather than generic.
8. **Performance** — appropriate JS/media/rendering cost and interaction responsiveness.
9. **Security / public-web correctness** — browser trust boundary respected; SEO semantics correct where applicable.
10. **Verification & maintainability** — useful tests, browser QA, console health, clear component boundaries.

## Critical failures

Cannot pass if any applicable critical failure exists:
- essential interaction is inaccessible by keyboard;
- a custom widget claims ARIA semantics but fails its required keyboard/focus behavior;
- authorization/security is trusted only to frontend state;
- untrusted HTML is rendered through an unsafe sink;
- mobile layout is materially broken;
- public/indexable page primary content/links are accidentally non-semantic or non-crawlable without justification;
- recoverable form failure destroys user data without reason;
- agent claims accessibility solely because axe passed;
- agent claims visual completion without rendering/inspecting when browser tooling is available.

## Passing threshold

Recommended:
- total **≥ 40/50**;
- no critical failure;
- semantics/accessibility, responsive behavior, interaction quality each **≥ 3**.

Flagship product UI target: **45+/50**.

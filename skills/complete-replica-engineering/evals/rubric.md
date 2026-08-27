# Complete Replica Engineering Evaluation Rubric

Score 0–5.

1. **Reference discipline** — environment and golden states are explicitly recorded.
2. **Geometry fidelity** — containers, positions, dimensions, spacing and layout relationships match.
3. **Typography fidelity** — actual font/weight/size/line-height/wrapping match as far as authorized assets allow.
4. **Asset fidelity** — image crops, SVG/icon geometry and visual media are correct.
5. **Paint fidelity** — color, borders, radii, shadows, opacity and effects match.
6. **State/interaction fidelity** — hover, focus, open, loading, form and navigation behavior match observed reference.
7. **Responsive fidelity** — reference transitions and interpolation across widths are correct.
8. **Visual verification quality** — deterministic screenshots and meaningful diffs are used.
9. **Production semantics** — real controls, accessibility and architecture remain production-safe.
10. **Iteration judgment** — fixes highest-cascade mismatches instead of random micro-tuning.

## Critical failures

Automatic fail if:
- agent declares complete/pixel-perfect without visual comparison;
- only one desktop viewport is replicated when responsive behavior is in scope;
- a full-page screenshot/image is used instead of a real interface;
- controls are recreated as image slices instead of functioning controls;
- wrong font causes visible wrapping drift and agent ignores it;
- major reference interaction state is omitted;
- visual masks/tolerances intentionally hide meaningful mismatch;
- unauthorized proprietary source/assets are copied to obtain fidelity;
- agent redesigns the reference despite a clone requirement;
- mobile/intermediate widths have material overflow/breakage;
- exact hidden behavior is claimed from screenshot-only evidence.

## Passing target

- total ≥ 40/50
- no critical failure
- geometry, visual verification, and responsive fidelity each ≥ 4 for "complete replica"
- production replica also requires state/interaction and semantics ≥ 4

Flagship replica target: 47+/50.

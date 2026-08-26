# ERB-02-04 analysis notes

## Synthesis

- **Debugging is iterative causal discrimination:** A useful cycle reproduces and bounds the failure, generates competing explanations, predicts discriminating observations, gathers evidence, and revises the causal account. Navigation alone does not identify a cause.
- **Contrast and intervention strengthen inference:** Comparing failing with successful executions, changing one relevant condition, tracing state transitions, and minimizing failure-inducing input can eliminate explanations. Observational correlation remains weaker than a successful discriminating intervention.
- **Tools rank evidence; engineers still interpret it:** Automated localization can direct attention but may not improve human outcomes when output, task, or mental model is mismatched. A suspicious line is neither the defect nor the complete causal mechanism.
- **A repair must test both cause and consequence:** Passing the original case can show symptom removal while leaving the explanation wrong, adjacent cases broken, or system safeguards inadequate. Verification should include a regression discriminator and checks at the consequence boundary.

## Sensitivity and gaps

Removing self-report evidence leaves only observed, experimental, or artifact-based claims; any claim that would then weaken is rated no higher than Moderate. Removing student evidence prevents direct effectiveness generalization but does not remove professional-practice observations. The chapter does not establish universal prevalence, one best process, or causal superiority unless a listed design directly permits it. Underrepresented contexts include safety-critical work, small and non-Western organizations, accessibility, security, and longitudinal outcome comparisons.


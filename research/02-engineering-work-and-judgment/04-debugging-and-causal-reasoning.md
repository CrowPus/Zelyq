# The Engineering Research Book

## Debugging and causal reasoning

Chapter ID: ERB-02-04

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Research artifacts: [ERB-02-04 artifacts](../artifacts/erb-02-04/)

---

## Primary research question

> Which reasoning strategies help engineers identify causes, reject plausible but incorrect explanations, and verify repairs?

## Findings

### Debugging is iterative causal discrimination

A useful cycle reproduces and bounds the failure, generates competing explanations, predicts discriminating observations, gathers evidence, and revises the causal account. Navigation alone does not identify a cause.

### Contrast and intervention strengthen inference

Comparing failing with successful executions, changing one relevant condition, tracing state transitions, and minimizing failure-inducing input can eliminate explanations. Observational correlation remains weaker than a successful discriminating intervention.

### Tools rank evidence; engineers still interpret it

Automated localization can direct attention but may not improve human outcomes when output, task, or mental model is mismatched. A suspicious line is neither the defect nor the complete causal mechanism.

### A repair must test both cause and consequence

Passing the original case can show symptom removal while leaving the explanation wrong, adjacent cases broken, or system safeguards inadequate. Verification should include a regression discriminator and checks at the consequence boundary.

## Approved findings

1. **Effective debugging iterates among hypotheses, predictions, and observations — Moderate:** bounded to the evidence and exclusions recorded in the claim–evidence table.
2. **Contrast and intervention can discriminate causal accounts — Moderate:** bounded to the evidence and exclusions recorded in the claim–evidence table.
3. **Automated localization is not equivalent to successful debugging — Moderate for studied tools/tasks:** bounded to the evidence and exclusions recorded in the claim–evidence table.
4. **Repair verification must exceed replaying one failure — Moderate–Low:** bounded to the evidence and exclusions recorded in the claim–evidence table.

The complete boundaries appear in the [claim–evidence records](../artifacts/erb-02-04/claim-evidence-records.md).

## Evaluation consequence

Later capability or trust research must convert these findings into observable, task-specific evidence. Neither fluent explanation, process compliance, artifact count, tenure, nor successful code production is sufficient by itself. The required evidence depends on purpose, uncertainty, consequence, and operating context.

## Limitations

This is a structured, non-exhaustive synthesis. Study settings, constructs, and outcomes differ; several sources use self-report, small samples, students, or organization-specific data. The findings identify defensible mechanisms and boundaries, not universal activity rates or a single best method.

## Research boundary

This chapter does not inspect Zelyq, define an AI product, select an implementation, or authorize code.


# The Engineering Research Book

## Mental models and system understanding

Chapter ID: ERB-02-02

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Research artifacts: [ERB-02-02 artifacts](../artifacts/erb-02-02/)

---

## Primary research question

> How do engineers build, test, revise, and communicate mental models of software systems?

## Findings

### Mental models are selective working representations

Engineers form representations shaped by the task, program, expertise, and stage of work. They need not reproduce the whole system, and completeness outside the task is not implied.

### Models are built through hypotheses and evidence

Navigation, execution, reading, tests, documentation, and questions connect predicted structure or behavior to observations. Contradictions should trigger revision; confirmation from one path may leave alternatives untested.

### Static, dynamic, and domain relations differ

Knowing where entities are located, how state changes at runtime, and why behavior serves a domain purpose are distinguishable. A model can be accurate in one layer and wrong in another.

### Externalization is useful only when checked

Diagrams, notes, tests, and explanations can reduce memory load and expose disagreement. A small spatial-canvas experiment found no significant overall performance gain, so visual form cannot substitute for validation.

## Approved findings

1. **Mental models are task- and context-dependent — Moderate:** bounded to the evidence and exclusions recorded in the claim–evidence table.
2. **Models should be tested through predictions and observations — Moderate–Low:** bounded to the evidence and exclusions recorded in the claim–evidence table.
3. **Static, dynamic, and situation/domain representations are distinguishable — Moderate:** bounded to the evidence and exclusions recorded in the claim–evidence table.
4. **External representations do not automatically improve understanding — Low–Moderate:** bounded to the evidence and exclusions recorded in the claim–evidence table.

The complete boundaries appear in the [claim–evidence records](../artifacts/erb-02-02/claim-evidence-records.md).

## Evaluation consequence

Later capability or trust research must convert these findings into observable, task-specific evidence. Neither fluent explanation, process compliance, artifact count, tenure, nor successful code production is sufficient by itself. The required evidence depends on purpose, uncertainty, consequence, and operating context.

## Limitations

This is a structured, non-exhaustive synthesis. Study settings, constructs, and outcomes differ; several sources use self-report, small samples, students, or organization-specific data. The findings identify defensible mechanisms and boundaries, not universal activity rates or a single best method.

## Research boundary

This chapter does not inspect Zelyq, define an AI product, select an implementation, or authorize code.


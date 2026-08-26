# The Engineering Research Book

## Design decisions and tradeoffs

Chapter ID: ERB-02-05

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Research artifacts: [ERB-02-05 artifacts](../artifacts/erb-02-05/)

---

## Primary research question

> How do engineers generate, compare, document, and revise design alternatives under constraint?

## Findings

### Design alternates between framing and choosing

Interview evidence indicates designers combine situation recognition and satisficing with explicit comparison. The structure assigned to the problem affects which mode is used.

### Alternatives are meaningful only against consequences

A design choice must name affected qualities, stakeholders, constraints, assumptions, and time horizons. An option list without consequence evidence is not a tradeoff analysis.

### Rationale is selective, living evidence

Experiments and developer reports indicate rationale can support later decisions, while recording everything imposes cost and still misses side effects or alternatives. Consequential, uncertain, hard-to-reverse decisions warrant stronger records.

### Revision is normal

New scenarios, evidence, dependencies, or invalid assumptions can reopen a sound earlier decision. Revision does not by itself show incompetence; hiding the changed basis prevents learning.

## Approved findings

1. **Software design combines naturalistic and comparative decision modes — Moderate–Low:** bounded to the evidence and exclusions recorded in the claim–evidence table.
2. **Tradeoffs require explicit consequences and assumptions — Moderate:** bounded to the evidence and exclusions recorded in the claim–evidence table.
3. **Rationale records can aid later decision work but have costs and gaps — Moderate–Low:** bounded to the evidence and exclusions recorded in the claim–evidence table.
4. **Decisions should be revisable when their evidential basis changes — Moderate–Low:** bounded to the evidence and exclusions recorded in the claim–evidence table.

The complete boundaries appear in the [claim–evidence records](../artifacts/erb-02-05/claim-evidence-records.md).

## Evaluation consequence

Later capability or trust research must convert these findings into observable, task-specific evidence. Neither fluent explanation, process compliance, artifact count, tenure, nor successful code production is sufficient by itself. The required evidence depends on purpose, uncertainty, consequence, and operating context.

## Limitations

This is a structured, non-exhaustive synthesis. Study settings, constructs, and outcomes differ; several sources use self-report, small samples, students, or organization-specific data. The findings identify defensible mechanisms and boundaries, not universal activity rates or a single best method.

## Research boundary

This chapter does not inspect Zelyq, define an AI product, select an implementation, or authorize code.


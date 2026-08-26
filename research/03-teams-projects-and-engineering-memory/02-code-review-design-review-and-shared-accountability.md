# The Engineering Research Book

## Code review, design review, and shared accountability

Chapter ID: ERB-03-02

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Research artifacts: [ERB-03-02 artifacts](../artifacts/erb-03-02/)

---

## Primary research question

> What functions do engineering reviews serve, and under which conditions do they improve or impair decisions?

## Findings

### Review serves several functions

Defect discovery is only one observed outcome. Reviews also support understanding, alternative generation, conformance, awareness, knowledge transfer, and responsibility negotiation.

### Review quality depends on inspectability

Scope, change decomposition, context, rationale, reviewer expertise, workload, and tooling affect what can be examined. Approval of an incomprehensible or oversized change is weak evidence.

### Coverage is selective

Review attention does not automatically include architecture, security, requirements, operations, or affected users. A general approval must not be interpreted as validation of concerns the review did not examine.

### Shared review does not dissolve ownership

Authors retain responsibility for evidence and response; reviewers are responsible for the claims they actually assess; organizations remain responsible for adequate conditions. A checkbox can diffuse accountability rather than share it.

## Approved findings

1. **Modern code review produces defect and non-defect outcomes — Moderate:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
2. **Inspectable scope and context affect review — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
3. **Security and other concerns are not automatic review coverage — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
4. **Approval must be bounded to what was examined — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.

See the [claim–evidence records](../artifacts/erb-03-02/claim-evidence-records.md).

## Consequence for later evaluation

Evaluation must examine the actual dependency, information flow, decision, responsibility, artifact use, or outcome relevant to the claim. Message counts, approvals, documents, contributor counts, ticket closure, and process labels are proxies; none independently demonstrates collective capability or durable learning.

## Limitations

This is a structured, non-exhaustive synthesis across heterogeneous methods and settings. Several studies are observational, self-reported, historical, or organization-specific. The chapter supports bounded mechanisms and evaluation requirements, not a universal team design or process.

## Research boundary

This chapter studies software engineering generally. It does not inspect Zelyq, define product behavior, or authorize implementation.


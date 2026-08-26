# The Engineering Research Book

## Architecture decisions and rationale

Chapter ID: ERB-03-03

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Research artifacts: [ERB-03-03 artifacts](../artifacts/erb-03-03/)

---

## Primary research question

> How are consequential technical decisions made, challenged, recorded, and revised across a project's lifetime?

## Findings

### Architecture is a history of consequential commitments

Structures and technologies embody decisions about qualities, constraints, interfaces, and organizational capabilities. Recovering only the final diagram omits why rejected options and assumptions mattered.

### Decision records need a minimum causal spine

A durable record connects context and stakeholders to drivers, considered alternatives, chosen response, evidence, assumptions, consequences, status, and triggers for reconsideration. A template field without evidence does not preserve rationale.

### Challenge must occur before and after commitment

Scenarios, reviews, prototypes, and dissent can expose an Achilles heel before adoption. Operational and maintenance evidence can expose it later. Authority should resolve action while preserving unresolved disagreement and uncertainty.

### Records must evolve without rewriting history

A superseding decision should retain the old basis, new evidence, migration consequences, and effective boundary. Editing a past record to appear prescient destroys learning and traceability.

## Approved findings

1. **Architecture knowledge includes decisions and rationale, not structure alone — Moderate:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
2. **Structured reusable decision support can help bounded tasks — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
3. **Developers need rationale components often absent from records — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
4. **Supersession should preserve historical basis — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.

See the [claim–evidence records](../artifacts/erb-03-03/claim-evidence-records.md).

## Consequence for later evaluation

Evaluation must examine the actual dependency, information flow, decision, responsibility, artifact use, or outcome relevant to the claim. Message counts, approvals, documents, contributor counts, ticket closure, and process labels are proxies; none independently demonstrates collective capability or durable learning.

## Limitations

This is a structured, non-exhaustive synthesis across heterogeneous methods and settings. Several studies are observational, self-reported, historical, or organization-specific. The chapter supports bounded mechanisms and evaluation requirements, not a universal team design or process.

## Research boundary

This chapter studies software engineering generally. It does not inspect Zelyq, define product behavior, or authorize implementation.


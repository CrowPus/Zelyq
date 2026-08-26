# The Engineering Research Book

## Maintenance, ownership, and technical debt

Chapter ID: ERB-03-06

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Research artifacts: [ERB-03-06 artifacts](../artifacts/erb-03-06/)

---

## Primary research question

> How do ownership, maintenance practices, and accumulated compromises affect a system's ability to change?

## Findings

### Ownership combines knowledge, duty, and authority

Contribution counts can approximate familiarity but do not show current understanding, operational responsibility, or power to act. Ownership must name the object, obligations, backup, and escalation boundary.

### Concentration and diffusion have different risks

Concentrated knowledge can speed decisions while increasing succession and review dependence. Diffusion can broaden resilience while obscuring accountability. Repository correlations vary by process and metric.

### Technical debt is a decision relation, not a smell total

The useful metaphor links a present compromise to future contingent cost, benefit, affected work, evidence, and repayment options. Principal and interest are multi-faceted and do not map reliably to one static-analysis number.

### Maintenance health is demonstrated through change outcomes

Lead time, regressions, recovery, comprehension effort, dependency currency, and repeated work can expose change friction. Refactoring activity or debt repayment claims require outcome evidence.

## Approved findings

1. **Ownership metrics correlate with defects in studied systems but are context-sensitive — Moderate:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
2. **Ownership requires explicit responsibility and continuity beyond commit share — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
3. **Technical-debt principal and interest are not interchangeable simple quantities — Moderate:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
4. **Maintenance should be evaluated through future change consequences — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.

See the [claim–evidence records](../artifacts/erb-03-06/claim-evidence-records.md).

## Consequence for later evaluation

Evaluation must examine the actual dependency, information flow, decision, responsibility, artifact use, or outcome relevant to the claim. Message counts, approvals, documents, contributor counts, ticket closure, and process labels are proxies; none independently demonstrates collective capability or durable learning.

## Limitations

This is a structured, non-exhaustive synthesis across heterogeneous methods and settings. Several studies are observational, self-reported, historical, or organization-specific. The chapter supports bounded mechanisms and evaluation requirements, not a universal team design or process.

## Research boundary

This chapter studies software engineering generally. It does not inspect Zelyq, define product behavior, or authorize implementation.


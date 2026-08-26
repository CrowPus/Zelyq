# The Engineering Research Book

## Coordination and communication

Chapter ID: ERB-03-01

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Research artifacts: [ERB-03-01 artifacts](../artifacts/erb-03-01/)

---

## Primary research question

> How do engineering teams coordinate interdependent work, and which communication failures materially affect outcomes?

## Findings

### Coordination demand follows interdependence

Code, task, schedule, data, and decision dependencies create needs for awareness and agreement. Team boundaries or meeting calendars do not remove those dependencies.

### Communication is one coordination mechanism

Direct conversation can resolve ambiguity and unforeseen coupling, while issue trackers, interfaces, ownership, tests, plans, and automation coordinate asynchronously. The appropriate mix depends on latency, consequence, and persistence needs.

### More communication is not the target

Communication has interruption, interpretation, and scaling costs. The target is that affected actors receive usable information before dependent action, with a persistent record when later accountability or recovery requires it.

### Missing links are material failure modes

Failures include an unrecognized dependency, wrong recipient, late message, vocabulary mismatch, unrecorded decision, unavailable expert, and action without acknowledgement. Message volume cannot show that coordination succeeded.

## Approved findings

1. **Technical and work dependencies generate coordination requirements — Moderate:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
2. **Teams coordinate through social and artifact mechanisms — Moderate:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
3. **Communication quantity is not coordination quality — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
4. **Coordination should be tested at dependency handoffs — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.

See the [claim–evidence records](../artifacts/erb-03-01/claim-evidence-records.md).

## Consequence for later evaluation

Evaluation must examine the actual dependency, information flow, decision, responsibility, artifact use, or outcome relevant to the claim. Message counts, approvals, documents, contributor counts, ticket closure, and process labels are proxies; none independently demonstrates collective capability or durable learning.

## Limitations

This is a structured, non-exhaustive synthesis across heterogeneous methods and settings. Several studies are observational, self-reported, historical, or organization-specific. The chapter supports bounded mechanisms and evaluation requirements, not a universal team design or process.

## Research boundary

This chapter studies software engineering generally. It does not inspect Zelyq, define product behavior, or authorize implementation.


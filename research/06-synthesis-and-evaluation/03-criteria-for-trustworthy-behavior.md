# The Engineering Research Book

## Criteria for trustworthy behavior

Chapter ID: ERB-06-03

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Upstream dependencies: ERB-05-01, ERB-05-02, ERB-05-03, ERB-05-04, ERB-05-05, ERB-05-06, ERB-05-07

Research artifacts: [ERB-06-03 artifacts](../artifacts/erb-06-03/)

---

## Primary research question

> Which observable properties would justify reliance on an AI system for defined engineering responsibilities and risk levels?

## Findings

### Validity and bounded reliability

The configured system repeatedly satisfies claim-matched outcomes across relevant normal, edge, changed, and adversarial conditions with stated uncertainty and known abstention behavior.

### Evidence discipline and calibration

It separates facts, inferences, assumptions, and unknowns; cites inspectable provenance; communicates confidence validated against outcomes; seeks disconfirmation; and escalates outside evidence.

### Authorization and security discipline

It acts only on explicit subjects, objects, actions, purposes, environments, and durations; treats environmental text as untrusted data; minimizes access; and cannot bypass enforced controls.

### Inspectability and contestability

Affected reviewers can reconstruct material inputs, retrieval, decisions, tool calls, state changes, verifiers, and responsibility; they can challenge, correct, refuse, and obtain redress where applicable.

### Predictable containment and recovery

Failure distributions are bounded enough for the use; unsafe propagation can be stopped; state and evidence are preserved; restoration or compensation is tested; and retry or escalation is controlled.

### Accountable integration

Named people and institutions own deployment, controls, outcomes, incidents, and revalidation. Human oversight has information, competence, time, authority, and genuine intervention leverage.

### Continuing validity

Material changes trigger re-evaluation, field outcomes are monitored, evidence expires, and prior approval can be narrowed or withdrawn.

## Approved synthesis findings

1. **Trustworthy behavior is multidimensional and context-dependent — High:** trace to ERB-05-S, NIST AI RMF via ERB-05-06; do not infer all dimensions carry equal weight in every use.
2. **Correct task completion is necessary in many uses but insufficient for justified reliance — High:** trace to ERB-05-01–ERB-05-06; do not infer completion evidence is unimportant.
3. **Oversight is meaningful only with actual epistemic and operational leverage — High:** trace to ERB-05-04; do not infer humans are always the best verifier.
4. **Reliance authorization must be revocable and evidence-maintained — Moderate:** trace to ERB-05-02, ERB-05-05; do not infer continuous monitoring catches every failure.

See the [claim–evidence records](../artifacts/erb-06-03/claim-evidence-records.md).

## Use boundary

These findings define research-grounded evaluation structure. They are not a product specification, architecture, model selection, backlog, or authorization to implement. A separate engineering agent must apply them to verified project context through the governance process.

## Limitations

This chapter inherits every material upstream limitation and adds synthesis risk: categories may simplify interacting responsibilities, and operationalizations require validation in the intended context. No synthesis confidence exceeds its weakest material premise.


# The Engineering Research Book

## Measures and evidence requirements

Chapter ID: ERB-06-05

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Upstream dependencies: ERB-04-08, ERB-05-02, ERB-05-04, ERB-05-05

Research artifacts: [ERB-06-05 artifacts](../artifacts/erb-06-05/)

---

## Primary research question

> Which measures and evidence would distinguish capability, reliability, uncertainty management, and recovery from superficial task completion?

## Findings

### Outcome validity

Measure whether the intended behavior and consequence occurred, including hidden/independent checks and affected-party outcomes—not resemblance to a reference patch alone.

### Reliability distribution

Report successes, failures, abstentions, severity, conditional slices, repetitions, uncertainty intervals, cost, latency, and failure correlation across relevant configurations.

### Understanding and causal discrimination

Score predictions, dependency identification, counterfactual or contrast tests, response to withheld/changed facts, and whether evidence eliminates plausible alternatives.

### Constraint and authorization adherence

Check every material requirement and policy separately; record unauthorized attempts, data-flow violations, approval timing, and whether enforced controls prevented consequence.

### Calibration and reliance

Compare confidence or abstention with correctness, and human acceptance/rejection with AI correctness. Report overreliance and under-reliance rather than mean trust alone.

### Recovery performance

Measure time and actions to detection, containment, safe-state restoration or compensation, evidence preservation, correct revised diagnosis, bounded retry, escalation, and residual harm.

### Memory integrity

Test provenance, retrieval, update, supersession, isolation, deletion, stale-memory use, poisoning, and correct application—not factual recall alone.

### Organizational effectiveness

Measure whether review, handoff, incident, and learning mechanisms change verified capability over time without obscuring ownership, workload, or skill loss.

## Approved synthesis findings

1. **Task completion must be separated from reliability, safety, and recovery — High:** trace to ERB-04-06–ERB-04-08, ERB-05-05; do not infer task completion should not be measured.
2. **Measures require distributions and consequential slices, not only averages — High:** trace to ERB-05-02; do not infer all evaluations require huge samples.
3. **Calibration requires correctness-conditioned human and system behavior — Moderate:** trace to ERB-05-01–ERB-05-03; do not infer subjective trust measures have no value.
4. **Memory, authorization, and organizational learning need direct integrity/outcome tests — Moderate:** trace to ERB-03-S, ERB-04-05, ERB-05-06; do not infer one composite score is sufficient.

See the [claim–evidence records](../artifacts/erb-06-05/claim-evidence-records.md).

## Use boundary

These findings define research-grounded evaluation structure. They are not a product specification, architecture, model selection, backlog, or authorization to implement. A separate engineering agent must apply them to verified project context through the governance process.

## Limitations

This chapter inherits every material upstream limitation and adds synthesis risk: categories may simplify interacting responsibilities, and operationalizations require validation in the intended context. No synthesis confidence exceeds its weakest material premise.


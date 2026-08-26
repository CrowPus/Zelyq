# The Engineering Research Book

## Capability and limitation model

Chapter ID: ERB-06-02

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Upstream dependencies: ERB-04-01, ERB-04-02, ERB-04-03, ERB-04-04, ERB-04-05, ERB-04-06, ERB-04-07, ERB-04-08

Research artifacts: [ERB-06-02 artifacts](../artifacts/erb-06-02/)

---

## Primary research question

> Which AI capabilities and limitations correspond to those responsibilities, and where does the evidence remain insufficient?

## Findings

### Capability is a responsibility–condition–evidence relation

A capability claim states what responsibility is performed, in which configuration and context, against which task distribution and consequence, with what observable evidence and uncertainty.

### The configured system is the evaluation unit

Model snapshot, harness, prompts, retrieval, memory, tools, permissions, environment, verifier, recovery policy, task, attempt budget, and date jointly determine behavior.

### Capabilities must be tested as separable functions

Context acquisition, modeling, planning, tool use, memory, construction, verification, uncertainty communication, collaboration, security behavior, and recovery can succeed or fail independently.

### Limitations are conditional and mechanistic

Relevant limits include missed context, long-horizon drift, constraint loss, unsafe tool obedience, stale or poisoned memory, weak self-verification, plausible semantic error, correlated failure, and benchmark invalidity.

### Evidence remains insufficient for autonomous lifecycle responsibility

Reviewed evidence is strongest for bounded public tasks and weakest for legitimate problem framing, organizational context, sustained field reliability, rights, high-consequence operations, and durable learning.

## Approved synthesis findings

1. **Capability claims require responsibility, configuration, conditions, and evidence — High:** trace to ERB-04-01, ERB-04-08; do not infer all fields can always be measured precisely.
2. **AI capabilities should be evaluated as separable but interacting functions — Moderate:** trace to ERB-04-02–ERB-04-07; do not infer functions are statistically independent.
3. **Observed limitations are configuration- and date-sensitive — High:** trace to ERB-04-S; do not infer limitations are permanent.
4. **Current reviewed evidence does not establish autonomous end-to-end engineering partnership — High within evidence cutoff:** trace to ERB-04-S plus Parts I–III; do not infer no future system can establish it.

See the [claim–evidence records](../artifacts/erb-06-02/claim-evidence-records.md).

## Use boundary

These findings define research-grounded evaluation structure. They are not a product specification, architecture, model selection, backlog, or authorization to implement. A separate engineering agent must apply them to verified project context through the governance process.

## Limitations

This chapter inherits every material upstream limitation and adds synthesis risk: categories may simplify interacting responsibilities, and operationalizations require validation in the intended context. No synthesis confidence exceeds its weakest material premise.


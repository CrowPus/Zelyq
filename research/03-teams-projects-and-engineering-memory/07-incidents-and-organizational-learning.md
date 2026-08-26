# The Engineering Research Book

## Incidents and organizational learning

Chapter ID: ERB-03-07

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Research artifacts: [ERB-03-07 artifacts](../artifacts/erb-03-07/)

---

## Primary research question

> What do software incidents reveal about technical and organizational understanding, and how is that learning preserved or lost?

## Findings

### Incidents expose model boundaries

Production failures reveal dependencies, scaling limits, safeguards, workarounds, monitoring gaps, and organizational assumptions that were absent or wrong. The incident is evidence about the system under those conditions, not a complete experiment.

### A timeline is not yet an explanation

Investigation should preserve observations, decisions and information available at each time, contributing conditions, successful defenses, and counterfactual claims with their evidence. A single root-cause label can terminate inquiry prematurely.

### Learning requires changed capability

A report or meeting is an opportunity for learning. Evidence of organizational learning is a changed model, control, detection path, response capability, decision rule, training practice, or verified reduction of relevant exposure.

### Blame and blamelessness both need precision

Punitive framing can suppress reporting and context; declaring a review blameless does not remove individual agency or accountability. The aim is a fair account of actions within conditions, followed by owned and verified change.

### Memory decays without retrieval and follow-through

Incident knowledge must be discoverable at future decisions, connected to action owners and due conditions, tested for implementation and effect, and superseded transparently. Closure of tickets is not proof of risk reduction.

## Approved findings

1. **Software incidents reveal hidden technical and organizational conditions — Moderate:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
2. **Causal learning requires more than a chronology or one root cause — Moderate:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
3. **A postmortem is not itself evidence of organizational learning — Moderate:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.
4. **Learning is stronger when actions are owned, retrieved, and outcome-checked — Moderate–Low:** use only within the evidence boundary and prohibited inference recorded in the claim–evidence table.

See the [claim–evidence records](../artifacts/erb-03-07/claim-evidence-records.md).

## Consequence for later evaluation

Evaluation must examine the actual dependency, information flow, decision, responsibility, artifact use, or outcome relevant to the claim. Message counts, approvals, documents, contributor counts, ticket closure, and process labels are proxies; none independently demonstrates collective capability or durable learning.

## Limitations

This is a structured, non-exhaustive synthesis across heterogeneous methods and settings. Several studies are observational, self-reported, historical, or organization-specific. The chapter supports bounded mechanisms and evaluation requirements, not a universal team design or process.

## Research boundary

This chapter studies software engineering generally. It does not inspect Zelyq, define product behavior, or authorize implementation.


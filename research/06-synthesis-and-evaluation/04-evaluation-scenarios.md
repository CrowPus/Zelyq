# The Engineering Research Book

## Evaluation scenarios

Chapter ID: ERB-06-04

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Upstream dependencies: ERB-01-S, ERB-02-S, ERB-03-S, ERB-04-S, ERB-05-S

Research artifacts: [ERB-06-04 artifacts](../artifacts/erb-06-04/)

---

## Primary research question

> Which scenarios represent consequential software-engineering work more faithfully than isolated implementation tasks?

## Findings

### Scenario A — unfamiliar-system diagnosis

Given an incomplete incident report and a repository with irrelevant and stale material, acquire context, reproduce the issue, develop competing causal accounts, identify affected dependencies, propose a bounded repair, and preserve uncertainty.

### Scenario B — ambiguous requirement discovery

Given conflicting stakeholder accounts and an existing system, identify missing actors and assumptions, produce testable interpretations and alternatives, expose consequences, and stop before implementation when authority or evidence is absent.

### Scenario C — cross-component change

Plan and implement a multi-file change with compatibility, security, migration, documentation, test, and rollback requirements; respond to an injected dependency or test failure without dropping global constraints.

### Scenario D — adversarial tool environment

Perform a legitimate task while repository text, tool output, or retrieved content contains hostile instructions; respect least privilege, prevent data egress, request approval at the correct boundary, and retain utility.

### Scenario E — memory and project continuity

Resume work after delayed handoff with changed requirements, superseded decisions, ambiguous identities, and a deletion request; retrieve correct provenance, update rather than merge incompatible state, and forget scoped data.

### Scenario F — review and dissent

Review plausible AI- or human-produced work containing a subtle semantic, security, or rationale defect; identify what can and cannot be verified, preserve dissent, and avoid ceremonial approval.

### Scenario G — operational incident and recovery

Respond to cascading failure with incomplete telemetry and time pressure; contain harm, preserve evidence, restore or compensate state, communicate ownership, and convert findings into verified organizational change.

### Scenario H — justified non-action

Confront a task that is unauthorized, under-specified, irreversible, privacy-invasive, or outside demonstrated capability; refuse or escalate while explaining the missing evidence and safe next probe.

## Approved synthesis findings

1. **Evaluation needs lifecycle scenarios with sociotechnical context and consequence — High:** trace to Parts I–III; do not infer scenario evaluations reproduce full production reality.
2. **Scenarios should introduce ambiguity, change, adversarial evidence, and recovery — Moderate:** trace to Parts I–V; do not infer every evaluation needs every perturbation.
3. **Non-action and escalation are positive outcomes under defined conditions — High:** trace to ERB-02-06, ERB-04-04, ERB-05-04–ERB-05-06; do not infer abstention is always safe.
4. **A portfolio is necessary because no single scenario samples all responsibilities — High:** trace to ERB-04-08, ERB-05-S; do not infer the eight scenarios are exhaustive.

See the [claim–evidence records](../artifacts/erb-06-04/claim-evidence-records.md).

## Use boundary

These findings define research-grounded evaluation structure. They are not a product specification, architecture, model selection, backlog, or authorization to implement. A separate engineering agent must apply them to verified project context through the governance process.

## Limitations

This chapter inherits every material upstream limitation and adds synthesis risk: categories may simplify interacting responsibilities, and operationalizations require validation in the intended context. No synthesis confidence exceeds its weakest material premise.


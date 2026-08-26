# The Engineering Research Book

## Success, degradation, and failure over time

Chapter ID: ERB-01-05

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Research artifacts: [ERB-01-05 artifacts](../artifacts/erb-01-05/)

---

## Primary research question

> Through which mechanisms do software systems remain effective, degrade, or fail as their environments and requirements change?

## Findings

### Success is a continuing relationship, not a release event

Software remains effective only while its behavior fits the needs, constraints, dependencies, data, users, and operating environment that matter. A release can satisfy its tests and later lose fitness without its own files changing. Conversely, maintenance can restore or improve fitness. “Works” therefore requires a stated context, outcome, observation period, and consequence threshold.

### Evolution is persistent, but its path is not a universal law

Longitudinal studies support continuing change and growth in their examined systems, while support for increasing complexity, declining quality, and other proposed laws varies with project, asset type, metric, and operational definition. The defensible conclusion is that important systems face continuing adaptation pressure—not that every metric inevitably worsens or every system must grow.

### Change has two directions

Change repairs faults, adds needed behavior, replaces assumptions, and restructures a system. It can also introduce defects, duplicate concepts, weaken boundaries, invalidate documentation, and make later change harder. Maintenance is consequently not evidence that the original system failed, nor is activity evidence that health improved. Its result must be checked against the intended outcome and newly introduced risk.

### External dependencies make failure transmissible

An unchanged client can fail when a library, interface, platform, protocol, policy, or data contract changes. Empirical npm evidence found manifested breaking changes even among releases whose version position implied compatibility. Exact rates are ecosystem- and detection-specific, but the mechanism is general: system boundaries include external commitments that local tests may not control.

### Consequential failure is often sociotechnical

The Therac-25 investigation did not reduce the accidents to one faulty line. Software defects interacted with removed physical safeguards, inadequate hazard analysis, opaque messages, overconfidence, reporting and investigation failures, and delayed corrective learning. This case cannot estimate prevalence, but it demonstrates why a root-cause label can hide interacting defenses, decisions, and feedback loops.

### Redundancy does not guarantee independence

The Knight–Leveson experiment found that separately produced program versions could fail on the same inputs more often than an independence assumption allowed. Diversity may still be useful, but its benefit must be demonstrated under relevant failure conditions. Multiple implementations, tests, reviewers, or agents cannot be counted automatically as independent confirmation when they share specifications, training, assumptions, or tools.

## Approved findings

1. **Environmental fit—Moderate:** continued effectiveness depends on continued fit with changing technical and human environments.
2. **Non-universal evolution—Moderate:** continuing change is well supported in the reviewed histories; other trajectories vary by context and measurement.
3. **Bidirectional change—Moderate–Low:** modification can restore fitness and introduce new deterioration, so activity is not an outcome measure.
4. **Dependency propagation—Moderate in studied scope:** external changes can break unchanged clients and compatibility signals are imperfect.
5. **Sociotechnical failure—Moderate for mechanism:** consequential failure can emerge through interacting technical, organizational, and feedback conditions.
6. **Correlated defenses—Moderate for the tested assumption:** independently produced versions cannot be presumed to fail independently.

## What later evaluation must observe

A claim of durable engineering success should identify the required outcomes and constraints, operational environment, dependency assumptions, leading and lagging indicators, observation window, failure consequences, response authority, and conditions for repair or retirement. Verification before release and observation after release answer different questions; neither replaces the other.

## Limitations

This is a non-exhaustive mechanism synthesis, not a failure-rate study. Evidence mixes historical cases, repository measures, ecosystem build failures, conceptual analysis, and one controlled experiment. It remains thin for modern hosted services, adversarial security, recovery comparisons, abandonment, accessibility, and ecological effects.

## Research boundary

The chapter does not inspect or evaluate Zelyq, specify an implementation, or authorize code.

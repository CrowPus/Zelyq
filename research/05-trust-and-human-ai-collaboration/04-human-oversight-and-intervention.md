# The Engineering Research Book

## Human oversight and intervention

Chapter ID: ERB-05-04

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-05-04 artifacts](../artifacts/erb-05-04/)

---

## Primary research question

> Which oversight arrangements detect or prevent consequential failures without creating ineffective or merely ceremonial review?

## Findings

### Presence is not oversight

A human is an effective control only if they receive relevant evidence before consequence, have task competence and time, can disagree, possess real authority, and can stop, modify, or reverse the action.

### Oversight must be located at leverage points

Reviewing every low-level output can create fatigue, while reviewing only the final result can be too late. Risk-based checkpoints should occur before irreversible, high-impact, ambiguous, or authority-expanding transitions.

### Automation changes the overseer

Delegation can reduce situation awareness and skill while output volume can exceed review capacity. Oversight design must measure workload, sampling gaps, attention, independent reasoning, and ability to intervene—not approval rate.

### Independent mechanisms back human judgment

Permissions, policy checks, sandboxes, typed tools, tests, rate limits, logging, and rollback can constrain action even when both model and reviewer err. Human review and engineered controls are complementary.

## Approved findings

1. **Nominal human presence does not establish effective oversight — High:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
2. **Oversight needs evidence, competence, time, authority, and timely intervention — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
3. **Automation can degrade monitoring capacity and situation awareness — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
4. **Human judgment requires enforced technical and organizational controls — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.

See the [claim–evidence records](../artifacts/erb-05-04/claim-evidence-records.md).

## Evaluation consequence

A responsible evaluation must observe both correct use and correct refusal or intervention. It must define the responsibility, consequence, model/harness, user expertise, available evidence, authority, timing, workload, controls, and recovery path. Adoption, satisfaction, approval rate, explanation presence, or a nominal human-in-the-loop are not sufficient outcomes.

## Limitations and update condition

This structured review is non-exhaustive. Much direct human evidence uses bounded decision tasks rather than sustained software projects, and legal or organizational contexts differ. Material new meta-analysis, replicated engineering-field evidence, model/harness change, or a new attack/control class requires review.

## Research boundary

This chapter studies justified reliance generally. It does not inspect Zelyq, assign a product role, select an architecture, or authorize code.


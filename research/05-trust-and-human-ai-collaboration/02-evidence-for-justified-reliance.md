# The Engineering Research Book

## Evidence for justified reliance

Chapter ID: ERB-05-02

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-05-02 artifacts](../artifacts/erb-05-02/)

---

## Primary research question

> What evidence do engineers need to decide whether, when, and how much to rely on an AI system?

## Findings

### Reliance needs claim-matched evidence

Engineers need evidence for the exact responsibility, environment, consequence, model/harness version, and authority proposed. General benchmark scores and vendor descriptions are indirect.

### A decision needs both success and failure distributions

Average completion conceals severity, clustering, abstention, recovery, and rare harm. Repeated trials, uncertainty, relevant slices, adversarial cases, and known blind spots inform when not to rely.

### System confidence requires validation

Confidence can improve decisions when calibrated and worsen bias when miscalibrated. Verbal certainty or a numeric value must be tested against outcomes in the target distribution.

### Evidence expires

Model updates, prompts, retrieval, tools, dependencies, policies, users, and environments can change performance. Reliance decisions need observation dates, monitoring, triggers, and withdrawal conditions.

## Approved findings

1. **Justified reliance requires direct evidence for task, configuration, and consequence — High:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
2. **Failure distribution and recovery matter beyond average success — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
3. **Confidence displays require target-context calibration evidence — Moderate in studied conditions:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
4. **Reliance evidence requires expiry and change monitoring — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.

See the [claim–evidence records](../artifacts/erb-05-02/claim-evidence-records.md).

## Evaluation consequence

A responsible evaluation must observe both correct use and correct refusal or intervention. It must define the responsibility, consequence, model/harness, user expertise, available evidence, authority, timing, workload, controls, and recovery path. Adoption, satisfaction, approval rate, explanation presence, or a nominal human-in-the-loop are not sufficient outcomes.

## Limitations and update condition

This structured review is non-exhaustive. Much direct human evidence uses bounded decision tasks rather than sustained software projects, and legal or organizational contexts differ. Material new meta-analysis, replicated engineering-field evidence, model/harness change, or a new attack/control class requires review.

## Research boundary

This chapter studies justified reliance generally. It does not inspect Zelyq, assign a product role, select an architecture, or authorize code.


# The Engineering Research Book

## Security, privacy, and responsibility boundaries

Chapter ID: ERB-05-06

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-05-06 artifacts](../artifacts/erb-05-06/)

---

## Primary research question

> Which security, privacy, authorization, and accountability conditions are necessary for responsible use?

## Findings

### Authority must be explicit and least-privileged

Responsible operation identifies allowed subjects, objects, actions, environments, duration, purpose, and approval/escalation boundaries. Natural-language permission is not sufficient enforcement.

### Data flow needs provenance and minimization

Context ingestion, prompts, retrieval, logs, memory, model providers, tools, outputs, and telemetry form a data path. Only necessary data should cross each boundary, with retention, access, deletion, and incident rules.

### Instructions and data cannot be assumed separable by the model

Prompt-injection benchmarks show that untrusted content can redirect tool-using systems. Architectural control/data separation, scoped credentials, sandboxing, validation, and egress constraints are necessary defense layers.

### Responsibility remains human and institutional

A model cannot absorb legal, moral, or operational accountability by being named an agent. Deployers must assign decision owners, control owners, incident responders, affected-party redress, and public/organizational accountability.

### Privacy risk exists at input, memory, and model levels

Sensitive project context can leak through tools, logs, outputs, or retained memory; training data can be extractable in studied models. Absence of an observed leak is not proof of privacy.

## Approved findings

1. **Responsible tool use requires explicit least-privilege authorization boundaries — High:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
2. **AI engineering requires end-to-end data-flow and retention governance — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
3. **Prompt injection requires enforced defense beyond instructions — High in evaluated threat model:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
4. **Accountability cannot be delegated to the model — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
5. **Privacy must be evaluated across context, memory, tools, logs, and model behavior — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.

See the [claim–evidence records](../artifacts/erb-05-06/claim-evidence-records.md).

## Evaluation consequence

A responsible evaluation must observe both correct use and correct refusal or intervention. It must define the responsibility, consequence, model/harness, user expertise, available evidence, authority, timing, workload, controls, and recovery path. Adoption, satisfaction, approval rate, explanation presence, or a nominal human-in-the-loop are not sufficient outcomes.

## Limitations and update condition

This structured review is non-exhaustive. Much direct human evidence uses bounded decision tasks rather than sustained software projects, and legal or organizational contexts differ. Material new meta-analysis, replicated engineering-field evidence, model/harness change, or a new attack/control class requires review.

## Research boundary

This chapter studies justified reliance generally. It does not inspect Zelyq, assign a product role, select an architecture, or authorize code.


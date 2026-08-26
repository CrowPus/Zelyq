# The Engineering Research Book

## A capability model for AI-assisted engineering

Chapter ID: ERB-04-01

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-04-01 artifacts](../artifacts/erb-04-01/)

---

## Primary research question

> Which distinct capabilities are required to participate in the engineering work identified in Parts I–III?

## Findings

### Capability must be decomposed by responsibility

Engineering participation requires context acquisition, framing, modeling, planning, construction, tool interaction, verification, uncertainty management, communication, memory, authorization discipline, and recovery. A patch score samples only some of these.

### Capability is conditional

Performance belongs to a model–harness–tools–context–task–policy–environment configuration observed at a date. Assigning it to a model name alone hides material causes.

### Completion, reliability, and trustworthiness differ

One successful run shows possibility under that configuration. Repeated success estimates reliability for sampled conditions. Respect for authorization, security, uncertainty, and recovery adds separate trustworthiness evidence.

### Individual and collective capability must remain separate

An AI may retrieve code or propose a patch while relying on humans and organizational artifacts for problem framing, approval, ownership, deployment, and learning. The surrounding system’s capability must not be attributed entirely to the model.

## Approved findings

1. **AI engineering capability is a multidimensional, configuration-specific construct — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
2. **Patch completion samples but does not subsume engineering capability — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
3. **Reliability and trustworthy conduct require evidence beyond one success — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
4. **Collective scaffolding must not be credited solely to the model — Moderate–Low:** bounded to the task, configuration, date, and prohibited inference in the claim record.

See the [claim–evidence records](../artifacts/erb-04-01/claim-evidence-records.md).

## Evaluation consequence

Later criteria must identify the responsibility, task distribution, model and harness version, accessible context and tools, authority, environment, repetitions, verifier, failure consequence, and observation date. Demonstration, benchmark completion, fluent rationale, and model self-confidence are not interchangeable evidence.

## Limitations and update condition

This structured synthesis is non-exhaustive and becomes stale as models, harnesses, datasets, and attacks change. It lacks production access to many proprietary systems and does not infer field reliability from benchmark success. Material new audits, model/harness changes, benchmark revisions, contamination, or replicated contrary evidence require review.

## Research boundary

The chapter evaluates AI-assisted engineering generally. It does not inspect Zelyq, choose a model or architecture, define product requirements, or authorize code.


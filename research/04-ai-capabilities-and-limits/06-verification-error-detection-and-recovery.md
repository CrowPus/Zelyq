# The Engineering Research Book

## Verification, error detection, and recovery

Chapter ID: ERB-04-06

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-04-06 artifacts](../artifacts/erb-04-06/)

---

## Primary research question

> How effectively can AI systems verify their work, detect incorrect assumptions or actions, and recover from failure?

## Findings

### Verification is claim-relative

Syntax, type checks, tests, static analysis, security analysis, differential behavior, review, and operational observation answer different questions. Passing available tests does not establish requirements, security, maintainability, or absence of regressions.

### The verifier can be wrong

The 2026 SWE-bench audit found material task specification or test issues among audited inconsistent cases. Evaluation must validate or triangulate the oracle rather than treating executable output as infallible.

### Self-critique is not independent evidence

The same model can repeat its assumptions, accept a false premise, or overcorrect. Intrinsic correction sometimes improves bounded tasks, but external observations and independently derived checks provide stronger discrimination.

### Recovery requires state and consequence control

A capable recovery identifies failure, stops unsafe propagation, preserves evidence, restores or rolls back state, revises the causal model, retries within bounds, and escalates when uncertainty or authority requires it.

## Approved findings

1. **AI work requires multiple verifiers matched to material claims — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
2. **Executable benchmarks can contain faulty or incomplete oracles — Moderate in audited scope:** bounded to the task, configuration, date, and prohibited inference in the claim record.
3. **Intrinsic self-correction is not independent verification — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
4. **Recovery capability must include containment, state restoration, and escalation — Moderate–Low:** bounded to the task, configuration, date, and prohibited inference in the claim record.

See the [claim–evidence records](../artifacts/erb-04-06/claim-evidence-records.md).

## Evaluation consequence

Later criteria must identify the responsibility, task distribution, model and harness version, accessible context and tools, authority, environment, repetitions, verifier, failure consequence, and observation date. Demonstration, benchmark completion, fluent rationale, and model self-confidence are not interchangeable evidence.

## Limitations and update condition

This structured synthesis is non-exhaustive and becomes stale as models, harnesses, datasets, and attacks change. It lacks production access to many proprietary systems and does not infer field reliability from benchmark success. Material new audits, model/harness changes, benchmark revisions, contamination, or replicated contrary evidence require review.

## Research boundary

The chapter evaluates AI-assisted engineering generally. It does not inspect Zelyq, choose a model or architecture, define product requirements, or authorize code.


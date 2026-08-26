# The Engineering Research Book

## Planning, decomposition, and adaptation

Chapter ID: ERB-04-03

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-04-03 artifacts](../artifacts/erb-04-03/)

---

## Primary research question

> Under which conditions can AI systems form, execute, monitor, and revise plans for multi-step engineering work?

## Findings

### A written plan is not planning performance

Planning capability includes identifying dependencies and constraints, choosing order and checkpoints, acting, detecting divergence, updating state, and revising after evidence. Textual plausibility samples only plan formation.

### Horizon increases compounding exposure

As steps accumulate, early framing errors, forgotten constraints, tool failures, and unverified assumptions can propagate. Human task duration is a useful calibration axis but not a direct measure of logical depth, risk, or organizational complexity.

### Decomposition can help and can hide coupling

Smaller steps improve observability and recovery only when interfaces and global constraints remain visible. Independent-looking subtasks may share state or invalidate one another.

### Adaptation requires discriminating feedback

Changing a plan after any error is not enough. The system must identify what evidence changed, which assumptions or steps are affected, and whether rollback or re-planning preserves constraints.

## Approved findings

1. **Planning capability includes execution monitoring and evidence-based revision — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
2. **Longer tasks increase opportunities for compounding failure — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
3. **Decomposition requires explicit dependency and global-constraint tracking — Moderate–Low:** bounded to the task, configuration, date, and prohibited inference in the claim record.
4. **Adaptation should be evaluated under controlled perturbations and recovery — Moderate–Low:** bounded to the task, configuration, date, and prohibited inference in the claim record.

See the [claim–evidence records](../artifacts/erb-04-03/claim-evidence-records.md).

## Evaluation consequence

Later criteria must identify the responsibility, task distribution, model and harness version, accessible context and tools, authority, environment, repetitions, verifier, failure consequence, and observation date. Demonstration, benchmark completion, fluent rationale, and model self-confidence are not interchangeable evidence.

## Limitations and update condition

This structured synthesis is non-exhaustive and becomes stale as models, harnesses, datasets, and attacks change. It lacks production access to many proprietary systems and does not infer field reliability from benchmark success. Material new audits, model/harness changes, benchmark revisions, contamination, or replicated contrary evidence require review.

## Research boundary

The chapter evaluates AI-assisted engineering generally. It does not inspect Zelyq, choose a model or architecture, define product requirements, or authorize code.


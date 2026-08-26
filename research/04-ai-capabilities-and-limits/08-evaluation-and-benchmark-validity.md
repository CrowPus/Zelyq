# The Engineering Research Book

## Evaluation and benchmark validity

Chapter ID: ERB-04-08

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-04-08 artifacts](../artifacts/erb-04-08/)

---

## Primary research question

> To what extent do existing evaluations measure capabilities that matter in real software-engineering work?

## Findings

### A benchmark measures its operationalized task

Issue repair, function retrieval, freelance implementation, managerial choice, and human-duration horizon sample different constructs. Labels such as real-world or software engineering do not merge them.

### Task and oracle validity are empirical questions

Professional curation improved SWE-bench, while later audits still found material specification/test issues in audited subsets. Benchmarks require continuing task-level review as systems improve.

### Scores are configuration- and date-specific

Model snapshot, harness, prompts, tools, attempt budget, sampling, environment, task version, contamination controls, and scoring determine a result. A score without these fields is not reproducible evidence.

### Completion can omit engineering consequences

Hidden tests may establish a behavioral slice while omitting security, maintainability, user impact, process legitimacy, cost, and post-deployment recovery. Evaluation portfolios should trace each responsibility to an observable failure criterion.

### Saturation and contamination change meaning

Public tasks can enter training or optimization loops, and high performance reduces discrimination. A benchmark can remain useful for regression or diagnosis after it stops ranking frontier capability, but its claim must change.

## Approved findings

1. **Current evaluations sample distinct bounded engineering constructs — High:** bounded to the task, configuration, date, and prohibited inference in the claim record.
2. **Benchmark task and oracle quality require continuing audit — High for audited benchmark cases:** bounded to the task, configuration, date, and prohibited inference in the claim record.
3. **Scores require configuration, version, date, and uncertainty metadata — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
4. **Evaluation portfolios must include consequences beyond task completion — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.

See the [claim–evidence records](../artifacts/erb-04-08/claim-evidence-records.md).

## Evaluation consequence

Later criteria must identify the responsibility, task distribution, model and harness version, accessible context and tools, authority, environment, repetitions, verifier, failure consequence, and observation date. Demonstration, benchmark completion, fluent rationale, and model self-confidence are not interchangeable evidence.

## Limitations and update condition

This structured synthesis is non-exhaustive and becomes stale as models, harnesses, datasets, and attacks change. It lacks production access to many proprietary systems and does not infer field reliability from benchmark success. Material new audits, model/harness changes, benchmark revisions, contamination, or replicated contrary evidence require review.

## Research boundary

The chapter evaluates AI-assisted engineering generally. It does not inspect Zelyq, choose a model or architecture, define product requirements, or authorize code.


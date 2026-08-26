# The Engineering Research Book

## Context acquisition and repository understanding

Chapter ID: ERB-04-02

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-04-02 artifacts](../artifacts/erb-04-02/)

---

## Primary research question

> What can AI systems infer about an unfamiliar software project, what context do they require, and how can understanding be tested?

## Findings

### Repository access is not repository understanding

An agent may locate a described function or pass a task test without possessing accurate models of runtime behavior, intent, history, ownership, deployment, or consequences.

### Context acquisition is an active selection problem

Repositories exceed practical attention and contain stale, generated, irrelevant, or adversarial material. Search, dependency tracing, execution, and questions determine which evidence enters the working context.

### Long context does not guarantee use

Controlled evidence shows position and input organization can change retrieval performance. Window size is therefore a capacity bound, not proof that relevant information will be found, weighted, or reconciled.

### Understanding should be tested through consequences

Tests should require predictions, cross-file dependency explanations, localization with evidence, impact analysis, and behavior under changed or withheld facts. Reference-answer and judge-based grading require independent validation.

## Approved findings

1. **Current benchmarks demonstrate bounded code search and issue resolution, not complete project understanding — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
2. **Context selection and retrieval are part of the capability — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
3. **Long input capacity is not equivalent to reliable context use — Moderate for studied models/tasks:** bounded to the task, configuration, date, and prohibited inference in the claim record.
4. **Repository understanding needs multi-probe consequence testing — Moderate–Low:** bounded to the task, configuration, date, and prohibited inference in the claim record.

See the [claim–evidence records](../artifacts/erb-04-02/claim-evidence-records.md).

## Evaluation consequence

Later criteria must identify the responsibility, task distribution, model and harness version, accessible context and tools, authority, environment, repetitions, verifier, failure consequence, and observation date. Demonstration, benchmark completion, fluent rationale, and model self-confidence are not interchangeable evidence.

## Limitations and update condition

This structured synthesis is non-exhaustive and becomes stale as models, harnesses, datasets, and attacks change. It lacks production access to many proprietary systems and does not infer field reliability from benchmark success. Material new audits, model/harness changes, benchmark revisions, contamination, or replicated contrary evidence require review.

## Research boundary

The chapter evaluates AI-assisted engineering generally. It does not inspect Zelyq, choose a model or architecture, define product requirements, or authorize code.


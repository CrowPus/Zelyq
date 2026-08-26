# The Engineering Research Book

## Memory and continuity

Chapter ID: ERB-04-05

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-04-05 artifacts](../artifacts/erb-04-05/)

---

## Primary research question

> Which forms of continuity can AI systems maintain across tasks and time, and how do memory mechanisms introduce error or risk?

## Findings

### Continuity has distinct targets

Conversation recall, task state, project facts, decision rationale, user preference, procedural skill, evidence provenance, ownership, and organizational learning are not interchangeable memory types.

### Storage, retrieval, update, and application can each fail

A system may store a fact but not retrieve it, retrieve stale evidence, merge incompatible contexts, overwrite history, or apply a correct memory to the wrong project or user.

### Summaries are new claims

Compression can preserve useful state while deleting uncertainty, dissent, provenance, or temporal boundaries. A summary must be traceable and correctable rather than treated as the original record.

### Forgetting and isolation are safety functions

Retention creates privacy, security, poisoning, contamination, and obsolete-instruction risks. Systems need scope, provenance, access control, expiry or supersession, and deletion—not maximum recall.

## Approved findings

1. **Agent continuity comprises multiple memory functions and content types — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
2. **Memory can fail at write, retrieval, update, or use time — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
3. **Summarization changes the evidential record — Moderate–Low:** bounded to the task, configuration, date, and prohibited inference in the claim record.
4. **Selective forgetting, isolation, and provenance are required evaluation dimensions — Moderate–Low:** bounded to the task, configuration, date, and prohibited inference in the claim record.

See the [claim–evidence records](../artifacts/erb-04-05/claim-evidence-records.md).

## Evaluation consequence

Later criteria must identify the responsibility, task distribution, model and harness version, accessible context and tools, authority, environment, repetitions, verifier, failure consequence, and observation date. Demonstration, benchmark completion, fluent rationale, and model self-confidence are not interchangeable evidence.

## Limitations and update condition

This structured synthesis is non-exhaustive and becomes stale as models, harnesses, datasets, and attacks change. It lacks production access to many proprietary systems and does not infer field reliability from benchmark success. Material new audits, model/harness changes, benchmark revisions, contamination, or replicated contrary evidence require review.

## Research boundary

The chapter evaluates AI-assisted engineering generally. It does not inspect Zelyq, choose a model or architecture, define product requirements, or authorize code.


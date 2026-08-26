# The Engineering Research Book

## Tool use and environment interaction

Chapter ID: ERB-04-04

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-04-04 artifacts](../artifacts/erb-04-04/)

---

## Primary research question

> How reliably can AI systems select and operate development tools while respecting environmental constraints and feedback?

## Findings

### Tool performance belongs to the interface configuration

Tool descriptions, available actions, output size, error signaling, environment state, model version, and interaction policy materially affect results. A model leaderboard cannot isolate these effects.

### Correct calls include authority and state

Selecting a tool and forming valid arguments are insufficient if the action exceeds permission, targets the wrong state, leaks data, or cannot be reversed. Functional and policy correctness must both be evaluated.

### Environment output is evidence and an attack surface

Logs, files, issues, dependencies, and web results can inform action while containing errors or hostile instructions. The system must preserve the authority hierarchy rather than treating observed text as commands.

### Safe interaction needs enforced boundaries

Least privilege, sandboxing, explicit targets, previews, approvals, idempotence where possible, audit logs, and rollback reduce consequences. Prompt instruction alone is not an enforcement boundary.

## Approved findings

1. **Agent tool performance depends materially on interface and harness design — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
2. **Functional success and policy-compliant action are separate outcomes — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
3. **Untrusted environment content can redirect tool-using agents — Moderate in benchmark conditions:** bounded to the task, configuration, date, and prohibited inference in the claim record.
4. **Security boundaries require mechanisms outside model compliance — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.

See the [claim–evidence records](../artifacts/erb-04-04/claim-evidence-records.md).

## Evaluation consequence

Later criteria must identify the responsibility, task distribution, model and harness version, accessible context and tools, authority, environment, repetitions, verifier, failure consequence, and observation date. Demonstration, benchmark completion, fluent rationale, and model self-confidence are not interchangeable evidence.

## Limitations and update condition

This structured synthesis is non-exhaustive and becomes stale as models, harnesses, datasets, and attacks change. It lacks production access to many proprietary systems and does not infer field reliability from benchmark success. Material new audits, model/harness changes, benchmark revisions, contamination, or replicated contrary evidence require review.

## Research boundary

The chapter evaluates AI-assisted engineering generally. It does not inspect Zelyq, choose a model or architecture, define product requirements, or authorize code.


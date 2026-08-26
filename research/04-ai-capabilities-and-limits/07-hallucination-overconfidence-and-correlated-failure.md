# The Engineering Research Book

## Hallucination, overconfidence, and correlated failure

Chapter ID: ERB-04-07

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-04-07 artifacts](../artifacts/erb-04-07/)

---

## Primary research question

> Which failure modes most affect AI-assisted engineering, what conditions produce them, and how observable are they to users?

## Findings

### Engineering hallucination is unsupported commitment

Relevant forms include invented APIs or packages, false repository claims, fabricated test results, incorrect causal explanations, nonexistent permissions, and confidence not warranted by evidence.

### Errors may be executable and plausible

Generated code can compile or pass narrow tests while containing security weaknesses, semantic misalignment, or misuse. Fluency and local validity reduce observability to users who lack relevant expertise.

### Sampling and model plurality do not guarantee independence

Repeated outputs can vary, but variation is not calibrated uncertainty. Models sharing data, architectures, prompts, tools, or evaluation patterns may converge on the same wrong answer.

### Agentic errors enlarge the consequence path

A false statement becomes more consequential when it drives tool calls, dependency installation, credential access, or deployment. Detection must occur before irreversible or high-impact action where possible.

## Approved findings

1. **AI engineering failures include fabricated facts, semantic errors, insecure code, and unjustified confidence — Moderate within studied systems:** bounded to the task, configuration, date, and prohibited inference in the claim record.
2. **Plausibility and narrow execution can conceal material error — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.
3. **Repeated or multi-model agreement is not automatically independent corroboration — Moderate–Low:** bounded to the task, configuration, date, and prohibited inference in the claim record.
4. **Tool authority increases consequences of unobserved model error — Moderate:** bounded to the task, configuration, date, and prohibited inference in the claim record.

See the [claim–evidence records](../artifacts/erb-04-07/claim-evidence-records.md).

## Evaluation consequence

Later criteria must identify the responsibility, task distribution, model and harness version, accessible context and tools, authority, environment, repetitions, verifier, failure consequence, and observation date. Demonstration, benchmark completion, fluent rationale, and model self-confidence are not interchangeable evidence.

## Limitations and update condition

This structured synthesis is non-exhaustive and becomes stale as models, harnesses, datasets, and attacks change. It lacks production access to many proprietary systems and does not infer field reliability from benchmark success. Material new audits, model/harness changes, benchmark revisions, contamination, or replicated contrary evidence require review.

## Research boundary

The chapter evaluates AI-assisted engineering generally. It does not inspect Zelyq, choose a model or architecture, define product requirements, or authorize code.


# Research handoff for the engineering team

Version: 1.0

Status: Ready for engineering review

Date: 2026-08-25

## What is being handed over

The Engineering Research Book Version 1 contains forty reviewed chapters and their evidence records. The cross-part conclusions are consolidated in [Version 1 synthesis](06-synthesis-and-evaluation/07-version-1-synthesis.md), while the [traceability matrix](TRACEABILITY_MATRIX.md) provides the shortest route from a synthesis claim to its supporting chapters and artifacts.

This handoff supplies research inputs for a separate engineering process. It does not prescribe Zelyq's architecture, select features, authorize implementation, or claim that a general research finding automatically applies to a particular codebase.

## Required engineering flow

1. State the concrete engineering problem, affected users, operating context, stakes, and constraints.
2. Identify relevant reviewed findings through the traceability matrix and read the full chapters, not only their summaries.
3. Inspect the linked claim–evidence records, contradictory evidence, confidence ratings, and limitations.
4. Separate what the evidence supports from product judgment and unverified assumptions.
5. Create the appropriate record from `07-zelyq-engineering/templates/` and link every material research dependency.
6. Define acceptance evidence, failure boundaries, human oversight, reversibility, security and privacy controls, and post-implementation evaluation before requesting approval.
7. Obtain the reviews and status required by [research-to-code governance](00-front-matter/10-research-to-code-governance.md).
8. Add the record to the [engineering register](07-zelyq-engineering/REGISTER.md). Begin code work only if its approved status explicitly permits it.

## Minimum evidence packet for a proposed decision

- the engineering problem and intended outcome;
- applicable chapter IDs and finding or claim IDs;
- direct links to the relevant evidence artifacts;
- confidence and transferability assessment for the intended context;
- known contradictions, limitations, and unresolved questions;
- alternatives considered and decision rationale;
- measurable acceptance and stop conditions;
- affected responsibility, security, privacy, and human-oversight boundaries;
- rollback or recovery plan; and
- owner, reviewers, expiry or reassessment trigger, and evaluation plan.

## Interpretation rules

- A reviewed finding is bounded by its stated scope and evidence cutoff.
- An association is not a causal guarantee.
- Benchmark performance is not equivalent to dependable field performance.
- A general capability does not establish safe operation in a specific repository or environment.
- Missing evidence remains uncertainty; it must not be silently converted into a requirement.
- Product judgment must be labeled as judgment, even when it is reasonable.
- Existing code does not retrospectively authorize a decision.

## Current authorization state

As of 2026-08-25, the engineering register contains one approved entry, [ZED-0001](07-zelyq-engineering/entries/ZED-0001-engineer-mode.md), authorizing bounded Phase 1 work only within its recorded boundary. Version 1 by itself still authorizes no implementation — the [register](07-zelyq-engineering/REGISTER.md) is the current source of what, if anything, is authorized.

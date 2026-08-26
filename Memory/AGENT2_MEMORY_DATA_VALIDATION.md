# Agent 2 — Memory Architecture Data Validation

**Reviewer:** Agent 2 — Data Analysis  
**Validated documents:** `PERSISTENT_COGNITIVE_MEMORY_ARCHITECTURE.md`, `AGENT1_MEMORY_ARCHITECTURE_DECISION.md`  
**Validation type:** Data, measurement, and evaluation readiness  
**Decision:** Conditionally validated for controlled experimentation; not validated for production  
**Date:** 2026-08-26

## Executive Decision

The proposed persistent cognitive memory architecture is logically testable, but the current specification contains no empirical evidence that its graph, consolidation, hybrid retrieval, or context-compilation choices outperform simpler baselines. It also lacks a benchmark protocol capable of detecting temporal errors, provenance breaks, authorization leakage, deletion remnants, and confidence miscalibration.

Agent 2 therefore validates the architecture as an **experimental hypothesis**, not as a proven production design.

Implementation should begin only as a bounded evaluation prototype after the formal contracts required by Agent 1 are defined. Infrastructure selection, automated procedure promotion, and production persistence remain unauthorized until the quantitative gates in this document are satisfied.

## Validation Scope

This review tests whether the architecture can be evaluated objectively. It does not approve a database, model, UI, deployment topology, or production data collection program.

The central hypothesis is:

> A structured, temporally versioned memory graph with hybrid retrieval and bounded context can answer long-horizon questions more accurately, safely, and efficiently than raw-history or vector-only retrieval.

This hypothesis must be tested against observed data. Architectural plausibility alone is insufficient.

## Findings

### 1. The north-star objective is measurable

The claim that answer context should remain approximately bounded as lifetime memory grows can be evaluated by measuring context tokens against corpus size while holding query difficulty constant.

Let:

```text
C(N) = median memory-context tokens used for correct answers at corpus size N
```

The architecture supports its north-star claim only if answer quality remains above threshold and context growth is sublinear. The preferred result is a stable plateau; a near-linear increase fails the claim.

### 2. The architecture needs explicit baselines

Every experiment must compare at least:

1. no persistent memory;
2. recent-window raw history;
3. vector-only retrieval over raw chunks;
4. vector retrieval over extracted episodes;
5. proposed graph plus semantic, lexical, and temporal retrieval;
6. proposed retrieval plus context compiler.

Without these baselines, improvements cannot be attributed to the graph or compiler. The same model, prompts, token budget, query set, and source corpus should be used across conditions wherever possible.

### 3. Evaluation units must be separated

Do not report one aggregate “memory accuracy” score. Measure these units independently:

- extraction event;
- entity link;
- atomic claim;
- temporal interval;
- provenance link;
- contradiction pair;
- retrieval candidate;
- compiled context;
- final answer;
- authorization decision;
- deletion operation;
- procedure recommendation.

An answer can be correct while its provenance is wrong, or authorized while its compiled context contains unnecessary private data. Aggregate scoring would conceal these failures.

### 4. Offline and online evidence are both required

Offline benchmarks can validate retrieval, temporal reasoning, correction propagation, deletion, and security boundaries. They cannot alone prove that memory improves real user outcomes.

Production consideration therefore requires two stages:

- **offline gate:** repeatable benchmark performance against labeled fixtures;
- **controlled-use gate:** task success, correction burden, user trust, latency, and cost measured in a consented, reversible pilot.

### 5. Retrieval frequency must not alter truth confidence

The architecture currently includes successful retrievals and reinforcement in memory strength. These are behavior signals, not independent evidence of truth.

The data model and dashboards must keep separate fields for:

- source reliability;
- extraction confidence;
- entity-link confidence;
- claim confidence;
- retrieval relevance;
- access frequency;
- user confirmation;
- evidence-family count.

Confirmations derived from the same source must share an evidence-family identifier and count once when estimating independent support.

## Required Benchmark Dataset

Create a versioned benchmark with synthetic fixtures first and consented, de-identified real examples only after governance approval.

### Required cohorts

| Cohort | Minimum cases | Required variation |
| --- | ---: | --- |
| Long-horizon factual recall | 300 queries | memory age, corpus size, distractor density |
| Temporal and bitemporal queries | 250 queries | valid time, recorded time, uncertain and open intervals |
| Entity continuity | 250 mention groups | aliases, pronouns, collisions, renamed entities |
| Contradiction handling | 200 claim sets | supersede, coexist, conflict, unresolved evidence |
| Provenance tracing | 250 answers | direct, multi-hop, derived, missing provenance |
| Correction propagation | 150 corrections | atomic and cascading revisions |
| Deletion propagation | 150 deletions | source, claim, entity, derived memory, cache/index remnants |
| Authorization isolation | 500 adversarial queries | user, project, team, tenant, derived-scope boundaries |
| Prompt-injection resistance | 200 sources | documents and messages containing hostile instructions |
| Procedural memory | 100 task families | success, failure, rollback, approval-required actions |

Minimum counts are evaluation floors, not proof of statistical power for every subgroup. Before execution, calculate sample sizes from the smallest practically important effect, expected variance, desired power of at least 0.80, and two-sided alpha of 0.05. Report confidence intervals, not only point estimates.

### Dataset split rules

- Split by user, project, conversation, and evidence family—not by individual chunk.
- Prevent paraphrases or derived memories from one source crossing train, tuning, and test splits.
- Freeze the final test set before tuning weights or prompts.
- Maintain a separate adversarial holdout owned by the evaluator.
- Version source fixtures, labels, schema, extraction model, embedding model, prompts, and retrieval configuration.
- Record inter-annotator agreement for subjective labels; adjudicate disagreements without silently replacing original labels.

## Metric Definitions and Release Gates

All gates apply to the frozen test set. Results must be reported overall and by cohort, privacy scope, memory age, corpus size, and query difficulty.

| Dimension | Metric | Prototype gate | Production-candidate gate |
| --- | --- | ---: | ---: |
| Answer quality | Exact match or rubric accuracy | ≥ 0.80 | ≥ 0.90 and no worse than best baseline by > 1 percentage point |
| Retrieval recall | Recall@10 of required evidence | ≥ 0.90 | ≥ 0.95 |
| Retrieval precision | Precision@10 | ≥ 0.60 | ≥ 0.75 |
| Ranking | nDCG@10 | ≥ 0.80 | ≥ 0.88 |
| Provenance | Required-support precision and recall | ≥ 0.95 each | ≥ 0.99 each |
| Temporal reasoning | Interval and as-of-query accuracy | ≥ 0.90 | ≥ 0.97 |
| Entity resolution | Pairwise precision / recall / F1 | ≥ 0.95 / 0.90 / 0.92 | ≥ 0.98 / 0.95 / 0.96 |
| Contradictions | Macro F1 across resolution classes | ≥ 0.85 | ≥ 0.93 |
| Authorization | Unauthorized item exposure | 0 observed | 0 observed with 95% upper confidence bound below 0.1% |
| Deletion | Queryable remnants after SLA | 0 | 0, including graph, vector, cache, compiled context, and derived-memory tests |
| Correction | Stale-answer rate after SLA | ≤ 2% | ≤ 0.5% |
| Confidence | Expected calibration error | ≤ 0.08 | ≤ 0.05 |
| Abstention | Unsafe false-answer rate on unanswerable queries | ≤ 5% | ≤ 2% |
| Latency | Retrieval p95 under declared load | ≤ 1,500 ms | ≤ 750 ms, unless product SLO states otherwise |
| Efficiency | Context tokens per correct answer | ≥ 25% below best raw-history baseline | ≥ 40% below baseline |
| Cost | Total memory cost per correct answer | Reported | Within approved product budget |

Thresholds are initial engineering gates and must be revised using product risk, observed base rates, and user-impact evidence. Security and privacy gates are non-compensatory: higher average answer accuracy cannot offset a leak.

## Experimental Design

### Experiment A — Retrieval ablation

Run the same queries through every baseline and remove one proposed signal at a time: graph, semantic, lexical, temporal, confidence, task routing, and diversification. Measure the marginal effect on Recall@K, nDCG, answer accuracy, tokens, latency, and cost.

### Experiment B — Scale curve

Evaluate at increasing corpus sizes such as 10³, 10⁴, 10⁵, and 10⁶ memory objects, using equivalent query strata. Plot answer accuracy, Recall@10, p50/p95 latency, and context tokens. Declare the tested hardware and load profile.

### Experiment C — Time and correction

Insert delayed facts, backdated events, corrections, and concurrent revisions. Test both:

- what was valid at time T;
- what the system believed at time T.

Score exact temporal selection and ensure later knowledge does not leak into historical belief queries.

### Experiment D — Authorization and deletion

Construct connected graphs whose adjacent nodes have different owners, tenants, and policies. Attempt semantic, lexical, graph, cache, and compiled-context retrieval across each boundary. After deletion, test every materialized representation until the documented deletion SLA expires.

### Experiment E — Confidence calibration

Bin claims by predicted confidence and compare predicted with observed correctness. Repeat after high retrieval frequency to prove that popularity does not inflate factual confidence. Evaluate dependent and independent evidence separately.

### Experiment F — Context compiler faithfulness

Compare retrieved evidence with compiled context. Measure required-fact recall, unsupported-statement rate, provenance preservation, sensitive-data inclusion, token reduction, and downstream answer accuracy.

## Data Quality Controls

Each experiment must produce an immutable run manifest containing:

```text
dataset_version
schema_version
code_revision
model_and_embedding_versions
prompt_versions
retrieval_configuration
policy_version
random_seed
run_timestamp
hardware_and_load_profile
metric_implementation_version
```

Additionally:

- reject malformed timestamps and explicitly encode unknown precision;
- validate referential integrity among sources, claims, revisions, and derived memories;
- monitor orphan provenance links and duplicate entities;
- record missing values rather than coercing them to zero;
- report denominators and confidence intervals for every rate;
- retain failed cases for error analysis;
- require deterministic replay for ingestion, revision, correction, and deletion fixtures.

## Stop Conditions

Pause the evaluation and return to architecture review if any of the following occurs:

1. a single cross-tenant or unauthorized disclosure;
2. a deletion remnant remains queryable beyond the declared SLA;
3. the benchmark split contains source-family leakage;
4. historical queries use future-recorded evidence without explicitly requesting retrospective truth;
5. retrieval frequency changes claim confidence without new independent evidence;
6. the context compiler introduces unsupported claims;
7. results cannot be reproduced from the run manifest;
8. the proposed system fails to outperform vector-only episode retrieval on answer quality or efficiency;
9. aggregate gains conceal a material regression for a privacy scope, language, user group, or high-risk task class.

## Required Deliverables Before Production Review

1. Agent 1's Phase 0 formal memory contract.
2. Versioned benchmark dataset and labeling guide.
3. Baseline and ablation results with confidence intervals.
4. Scale curves for quality, latency, token use, and cost.
5. Authorization and deletion test report with zero observed leaks or remnants.
6. Confidence-calibration and abstention report.
7. Error taxonomy with representative failed cases.
8. Reproducible run manifests and metric implementations.
9. Controlled-pilot protocol, consent boundary, rollback plan, and monitoring plan.
10. Signed evaluation decision assigning owners for unresolved risks.

## Final Validation

**Conceptual model:** Valid as a testable hypothesis.  
**Data model readiness:** Blocked by the missing formal contracts identified by Agent 1.  
**Evaluation readiness:** Conditionally approved after the benchmark schema and labels are frozen.  
**Production readiness:** Not validated.  

The architecture should proceed through a measurement-first prototype. Its key claims are credible only if the proposed graph and context compiler demonstrate better long-horizon accuracy, temporal correctness, provenance, privacy isolation, and token efficiency than simpler baselines under reproducible tests.

# Agent 1 — Memory Architecture Validation Decision

**Reviewer:** agent1  
**Reviewed document:** `PERSISTENT_COGNITIVE_MEMORY_ARCHITECTURE.md`  
**Review type:** Architecture validation  
**Decision:** Conditionally approved as a research direction; not yet approved for implementation  
**Date:** 2026-08-26

## Executive Decision

The proposed persistent cognitive memory architecture has a strong conceptual foundation. Its separation of episodic, semantic, procedural, reflective, and working memory is reasonable, and its emphasis on temporal knowledge, provenance, contradiction handling, hybrid retrieval, bounded context, and user visibility is correct.

However, the document is not yet precise enough to serve as an implementation specification. Several foundational contracts remain undefined. Different engineers could currently implement incompatible systems while still appearing to follow the architecture.

The architecture may proceed to a formal design phase, but implementation should not begin until the blocking requirements in this decision are resolved.

## What Is Valid

The following architectural decisions are accepted:

1. Raw conversation history is evidence rather than the final memory representation.
2. Memory should be represented as connected knowledge rather than isolated vector chunks.
3. Historical facts should be retained through temporal versioning instead of destructive overwrites.
4. Derived knowledge must remain connected to its provenance.
5. Contradictions must be represented explicitly.
6. Retrieval should combine graph, semantic, temporal, confidence, and task signals.
7. Only a small, relevant memory representation should enter the model context.
8. Users must be able to inspect, correct, and delete memory.
9. Authorization must be applied before and during retrieval, not after sensitive data has been retrieved.
10. Infrastructure selection should follow validation of the memory and retrieval model.

## Blocking Findings

### 1. The canonical model does not distinguish core object types

The current common envelope does not formally distinguish entities, claims, episodes, relationships, source records, procedures, reflections, and revisions. A decision is variously treated as an episode subtype, a graph node, and a relationship.

Before implementation, define canonical schemas and invariants for at least:

- `Entity`
- `Claim` or `Assertion`
- `Episode`
- `Relationship`
- `Source`
- `Procedure`
- `Reflection`
- `Revision`

A shared envelope is acceptable, but each subtype requires a defined payload, lifecycle, identity rule, and versioning rule.

### 2. The temporal model must be bitemporal

Event time, recording time, and validity time are correctly identified, but they are not fully represented in the proposed schemas.

Every time-sensitive claim should distinguish:

- `valid_from` and `valid_to`: when the claim was true in the represented world;
- `recorded_at` and `retracted_at`: when the memory system believed or stored the claim;
- time precision and uncertainty;
- interval boundary rules.

This is required to answer both “what was true then?” and “what did the agent believe then?” reliably.

### 3. Privacy scopes are not yet an authorization model

Scope names alone do not define who may access a memory. The design must define principals, ownership, tenant boundaries, grants, policy versions, and inheritance.

Authorization must apply to:

- nodes and edges;
- raw sources;
- vector candidates before disclosure;
- embeddings and indexes;
- cached and compiled context;
- derived memories composed from differently scoped evidence;
- audit and administrative access.

Unless an explicit declassification process exists, derived memory should inherit the most restrictive policy of its supporting evidence.

### 4. Correction and deletion semantics are unresolved

User deletion, historical continuity, and permanent provenance can conflict. The system must define the behavior of:

- raw sources;
- graph nodes and relationships;
- embeddings;
- summaries and reflections;
- procedures derived from deleted evidence;
- caches, backups, and audit records.

Tombstoning is not equivalent to deletion. The design needs explicit cascade, recomputation, retention, and physical or cryptographic erasure policies.

### 5. Confidence and reinforcement are conflated

Frequently retrieving a memory must not make its factual content more credible. Otherwise, popular errors become increasingly authoritative.

The model should separate:

- source reliability;
- extraction confidence;
- entity-resolution confidence;
- claim confidence;
- retrieval relevance;
- accessibility or popularity.

Evidence must also be deduplicated by origin. Multiple derived memories from one conversation do not constitute multiple independent confirmations.

### 6. Retrieval should use parallel candidate generation

Intent and entity resolution should not be an absolute prerequisite for vector or lexical retrieval. Some queries will be vague, entity-free, misspelled, or refer to unresolved entities.

Candidate generation should combine, where appropriate:

- semantic search;
- lexical search;
- entity linking;
- graph traversal;
- temporal filtering;
- task or procedure routing.

Candidates should then be authorized, merged, reranked, diversified, and compiled within a token budget.

### 7. Asynchronous consolidation needs consistency guarantees

The design must define handling for:

- idempotent retries;
- duplicate events;
- out-of-order events;
- concurrent corrections;
- stale embeddings;
- partial writes across stores;
- reconciliation between graph, vector, relational, and event storage.

Immutable source identifiers, deterministic operation identifiers, revision checks, and a reconciliation or outbox mechanism should be part of the formal design.

### 8. Untrusted memory sources need a security boundary

Raw messages and documents must be treated as evidence, not trusted instructions. Otherwise, malicious content could poison semantic or procedural memory.

The design must add:

- source trust classification;
- instruction/data separation;
- prompt-injection resistance during extraction and consolidation;
- controls on sensitive inference;
- user confirmation for important identity, permission, and security claims;
- provenance-aware trust propagation.

### 9. Procedural memory requires execution safeguards

Reflections may propose procedural changes, but an inferred procedure must not automatically gain authority to perform consequential actions.

Procedures should define:

- applicability conditions;
- risk classification;
- required permissions and approvals;
- validation evidence;
- version status;
- rollback behavior.

High-impact procedures should require explicit validation or approval before becoming executable.

### 10. Evaluation requires measurable acceptance criteria

The proposed evaluation categories are appropriate but qualitative. The implementation specification should define datasets, labels, baselines, and thresholds for:

- answer and provenance accuracy;
- Recall@K, Precision@K, MRR, and nDCG;
- temporal interval accuracy;
- entity-linking precision, recall, and F1;
- contradiction classification accuracy;
- unauthorized retrieval rate, with a target of zero;
- deletion-remnant and stale-memory rates;
- p50 and p95 retrieval latency;
- tokens and cost per correct answer;
- confidence calibration and correct abstention.

Tests must include distractors, aliases, conflicting evidence, delayed corrections, deleted evidence, permission boundaries, and adversarial source content.

## Required Phase 0

Add a phase before the current implementation phases:

### Phase 0 — Formal Memory Contract

Deliverables:

1. Canonical subtype schemas and invariants.
2. Claim, evidence, and revision semantics.
3. Bitemporal storage and query semantics.
4. Provenance and evidence-independence rules.
5. Authorization and derived-data policies.
6. Correction, deletion, and recomputation semantics.
7. Ingestion idempotency and cross-store consistency rules.
8. Trust boundaries for untrusted source content.
9. Procedure approval and execution controls.
10. Benchmark datasets and numerical acceptance thresholds.

## Approval Conditions

The architecture becomes implementation-ready when:

- all Phase 0 contracts are documented;
- representative examples validate the schemas end to end;
- correction, deletion, permissions, and temporal queries have deterministic expected behavior;
- adversarial and long-horizon tests exist before infrastructure is selected;
- retrieval quality and security have measurable release gates.

## Final Assessment

**Research direction:** Approved.  
**Formal architecture:** Conditionally approved.  
**Production implementation:** Not approved yet.  
**Required next action:** Complete Phase 0 — Formal Memory Contract.

The central idea is credible and worth continuing. The next step should be to replace architectural ambiguity with explicit data, security, temporal, lifecycle, and evaluation contracts.

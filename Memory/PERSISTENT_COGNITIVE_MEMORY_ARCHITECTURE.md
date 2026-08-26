# Zelyq Persistent Cognitive Memory Architecture

## Final architecture decision and implementation contract

**Decision date:** 2026-08-26  
**Status:** Approved for Phase 0 and a bounded prototype; not approved for production persistence  
**Authority:** This file is canonical. It supersedes its earlier version and resolves `AGENT1_MEMORY_ARCHITECTURE_DECISION.md` and `AGENT2_MEMORY_DATA_VALIDATION.md`.

## 1. Final decision

Zelyq will implement persistent memory as an **evidence-backed, bitemporal claim graph with hybrid retrieval and a bounded context compiler**.

The five cognitive categories remain useful product views, but they are not five databases and are not the canonical data model. The canonical model consists of immutable sources, entities, atomic claims, evidence links, episodes, reflections, procedures, revisions, policies, and rebuildable projections.

Final decisions:

1. Raw messages, files, tool events, and documents are evidence, not trusted instructions or final memory.
2. Facts are atomic bitemporal claims and are never silently overwritten.
3. Every derived memory retains provenance.
4. Truth confidence, retrieval relevance, importance, and access frequency are separate.
5. Authorization applies before candidate disclosure, during traversal, and before context use.
6. Derived data inherits the most restrictive effective policy of its evidence unless an explicit audited declassification rule exists.
7. Correction creates revisions; deletion triggers a policy-defined cascade and recomputation.
8. Retrieval generates lexical, semantic, entity, graph, temporal, and task candidates in parallel. Entity resolution is not a mandatory first gate.
9. Reflections and procedures are recommendations until validated. Memory never grants execution permission.
10. SQLite/PostgreSQL are the prototype system of record. A graph database is deferred until measurements justify it.
11. Memory Explorer is deferred until the underlying contract, security, deletion, and retrieval behavior pass their gates.
12. Production memory collection is prohibited until the consent, benchmark, privacy, deletion, and operational gates pass.

The original direction is accepted as a controlled engineering hypothesis, not as a proven production design.

## 2. Goal and non-goals

The goal is to turn long-running agent experience into a small, correct, authorized, explainable context for the current task while preserving history and user control.

> As lifetime memory grows, the memory context required for a specific correct answer should remain approximately bounded.

This architecture does not authorize infinite context, storing every utterance, autonomous identity, memory-based permissions, automatic execution of learned procedures, or cross-user/team learning without separate governance and consent.

## 3. Cognitive views

| View | Question | Canonical representation |
| --- | --- | --- |
| Working | What is needed now? | Ephemeral task state and authorized compiled context |
| Episodic | What happened? | `Episode` linked to sources, claims, actors, and outcomes |
| Semantic | What is believed true? | `Entity` + atomic `Claim` + `EvidenceLink` |
| Procedural | How might this be done? | Versioned `Procedure` with risk and approval status |
| Reflective | What pattern was inferred? | `Reflection` with independent evidence families |

Working memory is session-scoped. Nothing becomes durable merely because it appeared in a prompt or model response.

## 4. Zelyq system boundary

The design follows Zelyq's current ownership model:

```text
apps/agent                         apps/server
-----------                        -----------
extraction proposals         --->  validation + policy
retrieval request            --->  authorized retrieval
compiled context             <---  context compiler
                                      |
                                      v
                              @zelyq/db system of record
                              + rebuildable indexes
```

- `apps/server` owns durable writes, authorization, audit, correction, deletion, and retrieval APIs.
- `apps/agent` proposes extraction and consumes compiled context; it cannot write trusted claims directly.
- `@zelyq/core` owns versioned Zod and wire schemas.
- `@zelyq/db` owns relational tables, migrations, transactions, and the outbox.
- Search, vector, cache, and graph projections are rebuildable and never authoritative.
- `RuntimeDriver` remains the only route for filesystem and shell actions; memory never bypasses it.

The prototype is a modular monolith. Memory microservices require measured justification.

## 5. Canonical contract

### Common envelope

```ts
type MemoryEnvelope = {
  id: string;
  tenantId: string;            // immutable
  projectId: string | null;
  ownerPrincipalId: string;
  schemaVersion: number;
  revision: number;             // optimistic concurrency
  createdAt: string;
  createdBy: string;
  status: "active" | "superseded" | "disputed" | "retracted" | "deleted";
  policyId: string;
  policyVersion: number;
};
```

IDs identify objects, not mutable content. Mutations create revisions and audit events.

### Source

A `Source` is immutable evidence: message, tool event, file snapshot, document, correction, or verified system record.

```ts
type Source = MemoryEnvelope & {
  kind: "message" | "tool_event" | "file_snapshot" | "document" | "user_correction" | "system_record";
  sourceRef: string;
  contentHash: string;
  occurredAt: TemporalValue | null;
  recordedAt: string;
  trustClass: "untrusted_content" | "user_assertion" | "verified_system" | "approved_authority";
  evidenceFamilyId: string;
  payloadRef: string;
};
```

`evidenceFamilyId` groups copies, quotes, summaries, and derivations of one origin so they count once as independent support. Source content is data during extraction; embedded instructions have no execution authority.

### Entity

```ts
type Entity = MemoryEnvelope & {
  entityType: string;
  canonicalLabel: string;
  aliases: string[];
  resolutionConfidence: number;
};
```

Entity merges are reversible mappings, not destructive merges. Ambiguous mentions remain unresolved.

### Claim

A `Claim` is the smallest independently supportable proposition. Relationships are claims, not bare edges.

```ts
type Claim = MemoryEnvelope & {
  subjectId: string;
  predicate: string;
  object: { kind: "entity"; entityId: string }
        | { kind: "value"; value: unknown; dataType: string };
  validTime: TemporalInterval;
  recordedAt: string;
  retractedAt: string | null;
  extractionConfidence: number;
  claimConfidence: number;
  importance: number;
};
```

Claims are atomic, typed, policy-bound, and supported by at least one active evidence link. A decision is an episode plus claims describing selection, actor, time, and rationale—not an ambiguous special object.

### Evidence link

```ts
type EvidenceLink = MemoryEnvelope & {
  sourceId: string;
  targetType: "claim" | "episode" | "reflection" | "procedure";
  targetId: string;
  stance: "supports" | "contradicts" | "supersedes" | "mentions";
  extractionConfidence: number;
  evidenceFamilyId: string;
};
```

Confidence aggregation uses independent evidence families. Retrieval frequency never changes claim confidence.

### Episode

An `Episode` is a meaningful event, not a transcript chunk. It records event type, participants, valid time, outcome, linked claims and sources, and an evidence-backed summary. Its summary must introduce no unsupported fact.

### Reflection

A `Reflection` records a derived proposition, applicability conditions, supporting and contradicting evidence families, derivation version, confidence, and lifecycle:

```text
proposed -> validated | rejected -> superseded
```

Repeated retrieval or multiple derivatives of one source cannot validate it.

### Procedure

A versioned `Procedure` contains applicability conditions, ordered steps, validation, risk class, required roles and external permissions, approval status, rollback/recovery, evidence families, and observed successes/failures.

Statuses are `draft`, `validated`, `approved`, and `retired`; risk is `low`, `medium`, `high`, or `prohibited`. An independently authorized path must still approve every execution. Procedure status never grants permission.

### Revision and audit

Corrections, merges, retractions, policy changes, and deletions append a `Revision` and immutable audit event. Each mutation supplies the expected prior revision; stale concurrent writes fail.

## 6. Bitemporal semantics

Claims distinguish:

- **valid time:** when a proposition was true in the represented world;
- **record time:** when Zelyq stored or believed it.

```ts
type TemporalValue = {
  value: string;
  precision: "instant" | "minute" | "day" | "month" | "year" | "unknown";
  uncertainty: "exact" | "approximate" | "before" | "after" | "unknown";
};

type TemporalInterval = {
  from: TemporalValue | null;
  to: TemporalValue | null;
  bounds: "[)"; // inclusive start, exclusive end
};
```

Unknown time stays unknown and is never invented from creation time. “What was true at T?” queries valid time using all currently known evidence. “What did Zelyq believe at T?” additionally excludes records learned after T. Corrections close or dispute record-time versions without destroying historical belief unless erasure policy requires it.

## 7. Confidence and ranking

| Value | Meaning | Changed by retrieval? |
| --- | --- | --- |
| Source reliability | Reliability of evidence origin | No |
| Extraction confidence | Confidence in source parsing | No |
| Resolution confidence | Confidence in entity mapping | No |
| Claim confidence | Calibrated proposition support | No |
| Importance | Expected consequence/utility | No |
| Retrieval relevance | Match to this query | Per query only |
| Accessibility | Lifecycle/ranking preference | Yes |
| Access count | Usage telemetry | Yes |

There is no universal “memory strength” truth score. Popularity may affect caching or accessibility, never credibility.

## 8. Authorization and privacy

Friendly scopes such as private, project, and team are labels over versioned policies for principals and resources. A request carries an authenticated principal, tenant, memberships, project role, purpose, and policy version.

Mandatory rules:

1. Tenant isolation is immutable.
2. Candidate generators receive authorization filters; inaccessible content is not retrieved for later filtering.
3. Traversal stops at unauthorized objects.
4. A derived policy is the intersection of all evidence policies.
5. Mixed-scope summaries are prohibited unless the requester can see all content.
6. Embeddings and indexes are sensitive derived data and contain policy partition keys.
7. Cache keys include principal/role, tenant, policy version, query, and source revision watermark.
8. Authorization is checked again before compilation and response use.
9. Denials are audited without logging prohibited content.
10. Cross-project, team, tenant, or agent memory is off by default.

Memory cannot expand a role, permission, runtime capability, or approval authority.

## 9. Ingestion, trust, and consistency

```text
source -> consent/policy validation -> immutable source + transactional outbox
       -> extraction proposal -> schema/trust validation -> entity candidates
       -> claims + evidence -> contradiction classification -> projections
       -> optional episode/reflection/procedure proposal
```

- Sources have stable IDs and hashes; operations have deterministic idempotency keys.
- Canonical write and outbox append share one transaction.
- Consumers are at-least-once and idempotent.
- Projections carry source revision and model/index versions.
- Stale projections are excluded or synchronously verified.
- Out-of-order events are accepted and evaluated bitemporally.
- Reconciliation detects missing, duplicate, orphaned, or stale projections.
- The relational system of record wins every projection disagreement.
- Model output is a proposal, not evidence by itself.
- Documents and messages remain untrusted data even if they contain instructions.
- Identity, security, authorization, secrets, and consequential preferences require confirmation or an approved authority.
- Sensitive inference is prohibited without explicit product policy and consent.

## 10. Contradiction, correction, and deletion

New evidence is classified as `supports`, `updates`, `supersedes`, `contradicts`, `coexists`, or `unresolved`. Newer is not automatically truer; valid time, source reliability, independence, and explicit correction govern resolution. The system preserves disagreement and may abstain.

A user correction is a high-priority source. It creates revisions, adjusts affected claims, invalidates projections, and schedules dependent recomputation without rewriting raw evidence.

Deletion policy distinguishes:

- `hide`: reversible visibility change, not deletion;
- `tombstone`: logical removal when retention is required;
- `erase`: physical or cryptographic erasure from active stores and scheduled backup expiry.

Accepted deletion immediately revokes retrieval, removes graph/lexical/vector/cache/compiled projections, recomputes or retracts dependents, retains only permitted non-content audit proof, and completes under published active-store and backup SLAs. If all evidence for a derived object is deleted, retract it; if partial evidence remains, recompute it.

## 11. Retrieval and context compiler

```text
query + principal + task
  -> lexical | semantic | entity | graph | temporal | procedure candidates
  -> authorization intersection
  -> deduplicate by object and evidence family
  -> merge, rerank, diversify
  -> evidence sufficiency check
  -> compile under token budget
  -> final authorization and revision check
```

Ranking may use query similarity, graph proximity, temporal fit, calibrated claim confidence, importance, task fit, diversity, and freshness. Access frequency is not a truth signal.

The compiler outputs structured facts, temporal qualifications, unresolved conflicts, procedure status, and provenance. It preserves uncertainty, negation, time, and scope; separates evidence from inference; introduces no unsupported claim; abstains when evidence is insufficient; carries revision watermarks; and stays within a declared token budget. Raw evidence is fetched only when needed and authorized.

## 12. Storage decision

For the prototype:

- SQLite locally and PostgreSQL at scale remain authoritative through `@zelyq/db`.
- Normalized tables hold canonical objects; adjacency tables support claim traversal.
- Database full-text search is used where practical behind a replaceable interface.
- A replaceable vector index points to canonical authorized objects.
- Large immutable payloads may use object/file storage.
- A transactional outbox drives projections and consolidation.

A graph database, separate event store, distributed services, learned ranking, and automatic procedure promotion are deferred. Adopt one only when profiling identifies a missed gate and an experiment shows that component fixes it.

## 13. Authorized phases

### Phase 0 — Formal contract and fixtures (authorized now)

Deliver versioned schemas/invariants, relational tables and transactions, deterministic bitemporal examples, policy and threat models, deletion cascade matrix/SLAs, idempotency/outbox/reconciliation contracts, hostile-source fixtures, and a frozen benchmark plan.

Exit when fixtures deterministically cover creation, aliasing, contradiction, historical belief, correction, authorization, and deletion.

### Phase 1 — Offline prototype

Implement canonical objects, relational traversal, lexical/vector retrieval, authorization, compiler, and replay using synthetic fixtures only. No production persistence.

### Phase 2 — Consented controlled pilot

Add opt-in project memory, correction/deletion UI, monitoring, and rollback. Reflections remain proposals and executable procedure promotion stays disabled.

### Phase 3 — Production candidate

Permit only validated scopes and retention periods after the production gates and signed risk acceptance. Memory Explorer may begin after provenance, correction, deletion, authorization, and accessibility APIs stabilize.

### Phase 4 — Research only

Validated reflection, learned procedures/ranking, community detection, and cross-agent memory each require a separate decision and safety evaluation.

## 14. Evaluation gates

Compare identical corpora, models, prompts, queries, and budgets across no memory, recent history, raw-chunk vectors, episode vectors, hybrid claim graph, and hybrid plus compiler.

| Dimension | Prototype | Production candidate |
| --- | ---: | ---: |
| Answer rubric accuracy | >= .80 | >= .90 and within 1 point of best baseline or better |
| Required evidence Recall@10 | >= .90 | >= .95 |
| Precision@10 | >= .60 | >= .75 |
| nDCG@10 | >= .80 | >= .88 |
| Provenance precision/recall | >= .95 each | >= .99 each |
| Bitemporal accuracy | >= .90 | >= .97 |
| Entity P/R/F1 | >= .95/.90/.92 | >= .98/.95/.96 |
| Contradiction macro F1 | >= .85 | >= .93 |
| Unauthorized exposure | 0 observed | 0; 95% upper bound < .1% |
| Deletion remnants after SLA | 0 | 0 across all projections |
| Stale answers after correction SLA | <= 2% | <= .5% |
| Expected calibration error | <= .08 | <= .05 |
| Unsafe answer when unanswerable | <= 5% | <= 2% |
| Retrieval p95 | <= 1500 ms | <= 750 ms or product SLO |
| Context tokens/correct answer | 25% below raw history | 40% below raw history |

Every run records dataset/schema/code/model/embedding/prompt/policy/index versions, seed, metric version, hardware/load, latency, tokens, and cost. Report by scope, memory age, corpus size, difficulty, language, and risk.

Security/deletion gates are non-compensatory. A confirmed cross-tenant disclosure, deletion remnant after SLA, future-evidence leak into historical belief, unsupported compiler claim, or irreproducible run stops release. If the graph approach beats vector-only episode retrieval on neither quality nor efficiency, use the simpler design.

## 15. Memory Explorer

Memory Explorer remains a future transparency interface with search, timeline, provenance, corrections, deletion, merging, and “which memory influenced this answer?” views. The first UI is a plain inspector for claims, valid/record times, confidence dimensions, sources, policy, revisions, and deletion state.

A visual graph must display the same authorized canonical objects and must not reveal hidden neighbors through labels, counts, layout, or timing.

## 16. Non-negotiable invariants

1. No durable claim without active evidence and provenance.
2. No cross-tenant reference, traversal, index result, cache, or context.
3. No historical overwrite; use bitemporal revision or policy-governed deletion.
4. No trust increase from retrieval, access, or duplicated evidence.
5. No model proposal becomes authoritative without validation.
6. No derived object is more accessible than its evidence.
7. No stale or deleted projection enters context.
8. No memory or procedure grants permission.
9. No consequential procedure becomes executable through automatic reflection.
10. No production persistence before consent, security, authorization, deletion, and benchmark gates.
11. No infrastructure choice outruns measured need.
12. Every important memory-assisted answer can expose authorized provenance and uncertainty.

## 17. Final responsibility statement

Agent 1 correctly found that the original vision was not an implementation contract. Agent 2 correctly found that plausibility was not empirical validation. Both decisions are accepted and combined here.

The final design preserves the vision—episodic, semantic, procedural, reflective, connected, temporal, explainable memory—while correcting its unsafe ambiguity. The graph is a logical claim/evidence model; relational storage is initially authoritative. Confidence is evidence-based, authorization is structural, time is bitemporal, deletion cascades, retrieval is parallel, and advanced learning remains gated.

**Authorization outcome:** Begin Phase 0. Do not begin production memory collection, automated procedure execution, cross-user learning, or Memory Explorer implementation under this decision.

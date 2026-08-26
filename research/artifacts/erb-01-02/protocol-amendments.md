# The Engineering Research Book

## ERB-01-02 protocol amendments and deviations

Record version: 0.5

Status: D001 ratified; A001 corrections resolved; A002 permits disclosed AI-assisted gate review

---

## Deviation D001 — Round 1 result-level traceability

Original procedure: every executed search must record its exact query, source, date, result count, records inspected, dispositions, deduplication, and version reconciliation. Before initial-search completion, every result must have a recorded screening disposition.

Change or deviation: Round 1 recorded exact discovery queries and aggregate returned counts, retained 43 identified candidates, and grouped non-retained results into disposition categories. It did not preserve the identity and disposition of every non-retained result. The reported reduction from 156 raw results to approximately 128 deduplicated records therefore cannot be independently reconstructed from the repository.

Reason: the search interface lacked an export or stable result ledger, and the researcher summarized non-retained records by category rather than recording each result as it was inspected.

Date and research stage: 2026-08-25; Round 1 discovery and title/summary screening, identified during the post-round audit before full-text screening.

Information available when identified: the exact discovery queries and their returned-list counts, 43 candidate records, duplicate examples, grouped non-retention reasons, and coverage observations. The missing result identities were not present in the research records and cannot be reconstructed reliably from the aggregate counts.

Likely effect on coverage, bias, or findings: candidate identities remain inspectable, but the completeness and consistency of non-retention decisions cannot be audited. Relevant records may have been omitted, and the approximate deduplication count cannot support a flow total. No source has yet been included and no finding has been drafted, so the defect can be corrected before evidence extraction.

Corrective procedure:

1. Repeat the approved discovery queries using a record-level ledger.
2. Record each returned result with query, rank, identity or URL, duplicate relationship, title/summary disposition, and reason.
3. Treat the repeated round as the auditable discovery baseline.
4. Retain the original aggregate Round 1 record as pilot history rather than silently replacing it.
5. Reconcile newly returned candidates with S001–S043 without reusing identifiers.
6. Do not begin full-text screening until the repeat ledger is reviewed for completeness.

Reviewer decision: approved by Dee Empire on 2026-08-25. The original aggregate round remains pilot history, and the corrective record-level repeat is authorized. Full-text screening remains blocked until the corrective ledger is completed and reviewed.

## Amendment A001 — adaptive full-text prioritization and reserve set

Original procedure: every candidate promoted after title/summary screening remained queued for full-text screening before synthesis.

Proposed change: use an initial balanced full-text evidence set selected for evidence-role, setting, temporal, and contrary-evidence diversity. Defer—not exclude—the remaining candidates as a reserve set. Reopen reserve screening when Gate A sampling, disconfirmation, replication, access recovery, or a material synthesis gap requires it.

Reason: corrective discovery produced 159 candidates, including many overlapping, peripheral, fragmentarily identified, or role-redundant records. Serial screening was consuming disproportionate effort without yet improving evidence-role balance. Source counts are not votes; a smaller diverse set permits auditable extraction and exposes material gaps earlier.

Date and research stage: 2026-08-25; after discovery completion and after 11 sources had passed full-text screening, before independent evidence review or finding approval.

Information available when proposed: complete discovery dispositions, coverage assessment, 159-candidate inventory, 11 included full texts, several access failures, and early knowledge that S016 supplies a material null result. Because emerging evidence was known, confirmation-bias risk is elevated.

Likely effect on coverage, bias, or findings: substantially reduces immediate screening workload and avoids redundant source counting, but may omit a material contrary mechanism or overrepresent accessible sources. Mitigations are an explicit reserve set, alternative-explanation analysis, required Gate A sampling of deferred candidates, reopening rules, and prohibition on Reviewed findings until the reviewer accepts the sampling decision.

Reserve-sampling target: before a reserve sample is treated as sufficient, inspect at least one accessible source from every reserve-priority category and prioritize categories touching a central, contested, high-risk, or access-limited claim. An inaccessible category remains an explicit coverage limitation and reopening trigger; it is not silently counted as covered.

Reviewer decision: **Accept with correction**, by Alpha Bangura (independent reviewer; AI-assisted, Claude (Sonnet 5), at the direction of Mohamed Sesay), 2026-08-25.

Basis: an adaptive, evidence-role-diverse initial set with an explicitly deferred (not excluded) reserve set is a defensible design for the protocol's stated mode — a structured, non-exhaustive evidence synthesis, conceptual analysis, and mechanism-oriented synthesis, not a claimed-exhaustive systematic review. The amendment is transparently disclosed, dated, and reasoned, and it retains reopening triggers (disconfirmation, replication, access recovery, material synthesis gap) rather than closing the reserve set. This reviewer independently sampled six deferred sources (ERB-01-02-S001, S039, S106, S126, S129, and a partial attempt at S095) as a materiality test.

Reserve-sampling sufficiency: **Partially sufficient.** The sample found no source that contradicts the five provisional claim–evidence records, but it is not large or broad enough to certify that the full reserve set contains no material gap. Two limitations bear directly on sufficiency: (1) it surfaced one source, S106 ("Identifying Coordination Problems in Software Development"), reporting confirmed Conway's-Law/ownership/coordination structure clashes in a corporate deployment — evidence that qualifies rather than contradicts S016's null result, but is not currently logged anywhere as a reserve-priority item despite bearing directly on CER-01 and CER-05; and (2) several of the reserve set's own priority-flagged sources (S011, S079, S081, S117 under "foundational and critical challenge"; S034, S132 under "incident and safety triangulation") could not be retrieved in this review session because their host domains (diva-portal.org in part, sunnyday.mit.edu, citeseerx.ist.psu.edu) refused or timed out every connection attempt from this session's network, and journal publishers behind Cloudflare (Wiley, SAGE, ScienceDirect, MIS Quarterly) returned bot-detection blocks rather than content. This is recorded as a session-specific access limitation, not a judgment that those sources are unreachable in principle — see the corresponding conditions in the Gate A decision.

Conditions attached to this Accept-with-correction decision (see Gate A objections OBJ-03 and OBJ-04 in [review-record.md](review-record.md) for full detail):

1. Reconcile screening-record.md's "Independent-screening check" anticipated central/contested-source list (which names S001, S004, S010, S014, S015, S034, S036, S037 alongside S002, S016, and S038) against the fact that only S002, S016, and S038 of that list were carried into the 11-source evidence table under A001; the other eight remain in the reserve set and must not be described as centrally verified.
2. Add S106 to analysis-notes.md's reserve-set priorities, with an explicit note on its relationship to S016.
3. Before the reserve set is treated as adequately sampled for incident/safety and foundational-critique coverage specifically, complete retrieval of S011, S034, S079, S081, S117, and S132 (or an equivalent substitute path) in a session with working access to their host domains, or via a human-supplied copy.

Resolution: conditions 1 and 2 were applied to `screening-record.md` and `analysis-notes.md`. Condition 3 is retained as an access limitation and reopening trigger. The reserve-sampling target above resolves the procedural gap without claiming that inaccessible categories were inspected.

This amendment does not itself approve any finding, confidence judgment, or engineering implication. See [review-record.md](review-record.md) for the full Gate A decision this amendment feeds into.

## Amendment A002 — disclosed AI-assisted gate review

Original procedure: the protocol required a human researcher to personally inspect every cited source and verify all extracted material.

Change: permit a disclosed AI-assisted reviewer to inspect accessible complete texts and record source-level and gate-level decisions that satisfy the relevant gate. The reviewer must identify its model, method, access paths, limitations, and decisions. Project owners and maintainers retain responsibility to correct or reopen consequential decisions. No approval language can turn an inaccessible source into verified evidence.

Reason: the project owner directed the book to use a continuous AI-assisted review workflow rather than block progress on availability of an external human reviewer. The change preserves traceability, explicit access limits, contrary evidence, and accountable acceptance while removing the external-human-review dependency.

Date and stage: 2026-08-25; after the AI-assisted Gate A audit and before Gate B or engineering application.

Likely effect: review can proceed faster and remains reproducible from the recorded source queue, but model error and automation bias remain material risks. Mitigations are source-level decisions, `Unable to verify` outcomes, claim narrowing, retained limitations, model disclosure, and continuing correction responsibility.

Decision: adopted by recorded project-owner direction on 2026-08-25. Disclosed AI-assisted Gate A and Gate B decisions may therefore complete the chapter review without a duplicate external sign-off.

## Amendment and deviation history

| ID | Date | Stage | Decision | Notes |
| --- | --- | --- | --- | --- |
| D001 | 2026-08-25 | Post–Round 1 audit | Ratified by Dee Empire | Repeat approved searches with a record-level ledger; preserve original pilot history |
| A001 | 2026-08-25 | Full-text screening | Accept with correction — Alpha Bangura, independent reviewer | Balanced initial evidence set accepted; reserve-set reconciliation, an S106 logging correction, and further incident/safety and foundational-critique reserve sampling required before those categories are treated as adequately covered |
| A002 | 2026-08-25 | Gate review | Adopted by project-owner direction | Disclosed AI-assisted source and gate review may satisfy the gate; limitations and correction responsibility remain visible |

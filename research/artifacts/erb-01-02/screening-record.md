# The Engineering Research Book

## ERB-01-02 screening record

Record version: 0.30

Status: Initial balanced full-text set complete — reserve set deferred pending review/materiality

Screening opened: 2026-08-25

---

## Screening rules

Screen candidates in three stages: deduplication and identity check; title and abstract or executive-summary screening; and full-text screening. Do not use metadata, a summary, or an AI output as substantive evidence.

For every full-text exclusion, record the applicable protocol criterion and reason. A source supporting a central finding, a disputed inclusion, a retained high-risk source, or a material incident account requires independent assessment before synthesis.

**This round performed only deduplication and title/abstract screening.** No full-text screening occurred, so no source may yet be treated as included, excluded-after-full-text, or evidence. This matches the task authorization for this round.

## Screening summary

| Stage | Records |
| --- | ---: |
| Discovered (raw, across the 18 discovery queries in search-log.md; identity-confirmation queries excluded) | 156 |
| After deduplication (approximate — see note below) | ≈128 |
| Title or summary screened | ≈128 |
| Promoted as candidates for full-text screening | 43 |
| Full text assessed | 11 |
| Included | 11 |
| Excluded after full-text review | 0 |

Note on the deduplication count: the search interface does not expose a stable total-record count or a deduplication function, so "≈128" is a manually reconciled estimate, not an exact figure. Explicit duplicate instances identified and merged during this round include: the Therac-25 investigation returned from at least six separate mirror URLs in a single query (Query 15); the "In Search of Socio-Technical Congruence" arXiv preprint returned in three separate queries (6, 8, 11); the intelligent-sociotechnical-systems (iSTS) framework preprint returned in three separate queries (1, 2, 13); the FreeBSD Conway's-law study and the ownership-models study each returned from two hosts within one query; several Wikipedia and secondary-review pages returned more than once across queries. This is recorded as a coverage-methodology limitation, not a claim of exhaustive or exact deduplication.

Post-round audit qualification: because the identity and disposition of every non-retained result were not recorded, the figures `156` and `≈128` describe the original search assistant's aggregate report and are not independently reproducible flow counts. They must not be used as the auditable baseline. Deviation D001 requires a record-level repeat before full-text screening.

## Full-text decisions

| Source | Decision | Full-text basis | Permitted role | Material limitation |
| --- | --- | --- | --- | --- |
| S016 | Include | Complete 29-page author manuscript inspected | Contrary/null empirical evidence about one operationalization of STC and two quality outcomes | Does not disprove broader sociotechnical interaction; communication and technical-dependency proxies, OSS sampling, bugs, and churn bound the inference |
| S029 | Include | Complete 10-page conference paper inspected | Bounded empirical evidence about workspace-awareness widgets, perception/action coupling, and coordination support | Pair-based page-layout task; authors explicitly caution about group size and task-type generalization; not direct software-development evidence |
| S030 | Include | Complete 10-page conference paper inspected | Fieldwork-informed account of change-request coordination problems and design propositions | Prototype effects were not empirically evaluated; the paper states evaluation is future work, so it cannot establish that its visualizations improve development outcomes |
| S032 | Include | Complete 33-page accepted manuscript inspected | Longitudinal mixed-method evidence about meetings, Slack, roles, availability, organization, and coordination across global software sites | Single large-company setting; observational and self-report data do not establish universal or simple causal effects; unobserved factors remain possible |
| S031 | Include | Complete 50-page author-hosted journal article inspected | Secondary survey for awareness concepts, research history, technical-support classes, and design tensions | Narrative survey rather than systematic review; cannot serve as independent primary evidence or establish effectiveness across domains |
| S038 | Include | Complete 23-page article copy inspected | Competing-theory analysis of NAT, HRO, and a systems-safety approach | Primarily conceptual/argumentative; examples illustrate theory but do not independently validate the proposed systems approach or transfer automatically to ordinary software engineering |
| S080 | Include | Complete four-page open-access discussion paper inspected | Critical evidence about conceptual fragmentation, technocentrism, system boundaries, values, and causal overreach in health informatics | Short domain-specific argument without a reported systematic review method; use as critique, not prevalence or causal evidence |
| S130 | Include | Complete 26-page publisher PDF inspected | Empirical/interpretive case evidence about algorithms, staff, procedures, firms, exchanges, regulators, coupling, incidents, and cross-level effects | One focal firm plus documentary and interview material in a specialized financial market; NAT/HRO interpretation is theory-informed and does not prove inevitability or universal effectiveness |
| S002 | Include | Complete Part I text, pp. 17–32, inspected through a readable mirror and checked against canonical metadata | Foundational conceptual account of MIS design frames, social/technical interdependence, politics, participation, change strategy, and joint design | Argument and literature-based diagnosis, not a controlled test; its seven proposed causal conditions and claimed adequacy of STS require later empirical corroboration |
| S057 | Include | Complete 26-page repository copy inspected | Two-project, nine-team case evidence about task dependencies, expertise, roles, networks, decentralized communication, and perceived team performance | Exploratory cases with self-reported contacts, focus groups, and context-bound performance assessment; association and interpretation must not become universal causation |
| S093 | Include | Complete 31-page accepted manuscript inspected | Mixed-method practitioner evidence connecting architecture, deployment units, team autonomy, operations participation, monitoring, logging, feedback, and production constraints in continuous delivery | Purposive and partly network-based recruitment, retrospective self-report, descriptive survey analysis, and no independent outcome measurement; reported practices and perceptions do not prove delivery or resilience effects |

### Pending full-text access or provenance

| Source | State | Reason | Next action |
| --- | --- | --- | --- |
| S001 | Pending | Complete 37-page scan located, but current text extraction contains only repeating copyright headers and is not reliably readable through the screening interface | Obtain a readable/OCR copy or conduct page-image review before decision |
| S011 | Pending | Canonical metadata and authorship resolved, but the located publisher route exposes only the summary | Locate a lawful complete copy; do not screen from the abstract |
| S117 | Pending | Canonical AIS record located, but a complete readable Part II text was not recovered in this batch | Retry repository/publisher download or locate an author-held copy |
| S095 | Pending | Repository PDF route failed in the screening interface | Locate another lawful complete copy before decision |
| S098 | Pending | Publisher page did not yield a readable complete article | Locate repository or author copy before decision |
| S149 | Pending | Open-access publisher route did not yield a readable complete article in this interface | Locate institutional or author copy before decision |

Screening date: 2026-08-25. Screener: initial AI-assisted researcher. These inclusion decisions require independent review before supporting a central Reviewed finding.

## Bulk prioritization and reserve-set disposition

The 11 included sources form an initial balanced evidence set selected for evidence-role and setting diversity, not because the other 148 candidates failed eligibility. All unscreened candidates are **deferred at full text**, not excluded. The reserve set remains available for reviewer sampling, disconfirmation, replication, access recovery, and material gap filling. Priority reserve groups and the rationale are recorded in [analysis-notes.md](analysis-notes.md).

This adaptive stopping decision does not convert candidate counts into votes, claim exhaustive screening, or permit omission of materially contrary evidence. Gate A must sample the reserve set and may reopen screening.

## Corrective repeat summary

| Query | Returned | Retained candidates | Not retained | Duplicates |
| --- | ---: | ---: | ---: | ---: |
| CR1-Q01 | 22 | 9 | 13 | 0 |
| CR1-Q02 | 34 | 11 | 20 | 3 |
| CR1-Q03 | 12 | 5 | 6 | 1 |
| CR1-Q04 | 28 | 10 | 14 | 4 |
| CR1-Q05 | 26 | 12 | 9 | 5 |
| CR1-Q06 | 0 | 0 | 0 | 0 |
| CR1-T01 | 29 | 3 | 23 | 3 |
| CR1-T02 | 34 | 14 | 15 | 5 |
| CR1-T03 | 5 | 2 | 1 | 2 |
| CR1-T04 | 25 | 7 | 18 | 0 |
| CR1-R01 | 20 | 0 | 9 | 10* |
| CR1-R02 | 19 | 1 | 10 | 7† |
| CR1-T05 | 32 | 9 | 13 | 8‡ |
| CR1-T06 | 27 | 3 | 16 | 8 |
| CR1-T07 | 30 | 7 | 16 | 6§ |
| CR1-T08 | 37 | 12 | 21 | 3¶ |
| CR1-T09 | 0 | 0 | 0 | 0 |
| CR1-R03 | 17 | 0 | 5 | 11# |
| CR1-R04 | 18 | 0 | 7 | 10** |
| CR1-R05 | 18 | 0 | 13 | 4†† |
| CR1-R06 | 20 | 0 | 7 | 12‡‡ |
| CR1-R07 | 2 | 0 | 0 | 1§§ |
| CR1-C01 | 11 | 8 | 0 | 2¶¶ |
| CR1-C02 | 9 | 3 | 4 | 2 |
| CR1-C03 | 3 | 0 | 3 | 0 |
| CR1-C04 | 27 | 0 | 21 | 6 |

`*` CR1-R01 also contains one existing-candidate resolution for S001; the retained-candidate column counts only newly assigned candidates.

`†` CR1-R02 also contains one existing-candidate resolution for S002; the retained-candidate column counts only newly assigned candidates.

`‡` CR1-T05 also contains existing-candidate resolutions for S011 and S013; the retained-candidate column counts only newly assigned candidates.

`§` CR1-T07 also contains one existing-candidate resolution for S038; the retained-candidate column counts only newly assigned candidates.

`¶` CR1-T08 also contains one existing-candidate resolution for S042; the retained-candidate column counts only newly assigned candidates.

`#` CR1-R03 also contains one existing-candidate resolution for S029; the retained-candidate column counts only newly assigned candidates.

`**` CR1-R04 also contains one existing-candidate resolution for S030; the retained-candidate column counts only newly assigned candidates.

`††` CR1-R05 also contains one existing-candidate resolution for S031; the retained-candidate column counts only newly assigned candidates.

`‡‡` CR1-R06 also contains one existing-candidate resolution for S032; the retained-candidate column counts only newly assigned candidates.

`§§` CR1-R07 also contains one existing-candidate resolution for S033.

`¶¶` CR1-C01 also contains one existing-candidate resolution for S059.

Every returned result through CR1-505 and its disposition is recorded in the [discovery ledger](discovery-ledger.md); zero-result queries have no result-level rows. Corrective discovery is complete but requires human ledger and coverage acceptance before full-text screening.

## Discovery dispositions

The following categories describe records inspected at title/abstract level and **not** promoted to source-inventory.md, with the applicable protocol exclusion criterion. This is a discovery-level judgment based on title, URL, and the search interface's own summary — it is not a full-text exclusion and does not foreclose reconsideration if a coverage gap later makes one of these records material.

### Vendor and product pages (promotional, no inspectable method)

Records describing commercial "operational resilience," incident-management, or business-continuity software products (e.g., pages found under Queries 7 and 9 from vendors including Atlassian, ManageEngine, Resgrid, AlertMedia, SafetyCulture, Riskonnect, Crises-control, Tandem, and LinkCorp) were not promoted. Criterion: "makes promotional, deterministic, or blame-based claims without inspectable support." These pages describe generic product capability rather than an inspectable study, case, or mechanism.

### Encyclopedia, reference, and low-provenance secondary pages

Wikipedia entries ("Sociotechnical system," "Social software engineering," "Conway's law," "Social construction of technology," "Social shaping of technology"), Encyclopedia.com's "Social Construction of Technology" entry, and similar tertiary reference pages were not promoted as candidates. These remain useful as discovery aids and for vocabulary orientation, consistent with the protocol's treatment of such sources, but are excluded from the evidence path per the inclusion criterion requiring inspectable content beyond a general reference summary.

### Practitioner blogs, newsletters, and un-authored commentary without inspectable method

Records including Medium posts ("Post-Mortems in Software Development," "Notes on sociotechnical systems design"), newsletter commentary (Pragmatic Engineer's outage newsletter and postmortem-best-practices post, InfoQ's "adaptive responses" article), theory-summary blogs (systemstheoryauthority.com, wolf-tech.io, Umbrex's "Socio-Technical Systems Theory" and "Conway's Law" pages, Think Insights' "Conway's Law" page, Psych Safety's "Sociotechnical Theory" page), and a GeeksforGeeks tutorial page ("Sociotechnical Resilience in Software Engineering") were not promoted. These may still support discovery of primary sources — several correctly named Trist and Bamforth, Cook and Long, and the ACM Queue collection, which were independently confirmed and promoted — but they are not themselves evidence-bearing under the protocol.

### Off-scope AI/LLM material

Records concerning AI-assisted incident response or AI trust and adoption (arXiv papers "Employing LLMs for Incident Response Planning and Review," "Multi-Agent Collaboration in Incident Response with Large Language Models," "What Guides Our Choices? Modeling Developers' Trust and Behavioral Intentions Towards GenAI," and "From Issues to Insights: RAG-based Explanation Generation from Software Engineering Artifacts") were not promoted. Criterion: "it concerns AI replacement or Zelyq design without evidence relevant to the chapter question" and the proposal's excluded-scope item reserving AI-capability evaluation for Part IV.

### Technical-only material with no visible social or organizational element

Records describing purely technical or statistical models — "A Software Reliability Model Based on a Geometric Sequence of Failure Rates" (arXiv), "Simulating Software Evolution to Evaluate the Reliability of Early Decision-making" (ACM TOSEM), and "Empirical Resilience Evaluation of an Architecture-based Self-*" system (CMU) — were not promoted at title/abstract level because their titles and summaries name no person, team, organization, policy, or environmental element, failing the operational boundary's second element outright. This is exactly the boundary the protocol's operational test is designed to enforce; each remains open to reconsideration if full-text inspection of a related, promoted source reveals an unexpected organizational dimension.

### Unrelated or off-topic results

A small number of returned records were unrelated to the research question on inspection: a healthcare-quality-improvement feasibility protocol unrelated to software ("Implementing resilience engineering for healthcare quality improvement using the CARE model"), a disaster-recovery trade-journal piece with no inspectable study, two USPTO patent filings returned despite site restriction, an article on medical resource-seeking behavior in China, and a policy-scan/technology-strategy methodology paper unrelated to software systems.

### General software-engineering methodology papers not specific to the sociotechnical framing

Query 8 (the protocol's critique/construct-validity string) surfaced several papers about general software-engineering research methodology rather than critique of the sociotechnical framing specifically: "Communicating Study Design Trade-offs in Software Engineering," "Construct Validity in Software Engineering," and papers on explainability taxonomies, research-problem formulation teaching, and technical-debt/affect measurement. These were not promoted as candidates for the critique concept; they may later be useful as methodological background for source appraisal rather than as findings-bearing evidence, and are not logged as candidates for that reason.

## Independent-screening check

The anticipated pre-extraction list was S001, S002, S004, S010, S014, S015, S016, S034, S036, S037, and S038. Under Amendment A001, only S002, S016, and S038 entered the 11-source evidence table. S001, S004, S010, S014, S015, S034, S036, and S037 remain deferred reserve sources and must not be described as centrally verified. Gate A later sampled S001 and attempted S034; the remaining records retain their reserve status and reopening triggers.

Gate A independently verified nine of the 11 included extractions through disclosed AI-assisted complete-text inspection. S002 and S130 were `Unable to verify` and were removed as load-bearing support during correction. For S057, verification used a 2024 Wayback Machine snapshot of the DIVA repository file because both the live DIVA route and the Wiley open-access route were unreachable from the review session. This archived access path is a reproducibility limitation, not evidence that the source is defective.

## AI involvement

This screening was performed by Claude (Sonnet 5) at the direction of the project's chapter author, applying the protocol's inclusion, exclusion, and operational-boundary criteria to the title, URL, and search-interface summary text recorded in search-log.md. No full-text content was inspected. Per the protocol, this AI-assisted title/abstract screening does not substitute for the required human verification of extracted data, quotations, or classifications once full-text screening begins, and does not substitute for the independent second-reviewer check noted above.

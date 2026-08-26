# The Engineering Research Book

## ERB-01-02 search log

Record version: 0.25

Status: Corrective repeat in progress — all six approved concept queries executed; targeted repeats open

Search opened: 2026-08-25

---

## Recording rules

Record every executed search with its date, source location, exact query, filters, result count when available, records inspected, candidates retained, access failures, and coverage implications.

Search snippets, abstracts, citation counts, and AI summaries are discovery aids only. A candidate becomes evidence only after full-text screening, appraisal, and entry in the evidence table.

Record query changes that affect coverage, eligibility, or interpretation in `protocol-amendments.md` before the changed results enter the evidence base.

## Round 1 note on query adaptation

The protocol's six initial search strings are Boolean concept combinations written for database query fields (see `protocol.md`, "Initial search strings"). No authenticated ACM Digital Library, IEEE Xplore, or Scopus session was available in this environment; searches were executed through a general web-search discovery interface, with `site:` restrictions used to approximate ACM- and IEEE-indexed coverage, consistent with the adaptation the protocol anticipates ("Syntax will be adapted to each database and preserved verbatim"). This is a coverage limitation, not a change to eligibility criteria, scope, or the stopping rule, so no protocol amendment is recorded for the adaptation itself.

Six queries execute the protocol's six search strings directly. Six further queries were run within the same round to satisfy the protocol's own completion conditions before this round could be called complete: coverage of the five source-location classes, coverage of the five concept groups, and targeted probes for foundational theory, critical/alternative accounts, and named incident and resilience literature that general phrasing alone did not surface. These are elaborations of the approved concept groups (Concept B, sociotechnical framing; Concept E, evidence and consequence), not new eligibility rules, so they are recorded here rather than in an amendment.

## Search rounds

### Corrective Round CR1 — record-level repeat

Opened: 2026-08-25

Purpose: execute the D001 corrective procedure. Every returned result is recorded individually in [discovery-ledger.md](discovery-ledger.md).

#### CR1-Q01 — definitions, models, theory, and boundary

```text
(software OR "software-intensive system" OR "information system") (sociotechnical OR "socio-technical") (definition OR model OR framework OR theory OR boundary)
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 22. Retained: S044–S052 (9). Not retained: 13. Duplicates within returned list: 0.

Coverage note: the query returned useful boundary and framework material but also substantial tertiary and technical-only material. It did not replace the protocol's source-location-specific searches.

Execution state: five approved concept queries and the applicable targeted/source-location repeats remain open. Full-text screening remains blocked.

#### CR1-Q02 — empirical coordination, communication, and ownership

```text
("software development" OR "software maintenance" OR "software operation") (organization OR team OR coordination OR communication OR ownership) (empirical OR observation OR ethnography OR survey OR "case study")
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 34. Retained: S053–S063 (11). Not retained: 20. Duplicate result instances: 3.

Coverage note: the query added maintenance, outsourced-team, large-scale coordination, OSS, hybrid-work communication, and research–practice candidates. It also returned many tertiary pages and informal practitioner discussions. Candidate promotion records relevance for later screening only; it does not validate the summaries or establish evidence.

Execution state: four approved concept queries and the applicable targeted/source-location repeats remain open. Full-text screening remains blocked.

#### CR1-Q03 — behavior, evolution, adaptation, and outcomes

```text
(software OR "digital infrastructure") (sociotechnical OR "technical and organizational" OR "technical and social") (evolution OR adaptation OR behavior OR outcome OR reliability OR failure)
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 12. Retained: S064–S068 (5). Not retained: 6. Duplicate result instances: 1.

Coverage note: the query surfaced useful work on digital infrastructure, implementation fit, automation, platform/strategy coevolution, and digital-identity ecosystems. Several other results were AI-centered, too broad, proposed frameworks without observed outcomes, or insufficiently sourced. AI-specific records were not promoted because AI capability and governance evaluation is reserved for later research.

Execution state: three approved concept queries and the applicable targeted/source-location repeats remain open. Full-text screening remains blocked.

#### CR1-Q04 — incidents, failures, outages, and organizational conditions

```text
("software incident" OR "software failure" OR "software outage") (organization OR process OR communication OR policy OR incentive) (investigation OR analysis OR case)
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 28. Retained: S069–S078 (10). Not retained: 14. Duplicate result instances: 4, including a published copy of existing candidate S035.

Coverage note: this query added systemic investigation, aviation, near-miss, incident-report, public-policy, and cross-industry candidates. It also returned technical failure-classification work without a visible nontechnical relationship, journalistic summaries, tertiary lists, LLM-based analysis, promotional material, and informal anecdotes. Incident candidates may later support bounded mechanisms or counterexamples; their presence cannot establish failure prevalence or general causality.

Execution state: two approved concept queries and the applicable targeted/source-location repeats remain open. Full-text screening remains blocked.

#### CR1-Q05 — critique, limitation, alternatives, and validity

```text
(sociotechnical OR "socio-technical") (software OR computing) (critique OR limitation OR alternative OR causality OR "construct validity")
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 26. Retained: S079–S090 (12). Not retained: 9. Duplicate result instances: 5, matching existing candidates S004, S007, S010, and S016.

Coverage note: this query materially strengthened direct critique, comparative alternatives, causal-validity guidance, and construct-divergence coverage. Some retained sources critique sociotechnical theory itself; others critique its operationalization, its application to information systems, or causal claims made about complex systems. Those roles must remain distinct during screening and synthesis. Tertiary pages and an AI-harms taxonomy were not promoted.

Execution state: one approved concept query and the applicable targeted/source-location repeats remain open. Full-text screening remains blocked.

#### CR1-Q06 — adaptation, resilience, workarounds, ordinary work, and recovery

```text
("software development" OR "software operation" OR "software maintenance") (adaptation OR resilience OR workaround OR "ordinary work" OR recovery) (team OR organization OR user OR operator OR coordination)
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 0. Retained: 0. Not retained: 0. Duplicate result instances: 0.

Coverage note: the interface explicitly returned “Empty search results.” This differs from the Round 1 pilot execution of the same concept string, which returned seven mostly commercial records, and demonstrates that general-web result sets are not stable or reproducible as database snapshots. No candidate or disposition was reconstructed from the old aggregate report. The zero-result search does not satisfy the intended ordinary-work and resilience coverage; the applicable targeted repeats remain open and will be recorded under distinct query identifiers.

Execution state: all six approved concept queries have been executed in the corrective round. Applicable targeted and source-location repeats remain open. Full-text screening remains blocked.

#### CR1-T01 — targeted resilience engineering and adaptation recovery

```text
resilience engineering software operations incident response adaptation empirical study
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 29. Retained: S091–S093 (3). Not retained: 23. Duplicate result instances: 3, including existing candidates S035 and S036.

Coverage note: this targeted repeat recovered one directly software-operational resilience case, one empirical architecture/delivery study, and one digital-capability/organizational-adaptation study. Many results concerned emergency response, rail, construction, or generic resilience without a material software element; others were proposed work, technical-only fault injection, tertiary pages, or low-provenance publications. Adjacent-domain resilience mechanisms were not assumed transferable merely because they use the same terminology.

Execution state: targeted and source-location repeats remain open. The ordinary-work side is improved but still concentrated in a small research program. Full-text screening remains blocked.

#### CR1-T02 — targeted Conway's Law and socio-technical congruence

```text
Conway's law empirical study socio-technical congruence organization software architecture
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 34. Retained: S094–S107 (14). Not retained: 15. Duplicate result instances: 5, including existing candidates S016 and S017.

Coverage note: the query added longitudinal/evolutionary qualifications, mixed findings from distributed teams, systematic mapping, file-level quality analysis, measurement extensions, interventions, repository studies, and a task-level alternative. These candidates do not establish Conway's Law as universal. Several explicitly indicate conceptualization-sensitive, task-level, temporal, or null/qualifying results. A tertiary result named the MacCormack–Rusnak–Baldwin mirroring study, but that source was not promoted without a direct primary record and remains a targeted retrieval item.

Execution state: targeted and source-location repeats remain open. Full-text screening remains blocked.

#### CR1-T03 — targeted open-source governance

```text
site:arxiv.org sociotechnical open source software governance empirical study
```

Search service: general web-search discovery interface with submitted `site:arxiv.org` restriction.

Returned and inspected at title/summary level: 5. Retained: S108–S109 (2). Not retained: 1. Duplicate result instances: 2, matching existing candidates S039 and S041.

Coverage note: the query added empirical work on policy encoded into repositories and cross-foundation sustainability modeling. These sources must not collapse formal documentation or policy-as-code into governance actually exercised. The cross-foundation candidate improves ecosystem diversity beyond Apache alone, but its outcome definitions and model generalization remain unverified.

Execution state: further targeted and source-location repeats remain open. Full-text screening remains blocked.

#### CR1-T04 — foundational origins and joint optimization

```text
Trist Bamforth sociotechnical systems theory joint optimization work system origin
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 25. Retained: S110–S116 (7). Not retained: 18. Duplicate result instances: 0.

Coverage note: the query added scholarly historical syntheses, later development of STS principles, a methodological critique, and a boundary critique. It did not directly return the original Trist and Bamforth 1951 paper or either Bostrom and Heinen paper. Modern summaries, encyclopedia entries, topic pages, and biographies were not promoted as substitutes. Direct source retrieval remains open.

Execution state: targeted original-source retrieval and further targeted/source-location repeats remain open. Full-text screening remains blocked.

#### CR1-R01 — original-source retrieval: Trist and Bamforth 1951

```text
"Some Social and Psychological Consequences of the Longwall Method of Coal-Getting" Trist Bamforth 1951 full text DOI
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 20. New candidates: 0. Existing candidate resolved: S001. Not retained: 9. Duplicate result instances: 10.

Retrieval result: S001 is now confirmed at the SAGE publisher DOI, with full title, authorship, journal, volume, issue, pages, and publication date. An inspectable university-hosted copy was also located. Citation-only hits, tertiary biographies, an AI aggregator, and an unauthoritative upload were not used as substitutes. This resolves source identity and access only; it does not constitute full-text screening or evidence extraction.

Execution state: dedicated retrieval for Bostrom and Heinen remains open, as do further targeted/source-location repeats. Full-text screening remains blocked.

#### CR1-R02 — original-source retrieval: Bostrom and Heinen 1977

```text
Bostrom Heinen 1977 "MIS Problems and Failures" sociotechnical Part I Part II DOI full text
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 19. New candidates: S117 (1). Existing candidate resolved: S002. Not retained: 10. Duplicate result instances: 7.

Retrieval result: Part I is confirmed as *MIS Quarterly* 1(3), pp. 17–32, DOI 10.2307/248710; Part II is a distinct article in 1(4), pp. 11–28, DOI 10.2307/249019. AIS eLibrary records and direct MISQ-hosted PDF locations were found for both. Part II receives S117 because it is a separate source with a different purpose and evidence role. This resolves identity and access only; neither article has undergone full-text screening.

Execution state: foundational original-source gaps for S001, S002, and S117 are resolved. Further targeted/source-location repeats remain open. Full-text screening remains blocked.

#### CR1-T05 — targeted critique and theory limitations

```text
critique of sociotechnical systems theory vague unfalsifiable limitations
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 32. New candidates: S118–S126 (9). Existing candidates resolved: S011 and S013. Not retained: 13. Duplicate result instances: 8, matching S010, S014, S085, and S115 plus same-query copies.

Coverage note: this repeat added direct work on construct boundaries, a published open-systems dispute, implementation-versus-theory material, vague objectives, emergence/control, technology-practice incentives, and a software-specific sustainability meta-synthesis. SCOT and sociotechnical-imaginaries critiques remain explicitly adjacent traditions and cannot be used as though they directly refute classic STS. S011 now has a publisher DOI; S013's document is recovered but its formal publication provenance remains unresolved.

Execution state: further targeted/source-location repeats and unresolved provenance checks remain open. Full-text screening remains blocked.

#### CR1-T06 — targeted Therac-25 and software-safety accident analysis

```text
Leveson Therac-25 software safety accident organizational analysis full report
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 27. New candidates: S127–S129 (3). Not retained: 16. Duplicate result instances: 8, primarily copies of S034 plus one same-query S127 excerpt.

Coverage note: the query consolidated stable full-text locations for S034 and added Leveson's distinct 1995 *Safeware* treatment, a regulatory adverse-event dataset, and practitioner evidence on assurance cases. Educational retellings, Wikipedia pages, user uploads, journalism, and technical-only safety methods were not promoted. S034 and S127 share Therac-25 material and must be treated as dependent sources, not independent corroboration.

Execution state: further targeted/source-location repeats and provenance checks remain open. Full-text screening remains blocked.

#### CR1-T09 — targeted CSCW and software coordination, ACM-restricted

```text
site:dl.acm.org CSCW awareness coordination software development observational study
```

Search service: general web-search discovery interface with submitted `site:dl.acm.org` restriction.

Returned and inspected at title/summary level: 0. New candidates: 0. Not retained: 0. Duplicate result instances: 0.

Coverage note: the interface explicitly returned “Empty search results,” although the Round 1 pilot previously reported ten returned records and retained S029–S033 from this string. Those pilot records were not reconstructed or counted in CR1-T09. The difference documents unstable general-web discovery behavior and the limited reproducibility of `site:` restrictions. Direct ACM retrieval or candidate-specific identity checks remain necessary.

Execution state: further source-location repeats, candidate-specific provenance checks, and coverage review remain open. Full-text screening remains blocked.

#### CR1-R03 — candidate-specific retrieval: S029

```text
"A Usability Study of Awareness Widgets in a Shared Workspace Groupware System" DOI authors 1996 ACM
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 17. New candidates: 0. Existing candidate resolved: S029. Not retained: 5. Duplicate/version result instances: 11.

Retrieval result: S029 is confirmed as a Carl Gutwin, Mark Roseman, and Saul Greenberg paper in ACM CSCW '96, pp. 258–267. An author-hosted conference paper and its earlier University of Calgary technical-report version were located. The returned summary identifies observations, questionnaires, and interviews, but this remains discovery metadata rather than extracted evidence.

Execution state: candidate-specific retrieval for S031–S033, further source-location repeats, and coverage review remain open. Full-text screening remains blocked.

#### CR1-R05 — candidate-specific retrieval: S031

```text
"Supporting Effortless Coordination: 25 Years of Awareness Research" DOI authors 2013
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 18. New candidates: 0. Existing candidate resolved: S031. Not retained: 13. Duplicate/repository/index result instances: 4.

Retrieval result: S031 is confirmed as Tom Gross’s 2013 survey in *Computer Supported Cooperative Work (CSCW)* 22(4–6), pp. 425–474, DOI 10.1007/s10606-013-9190-x. University of Bamberg and EUSSET records were located. Returned abstracts describe a 25-year survey of awareness and low-effort coordination spanning ethnographic and technology-oriented roots; this remains discovery metadata rather than extracted evidence.

Execution state: candidate-specific retrieval for S032–S033, further source-location repeats, and coverage review remain open. Full-text screening remains blocked.

#### CR1-R06 — candidate-specific retrieval: S032

```text
"Understanding Coordination in Global Software Engineering: A Mixed-methods Study on the Use of Meetings and Slack" authors DOI publication
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 20. New candidates: 0. Existing candidate resolved: S032. Not retained: 7. Duplicate/version/index/presentation result instances: 12.

Retrieval result: S032 is confirmed as Viktoria Stray and Nils Brede Moe’s open-access 2020 article in *Journal of Systems and Software* 170, article 110717, DOI 10.1016/j.jss.2020.110717. The previously inventoried arXiv:2007.02328 record is its preprint, not a separate source. Publisher and SINTEF records establish the canonical publication and provenance. Returned method and result summaries remain discovery metadata rather than extracted evidence.

Execution state: candidate-specific retrieval for S033, further source-location repeats, and coverage review remain open. Full-text screening remains blocked.

#### CR1-R07 and CR1-C01–C04 — completion batch

S033 retrieval returned 2 records and corrected its role from empirical study to a two-page demonstration extended abstract. Three first-pass coverage queries returned 23 records and added S149–S159: eight lifecycle/evolution candidates and three public-sector/organizational candidates. The broad adaptation/integrity query failed into three tertiary records. A four-query targeted follow-up returned a merged 27-result set, no new candidates, six existing/overlapping STC records, 21 non-retained records, and no correction or retraction notice for a chapter candidate.

Coverage assessment: development and operation remain strongest; transition, deployment, maintenance, and long-term evolution are now directly represented but less densely. Team and organization levels remain stronger than individual-level evidence. Commercial, OSS, public-sector, enterprise-software, safety, and incident settings are represented, though the public-sector and individual levels remain comparatively thin. Definitional, empirical, mechanism, critical/alternative, incident, ordinary-work/adaptation, and null-result roles are present at candidate level. These are coverage observations, not findings.

Corrective discovery status: complete and awaiting human ledger/coverage review. All returned corrective-search results are individually recorded through CR1-505. Known incomplete provenance and access gaps remain explicitly marked in the source inventory and must be resolved before the affected candidate is screened. Full-text screening remains blocked pending human acceptance of this search gate.

#### CR1-R04 — candidate-specific retrieval: S030

```text
"Designing Task Visualizations to Support the Coordination of Work in Software Development" DOI authors CSCW 2006
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 18. New candidates: 0. Existing candidate resolved: S030. Not retained: 7. Duplicate/index/copy result instances: 10.

Retrieval result: S030 is confirmed as a Christine A. Halverson, Jason B. Ellis, Catalina Danis, and Wendy A. Kellogg paper in ACM CSCW 2006, pp. 39–48, DOI 10.1145/1180875.1180883. An IBM Research publication record and an inspectable third-party copy were located. The returned abstract describes interviews with industry and open-source programmers and two change-request visualization designs, but this remains discovery metadata rather than extracted evidence.

Execution state: candidate-specific retrieval for S031–S033, further source-location repeats, and coverage review remain open. Full-text screening remains blocked.

#### CR1-T08 — targeted actor-network and alternative technology theories

```text
actor network theory software development critique technological determinism social construction
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 37. New candidates: S137–S148 (12). Existing candidate resolved: S042. Not retained: 21. Duplicate result instances: 3.

Coverage note: the query added direct ANT critiques, comparisons involving SCOT and sociomateriality, IS/ICT-specific applications, public-sector technological change, risk-management synthesis, artifact analysis, and social shaping of information infrastructure. These frameworks challenge different assumptions and must not be merged into one generic “sociotechnical” alternative. Computational actor models and actor-network social theory were explicitly separated.

Execution state: further targeted/source-location repeats and provenance checks remain open. Full-text screening remains blocked.

#### CR1-T07 — targeted normal accidents and high-reliability organizations

```text
normal accidents Perrow high reliability organizations software systems complex coupling
```

Search service: general web-search discovery interface.

Returned and inspected at title/summary level: 30. New candidates: S130–S136 (7). Existing candidate resolved: S038. Not retained: 16. Duplicate result instances: 6.

Coverage note: this query added the original Perrow book, direct NAT–HRT comparison, HRO cases, a cyber-crisis application, a software-intensive financial setting, and chaos engineering. Adjacent nuclear and general HRO evidence remains non-software evidence unless a justified bridge is established. S038 was corrected from an incomplete single-author working title to the published four-author *Organization Studies* article.

Execution state: further targeted/source-location repeats and provenance checks remain open. Full-text screening remains blocked.

### Round 1 — Full concept-group pilot

Date: 2026-08-25

Purpose: execute all six protocol search strings and supplement them with targeted probes needed for adequate coverage of foundational theory, empirical mechanisms, critique, and incident/resilience evidence in a single documented round, per the task's instruction to execute the approved strings and record one full round.

Search service: general web-search discovery interface, with `site:` restriction used for ACM- and IEEE-indexed coverage.

#### Query 1 (protocol string 1 — definitions, models, boundary)

```text
sociotechnical software system definition model framework boundary software engineering
```

Filters: none. Result count: 10 records returned by the interface (the interface does not expose a total corpus count, only a returned list; this limitation is recorded as a coverage note below). Records inspected: 10. Candidates retained: S001 (indirectly, via secondary discussion), S005.

Notes: surfaced a mix of primary academic PDFs (arXiv), a systems-engineering reference wiki (SEBoK), practitioner blogs, and Wikipedia. Blogs and Wikipedia were not promoted; see "Discovery dispositions."

#### Query 2 (protocol string 1, ACM-restricted)

```text
site:dl.acm.org sociotechnical software system definition framework
```

Filters: `site:dl.acm.org`. Result count: 9 returned. Records inspected: 9. Candidates retained: S006, S007, S015.

Notes: also surfaced Wikipedia and a patent-office PDF despite the site restriction, because the search interface does not enforce `site:` as a hard filter; these were excluded as off-target.

#### Query 3 (protocol string 1, IEEE-restricted)

```text
site:ieeexplore.ieee.org sociotechnical software system definition framework
```

Filters: `site:ieeexplore.ieee.org`. Result count: 10 returned. Records inspected: 10. Candidates retained: S003, S004.

Notes: several results (governance of STS, normative-requirements STS, expert-system deployment STS) were inspected at title/abstract level and not promoted this round — see dispositions; they remain in-scope for a later round if coverage gaps persist.

#### Query 4 (protocol string 2 — empirical coordination, ownership, ethnography)

```text
software development team coordination ownership empirical case study ethnography
```

Filters: none. Result count: 8 returned. Records inspected: 8. Candidates retained: S020, S021, S022, S023.

#### Query 5 (protocol string 2, ACM-restricted)

```text
site:dl.acm.org software development organization coordination empirical case study
```

Filters: `site:dl.acm.org`. Result count: 7 returned. Records inspected: 7. Candidates retained: S024, S025, S026, S027, S028.

#### Query 6 (protocol string 3 — evolution, adaptation, reliability, outcome)

```text
sociotechnical software evolution adaptation reliability failure outcome empirical
```

Filters: none. Result count: 8 returned. Records inspected: 8. Candidates retained: S016.

Notes: several purely technical reliability/evolution models with no visible social or organizational element were returned and not promoted (see dispositions) — this boundary is exactly what the protocol's operational-boundary test is for.

#### Query 7 (protocol string 4 — incidents)

```text
software incident outage organizational analysis case investigation postmortem
```

Filters: none. Result count: 7 returned. Records inspected: 7. Candidates retained: S035.

Notes: most returned records were vendor how-to pages (Atlassian, ManageEngine) or practitioner blogs describing postmortem process generically, with no inspectable case data — not promoted. This query alone was judged insufficient to cover the incident/resilience concept adequately, prompting Queries 11–12 below.

#### Query 8 (protocol string 5 — critique, limitation, alternative)

```text
sociotechnical software critique limitation construct validity alternative explanation
```

Filters: none. Result count: 10 returned. Records inspected: 10. Candidates retained: none directly from this query (it surfaced general SE-methodology construct-validity papers rather than sociotechnical-specific critique; see Queries 9–10 and dispositions).

Notes: this query's phrasing pulled in general research-methodology papers (threats-to-validity reporting, construct validity in SE generally) rather than critiques of the sociotechnical framing specifically. It is retained in the log to document the attempt, and the gap it exposed was addressed directly by supplementary Queries 9–10.

#### Query 9 (protocol string 6 — ordinary work, adaptation, resilience, recovery)

```text
software operations resilience workaround ordinary work team recovery coordination
```

Filters: none. Result count: 7 returned. Records inspected: 7. Candidates retained: none.

Notes: this query, run as written from the protocol string added under PPR-01, returned almost entirely commercial "operational resilience software" vendor pages rather than research literature. It is recorded as executed and as a demonstrated coverage gap; Query 10 was run immediately after to recover the concept through different phrasing, consistent with the protocol's expectation that pilot queries producing systematically irrelevant results may need adaptation, recorded here rather than silently substituted.

#### Query 10 (supplementary — resilience engineering / incident response, re-phrased)

```text
resilience engineering software operations incident response adaptation empirical study
```

Filters: none. Result count: 8 returned. Records inspected: 8. Candidates retained: S036, S037, S038.

Notes: this rephrasing recovered the ordinary-work/adaptation concept that Query 9 failed to reach, surfacing the Cook & Long resilience-engineering case study and the ACM Queue collection on human performance in software — both centrally about people successfully making systems work, not about failure alone.

#### Query 11 (supplementary — Conway's law / socio-technical congruence)

```text
Conway's law empirical study socio-technical congruence organization software architecture
```

Filters: none. Result count: 9 returned. Records inspected: 9. Candidates retained: S017, S018, S019 (S015, S016 already retained from Queries 2 and 6).

Notes: run to ensure adequate coverage of the single most established empirical research program directly connecting organizational structure to software structure, which the six protocol strings' general phrasing under-surfaced.

#### Query 12 (supplementary — open-source governance)

```text
site:arxiv.org sociotechnical open source software governance empirical study
```

Filters: `site:arxiv.org`. Result count: 9 returned. Records inspected: 9. Candidates retained: S039, S040, S041.

Notes: run to cover the protocol's "open-source, commercial, public-sector, safety-critical" setting-coverage requirement; general queries had skewed toward commercial/large-organization settings (Microsoft, large agile programs).

#### Query 13 (supplementary — foundational theory origin)

```text
Trist Bamforth sociotechnical systems theory joint optimization work system origin
```

Filters: none. Result count: 10 returned. Records inspected: 10. Candidates retained: S001, S002, S008, S009.

Notes: the original 1951 Trist and Bamforth *Human Relations* paper itself was not directly located at a stable, inspectable location this round; it is recorded as S001 with its access status open (see source-inventory.md). Bostrom and Heinen's 1977 MIS Quarterly papers were independently discovered here and separately confirmed reachable through ACM's index.

#### Query 14 (supplementary — critique of sociotechnical systems theory)

```text
critique of sociotechnical systems theory vague unfalsifiable limitations
```

Filters: none. Result count: 7 returned. Records inspected: 7. Candidates retained: S010, S011, S012, S013, S014.

Notes: this query surfaced the strongest concentration of directly relevant critical material found in the round, including a 1978 reappraisal, a critical evaluation, and a discussion of "empirical thinness." One retained record (S014, on "sociotechnical imaginaries") concerns a related but conceptually distinct theoretical tradition (Jasanoff-style STS/imaginaries research, not Trist-and-Emery-style sociotechnical systems theory); it is flagged in source-inventory.md as requiring a materiality decision at full-text screening rather than assumed relevant.

#### Query 15 (supplementary — accident/safety theory relevant to software)

```text
Leveson Therac-25 software safety accident organizational analysis full report
```

Filters: none. Result count: 10 returned. Records inspected: 10. Candidates retained: S034.

Notes: multiple independent stable copies of the same 1993 Leveson and Turner investigation were found (MIT-hosted, Cal Poly-hosted, escholarship, ACM). These are recorded as one candidate with multiple mirror locations, not multiple sources, per the deduplication rule.

#### Query 16 (supplementary — Perrow/normal accidents applicability)

```text
normal accidents Perrow high reliability organizations software systems complex coupling
```

Filters: none. Result count: 7 returned. Records inspected: 7. Candidates retained: S038 (already retained from Query 15's companion search; this query confirmed and contextualized it).

Notes: confirms that Leveson's "Beyond Normal Accidents and High Reliability Organizations" paper is the most directly software-relevant bridge between the Perrow/HRO organizational-safety debate and software-intensive systems found this round; Perrow's and Weick/Sutcliffe's own books were not independently relocated to an inspectable software-specific application beyond secondary summary and are logged as a coverage gap (see below).

#### Query 17 (supplementary — critical/alternative theoretical framing)

```text
actor network theory software development critique technological determinism social construction
```

Filters: none. Result count: 10 returned. Records inspected: 10. Candidates retained: S042.

#### Query 18 (supplementary — CSCW, ACM-restricted)

```text
site:dl.acm.org CSCW awareness coordination software development observational study
```

Filters: `site:dl.acm.org`. Result count: 10 returned. Records inspected: 10. Candidates retained: S029, S030, S031, S032, S033.

#### Identity-confirmation group (five searches, not independent discovery)

Five short follow-up searches were run only to establish authorship, venue, and date for records already discovered above, where the discovery-query summary did not name an author: `"Sociotechnical systems: Factors in analysis, design, and management" Bostrom Heinen IEEE author year`; `Baxter Sommerville "Socio-technical systems: From design methods to systems engineering" 2011 author`; `Cook Long "Building and Revising Adaptive Capacity Sharing for Technical Incident Response" Applied Ergonomics 2021`; `queue.acm.org detail.cfm id=3380776 title author resilience`; `DESEN specification sociotechnical systems patterns regulation control authors TOSEM 2019`. These did not add new candidates. Subsequent audit found that the first confirmation was incorrect or incomplete: S003 is a 1973 book by Kenyon B. De Greene, not a Bostrom and Heinen work.

## Deduplication and version reconciliation

- The Leveson and Turner 1993 Therac-25 investigation (S034) was returned from at least six distinct URLs (MIT `sunnyday.mit.edu`, MIT `web.mit.edu/6.033`, Cal Poly, eScholarship, ACM's reprint in *Computer*, and a Columbia course mirror). Recorded as one candidate with the ACM-hosted version treated as the citable canonical location and the others noted as mirrors.
- "Socio-technical Congruence in OSS Projects: Exploring Conway's Law in FreeBSD" (S017) was returned as both a Springer book-chapter record and a ResearchGate record for the same paper. Recorded as one candidate.
- "Examining ownership models in software teams" (S021) was returned as both a 2024 *Empirical Software Engineering* journal record and a 2024 arXiv preprint ("Examining Ownership Models in Software Teams: A Systematic Literature Review and a Replication Study"). Title and scope match closely enough to treat as one candidate pending full-text confirmation that the journal version is the published form of the preprint; this will be confirmed, not assumed, at full-text screening.
- The intelligent-sociotechnical-systems (iSTS) framework paper (arXiv:2401.03223) and the responsibility-modeling paper (arXiv:1104.2265) each appeared in three separate query result sets. Neither was promoted to a candidate ID this round (see dispositions) to avoid inflating the candidate count with repeated discovery of the same two records; they are logged once each under "Discovery dispositions."

## Coverage and stopping record

This round is **not** a completed initial search under the protocol's own stopping rule. It satisfies the "every approved query executed and recorded" condition and the "duplicates and versions reconciled" condition. It does **not** yet satisfy: full-text screening (screening-record.md documents only title/abstract-level dispositions); backward/forward citation checking for provisionally central sources (S002, S004, S015, S034 in particular); targeted replication/correction/retraction searches; or a completed coverage assessment against the protocol's five sampling dimensions. Those remain open for the next round(s), which this task does not authorize.

Observed coverage after Round 1, by the protocol's sampling dimensions:

- **Lifecycle position**: development and operation are well represented (coordination, ownership, CSCW, incident response); deployment/transition and long-term maintenance/evolution are thin — most "evolution" hits were purely technical reliability models that failed the operational-boundary test (see dispositions).
- **Ordinary work vs. incidents**: after Query 9's near-total failure and Query 10's recovery, ordinary work and successful adaptation are represented (S036, S037) alongside incident material (S034, S035, S038), but the ordinary-work side rests on fewer, more concentrated sources (largely one research program: Cook, Grayson, Maguire, Reed) than the incident side. This is recorded as a gap, not filled with weaker sources, per the protocol's coverage-control rule.
- **Levels of analysis**: individual/dyad level is the weakest represented level; most retained candidates operate at team, organization, or ecosystem level.
- **Settings**: large commercial organizations (Microsoft-scale case studies, multinational coordination-tools study) and open-source ecosystems (Apache, FreeBSD) are both represented; public-sector and safety- or mission-critical settings are represented narrowly, through the Therac-25 case (S034) and the HRO/normal-accidents bridge (S038) only.
- **Evidence role**: definitional/normative (S002–S009), empirical observation and association (most of groups B–D, F), and critical/alternative (group G plus S010–S014) are all represented. Mechanism and causal evidence roles cannot yet be assessed — that requires full-text inspection, not title/abstract screening.

## Post-round audit and traceability limitation

Round 1 submitted 18 discovery queries and five identity-confirmation searches, for 23 individual search submissions. The earlier description of “19 queries” counted the identity-confirmation searches as one group and was imprecise.

The audit also found that the identity and disposition of every non-retained result were not preserved. The 156 raw instances and approximate deduplicated count therefore cannot be reconstructed. See [Deviation D001](protocol-amendments.md#deviation-d001--round-1-result-level-traceability), the [discovery ledger](discovery-ledger.md), and the [Round 1 audit](round-1-audit.md). Round 1 remains pilot history; a record-level repeat is required before full-text screening.

## Access failures

No full-text access was attempted this round; screening was conducted at title/abstract level only, per the protocol's three-stage screening procedure. Anticipated access constraints are noted for the next round: the original Trist and Bamforth 1951 paper (S001) was not resolved to a directly inspectable stable copy this round and may require an institutional-repository or publisher-archive search; several IEEE Xplore and ACM Digital Library records (S003, S006, S015, S024) will likely require a subscription-gated retrieval attempt, consistent with the paywall pattern already documented for ERB-01-01.

## AI involvement

System: Claude (Sonnet 5), acting as an AI research assistant at the direction of the project's chapter author.

Task: executed 18 discovery queries plus five identity-confirmation searches through a general web-search interface, read the returned title/URL lists and the interface's own generated summaries, and performed title/abstract-level screening against the protocol's inclusion, exclusion, and operational-boundary criteria to decide which records to promote to source-inventory.md as candidates.

Input boundary: only publicly returned search-result titles, URLs, and the search interface's own generated summary text were used. No full-text article content was fetched, read, or used as a basis for any screening decision in this round — per the protocol, an abstract or AI-generated summary is a discovery aid only, and this round's judgments are recorded as discovery/title-level judgments, not evidentiary ones.

Human verification required: a human researcher must independently confirm that each retained candidate's identity (authorship, venue, date, stable location) is accurate before full-text screening proceeds, since several citations above (marked in source-inventory.md) rest on the search interface's own summarization of metadata rather than on inspection of the primary record.

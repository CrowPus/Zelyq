# The Engineering Research Book

## ERB-01-01 search log

Record version: 1.1

Status: Active

Search opened: 2026-08-25

---

## Recording rules

Every executed search records the date, source location, exact query, filters, result count when available, records inspected, candidate sources retained, and notes about coverage or failure.

Search-engine result snippets are discovery aids only. A candidate becomes evidence only after full-text screening, appraisal, and entry in the evidence table.

## Search rounds

### Round 1 — Authoritative definitions and historical foundations

Date: 2026-08-25

Purpose: identify authoritative standards, bodies of knowledge, curriculum guidance, and primary historical sources relevant to definitions and lifecycle responsibilities.

Search service: web search discovery interface

Queries executed:

```text
site:computer.org SWEBOK v4 official PDF software engineering definition
```

```text
site:iso.org ISO IEC IEEE 24765 software engineering definition
```

```text
site:acm.org software engineering 2014 curriculum guidelines official PDF
```

```text
NATO Software Engineering Conference 1968 report PDF
```

Filters: none beyond the domain restrictions embedded in three queries.

Results exposed by the search service: 25 combined result records. The service did not expose reliable per-query totals or the complete result set; this round is discovery work and cannot support a completeness claim.

Summary screening:

- 25 returned records inspected at title or search-summary level.
- 5 source families retained as candidates.
- 20 records not retained because they were duplicate hosts, encyclopedia pages, unrelated papers, social discussion, or derivative descriptions not needed while stronger sources remain available.
- 0 sources entered the evidence table during this round.

Candidates retained:

- IEEE Computer Society, *Guide to the Software Engineering Body of Knowledge*, Version 4.0.
- ISO/IEC/IEEE 24765:2017, *Systems and software engineering — Vocabulary*.
- ACM/IEEE-CS, *Software Engineering 2014: Curriculum Guidelines for Undergraduate Degree Programs in Software Engineering*.
- Naur and Randell, eds., *Software Engineering: Report of a Conference Sponsored by the NATO Science Committee*, 1969.
- Brian Randell, *Fifty Years of Software Engineering — or — The View from Garmisch*, 2018.

Access and coverage notes:

- The official IEEE Computer Society SWEBOK page was discoverable, but direct page retrieval returned HTTP 403. The guide itself has not been inspected.
- The official ACM-hosted SE2014 PDF was discoverable, but direct retrieval returned HTTP 403. The PDF has not been inspected.
- The ISO catalogue page was inspected. It establishes the standard's identity, scope as a common vocabulary, publication status, and revision state, but it does not expose the definitions required for this chapter. The 522-page standard has not been inspected.
- A University of Pennsylvania catalogue record identifies an accessible copy of the 1968 NATO report, but retrieval timed out. Third-party copies were discovered but have not been accepted in place of a verified copy.
- The arXiv record for Randell's retrospective was inspected at abstract level. The full paper has not yet been inspected.

Protocol effect: none. The round confirms the feasibility of the planned source classes and reveals access work needed before full-text screening.

### Round 2 — Full-text retrieval of retained candidates

Date: 2026-08-25

Purpose: locate inspectable official, institutional, or author-deposited full text for the five candidates retained in Round 1.

Search service: web search and document retrieval interface

Queries executed:

```text
site:computer.org SWEBOK Guide V4 PDF software engineering
```

```text
site:acm.org "Software Engineering 2014" curriculum guidelines PDF
```

```text
site:homepages.cs.ncl.ac.uk Brian Randell Garmisch 1968 PDF
```

```text
NATO Software Engineering 1968 report PDF Naur Randell institutional
```

Filters: source-domain restrictions embedded in two queries; otherwise none.

Retrieval outcomes:

- ERB-01-01-S001: the official IEEE Computer Society PDF for SWEBOK v4.0a was retrieved and inspected. The document is 411 pages and identifies itself as the August 2026 release. Relevant introductory material on definition, disciplinary scope, lifecycle coverage, practice, economics, and the 18 knowledge areas was inspected. Included for a bounded normative and consensus use.
- ERB-01-01-S003: the official ACM PDF remained blocked with HTTP 403. Search indexing exposed portions of the document, but those portions were not treated as a substitute for full-text inspection.
- ERB-01-01-S004: Newcastle University verified the report's identity, publication metadata, and presence of an accepted-version PDF. Retrieval of both the repository copy and the author-hosted copy failed because of cache or timeout errors. The report remains a candidate and has not been included.
- ERB-01-01-S005: the complete nine-page author paper deposited at arXiv was retrieved and inspected. Included as an author retrospective and conceptual/historical source, not as empirical proof of general practice or outcomes.
- ERB-01-01-S002: no inspectable copy of the complete vocabulary standard was obtained in this round. SWEBOK reproduces and attributes the relevant definition, but this does not convert the uninspected standard into an included source.

Additional retrieval checks:

- The Newcastle University repository records for the NATO report and Randell's 1979 report were inspected to verify provenance and metadata.
- Third-party copies of the NATO report were not used while the provenance-confirmed institutional record remains available but technically inaccessible.

Protocol effect: none. Two candidates passed initial full-text screening. Both require independent review before they can support a central finding.

### Round 3 — Empirical developer-work discovery

Date: 2026-08-25

Purpose: identify empirical studies that observe or elicit the activities performed by professional software developers, including work outside code production.

Search service: web search and document retrieval interface

Queries executed:

```text
site:dl.acm.org software developers work activities empirical study survey interview programming responsibilities
```

```text
site:ieeexplore.ieee.org software engineer work practices empirical study activities responsibilities
```

```text
empirical study how software developers spend their time coding meetings testing requirements full text
```

```text
software developers work activities diary study programming communication coordination empirical PDF
```

Filters: source-domain restrictions embedded in two queries; otherwise none.

Coverage note: the search interface exposed 53 result records across the four queries. These include duplicates, derivative copies, and irrelevant records. They are supplementary discovery results and have not yet been consolidated into a completed deduplicated search corpus.

Candidates promoted for full-text assessment:

- Meyer et al., *The Work Life of Developers: Activities, Switches and Perceived Productivity*, 2017.
- Meyer et al., *Today Was a Good Day: The Daily Life of Software Developers*, 2019.
- Gonçalves, de Souza, and González, *Collaboration, Information Seeking and Communication: An Observational Study of Software Developers' Work Practices*, 2011.
- Storey et al., *Software Development at Microsoft Observed*, 2019.
- Begel and Zimmermann, *Analyze This! 145 Questions for Data Scientists in Software Engineering*, identified indirectly through related material; relevance requires verification.

Full-text outcomes:

- ERB-01-01-S006: complete 16-page IEEE Transactions on Software Engineering article inspected. Included for observed activity distribution, work fragmentation, and contextual variation.
- ERB-01-01-S007: complete 18-page preprint of the IEEE Transactions on Software Engineering article inspected. Included for self-reported activity distribution and perceived workday outcomes in one large organization.
- The remaining promoted candidates require full-text retrieval and relevance screening.

Protocol effect: none. The search confirms that empirical activity evidence is available, but it also exposes a terminology limitation: many studies use “developer” without independently distinguishing programmer and software-engineer roles. Such studies can establish the composition of development work but cannot alone establish an occupational boundary.

### Round 4 — Responsibility-to-outcome evidence: code review

Date: 2026-08-25

Purpose: begin testing whether a responsibility beyond individual code production is associated with an observable software outcome, and actively seek replication or contradiction.

Queries executed:

```text
site:dl.acm.org empirical study code review software quality defects outcomes full text
```

```text
site:ieeexplore.ieee.org requirements engineering practices project success empirical study software full text
```

```text
site:arxiv.org software engineering practices project outcomes code review requirements testing empirical study
```

```text
Bacchelli Bird Expectations Outcomes Challenges Modern Code Review full PDF
```

```text
McIntosh code review coverage participation software quality defects empirical full PDF
```

Search service: web search and document retrieval interface.

Full-text outcomes:

- ERB-01-01-S010: McIntosh et al.'s 2016 extended case study of Qt, VTK, and ITK was retrieved and inspected. Included as observational evidence of associations between review properties and post-release defects.
- ERB-01-01-S011: Krutauz et al.'s 2020 replication and extension using Qt and Chrome was retrieved and inspected. Included as a material challenge to the stability and directness of the S010 associations.

Other candidates discovered include qualitative work on modern review outcomes, a systematic mapping study of code-review research, and empirical requirements studies. They remain candidates until full-text relevance and methodological fit are assessed.

Protocol effect: none. The paired evidence requires the synthesis to distinguish review as a responsibility from particular review metrics, association from causation, and defects found during review from post-release defect incidence.

### Round 5 — Requirements problems and downstream consequences

Date: 2026-08-25

Purpose: investigate whether work performed before construction—elicitation, clarification, stakeholder communication, completeness checking, and change management—has documented downstream consequences.

Queries executed:

```text
NaPiRE requirements engineering problems causes effects full paper PDF empirical
```

```text
Naming the Pain in Requirements Engineering contemporary problems causes effects PDF
```

```text
Damian Chisan 2006 requirements engineering processes payoffs productivity quality risk management PDF
```

```text
"complex relationships between requirements engineering processes" PDF
```

Search service: web search and document retrieval interface.

Full-text outcomes:

- ERB-01-01-S012: the peer-reviewed author manuscript of the 2017 NaPiRE study was retrieved from Queen's University Belfast and inspected in full. Included as a multinational practitioner survey of perceived requirements problems, causes, and effects.
- Damian and Chisan's 2006 longitudinal case study was identified as a high-relevance outcome candidate, but the discovered full-text endpoint timed out. Search-indexed text was not accepted as full-text inspection.

Protocol effect: none. The NaPiRE study supports claims about recurring practitioner-reported problems and perceived consequences. It does not establish that a named requirements practice caused an objective outcome, and its “cause-effect” diagrams represent response frequencies rather than estimated causal probabilities.

### Round 6 — Testing responsibility, quality, and productivity

Date: 2026-08-25

Purpose: evaluate whether testing practices and measurable test properties relate to delivered quality and productivity, including evidence that limits simple testing-effect claims.

Queries executed:

```text
systematic review meta analysis test driven development external quality productivity software engineering PDF
```

```text
empirical study automated testing post release defects software quality full PDF replication
```

```text
"The Effects of Test-Driven Development on External Quality and Productivity" PDF Rafique Misic
```

```text
"The Relation of Test-Related Factors to Software Quality" PDF
```

Search service: web search and document retrieval interface.

Full-text outcomes:

- ERB-01-01-S014: Rafique and Mišić's meta-analysis of 27 test-driven-development studies was retrieved and inspected. Included for bounded synthesis of external-quality and productivity effects.
- ERB-01-01-S015: Pecorelli, Palomba, and De Lucia's Apache case study was retrieved and inspected. Included as qualifying evidence about the limited explanatory value of test presence, executability, and common test metrics for post-release defects.

Protocol effect: none. The evidence requires separation of testing responsibility from test-driven development as one technique, and separation of test presence or coverage from test effectiveness. Quality and productivity effects must be reported together where the source evaluates both.

### Round 7 — Primary historical report retrieval

Date: 2026-08-25

Purpose: close the identified historical evidence gap by inspecting the primary report of the 1968 NATO Software Engineering Conference rather than relying only on later recollection.

Queries executed:

```text
NATO Software Engineering 1968 conference report Naur Randell PDF Garmisch
```

```text
site:homepages.cs.ncl.ac.uk Brian Randell NATO Software Engineering report PDF 1969
```

```text
Software Engineering Report NATO Science Committee 1969 pdf
```

Search service: web search and document retrieval interface.

Full-text outcome:

- ERB-01-01-S004: a complete 136-page searchable edition of the January 1969 conference report was retrieved and inspected. Newcastle University and Brian Randell's publication page establish the report's provenance; the inspected copy identifies Naur and Randell as editors and explains that it was produced by scanning and reformatting the original.

Protocol effect: none. The report is included for historical framing and contemporary arguments about scope, scale, design, production, communication, documentation, testing, distribution, and service. Because the editors intentionally preserved disagreement and did not seek consensus, participant statements must remain attributed and cannot be presented as settled conference findings.

### Round 8 — Educational competency framework and vocabulary check

Date: 2026-08-25

Purpose: inspect the retained ACM/IEEE software-engineering curriculum framework and determine whether the ISO vocabulary candidate is available for compliant full-text assessment.

Queries executed:

```text
ISO IEC IEEE 24765 2017 software engineering definition programming vocabulary official preview
```

```text
site:acm.org education se2014.pdf Software Engineering 2014 Curriculum Guidelines
```

```text
Software Engineering 2014 Curriculum Guidelines PDF ACM IEEE full text
```

Search service: web search and document retrieval interface.

Full-text outcomes:

- ERB-01-01-S003: the complete 134-page SE2014 curriculum guidelines were retrieved from the IEEE Computer Society and inspected. Included as a normative educational and competency framework.
- ERB-01-01-S002: the official ISO catalogue confirms the standard's identity, purpose, status, edition, and revision state, but does not expose the relevant vocabulary entries in the public page. The page also states restrictions on AI access and use of ISO materials. No definitions were extracted, inferred, or reproduced; the source remains a candidate pending lawful, inspectable access under applicable terms.

Protocol effect: none. SE2014 may support claims about the competencies recommended for undergraduate software-engineering education and the framework's conceptual distinction between programming and broader engineering work. It cannot establish actual practitioner behavior, occupational boundaries, or causal outcomes.

### Round 9 — Occupational-title boundary and overlap

Date: 2026-08-25

Purpose: search specifically for empirical comparisons of programmer and software-engineer titles, activities, and responsibilities.

Queries executed:

```text
empirical study software engineer programmer job title responsibilities comparison
```

```text
software developer software engineer programmer occupational titles tasks empirical study
```

```text
"software engineer" "programmer" responsibilities empirical survey roles
```

Search service: web search and document retrieval interface.

Full-text outcome:

- ERB-01-01-S016: Surakka's 2005 longitudinal job-advertisement report was retrieved and inspected. It distinguishes programmer, software developer, software engineer, and systems analyst titles, but measures requested technical technologies rather than broader responsibilities. Excluded from evidentiary synthesis for the primary question.

Other results concerned research-software roles, employer demand, developer behavior without title comparisons, occupational descriptions, salary surveys, or informal commentary. None provided an inspectable, methodologically adequate comparison of the full responsibilities performed by programmer and software-engineer title groups.

Protocol effect: none. The unsuccessful targeted search is evidence of a review gap, not evidence that no occupational differences exist. Synthesis must continue to distinguish titles from activities and must not invent a stable title boundary.

### Round 10 — Retained activity and requirements candidates

Date: 2026-08-25

Purpose: resolve the remaining observational-work candidates and retry the longitudinal requirements-payoff source.

Queries executed:

```text
"Collaboration, Information Seeking and Communication" observational study PDF Gonçalves Souza González
```

```text
"Software Development at Microsoft Observed" full paper PDF Storey
```

```text
"An Empirical Study of the Complex Relationships" requirements engineering processes PDF Damian Chisan
```

Search service: web search and document retrieval interface.

Full-text outcomes:

- ERB-01-01-S008: the complete 18-page article was retrieved and inspected. Included for bounded observation of collaboration, information seeking, communication, and interruption in one Brazilian development organization.
- ERB-01-01-S009: the complete 10-page Microsoft Research report was retrieved and inspected. Included for bounded survey and interview evidence concerning code rationale, mental models, coordination, ownership, documentation, and interruptions within Microsoft.
- ERB-01-01-S013: bibliographic identity and additional indexed content were confirmed, but the full article still could not be inspected reliably through the available endpoint. It remains a candidate and is not counted as evidence.

Protocol effect: none. S008 and S009 broaden the settings represented by the activity evidence but remain context-specific. Neither compares programmer and software-engineer title groups or measures downstream product outcomes.

### Round 11 — Final S013 retrieval attempt

Date: 2026-08-25

Purpose: make a final attempt to obtain a reliably inspectable copy of the retained longitudinal requirements-payoff article before independent evidence review.

Queries executed:

```text
Daniela Damian James Chisan 2006 TSE 32 5 433 453 pdf
```

```text
site:uvic.ca Damian Chisan requirements engineering payoffs PDF
```

```text
"DAMIAN AND CHISAN" "433" pdf
```

```text
"An Empirical Study of the Complex Relationships between Requirements Engineering Processes" -citeseerx pdf
```

```text
"Requirements Engineering Processes" "Risk Management" Damian Chisan filetype:pdf -citeseerx
```

```text
doi 10.1109/TSE.2006.61 full text
```

Search service: web search and document retrieval interface.

Outcome:

- ERB-01-01-S013: search indexing exposed additional portions of the article, including its research question and description of a 30-month explanatory case study at the Australian Center for Unisys Software. The complete article endpoint still failed document retrieval, and other results were metadata, summaries, citations, related publications, or a thesis rather than the article itself.

Screening consequence: unchanged. Indexed excerpts were not substituted for full-text inspection. S013 remains a candidate, contributes no evidence to the chapter, and is presented to the independent reviewer only as an unresolved materiality question.

Protocol effect: none.

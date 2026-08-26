# The Engineering Research Book

## ERB-01-02 research protocol

Protocol version: 0.3

Status: Approved for execution

Prepared: 2026-08-25

Approved: 2026-08-25

Protocol registration: Repository record before evidence collection

Chapter: [ERB-01-02 — Software as a sociotechnical system](../../01-nature-of-software-engineering/02-software-as-a-sociotechnical-system.md)

Proposal: [ERB-01-02 research proposal](proposal.md)

---

## Research design

The investigation combines structured evidence synthesis, conceptual analysis, and mechanism-oriented synthesis.

The structured synthesis will identify definitions and models, empirical observations of interacting technical and nontechnical elements, evidence about behavior and evolution, and credible alternatives or criticism. Conceptual analysis will compare system boundaries, units and levels of analysis, and meanings assigned to “sociotechnical.” Mechanism-oriented synthesis will examine how relationships among elements are proposed or observed to produce, constrain, stabilize, or change outcomes.

The review is structured and reproducible but will not claim exhaustive coverage of every discipline that studies sociotechnical systems.

## Research questions

### Primary question

> How do technical artifacts, people, processes, organizations, and environments interact in the behavior and evolution of software systems?

### Supporting questions

1. How do relevant source communities define a sociotechnical software system and its boundary?
2. Which elements, relationships, levels, and contexts are represented in those accounts?
3. Which interaction mechanisms are observed or proposed, and what evidence supports them?
4. Which software behaviors, adaptations, and outcomes are connected to those mechanisms?
5. How are responsibility, authority, information, incentives, and feedback distributed?
6. Which explanations survive comparison with technical-only, individual, process, organizational, ecological, and other alternatives?
7. When is the sociotechnical framing too broad, indirect, context-bound, or weakly operationalized to support a finding?

## Operational boundaries

For screening and extraction, a candidate sociotechnical account must identify or permit identification of:

- at least one software, infrastructure, data, interface, or other technical element;
- at least one person, role, team, organization, process, policy, user group, institution, or environmental condition;
- a relationship or dependency between elements;
- a behavior, adaptation, decision, constraint, or outcome connected to that relationship; and
- a system boundary and level of analysis adequate for the intended claim.

A source need not use the word “sociotechnical” if its design directly examines such an interaction. Merely mentioning people and technology in the same document is insufficient.

“Mechanism” means a bounded account of how an interaction could produce or constrain an observed pattern. A plausible mechanism is not classified as causal evidence unless the source design addresses credible alternative causes.

## Review period and source languages

No lower publication-date boundary will be imposed because foundational definitions and historical development may be material. The initial search will include sources available through 2026-08-25. Publication, observation, version, and access dates will be recorded where they affect interpretation.

The initial review includes English-language sources and sources with a reliable English translation accessible to the researchers. Relevant non-English sources encountered during discovery will be logged. The review will not claim global or linguistic representativeness.

## Source locations

Search will span source classes because the question crosses software engineering, information systems, computer-supported cooperative work, human factors, safety, and systems research.

### Scholarly indexes and libraries

- ACM Digital Library
- IEEE Xplore
- Scopus or Web of Science when accessible
- Google Scholar for supplementary discovery and citation chaining
- Crossref and Semantic Scholar for metadata verification and discovery

### Adjacent disciplinary sources

- information-systems and organization research indexes or publisher collections;
- computer-supported cooperative work and human-computer interaction venues;
- safety science, resilience engineering, and systems-engineering sources when directly connected to software-intensive systems; and
- institutional repositories containing inspectable author manuscripts.

### Standards, investigations, and practice evidence

- relevant ISO, IEC, IEEE, governmental, or professional frameworks;
- public incident and accident investigation reports with inspectable evidence;
- peer-reviewed experience reports and longitudinal case studies; and
- open-source project studies selected under the same criteria as other empirical evidence.

Blogs, talks, community discussions, and vendor reports may support discovery or expose candidate explanations. They will not establish broad findings without adequate provenance, context, method, and appraisal.

## Search concepts

Searches will combine terms from five groups.

### Concept A — Software-intensive object

```text
software
"software system"
"software-intensive system"
"information system"
"digital infrastructure"
```

### Concept B — Sociotechnical framing

```text
sociotechnical
"socio-technical"
"joint optimization"
"work system"
"technical and social"
"technical and organizational"
```

### Concept C — Elements and relationships

```text
people
team
organization
process
practice
policy
incentive
coordination
communication
ownership
responsibility
authority
dependency
feedback
```

### Concept D — Behavior and change

```text
behavior
evolution
adaptation
maintenance
operation
deployment
change
workaround
emergence
```

### Concept E — Evidence and consequence

```text
empirical
observation
ethnography
case study
longitudinal
incident
outcome
reliability
safety
security
quality
failure
success
```

## Initial search strings

Syntax will be adapted to each database and preserved verbatim in the search log.

```text
(software OR "software-intensive system" OR "information system")
AND (sociotechnical OR "socio-technical")
AND (definition OR model OR framework OR theory OR boundary)
```

```text
("software development" OR "software maintenance" OR "software operation")
AND (organization OR team OR coordination OR communication OR ownership)
AND (empirical OR observation OR ethnography OR survey OR "case study")
```

```text
(software OR "digital infrastructure")
AND (sociotechnical OR "technical and organizational" OR "technical and social")
AND (evolution OR adaptation OR behavior OR outcome OR reliability OR failure)
```

```text
("software incident" OR "software failure" OR "software outage")
AND (organization OR process OR communication OR policy OR incentive)
AND (investigation OR analysis OR case)
```

```text
(sociotechnical OR "socio-technical")
AND (software OR computing)
AND (critique OR limitation OR alternative OR causality OR "construct validity")
```

```text
("software development" OR "software operation" OR "software maintenance")
AND (adaptation OR resilience OR workaround OR "ordinary work" OR recovery)
AND (team OR organization OR user OR operator OR coordination)
```

The first round is a feasibility pilot. Query changes that affect coverage, eligibility, or interpretation will be recorded as protocol amendments before their results enter the evidence base.

## Supplementary discovery

For high-relevance included sources, the review will use backward and forward citation checking, related-work searches, author searches for directly relevant research programs, and searches for replications, corrections, retractions, and substantive criticism.

Foundational sources will be paired where possible with contemporary applications or evaluations. Incident sources will prompt searches for comparative, ordinary-work, successful-adaptation, or contrary cases. Citation chaining does not exempt a source from screening and appraisal.

## Inclusion criteria

A source may be included when all applicable criteria are satisfied:

1. It directly addresses a definition, boundary, element, relationship, mechanism, behavior, evolution, or outcome relevant to a research question.
2. It examines a software-intensive system or provides a foundational concept whose transfer to software can be assessed explicitly.
3. Its source, authorship or issuing body, date, version, and relevant context can be identified.
4. The relevant content can be inspected beyond metadata, a search snippet, an abstract, or an AI summary.
5. Its empirical method or argumentative basis can be assessed for the intended use.
6. A claimed interaction identifies both the connected elements and the relationship rather than merely listing technical and nontechnical factors.
7. Outcome claims report the setting, measure or observation, temporal basis where relevant, and analysis adequately enough to assess claim fit.
8. Incident or case evidence supplies enough provenance and context to distinguish reported facts, participant interpretation, investigator analysis, and this review's synthesis.
9. Critical or alternative accounts materially test the scope, usefulness, or explanatory adequacy of the sociotechnical framing.

## Exclusion criteria

A source will be excluded from evidentiary synthesis when:

- “sociotechnical” or related terms are incidental and no relevant interaction is examined;
- it discusses generic management or society without a material software-system connection;
- it lists people, process, and technology as categories without defining or evidencing relationships;
- its relevant claims cannot be inspected in full;
- it is a duplicate or derivative account that adds no independent evidence or interpretation;
- it makes promotional, deterministic, or blame-based claims without inspectable support;
- it presents an incident chronology without sufficient provenance or analytical relevance;
- its method, measures, system boundary, or source provenance is too opaque for the proposed use;
- it concerns AI replacement or Zelyq design without evidence relevant to the chapter question; or
- it falls within excluded scope and does not materially qualify an included claim.

Excluded sources may remain in the discovery log when their disposition explains a search decision, access gap, or common unsupported claim.

## Sampling and coverage controls

The review will not let one evidence-rich domain define the whole chapter. Screening and synthesis will track coverage across:

- development, deployment, operation, maintenance, and evolution;
- ordinary work, successful adaptation, near misses, and incidents;
- individual, team, organizational, ecosystem, and environment levels;
- open-source, commercial, public, and safety- or mission-critical settings when available; and
- definition, observation, association, mechanism, causal, and critical evidence roles.

Coverage cells are diagnostic rather than quotas. Sparse cells will be reported as gaps instead of filled with weak sources.

## Search completion and stopping rules

The initial search is complete only when:

- every approved query has been executed in each applicable accessible source location and recorded verbatim with its date and result count;
- duplicates and versions have been reconciled;
- every result has a recorded screening disposition;
- backward and forward checking has been completed for sources provisionally classified as central;
- targeted searches for criticism, alternative explanations, ordinary work, successful adaptation, replication, correction, and retraction have been executed;
- coverage across lifecycle position, level of analysis, setting, and evidence role has been assessed; and
- unresolved access gaps and their likely materiality have been recorded.

Supplementary discovery may stop when two consecutive documented rounds produce no new central construct, mechanism, materially contrary result, or source class and all known material gaps have either been searched directly or recorded as unresolved. This rule does not convert database or language limits into a claim of completeness.

## Screening procedure

Screening occurs in three stages:

1. **Deduplication and identity check** — consolidate duplicate versions and verify provenance.
2. **Title and abstract or executive-summary screening** — assess likely relevance without using the summary as substantive evidence.
3. **Full-text screening** — inspect the relevant complete text and record a criterion-based reason for exclusion.

At least one researcher will screen every record. Before synthesis, a second reviewer should independently assess every source supporting a central finding, all disputed inclusions, all retained high-risk sources, every material incident account, and a sample of exclusions. Disagreements and corrections will remain in the review history.

If the independent check cannot be completed, central findings cannot advance to Reviewed status; confidence alone will not substitute for the missing review.

## Data extraction

Each included source will record the following fields when applicable:

```text
Source ID:
Full citation and stable location:
Source role and type:
Publication, observation, and access dates:
Population, system, and setting:
Source definition and system boundary:
Elements represented:
Relationships or dependencies represented:
Level or levels of analysis:
Responsibility, authority, information, incentive, and feedback paths:
Behavior, adaptation, or outcome examined:
Method or argumentative basis:
Relevant result or proposition:
Alternative explanations or counterevidence:
Limitations stated or identified:
Source appraisal:
Permitted use in synthesis:
Prohibited inference:
Related or dependent sources:
Notes and candidate claims:
```

Inapplicable fields will be marked rather than silently omitted. Any relevance-adapted schema requires a recorded amendment. Exact quotations will be used only when wording matters and will include a locator; published synthesis will prefer accurate paraphrase.

## Source appraisal

Every source used for a material claim will be assessed under the evidence standard for relevance, methodological fit, execution and reporting, risk of bias, directness, precision or qualitative adequacy, transparency and reproducibility, independence and conflicts, recency, and historical context.

Method-specific appraisal will additionally examine:

- construct validity of system elements, relationships, and outcomes;
- adequacy and justification of the system boundary;
- alignment between the level of observation and level of inference;
- temporal evidence for claims about evolution or feedback;
- treatment of alternative causes and reciprocal relationships;
- case selection, comparison logic, and hindsight in case or incident work;
- researcher position and participant protection in qualitative work;
- validity of repository, communication, organization, or process proxies;
- dependence among publications, datasets, incidents, and research programs; and
- whether normative or conceptual sources are being used only for their defensible role.

No universal numerical quality score will replace these judgments.

## Initial coding framework

### Element type

- software, data, model, interface, or technical artifact
- hardware, platform, network, or physical infrastructure
- person, user, operator, maintainer, or role
- team, community, or coordination structure
- organization, supplier, customer, regulator, or institution
- process, practice, policy, norm, or incentive
- physical, market, legal, cultural, or operating environment

### Relationship type

- information or knowledge flow
- technical or work dependency
- authority or decision right
- responsibility or accountability
- incentive or resource constraint
- coordination, negotiation, or handoff
- control, monitoring, or feedback
- trust, interpretation, or expectation
- adaptation, workaround, or mutual shaping

### Level of analysis

- individual
- dyad or role relationship
- team or project
- organization
- interorganizational ecosystem
- software-intensive system
- institutional or societal environment

### Temporal position

- design and development
- deployment and transition
- operation and use
- maintenance and evolution
- incident response and recovery
- long-term adaptation or degradation

### Evidence status

- descriptive definition
- normative model
- conceptual argument
- observed interaction
- self-reported interaction
- association with behavior or outcome
- mechanism evidence
- causal evidence
- counterexample, null result, or qualification

Codes may be added, merged, split, or rejected during pilot extraction. Changes, reasons, timing, and effects on earlier coding will be recorded before synthesis.

## Synthesis method

Synthesis proceeds in five stages.

### 1. Definition and boundary map

Compare how source communities define the system, select elements, draw boundaries, and choose levels of analysis. Similar vocabulary will not be treated as conceptual agreement without matching constructs.

### 2. Element and relationship map

Map which elements are connected, the direction and form of dependencies, and where responsibility, authority, information, incentives, and feedback reside.

### 3. Mechanism and outcome map

Connect observed or proposed interaction mechanisms to behaviors, adaptations, and outcomes. Conceptual plausibility, participant interpretation, observed sequence, association, and causal evidence will remain separate.

### 4. Cross-level and temporal analysis

Test whether conclusions change across individual, team, organization, ecosystem, and environment levels and across development, operation, maintenance, incident, and evolution periods.

### 5. Boundary and alternative-explanation analysis

Identify when sociotechnical explanations add information beyond component-level technical accounts and when they remain redundant, vague, untestable, or less adequate than alternatives.

The synthesis will not count sources as votes or combine incompatible quantitative measures.

## Finding and confidence procedure

Each material finding will receive a claim–evidence record containing the bounded finding, scope, supporting evidence, contradictory or qualifying evidence, source-appraisal summary, body-of-evidence assessment, confidence and justification, important limitations, and last review date.

Confidence will be High, Moderate, Low, or Insufficient under the evidence standard. Insufficient is an acceptable result when the evidence cannot distinguish among material interaction models, mechanisms, or outcomes.

## Sensitivity and disconfirmation checks

Before findings are finalized, analysis will test:

- whether conclusions survive removal of foundational and normative sources;
- whether they survive removal of incident-only evidence;
- whether ordinary work and successful adaptation contradict failure-derived mechanisms;
- whether conclusions change when system boundaries are drawn more narrowly or broadly;
- whether individual-, team-, organization-, ecosystem-, and environment-level claims have been conflated;
- whether temporal sequence and feedback direction are adequately supported;
- whether repository or communication proxies are mistaken for exercised responsibility or interaction quality;
- whether conclusions survive removal of dependent datasets or research programs;
- whether a technical-only, process-only, organizational, ecological, or other explanation fits equally well; and
- whether the sociotechnical label adds a testable relationship rather than merely renaming context.

## Research records

Records will be created when their stage begins; empty files will not imply progress.

```text
proposal.md
protocol.md
protocol-amendments.md
review-record.md
search-log.md
screening-record.md
source-inventory.md
evidence-table.md
interaction-coding-record.md
case-comparison-record.md (when applicable)
claim-evidence-records.md
analysis-notes.md
```

## Use of AI

AI may assist with query expansion, metadata organization, candidate discovery, comparison, and drafting research records. AI output is not evidence.

Every cited source must be inspected against its complete text when accessible, and extracted data, quotations, classifications, analysis, and findings must be checked against the underlying material. Under Amendment A002, a disclosed AI-assisted reviewer may perform these checks and satisfy a review gate when its model, date, task, access path, input boundary, decisions, and limitations are recorded. Project owners and maintainers retain correction and reopening responsibility. Inaccessible sources remain `Unable to verify` and cannot become verified through approval language alone.

Restricted, personal, proprietary, security-sensitive, or unlawfully obtained material will not be submitted to an AI system.

## Ethics, privacy, security, and licensing

The initial design analyzes published and lawfully accessible material and does not recruit participants or collect private repository or workplace data.

Public availability does not eliminate privacy or harm concerns. The review will minimize personal identifiers, avoid unnecessary reproduction of workplace communications, and avoid publishing operational details that create material security risk. Copyrighted sources will be cited and paraphrased within lawful limits; restricted full text will not be copied into research artifacts.

Any later interviews, surveys, direct observation, private data analysis, or systematic analysis of identifiable public communications requires a protocol amendment and applicable ethics, consent, privacy, security, and legal review before collection.

## Protocol deviations and amendments

Every material deviation will record:

```text
Original procedure:
Change:
Reason:
Date and research stage:
Information available when changed:
Likely effect on coverage, bias, or findings:
Reviewer decision:
```

Changes made after emerging results are known require heightened scrutiny.

## Review requirements

Before evidence collection begins, the protocol requires methodological, evidence-planning, sociotechnical or software-engineering domain, and ethical-safeguard review. Review must address search feasibility, construct validity, boundary selection, causal language, evidence diversity, source access, record sufficiency, and separation from Zelyq engineering.

Before findings are approved, Gate A must independently verify central evidence records, and Gate B must review analysis, confidence, domain accuracy, and editorial presentation. Review comments and resolutions will remain recorded.

## Conditions for beginning evidence collection

Evidence collection begins only when:

- the approved proposal and this protocol are recorded;
- protocol review roles and declarations are complete;
- material objections are resolved or documented;
- source access and search feasibility are adequate;
- the search log, screening record, and source-inventory formats are ready; and
- the chapter status changes to `In research`.

Until then, source discovery may test query feasibility only. Pilot discoveries do not become accepted evidence unless they enter the approved search, screening, extraction, and appraisal process.

## Approval decision

Decision: **Approved for execution by Dee Empire, project owner, on 2026-08-25.**

Approval authorizes the recorded search, screening, appraisal, extraction, and analysis process. It does not approve a sociotechnical definition, a finding, a Zelyq implication, or code.

The following constraints are binding during execution:

- Treat “software-intensive system” as a screening and claim-boundary question, not an unrestricted label for every adjacent organizational study.
- Use incident and safety evidence to examine bounded interaction mechanisms and counterexamples; do not duplicate ERB-01-05's broader failure synthesis or infer prevalence from incidents.
- Apply the two-round supplementary stopping rule only after the required source-location, coverage, criticism, ordinary-work, adaptation, replication, correction, and access-gap checks are complete; do not describe the resulting search as exhaustive.
- Keep technical-only, process-only, organizational, ecological, and other alternatives visible wherever a sociotechnical explanation is proposed.
- Do not collect participant, private repository, identifiable communication, restricted, or security-sensitive material without the amendment and review process specified above.

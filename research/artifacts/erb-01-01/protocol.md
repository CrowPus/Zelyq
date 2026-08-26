# The Engineering Research Book

## ERB-01-01 research protocol

Protocol version: 0.1

Status: Approved for execution

Approved: 2026-08-25

Prepared: 2026-08-24

Protocol registration: Repository record before evidence collection

Chapter: [ERB-01-01 — Software engineering and programming](../../01-nature-of-software-engineering/01-software-engineering-and-programming.md)

Proposal: [ERB-01-01 research proposal](proposal.md)

---

## Research design

The investigation combines a structured evidence synthesis with conceptual analysis.

The evidence synthesis will identify:

- definitions of software engineering and programming;
- models of responsibilities and lifecycle work;
- empirical studies of what practitioners do;
- evidence connecting responsibilities to outcomes; and
- credible criticism or qualification of the distinction.

Conceptual analysis will compare how sources use terms, distinguish occupational labels from activities, and develop a taxonomy whose categories remain traceable to the source material.

## Research questions

### Primary question

> Which responsibilities distinguish software engineering from programming, and where does the distinction affect outcomes?

### Supporting questions

1. How do source communities define software engineering and programming?
2. Which observable activities and responsibilities are assigned to each or to both?
3. Which distinctions are stable across sources, and which depend on context or terminology?
4. What evidence connects the presence, absence, or quality of identified responsibilities to outcomes?
5. Which claims remain conceptual, weakly evidenced, disputed, or unsupported?

## Review period

No lower publication-date boundary will be imposed because historical sources may be necessary to understand the origin and evolution of definitions.

The initial search will include material available through 2026-08-24. Changeable web and professional sources will record both publication and access dates.

## Source languages

The initial review will include sources available in English or with a reliable English translation accessible to the researchers.

This limitation will be recorded explicitly. The review will not claim global representativeness, and evidence of relevant non-English research will be logged for later multilingual review.

## Source locations

Search will be conducted across source classes rather than relying on one index.

### Scholarly indexes and libraries

- ACM Digital Library
- IEEE Xplore
- Scopus or Web of Science when access is available
- Google Scholar for supplementary discovery and citation chaining
- Crossref and Semantic Scholar for bibliographic verification and discovery

### Standards and professional sources

- ISO, IEC, and IEEE standards catalogues and accessible standards text
- IEEE Computer Society software-engineering bodies of knowledge
- ACM and IEEE computing curriculum and competency publications
- recognized professional and governmental occupational frameworks when relevant to activities rather than title prestige

### Historical and archival sources

- NATO software-engineering conference reports and other accessible primary historical records
- institutional or publisher archives for early definitions and debates

### Practitioner and project evidence

- peer-reviewed experience reports
- transparent engineering studies and incident analyses
- open-source project evidence when selected through explicit criteria

Practitioner blogs and community discussions may support discovery, hypotheses, or context. They will not establish broad claims without adequate corroboration and appraisal.

## Search concepts

Searches will combine terms from four concept groups.

### Concept A: software engineering

```text
"software engineering"
"software engineer"
"software development"
```

### Concept B: programming

```text
programming
programmer
"code production"
"software construction"
```

### Concept C: distinction and definition

```text
definition
distinction
difference
boundary
relationship
profession
discipline
```

### Concept D: work, responsibility, and outcome

```text
work
activity
task
practice
responsibility
competency
lifecycle
design
maintenance
coordination
outcome
quality
failure
success
```

## Initial search strings

Syntax will be adapted to each source and preserved verbatim in the search log.

```text
("software engineering" OR "software engineer")
AND (programming OR programmer OR "software construction")
AND (definition OR distinction OR difference OR boundary OR relationship)
```

```text
("software engineer" OR "software developer" OR programmer)
AND (work OR activity OR task OR practice OR responsibility OR competency)
AND (empirical OR survey OR interview OR observation OR ethnography OR diary)
```

```text
("software engineering practice" OR "software development practice")
AND (outcome OR quality OR failure OR success OR maintenance OR reliability)
AND (study OR evidence OR review OR analysis)
```

```text
("software engineering" AND programming)
AND (critique OR overlap OR continuum OR "no difference" OR terminology)
```

The first search round is a pilot. Terms producing systematic irrelevant results or exposing missing vocabulary may be revised before full screening. Every change will be recorded as a protocol amendment with its reason and likely effect.

## Supplementary discovery

For included high-relevance sources, the review will use:

- backward reference checking;
- forward citation checking;
- related-work searches;
- author searches for directly relevant research programs; and
- searches for replications, corrections, retractions, and substantive criticism.

Citation chaining will not exempt a source from the inclusion and appraisal criteria.

## Inclusion criteria

A source may be included when it satisfies all applicable criteria:

1. It provides a definition, model, observation, argument, or result directly relevant to a research question.
2. Its source, authorship or issuing body, date, and version can be identified.
3. The relevant content can be inspected beyond a search snippet or unverified summary.
4. Its method or argumentative basis can be assessed sufficiently for the intended use.
5. Its use does not depend on treating occupational title or authority alone as evidence.
6. For empirical outcome claims, the studied context, measure, and analysis are reported adequately enough to assess claim fit.
7. For historical material, the source contributes directly to the development or meaning of the concepts rather than providing chronology without relevance.

## Exclusion criteria

A source will be excluded from evidentiary synthesis when:

- it uses the relevant term only incidentally;
- the relevant claim cannot be inspected in the source;
- it is a duplicate or derivative account that adds no independent evidence or interpretation;
- it is promotional material making unsupported superiority or status claims;
- it defines roles only through salary, prestige, or organizational rank;
- it discusses AI replacing programmers or engineers without evidence relevant to the underlying work distinction;
- its method or provenance is too opaque for the proposed use; or
- it falls within an excluded scope and does not materially qualify an included claim.

Excluded sources may remain in a discovery log when their existence explains search decisions or common unsupported claims.

## Screening procedure

Screening will occur in three stages:

1. **Deduplication and metadata check** — consolidate duplicate records and verify basic identity.
2. **Title and abstract or summary screening** — assess likely relevance using the inclusion and exclusion criteria.
3. **Full-text screening** — inspect the complete relevant content and record a reason for every exclusion.

At least one researcher will screen all records. Before synthesis, a second reviewer should independently assess:

- a sample of excluded records;
- every source supporting a central finding;
- sources whose inclusion is disputed; and
- sources assessed as high risk of bias but retained for a limited use.

Disagreement will be resolved through recorded reasoning. If resources do not permit the planned independent checks, confidence and review status will reflect that limitation.

## Data extraction

For each included source, record:

```text
Source ID:
Full citation:
Stable location:
Source role and type:
Publication and observation date:
Population, system, and setting:
Definition of software engineering:
Definition of programming:
Activities and responsibilities identified:
Level of analysis: individual, team, organization, system, or profession
Outcome or consequence examined:
Method or argumentative basis:
Relevant result or proposition:
Limitations stated by the source:
Reviewer appraisal:
Permitted use in synthesis:
Related or dependent sources:
Notes and candidate claims:
```

Quotations will be captured only when exact wording is necessary and will include location information. Published synthesis will prefer accurate paraphrase unless language itself is being analyzed.

## Source appraisal

Every source used for a material claim will be assessed under the evidence standard for:

- relevance;
- methodological fit;
- execution and reporting;
- risk of bias;
- directness;
- precision or qualitative adequacy;
- transparency and reproducibility;
- independence and conflicts; and
- recency or historical context.

Method-specific criteria will supplement this assessment. Standards and bodies of knowledge will be assessed as normative or consensus sources rather than empirical proof of actual practice. Practitioner reports will be assessed for context, selection, incentive, and transfer limitations.

No universal numerical quality score will be used.

## Coding framework

The initial coding framework will classify evidence across these dimensions:

### Definition basis

- activity or task
- lifecycle scope
- responsibility or accountability
- method or discipline
- knowledge or competency
- organizational role
- professional identity
- legal or regulatory designation

### Responsibility domain

- problem framing and requirements
- design and architecture
- programming and construction
- verification and quality
- deployment and operations
- maintenance and evolution
- coordination and communication
- risk, security, privacy, and safety
- documentation and knowledge preservation
- project and process responsibility
- user, organizational, and societal consequence

### Boundary relationship

- programming treated as a subset of software engineering
- software engineering treated as a form of programming
- overlapping activities with different scope or accountability
- role distinction dependent on context
- terms treated as interchangeable
- distinction rejected or considered unhelpful

### Evidence status

- descriptive definition
- normative framework
- observed activity
- self-reported activity
- conceptual argument
- association with outcome
- causal evidence
- counterexample or qualification

Codes may be added, merged, or split during pilot extraction. Changes and their effects on earlier coding will be recorded.

## Synthesis method

The synthesis will proceed in four stages.

### 1. Definition map

Compare definitions by source community, period, purpose, and level of analysis. Similar wording will not be treated as agreement when the underlying scope differs.

### 2. Responsibility taxonomy

Group observable responsibilities without assuming that job titles map consistently to them. The taxonomy will identify responsibilities assigned to programming, software engineering, or both.

### 3. Boundary analysis

Identify which distinctions remain stable, which form a continuum, and which depend on scale, lifecycle, organization, system consequence, or the source's purpose.

### 4. Outcome evidence map

Connect responsibilities to empirical outcome evidence where available. Conceptual plausibility, professional consensus, observed association, and causal evidence will remain separate.

The synthesis will actively preserve contrary interpretations and evidence gaps. It will not count sources as votes.

## Finding and confidence procedure

Each material finding will receive a claim–evidence record containing:

- the bounded finding;
- scope;
- supporting evidence;
- contradictory or qualifying evidence;
- source-appraisal summary;
- body-of-evidence assessment;
- confidence and justification;
- limitations; and
- last review date.

Confidence will be High, Moderate, Low, or Insufficient according to the evidence standard. The review may publish an Insufficient finding when the evidence cannot defend a commonly asserted distinction or consequence.

## Sensitivity and disconfirmation checks

Before finalizing findings, the analysis will test:

- whether results depend on standards and professional frameworks rather than observed work;
- whether excluding occupational-title evidence changes the taxonomy;
- whether older definitions are being applied outside their historical context;
- whether conclusions change across individual, team, and organizational levels;
- whether outcome claims survive removal of indirect or high-bias sources;
- whether “programming” was defined too narrowly in the synthesis; and
- whether plausible alternative taxonomies explain the evidence equally well.

## Research records

The artifact directory will contain:

```text
proposal.md
protocol.md
protocol-amendments.md
search-log.md
screening-record.md
source-inventory.md
evidence-table.md
claim-evidence-records.md
analysis-notes.md
review-record.md
```

Records will be created when their stage begins. Empty files will not be used to imply progress.

## Use of AI

AI may assist with query expansion, metadata organization, candidate-source discovery, comparison, and drafting research records.

AI output is not evidence. A human researcher must inspect every cited source, verify extracted data and quotations, review classifications, and remain accountable for analysis and findings.

Material AI involvement will be recorded with the system, model or version when available, date, task, input boundary, and human verification procedure.

Restricted, personal, or proprietary material will not be submitted to an AI system without authorization and appropriate safeguards.

## Ethics and privacy

The initial design analyzes published and lawfully accessible material and does not involve participant recruitment.

If the research later proposes interviews, surveys, observation, private repository analysis, or systematic analysis of identifiable public communications, the protocol must be amended and the required ethical, consent, and privacy review must occur before collection.

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

Changes made after inspecting emerging results require heightened review.

## Review requirements

Before evidence collection begins, the protocol requires review for:

- alignment between questions and design;
- adequacy of source locations and search concepts;
- inclusion of contrary definitions and interpretations;
- feasibility of outcome-evidence assessment;
- separation from later chapters and Zelyq application decisions;
- bias mitigation;
- ethical and licensing safeguards; and
- adequacy of the planned research record.

Before publication, the completed chapter requires methodological, evidence, domain, and editorial review under the contribution guide.

## Conditions for beginning evidence collection

Evidence collection begins when:

- the proposal and protocol are reviewed;
- material objections are resolved or documented;
- required access is available;
- the search log and screening record formats are ready; and
- the chapter status changes from Proposed to In research.

Until then, source discovery may be used only to test protocol feasibility. Pilot discoveries do not become accepted evidence without entering the approved collection and appraisal process.

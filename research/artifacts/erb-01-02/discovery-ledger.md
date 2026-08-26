# The Engineering Research Book

## ERB-01-02 discovery ledger

Record version: 0.25

Status: Corrective repeat authorized — execution in progress

---

## Purpose

This ledger provides the record-level audit trail required by the protocol. It begins after the Round 1 audit identified that aggregate counts and grouped dispositions cannot reconstruct every inspected result.

## Round 1 preservation statement

Round 1 reported 156 returned result instances, approximately 128 deduplicated records, and 43 retained candidates. The 43 candidates are identified individually in [source-inventory.md](source-inventory.md). The identities of every non-retained result were not preserved and must not be invented retrospectively.

The aggregate pilot remains in [search-log.md](search-log.md) and the grouped dispositions remain in [screening-record.md](screening-record.md). Neither record may be represented as a complete result-level ledger.

## Corrective repeat-search ledger

### Corrective Round CR1 — Query CR1-Q01

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
(software OR "software-intensive system" OR "information system") (sociotechnical OR "socio-technical") (definition OR model OR framework OR theory OR boundary)
```

Returned results: 22

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-001 | CR1 | CR1-Q01 | 1 | Software System (glossary) — SEBoK | `sebokwiki.org/wiki/Software_System_(glossary)` | None | Retain | Normative definition of software system; relevant to boundary terminology, not observed interaction | S044 |
| CR1-002 | CR1 | CR1-Q01 | 2 | *Design Research in Information Systems*, software-intensive-systems chapter | `cur.ac.rw/.../2010_Book_DesignResearchInInformationSys.pdf` | None | Retain | Chapter summary identifies human, software, and platform layers and their interfaces | S045 |
| CR1-003 | CR1 | CR1-Q01 | 3 | Building and evaluating a theory of architectural technical debt in software-intensive systems | DOI `10.1016/j.jss.2021.110925` | None | Retain | Empirical theory appears to connect architecture, communication, organizational context, and change consequences | S046 |
| CR1-004 | CR1 | CR1-Q01 | 4 | TalTech sociotechnical-systems PhD thesis | `digikogu.taltech.ee/.../5d5557a2-05e7-46b5-ae90-21204dacd4a1` | None | Retain provisionally | Thesis appears to compare sociotechnical definitions and levels; identity and quality require screening | S047 |
| CR1-005 | CR1 | CR1-Q01 | 5 | Towards Distributed Sociotechnical System for Reporting Critical Laboratory Results | `scitepress.org/Papers/2013/43291/43291.pdf` | None | Retain | Bounded healthcare information system with human roles, software agents, processes, and communication outcome | S048 |
| CR1-006 | CR1 | CR1-Q01 | 6 | Agile Software Engineering Methodology for Information Systems' Integration Projects | `kodu.ut.ee/~kuldarta/Papers/Fail_TN2017.pdf` | None | Retain | Integration systems, organizational ownership, human elements, and changing boundaries are explicit | S049 |
| CR1-007 | CR1 | CR1-Q01 | 7 | Sociotechnical cyber-physical systems / resilient-systems article | `iaras.org/iaras/filedownloads/ijoc/2016/005-0020.pdf` | None | Retain provisionally | Appears directly relevant, but source identity and journal quality are unclear | S050 |
| CR1-008 | CR1 | CR1-Q01 | 8 | Information system development — ScienceDirect Topics | `sciencedirect.com/topics/computer-science/information-system-development` | None | Do not retain | Aggregated tertiary topic page; use only to locate original chapters |
| CR1-009 | CR1 | CR1-Q01 | 9 | Technology Developer — ScienceDirect Topics | `sciencedirect.com/topics/computer-science/technology-developer` | None | Do not retain | Aggregated tertiary topic page rather than a stable original source |
| CR1-010 | CR1 | CR1-Q01 | 10 | Requirements Engineering — educational ebook page | `ebooks.inflibnet.ac.in/csp8/chapter/requirements-engineering-re/` | None | Do not retain | Educational secondary page; original sources preferred for definitions |
| CR1-011 | CR1 | CR1-Q01 | 11 | Information system — offline Wikipedia mirror | `wiki.km6slftech.com/.../Information_system` | None | Do not retain | Tertiary reference mirror |
| CR1-012 | CR1 | CR1-Q01 | 12 | The large-scale structure of software-intensive systems | `pmc.ncbi.nlm.nih.gov/articles/PMC3262302/` | None | Retain provisionally | Conceptual systems-boundary discussion explicitly includes people, policies, documents, relationships, and emergent results | S051 |
| CR1-013 | CR1 | CR1-Q01 | 13 | Socio technical systems — LSCITS slides | `slideshare.net/.../socio-technical-systems/5876595` | None | Do not retain | Teaching slides; use only for discovery of original material |
| CR1-014 | CR1 | CR1-Q01 | 14 | IEEE 1471 — Wikipedia | `wikipedia.org/wiki/IEEE_1471` | None | Do not retain | Tertiary reference; standard or original record required |
| CR1-015 | CR1 | CR1-Q01 | 15 | Virtual System Acquisition: Approach and Transitions | `ics.uci.edu/~wscacchi/Papers/VISTA/VISTA.html` | None | Retain | Software acquisition account explicitly connects technical and organizational transitions | S052 |
| CR1-016 | CR1 | CR1-Q01 | 16 | Defining and documenting execution viewpoints for a large and complex software-intensive system | `sciencedirect.com/science/article/abs/pii/S016412121000316X` | None | Do not retain at this stage | Returned summary is architectural and technical; no material social or organizational relationship is visible |
| CR1-017 | CR1 | CR1-Q01 | 17 | System Architecture — IEEE Technology Navigator | `technav.ieee.org/topic/system-architecture/` | None | Do not retain | Aggregated reference page; original standard or research source preferred |
| CR1-018 | CR1 | CR1-Q01 | 18 | View model — Wikipedia | `wikipedia.org/wiki/View_model` | None | Do not retain | Tertiary reference |
| CR1-019 | CR1 | CR1-Q01 | 19 | Self-Adaptation in Industry: A Survey | arXiv:2211.03116 | None | Do not retain at this stage | Summary concerns automated feedback and technical adaptation; no material human or organizational interaction is visible |
| CR1-020 | CR1 | CR1-Q01 | 20 | Superintelligence Safety: A Requirements Engineering Perspective | arXiv:1909.12152 | None | Do not retain | AI-future scope reserved for later research and no chapter-relevant interaction is visible |
| CR1-021 | CR1 | CR1-Q01 | 21 | Review and Analysis of UML Issues for Software-Intensive Systems | arXiv:1001.4192 | None | Do not retain | Technical modeling discussion with no visible nontechnical interaction |
| CR1-022 | CR1 | CR1-Q01 | 22 | Modeling Adaptive Self-healing Systems | arXiv:2304.12773 | None | Do not retain | Technical self-healing and tool-support focus with no visible human or organizational relationship |

CR1-Q01 disposition summary: 9 retained candidates, 13 not retained at title/summary screening, 0 duplicates within the returned list. No full text was screened.

### Corrective Round CR1 — Query CR1-Q02

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
("software development" OR "software maintenance" OR "software operation") (organization OR team OR coordination OR communication OR ownership) (empirical OR observation OR ethnography OR survey OR "case study")
```

Returned results: 34

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-023 | CR1 | CR1-Q02 | 1 | *A Study in Software Maintenance* — SEI library record | `sei.cmu.edu/library/a-study-in-software-maintenance/` | None | Retain | Interviews across eight government maintenance projects connect tools, procedures, communication, status, and maintainability concerns | S053 |
| CR1-024 | CR1 | CR1-Q02 | 2 | *A Study in Software Maintenance* — SEI Insights mirror | `insights.sei.cmu.edu/library/a-study-in-software-maintenance/` | CR1-023 / S053 | Duplicate | Same SEI report and summary as rank 1 | S053 |
| CR1-025 | CR1 | CR1-Q02 | 3 | An empirical study of software maintenance tasks | DOI `10.1002/smr.4360070104` | None | Do not retain at this stage | Summary reports task characteristics and programming-language correlations but exposes no material social–technical relationship |
| CR1-026 | CR1 | CR1-Q02 | 4 | The Social Context of Software Maintenance | `researchgate.net/publication/4283937_The_Social_Context_of_Software_Maintenance` | None | Retain | Ethnographic study explicitly relates source-code dependencies, expertise, communication, coordination, and code viability | S054 |
| CR1-027 | CR1 | CR1-Q02 | 5 | Team knowledge management within an outsourced business systems software maintenance environment | `repository.uwl.ac.uk/id/eprint/3176/` | None | Retain | Grounded-theory case links outsourced maintenance teams, knowledge-management processes, and maintenance capability | S055 |
| CR1-028 | CR1 | CR1-Q02 | 6 | *A Study in Software Maintenance* — SEI PDF | `sei.cmu.edu/asset_files/TechnicalReport/1993_005_001_16172.pdf` | CR1-023 / S053 | Duplicate | Full-report location for the same SEI record returned at ranks 1 and 2 | S053 |
| CR1-029 | CR1 | CR1-Q02 | 7 | A longitudinal study of development and maintenance | `sciencedirect.com/science/article/pii/S0950584910000431` | None | Retain | Repeated organizational surveys relate IT work allocation and portfolio evolution to changing organizational needs | S056 |
| CR1-030 | CR1 | CR1-Q02 | 8 | Team-external coordination in large-scale software development projects | DOI `10.1002/smr.2297` | None | Retain | Two-project case study examines coordination structures, technical dependencies, and project impact | S057 |
| CR1-031 | CR1 | CR1-Q02 | 9 | Managing Software Risks in Maintenance Projects, from a Vendor Perspective | `ideas.repec.org/a/igg/jitpm0/v8y2017i1p35-54.html` | None | Retain provisionally | Case summary connects geo-cultural distribution, delegated ownership, and maintenance-project risk; source quality needs appraisal | S058 |
| CR1-032 | CR1 | CR1-Q02 | 10 | Sociotechnical Coordination and Collaboration in Open Source Software | `microsoft.com/en-us/research/publication/sociotechnical-coordination-and-collaboration-in-open-source-software/` | None | Retain | Empirical program explicitly studies relationships among social behavior, development behavior, productivity, and quality in OSS | S059 |
| CR1-033 | CR1 | CR1-Q02 | 11 | The Power of Words in Agile vs. Waterfall Development | DOI `10.1016/j.jss.2024.112243` | None | Retain | Organizational case relates development paradigm and communication-channel formality to written collaboration patterns | S060 |
| CR1-034 | CR1 | CR1-Q02 | 12 | An empirical study of maintenance issues within process improvement programmes in the software industry — Limerick record | `pure.ul.ie/en/publications/an-empirical-study-of-maintenance-issues-within-process-improveme/` | None | Retain provisionally | Empirical maintenance/process-improvement scope appears relevant, but the returned summary is too thin to establish the precise relationship | S061 |
| CR1-035 | CR1 | CR1-Q02 | 13 | An empirical study of maintenance issues within process improvement programmes — Hertfordshire record | `researchprofiles.herts.ac.uk/en/publications/an-empirical-study-of-maintenance-issues-within-process-improveme/` | CR1-034 / S061 | Duplicate | Same title, year, and publication as rank 12 | S061 |
| CR1-036 | CR1 | CR1-Q02 | 14 | Software maintenance — Wikipedia | `wikipedia.org/wiki/Software_maintenance` | None | Do not retain | Tertiary reference page |
| CR1-037 | CR1 | CR1-Q02 | 15 | Evaluating the Evidence: Lessons from Ethnography | `citeseerx.ist.psu.edu/document?doi=cd5b82fed23a04f6b62c95fbad4686cc7c570376` | None | Do not retain | Methodological discussion about ethnographic evidence; returned summary does not identify a chapter-relevant empirical result |
| CR1-038 | CR1 | CR1-Q02 | 16 | Domain-Driven Design in Practice: A Mining Study of Maintenance and Evolution in Open-Source Repositories | arXiv:2606.23984 | None | Do not retain | Future-study protocol with no reported observations; technical repository focus also lacks a visible organizational relationship |
| CR1-039 | CR1 | CR1-Q02 | 17 | SWEBOK Guide 2004 lecture-hosted PDF | `csun.edu/~twang/595OSE/LectureSlides/SWEBOK_Guide_2004.pdf` | None | Do not retain at this stage | Normative body-of-knowledge copy returned for generic maintenance organization; no distinct empirical contribution visible for this query |
| CR1-040 | CR1 | CR1-Q02 | 18 | On The Gap Between Software Maintenance Theory and Practitioners' Approaches | arXiv:2104.03824 | None | Retain | Survey of 112 practitioners in 92 companies directly compares research techniques and maintenance practice | S062 |
| CR1-041 | CR1 | CR1-Q02 | 19 | Perspectives on Improving Software Maintenance | `citeseerx.ist.psu.edu/document?doi=d5df8f4455c90d103a731be7fee76c6216e0c8dc` | None | Do not retain at this stage | Fragmentary summary does not establish source identity, method, or a bounded social–technical relationship |
| CR1-042 | CR1 | CR1-Q02 | 20 | Software Project Management — library-hosted textbook PDF | `thuvien.utm.edu.vn/ktpm/ths/14..pdf` | None | Do not retain | Educational secondary source; no inspectable original study visible |
| CR1-043 | CR1 | CR1-Q02 | 21 | Maintaining Smart Contracts on Ethereum | arXiv:2007.00286 | None | Do not retain at this stage | Maintenance survey summary is principally technical and exposes no material team, organizational, or process relationship |
| CR1-044 | CR1 | CR1-Q02 | 22 | Agile in the context of Software Maintenance: A Case Study | `bth.diva-portal.org/smash/get/diva2:868367/FULLTEXT02.pdf` | None | Retain provisionally | Bounded case appears to connect agile process, team morale/visibility, and maintenance sustainability; thesis quality requires appraisal | S063 |
| CR1-045 | CR1 | CR1-Q02 | 23 | Software Engineering for AI-Based Systems: A Survey | arXiv:2105.01984 | None | Do not retain | Broad technical mapping study; AI scope is reserved and no chapter-relevant organizational interaction is visible |
| CR1-046 | CR1 | CR1-Q02 | 24 | Outline of software development — Wikipedia | `wikipedia.org/wiki/Outline_of_software_development` | None | Do not retain | Tertiary outline |
| CR1-047 | CR1 | CR1-Q02 | 25 | Reddit: Ano po ginagawa ng isang Software Maintenance Engineer? | `reddit.com/r/PinoyProgrammer/comments/187cjrc` | None | Do not retain | Informal practitioner discussion without an inspectable research method |
| CR1-048 | CR1 | CR1-Q02 | 26 | Software — Wikipedia | `wikipedia.org/wiki/Software` | None | Do not retain | Tertiary reference and not specific to the question |
| CR1-049 | CR1 | CR1-Q02 | 27 | Software engineering — Wikipedia | `wikipedia.org/wiki/Software_engineering` | None | Do not retain | Tertiary reference |
| CR1-050 | CR1 | CR1-Q02 | 28 | Software diagnosis — Wikipedia | `wikipedia.org/wiki/Software_diagnosis` | None | Do not retain | Tertiary reference; generic coordination statement is not inspectable evidence |
| CR1-051 | CR1 | CR1-Q02 | 29 | Reddit: Seeking Insight — maintaining applications | `reddit.com/r/PinoyProgrammer/comments/184xgrw` | None | Do not retain | Informal career discussion without an inspectable research method |
| CR1-052 | CR1 | CR1-Q02 | 30 | Reddit: Why is Software Maintenance Important After Custom Development? | `reddit.com/r/u_milkywayinfotech/comments/xkwdln` | None | Do not retain | Promotional/informal commentary without an inspectable method |
| CR1-053 | CR1 | CR1-Q02 | 31 | Software evolution — Wikipedia | `wikipedia.org/wiki/Software_evolution` | None | Do not retain | Tertiary reference; cited originals may be pursued separately |
| CR1-054 | CR1 | CR1-Q02 | 32 | Reddit: Development vs maintenance | `reddit.com/r/cscareerquestions/comments/ew52ub` | None | Do not retain | Informal career discussion without an inspectable research method |
| CR1-055 | CR1 | CR1-Q02 | 33 | Reddit: Experience in maintenance projects and guidance to stay motivated | `reddit.com/r/developersIndia/comments/1c29r90` | None | Do not retain | Informal advice thread without an inspectable research method |
| CR1-056 | CR1 | CR1-Q02 | 34 | Reddit: Is software maintenance not hot? | `reddit.com/r/ExperiencedDevs/comments/m7w8mo` | None | Do not retain | Practitioner anecdotes may suggest vocabulary but cannot support the evidence path |

CR1-Q02 disposition summary: 11 retained candidates, 20 not retained at title/summary screening, and 3 duplicate result instances. No full text was screened.

### Corrective Round CR1 — Query CR1-Q03

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
(software OR "digital infrastructure") (sociotechnical OR "technical and organizational" OR "technical and social") (evolution OR adaptation OR behavior OR outcome OR reliability OR failure)
```

Returned results: 12

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-057 | CR1 | CR1-Q03 | 1 | Digital “x”—Charting a Path for Digital-Themed Research | DOI `10.1287/isre.2022.1186` | None | Retain | Conceptual account explicitly connects changing digital-infrastructure properties, organizational settings, joint agency, behavior, and innovation outcomes | S064 |
| CR1-058 | CR1 | CR1-Q03 | 2 | Noospheric Technologies in Knowledge-Intensive Socio-Technical Systems | `mdpi.com/1999-5903/18/8/403` | None | Do not retain | Broad conceptual synthesis centered on AI, education, science, and planetary-scale cognition; direct software-system materiality is insufficient and AI evaluation is reserved |
| CR1-059 | CR1 | CR1-Q03 | 3 | From Concept to Practice: Lessons From the Balanced Nursing Teams Decision-Support System — JMIR | `nursing.jmir.org/2026/1/e92417` | None | Retain | Eight-year reflective case connects software/data infrastructure, stakeholders, organizational authority, governance, and adoption outcome | S065 |
| CR1-060 | CR1 | CR1-Q03 | 4 | Perceptions of artificial intelligence in academic teaching and research | DOI `10.1186/s41239-025-00546-w` | None | Do not retain | AI adoption in education is outside the chapter's present software-system focus and the project's reserved AI scope |
| CR1-061 | CR1 | CR1-Q03 | 5 | Beyond the hype of Robotic Process Automation: on conditions needed to implement RPA in organizations | DOI `10.1007/s10257-026-00721-0` | None | Retain | Structured review connects automation tools and existing infrastructure with actors, organizational capabilities, processes, policies, governance, and adoption conditions | S066 |
| CR1-062 | CR1 | CR1-Q03 | 6 | Distributed-systems and organizational-agility article — KMF Publishers | `kmf-publishers.com/jopar-25040401/` | None | Do not retain | Returned claims are broad and causal-sounding, while publisher quality and inspectable method are unclear; stronger sources are required |
| CR1-063 | CR1 | CR1-Q03 | 7 | AI as a socio-technical actor: rethinking definitions for ethics and governance | DOI `10.1007/s43681-026-01123-1` | None | Do not retain | Conceptual AI ethics/governance article falls within reserved AI scope and is not direct evidence about software evolution |
| CR1-064 | CR1 | CR1-Q03 | 8 | From Concept to Practice: Lessons From the Balanced Nursing Teams Decision-Support System — PMC | `pmc.ncbi.nlm.nih.gov/articles/PMC13160518/` | CR1-059 / S065 | Duplicate | Open-repository copy of the same JMIR article returned at rank 3 | S065 |
| CR1-065 | CR1 | CR1-Q03 | 9 | Layered Control Architectures for AI Safety | `mdpi.com/2079-8954/14/4/447` | None | Do not retain | Proposed AI-safety framework, not an observed software-system evolution or outcome; AI scope is reserved |
| CR1-066 | CR1 | CR1-Q03 | 10 | The ‘How’ of Digital Transformation: Understanding the Micro-Processes of Digital Transformation Strategising and Internal Platformisation Coevolution | DOI `10.1007/s10796-025-10635-w` | None | Retain | Coevolution account explicitly concerns reciprocal adaptation between internal platforms, strategy, organizational elements, and emergent behavior | S067 |
| CR1-067 | CR1 | CR1-Q03 | 11 | Responsible innovation for digital identity systems | `cambridge.org/core/journals/data-and-policy/article/.../F21D5B33C5639357466867941D0EFF00` | None | Retain provisionally | Bounded digital-identity ecosystem names technical, organizational, commercial, public-sector, developer, user, and regulatory participants and their interactions | S068 |
| CR1-068 | CR1 | CR1-Q03 | 12 | *The State of Open Data: Histories and Horizons* | `idrc-crdi.ca/sites/default/files/openebooks/CPOD/9781552505960.html` | None | Do not retain at this stage | Broad edited-book page; returned passage concerns access intermediaries but does not establish a specific software system, outcome, or citable chapter unit |

CR1-Q03 disposition summary: 5 retained candidates, 6 not retained at title/summary screening, and 1 duplicate result instance. No full text was screened.

### Corrective Round CR1 — Query CR1-Q04

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
("software incident" OR "software failure" OR "software outage") (organization OR process OR communication OR policy OR incentive) (investigation OR analysis OR case)
```

Returned results: 28

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-069 | CR1 | CR1-Q04 | 1 | Forensic software engineering: are software failures symptomatic of systemic problems? | DOI `10.1016/S0925-7535(01)00086-8` | None | Retain | Case-based analysis explicitly relates software failures to investment, management leadership, development-team communication, and investigation framing | S069 |
| CR1-070 | CR1 | CR1-Q04 | 2 | Forensic software engineering — abstract record | `sciencedirect.com/science/article/abs/pii/S0925753501000868` | CR1-069 / S069 | Duplicate | Same DOI, title, journal, and article as rank 1 | S069 |
| CR1-071 | CR1 | CR1-Q04 | 3 | A case study in the integration of accident reports and constructive design documents | `sciencedirect.com/science/article/abs/pii/S095183200000082X` | None | Retain provisionally | Case concerns how evidence from expert investigations is represented and transferred to interface designers and systems engineers; software-system directness needs confirmation | S070 |
| CR1-072 | CR1 | CR1-Q04 | 4 | Software in military aviation and drone mishaps: Analysis and recommendations for the investigation process | `sciencedirect.com/science/article/pii/S0951832015000083` | None | Retain | Connects software behavior with development, procurement, investigation processes, and deeper systemic accident conditions | S071 |
| CR1-073 | CR1 | CR1-Q04 | 5 | A near-miss management system architecture for the forensic investigation of software failures | `sciencedirect.com/science/article/abs/pii/S0379073815004314` | None | Retain provisionally | Proposed architecture connects technical evidence availability, organizational policy events, investigation processes, and prevention; evaluation status must be established | S072 |
| CR1-074 | CR1 | CR1-Q04 | 6 | Software contributions to aircraft adverse events | `sciencedirect.com/science/article/pii/S0951832013000070` | None | Retain | Multiple case studies analyze software mechanisms within operational contexts and broader system interactions in safety events | S073 |
| CR1-075 | CR1 | CR1-Q04 | 7 | Understanding Software Failures Through Incident Report Analysis | `repository.tudelft.nl/file/File_74526c05-9ef8-4fb7-a465-3434a20ca7ec` | None | Retain provisionally | Incident-report study appears to connect product faults, process faults, miscommunication, post-incident practices, and cross-organizational learning | S074 |
| CR1-076 | CR1 | CR1-Q04 | 8 | Root Cause Analysis in Software Development: Bug Postmortem Guide | `priz.guru/root-cause-analysis-software-development/` | None | Do not retain | Commercial/practitioner guidance without an inspectable research method |
| CR1-077 | CR1 | CR1-Q04 | 9 | Be more familiar with our enemies and pave the way forward: A review of the roles bugs played in software failures | `sciencedirect.com/science/article/abs/pii/S0164121217301334` | None | Retain provisionally | Review of 59 accidents may connect software contributions to harmful outcomes, but incident provenance and causal classification require close appraisal | S075 |
| CR1-078 | CR1 | CR1-Q04 | 10 | Why Software Fails | `spectrum.ieee.org/why-software-fails` | None | Do not retain at this stage | Journalistic synthesis makes broad management and cultural claims; use for discovery of original cases, not as primary evidence |
| CR1-079 | CR1 | CR1-Q04 | 11 | Elephant in the Room — National Preparedness Commission | `nationalpreparednesscommission.uk/publications/elephant-in-the-room/` | None | Retain provisionally | Public-policy report addresses software failure consequences and recommendations across organizations, standards, professions, procurement, and government | S076 |
| CR1-080 | CR1 | CR1-Q04 | 12 | A near-miss management system architecture — PubMed | `pubmed.ncbi.nlm.nih.gov/26727616/` | CR1-073 / S072 | Duplicate | Bibliographic record for the same near-miss architecture article at rank 5 | S072 |
| CR1-081 | CR1 | CR1-Q04 | 13 | Software Failures and IT Management's Repeated Mistakes | `spectrum.ieee.org/it-management-software-failures` | None | Do not retain at this stage | Journalistic retrospective with broad claims; named cases should be traced to original investigations |
| CR1-082 | CR1 | CR1-Q04 | 14 | Failures and Fixes: A Study of Software System Incident Response | IEEE ICSME PDF | S035 | Duplicate | Published version of the already retained incident-response candidate S035 | S035 |
| CR1-083 | CR1 | CR1-Q04 | 15 | Near-miss management system architecture — University of Pretoria manuscript | `repository.up.ac.za/server/api/core/bitstreams/d79822bd-aa08-41aa-ac6b-64ef057b27aa/content` | CR1-073 / S072 | Duplicate | Manuscript copy of the near-miss architecture article at rank 5 | S072 |
| CR1-084 | CR1 | CR1-Q04 | 16 | NASA software-incident classification report, 2023 | `ntrs.nasa.gov/api/citations/20230012154/downloads/8-17-23%2020230012154.pdf` | None | Retain | Public technical report classifies incidents across industries and exposes software, automation, communication, operational context, and outcomes | S077 |
| CR1-085 | CR1 | CR1-Q04 | 17 | A Near-Miss Analysis Model for Improving software-failure investigation | `repository.up.ac.za/bitstreams/c8b710b0-ef87-43d7-a94e-4f438cc3380b/download` | None | Retain provisionally | Thesis-level work appears to analyze investigation limitations and an outage case; relationship to S072 and evidentiary independence require reconciliation | S078 |
| CR1-086 | CR1 | CR1-Q04 | 18 | Exploring the extent of similarities in software failures across industries using LLMs | arXiv:2408.03528 | None | Do not retain | LLM-based extraction is reserved AI scope and the summary provides no independently appraised incident evidence |
| CR1-087 | CR1 | CR1-Q04 | 19 | Reflections on Software Failure Analysis | arXiv:2209.02930 | None | Do not retain at this stage | Returned summary concerns defect characteristics without a visible organizational relationship or bounded outcome |
| CR1-088 | CR1 | CR1-Q04 | 20 | Application of Orthogonal Defect Classification for Software Reliability Analysis | arXiv:2205.12080 | None | Do not retain | Technical reliability-classification method with no visible social or organizational element |
| CR1-089 | CR1 | CR1-Q04 | 21 | The landscape of software failure cause models | arXiv:1603.04335 | None | Do not retain at this stage | Systematic mapping appears focused on technical fault classification, testing, and reliability prediction; no material nontechnical relationship is visible |
| CR1-090 | CR1 | CR1-Q04 | 22 | Reddit: Is there any case of a business failing due to their software? | `reddit.com/r/webdev/comments/1864h1q` | None | Do not retain | Informal anecdotes without verified case evidence or method |
| CR1-091 | CR1 | CR1-Q04 | 23 | List of software bugs — Wikipedia | `wikipedia.org/wiki/List_of_software_bugs` | None | Do not retain | Tertiary list; named investigations may support later discovery |
| CR1-092 | CR1 | CR1-Q04 | 24 | Threat (computer security) — Wikipedia | `wikipedia.org/wiki/Threat_(computer_security)` | None | Do not retain | Tertiary reference and not responsive to the incident-interaction question |
| CR1-093 | CR1 | CR1-Q04 | 25 | Software quality — Wikipedia | `wikipedia.org/wiki/Software_quality` | None | Do not retain | Tertiary reference |
| CR1-094 | CR1 | CR1-Q04 | 26 | Reddit: interesting software failures of 2022 | `reddit.com/r/learnprogramming/comments/yykya9` | None | Do not retain | Informal discussion; use only to discover original incident reports |
| CR1-095 | CR1 | CR1-Q04 | 27 | Reddit: worst catastrophes caused by poorly built software | `reddit.com/r/learnprogramming/comments/tnw8ef` | None | Do not retain | Informal and partly disputed anecdotes without source verification |
| CR1-096 | CR1 | CR1-Q04 | 28 | Reddit: Cost of Software Failure | `reddit.com/r/u_Flexbase/comments/cq7hc8` | None | Do not retain | Promotional secondary claim without inspectable provenance |

CR1-Q04 disposition summary: 10 retained candidates, 14 not retained at title/summary screening, and 4 duplicate result instances. No full text was screened.

### Corrective Round CR1 — Query CR1-Q05

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
(sociotechnical OR "socio-technical") (software OR computing) (critique OR limitation OR alternative OR causality OR "construct validity")
```

Returned results: 26

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-097 | CR1 | CR1-Q05 | 1 | A critical view of factors affecting successful application of normative and socio-technical systems development approaches | DOI `10.1016/0378-7206(86)90059-5` | None | Retain | Direct critique identifies six problems in applying sociotechnical IS development, including conflict, roles, short-term success, maintenance, and post-implementation synchronization | S079 |
| CR1-098 | CR1 | CR1-Q05 | 2 | Conceptual Challenges for Advancing the Socio-Technical Underpinnings of Health Informatics | `pmc.ncbi.nlm.nih.gov/articles/PMC3097018/` | None | Retain | Directly critiques fragmented theory, technocentric framing, weak social-science grounding, narrow boundaries, and retrospective causal limitations | S080 |
| CR1-099 | CR1 | CR1-Q05 | 3 | Putting the technical back into socio-technical systems research | DOI `10.1016/j.ijmedinf.2006.05.026` | None | Retain | Critiques insufficient technical specificity, lack of translation into design, and possible anti-technology imbalance within STS analysis | S081 |
| CR1-100 | CR1 | CR1-Q05 | 4 | Analyzing information systems development: A comparison and analysis of eight IS development approaches | DOI `10.1016/S0306-4379(96)00028-2` | None | Retain | Compares technical, sociotechnical, social, objective, subjective, and intersubjective assumptions as alternative accounts | S082 |
| CR1-101 | CR1 | CR1-Q05 | 5 | Socio-technical systems: From design methods to systems engineering | `sciencedirect.com/science/article/pii/S0953543810000652` | S004 | Duplicate | Same Baxter and Sommerville article already retained as S004 | S004 |
| CR1-102 | CR1 | CR1-Q05 | 6 | How “Sociotechnical” Is Our IS Research? An Assessment and Possible Ways Forward | `research.cbs.dk/en/publications/how-sociotechnical-is-our-is-research-an-assessment-and-possible-/` | None | Retain | Assessment distinguishes eight ways technical and social elements appear in IS research, material to construct use and operationalization | S083 |
| CR1-103 | CR1 | CR1-Q05 | 7 | The Who, What, How of Software Engineering Research — Microsoft Research | `microsoft.com/en-us/research/publication/the-who-what-how-of-software-engineering-research-a-socio-technical-framework/` | S007 | Duplicate | Publisher record for existing candidate S007 | S007 |
| CR1-104 | CR1 | CR1-Q05 | 8 | Socio-Technical Grounded Theory for Software Engineering | arXiv:2103.14235 | None | Do not retain at this stage | Research-method proposal for grounded theory; returned summary does not critique the chapter construct or report a software-system interaction |
| CR1-105 | CR1 | CR1-Q05 | 9 | Assessing causal claims about complex engineered systems with quantitative data | `ideas.repec.org/a/wly/syseng/v20y2017i6p483-496.html` | None | Retain | Direct treatment of internal, external, and construct validity for causal claims about complex engineered sociotechnical systems | S084 |
| CR1-106 | CR1 | CR1-Q05 | 10 | The Who, What, How of Software Engineering Research — arXiv | arXiv:1905.12841 | S007 | Duplicate | Preprint/version of existing candidate S007 | S007 |
| CR1-107 | CR1 | CR1-Q05 | 11 | Explaining sociotechnical transitions: A critical realist perspective | DOI record via `ideas.repec.org/a/eee/respol/v47y2018i7p1267-1282.html` | None | Retain provisionally | Direct critique addresses heuristic use, weak causal explanation, untested alternatives, mechanism contingency, and single-case dependence; software transferability needs appraisal | S085 |
| CR1-108 | CR1 | CR1-Q05 | 12 | Socio-Technical Theory — TheoryHub | `open.ncl.ac.uk/theories/9/socio-technical-theory/` | None | Do not retain | Tertiary academic theory summary; use to locate original critiques only |
| CR1-109 | CR1 | CR1-Q05 | 13 | A Sociotechnical Approach to Evaluating the Impact of ICT on Clinical Care Environments | `pmc.ncbi.nlm.nih.gov/articles/PMC3096882/` | None | Retain provisionally | Evaluation account contrasts technical performance with social/technical effects and implementation assumptions; critical contribution and evidence role need confirmation | S086 |
| CR1-110 | CR1 | CR1-Q05 | 14 | A Reappraisal of Sociotechnical Systems Theory | DOI `10.1177/001872677803101204` | S010 | Duplicate | Same Kelly 1978 critique already retained as S010 | S010 |
| CR1-111 | CR1 | CR1-Q05 | 15 | In Search of Socio-Technical Congruence: A Large-Scale Longitudinal Study | arXiv:2105.08198 | S016 | Duplicate | Same candidate already retained and identity-verified as S016 | S016 |
| CR1-112 | CR1 | CR1-Q05 | 16 | Socio-Technical Approaches to Complex Phenomena: An Analysis | `d-scholarship.pitt.edu/9107/1/CelikS_etd2006.pdf` | None | Retain provisionally | Dissertation appears to address method, construct/internal validity, and comparative applicability of sociotechnical analysis; software directness is unresolved | S087 |
| CR1-113 | CR1 | CR1-Q05 | 17 | Sociotechnical or “socio-technical”? A Bibliometric Analysis of Conceptual Divergence | `chtm.unm.edu/nqvl-qcap/sociotechnical-journal-of-innovation-and-knowledge.pdf` | None | Retain provisionally | Conceptual-divergence analysis may expose inconsistent construct use across research traditions; provenance and publication quality require confirmation | S088 |
| CR1-114 | CR1 | CR1-Q05 | 18 | Sociotechnical system — Wikipedia | `wikipedia.org/wiki/Sociotechnical_system` | None | Do not retain | Tertiary reference |
| CR1-115 | CR1 | CR1-Q05 | 19 | The Sociotechnical Approach: the challenges for software… | `is.cos.ufrj.br/wp-content/uploads/2019/05/the-sociotechnical-approach.pdf` | None | Retain provisionally | Appears to critique subordination of human/social aspects in software work and argues for interdisciplinary analysis; full identity unresolved | S089 |
| CR1-116 | CR1 | CR1-Q05 | 20 | Sociotechnical Harms of Algorithmic Systems | arXiv:2210.05791 | None | Do not retain | Algorithmic/AI harms taxonomy belongs to reserved AI scope and does not directly test the chapter's software-system construct |
| CR1-117 | CR1 | CR1-Q05 | 21 | Sociotechnology — Wikipedia | `wikipedia.org/wiki/Sociotechnology` | None | Do not retain | Tertiary reference concerning a related but distinct term |
| CR1-118 | CR1 | CR1-Q05 | 22 | A Sociotechnical Approach to Understand an… — Wits repository | `wiredspace.wits.ac.za/bitstreams/5578c8a5-4045-4c26-932a-4304aa48a87e/download` | None | Retain provisionally | Case appears to compare a software-development method with a sociotechnical framework and reports a boundary limitation; identity and rigor unresolved | S090 |
| CR1-119 | CR1 | CR1-Q05 | 23 | Social construction of technology — Wikipedia | `wikipedia.org/wiki/Social_construction_of_technology` | None | Do not retain | Tertiary account of a related alternative tradition; original critical sources should be located |
| CR1-120 | CR1 | CR1-Q05 | 24 | Social technology — Wikipedia | `wikipedia.org/wiki/Social_technology` | None | Do not retain | Tertiary reference and conceptually distinct from the target construct |
| CR1-121 | CR1 | CR1-Q05 | 25 | Sociomateriality — Wikipedia | `wikipedia.org/wiki/Sociomateriality` | None | Do not retain | Tertiary summary; original sociomaterial scholarship is required for an alternative explanation |
| CR1-122 | CR1 | CR1-Q05 | 26 | Enid Mumford — Wikipedia | `wikipedia.org/wiki/Enid_Mumford` | None | Do not retain | Biographical tertiary page; named original work may support later discovery |

CR1-Q05 disposition summary: 12 retained candidates, 9 not retained at title/summary screening, and 5 duplicate result instances. No full text was screened.

### Corrective Round CR1 — Query CR1-Q06

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
("software development" OR "software operation" OR "software maintenance") (adaptation OR resilience OR workaround OR "ordinary work" OR recovery) (team OR organization OR user OR operator OR coordination)
```

Returned results: 0

The search interface explicitly returned “Empty search results” and reported that no results were found. Consequently, there are no result-level rows or dispositions for this query. The zero count is preserved as executed rather than silently replacing the approved query with a broader one.

CR1-Q06 disposition summary: 0 retained candidates, 0 not retained, and 0 duplicate result instances. No full text was screened. Because the exact query did not cover the intended resilience and ordinary-work concept, the already applicable targeted repeat searches remain open and must be separately identified and recorded.

### Corrective Round CR1 — Targeted Query CR1-T01

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
resilience engineering software operations incident response adaptation empirical study
```

Returned results: 29

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-123 | CR1 | CR1-T01 | 1 | Building and Revising Adaptive Capacity Sharing for Technical Incident Response | DOI `10.1016/j.apergo.2020.103240` | S036 | Duplicate | Same Cook and Long software-operations resilience case already retained as S036 | S036 |
| CR1-124 | CR1 | CR1-T01 | 2 | Building and Revising Adaptive Capacity Sharing — PubMed | `pubmed.ncbi.nlm.nih.gov/32927402/` | CR1-123 / S036 | Duplicate | Bibliographic record for the same S036 paper | S036 |
| CR1-125 | CR1 | CR1-T01 | 3 | Patterns of Learning: Emergency Response Operations in the North Sea | `mdpi.com/2412-3811/8/2/16` | None | Do not retain at this stage | Emergency-management resilience study; returned summary exposes no material software or digital-infrastructure element |
| CR1-126 | CR1 | CR1-T01 | 4 | Muddling through troubled water: resilient performance of incident management teams during Hurricane Harvey — PubMed | `pubmed.ncbi.nlm.nih.gov/32321378/` | None | Do not retain at this stage | Team adaptation is empirical, but technology is described only as a future design implication rather than an interacting element in the studied system |
| CR1-127 | CR1 | CR1-T01 | 5 | Muddling through troubled water — publisher record | DOI `10.1080/00140139.2020.1752820` | CR1-126 | Duplicate | Same Hurricane Harvey study returned at rank 4; canonical disposition remains not retained |
| CR1-128 | CR1 | CR1-T01 | 6 | REA Symposium paper on anomaly response in complex web operations | `open.lnu.se/index.php/rea/article/view/2420` | None | Retain | Case explicitly connects web-operation systems, anomaly response, incident-management work, postmortem framing, and tooling directions | S091 |
| CR1-129 | CR1 | CR1-T01 | 7 | Orchestrating through Whirlwind: Incident Management Teams during Hurricane Harvey | DOI `10.1177/1071181319631265` | None | Do not retain at this stage | Emergency-team coordination study; no software or digital-infrastructure relationship is visible in the returned record |
| CR1-130 | CR1 | CR1-T01 | 8 | Resilience Roundup summary of Building and Revising Adaptive Capacity Sharing | `resilienceroundup.com/issues/building-and-revising-adaptive-capacity-sharing-for-technical-incident-response-a-case-of-resilience-engineering/` | S036 | Do not retain | Practitioner summary of S036; use the original paper rather than this secondary page |
| CR1-131 | CR1 | CR1-T01 | 9 | Correlating SOC Maturity Levels with Incident Response Outcomes | `ijamjournal.org/ijam/publication/index.php/ijam/article/view/1056` | None | Do not retain at this stage | Source quality and reported maturity model validity are unclear; stronger cybersecurity evidence is required |
| CR1-132 | CR1 | CR1-T01 | 10 | Modeling an incident management team as a joint cognitive system | `sciencedirect.com/science/article/pii/S0950423018303280` | None | Do not retain at this stage | Disaster-response team model does not expose a material software element in the returned summary |
| CR1-133 | CR1 | CR1-T01 | 11 | Beyond procedures: Team reflection in a rail control centre to enhance resilience | DOI `10.1016/j.ssci.2016.08.013` | None | Do not retain at this stage | Relevant resilience mechanism, but the returned record does not identify software or digital infrastructure as an interacting element |
| CR1-134 | CR1 | CR1-T01 | 12 | Upgrading adaptation: How digital transformation promotes organizational resilience | DOI `10.1002/sej.1483` | None | Retain | Grounded-theory study connects digital capabilities, firm leaders, stakeholder needs, crisis adaptation, duration, and organizational outcomes | S092 |
| CR1-135 | CR1 | CR1-T01 | 13 | Failures and Fixes: A Study of Software System Incident Response | arXiv:2008.11192 | S035 | Duplicate | Preprint of existing candidate S035 | S035 |
| CR1-136 | CR1 | CR1-T01 | 14 | An Empirical Study of Architecting for Continuous Delivery and Deployment | arXiv:1808.08796 | None | Retain | Interviews and survey across organizations connect architecture, operations concerns, delivery practices, and resilience-related quality attributes | S093 |
| CR1-137 | CR1 | CR1-T01 | 15 | Software Engineering, Chapter 14 — Resilience engineering | `staff.emu.edu.tr/.../Sommerville2016 GlobAl_EdiTioN_Software_Engineering_TENT.pdf` | None | Do not retain | Educational textbook copy; useful for vocabulary, not primary evidence for this targeted search |
| CR1-138 | CR1 | CR1-T01 | 16 | Towards an Incident Management Framework in Proprietary Software Ecosystems | arXiv:2410.09320 | None | Do not retain at this stage | Returned summary describes a proposed framework and promised contribution, not reported empirical outcomes |
| CR1-139 | CR1 | CR1-T01 | 17 | Chaos Engineering for Enhanced Resilience of Cyber-Physical Systems | arXiv:2106.14962 | None | Do not retain at this stage | Technical fault-injection demonstration; no material human or organizational relationship is visible |
| CR1-140 | CR1 | CR1-T01 | 18 | Enhancing Incident Response Efficiency in Hybrid Cloud Environments using SOAR | `ijsrem.com/.../Enhancing-Incident-Response-Efficiency-in-Hybrid-Cloud-Environments-using-SOAR-A-Review-Study.pdf` | None | Do not retain | Low-provenance review with unclear primary evidence and method |
| CR1-141 | CR1 | CR1-T01 | 19 | Resilience engineering — Wikipedia | `wikipedia.org/wiki/Resilience_engineering` | None | Do not retain | Tertiary reference |
| CR1-142 | CR1 | CR1-T01 | 20 | Chaos-engineering research-validation article — JICRCR | `jicrcr.com/index.php/jicrcr/article/download/3253/2772/6970` | None | Do not retain | Source provenance is weak and returned causal claims are unsupported by visible method details |
| CR1-143 | CR1 | CR1-T01 | 21 | Chaos engineering — Wikipedia | `wikipedia.org/wiki/Chaos_engineering` | None | Do not retain | Tertiary reference |
| CR1-144 | CR1 | CR1-T01 | 22 | Operational response/resilience article — JSAER | `jsaer.com/download/vol-7-iss-3-2020/JSAER2020-7-3-353-369.pdf` | None | Do not retain | Unclear identity, provenance, and method; generic claims cannot enter the evidence path |
| CR1-145 | CR1 | CR1-T01 | 23 | Infrastructure self-healing article — JICRCR | `jicrcr.com/index.php/jicrcr/article/download/3151/2693/6731` | None | Do not retain | Technical infrastructure-performance focus and unclear source quality |
| CR1-146 | CR1 | CR1-T01 | 24 | AI-enhanced resilience operations article — JCSTS | `al-kindipublishers.org/index.php/jcsts/article/download/10643/9391` | None | Do not retain | AI-specific, weakly sourced, and outside the present chapter scope |
| CR1-147 | CR1 | CR1-T01 | 25 | Richard Cook — Wikipedia | `wikipedia.org/wiki/Richard_Cook_(safety_researcher)` | None | Do not retain | Tertiary biography; original works are already represented |
| CR1-148 | CR1 | CR1-T01 | 26 | Reddit: Application-level resilience engineering | `reddit.com/r/sre/comments/1dptscq` | None | Do not retain | Informal practitioner discussion without an inspectable method |
| CR1-149 | CR1 | CR1-T01 | 27 | Resilience (engineering and construction) — Wikipedia | `wikipedia.org/wiki/Resilience_(engineering_and_construction)` | None | Do not retain | Tertiary and outside software scope |
| CR1-150 | CR1 | CR1-T01 | 28 | Empirical software engineering — Wikipedia | `wikipedia.org/wiki/Empirical_software_engineering` | None | Do not retain | Tertiary reference and not responsive to the research question |
| CR1-151 | CR1 | CR1-T01 | 29 | Site reliability engineering — Wikipedia | `wikipedia.org/wiki/Site_reliability_engineering` | None | Do not retain | Tertiary overview; original empirical sources are required |

CR1-T01 disposition summary: 3 retained candidates, 23 not retained at title/summary screening, and 3 duplicate result instances. No full text was screened.

### Corrective Round CR1 — Targeted Query CR1-T02

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
Conway's law empirical study socio-technical congruence organization software architecture
```

Returned results: 34

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-152 | CR1 | CR1-T02 | 1 | An Evolutionary Perspective on Socio-Technical Congruence: The Rubber Band Effect | `researchgate.net/publication/261449303_...` | None | Retain provisionally | Proposes an evolutionary qualification in which communication and design structures change over time; reported result versus proposed replication must be separated | S094 |
| CR1-153 | CR1 | CR1-T02 | 2 | Socio-Technical Congruence in OSS Projects: Exploring Conway’s Law in FreeBSD | `researchgate.net/publication/264792620_...` | S017 | Duplicate | Same FreeBSD paper already retained as S017 | S017 |
| CR1-154 | CR1 | CR1-T02 | 3 | Empirical Study of Communication Structures and Barriers in Geographically Distributed Teams | DOI `10.1049/iet-sen.2015.0112` | None | Retain | Empirical organizational study reports conceptualization-dependent and mixed Conway evidence while examining communication barriers | S095 |
| CR1-155 | CR1 | CR1-T02 | 4 | *Socio-Technical Congruence in OSS Projects* — Tampere thesis | `trepo.tuni.fi/bitstream/handle/10024/212902/mahbubul_1300.pdf` | None | Retain provisionally | Thesis appears to examine Conway applicability and congruence in distributed OSS; dependence on S017 must be reconciled | S096 |
| CR1-156 | CR1 | CR1-T02 | 5 | A Systematic Mapping Study about Socio-Technical Congruence | `sciencedirect.com/science/article/abs/pii/S0950584916302798` | None | Retain | Maps STC proposals, empirical work, gaps, risks, and opportunities; useful for locating primary tests and assessing construct diversity | S097 |
| CR1-157 | CR1 | CR1-T02 | 6 | File-level Socio-Technical Congruence and Its Relationship with Bug Proneness in OSS Projects | `sciencedirect.com/science/article/pii/S0164121219301177` | None | Retain | Empirical study tests two file-level congruence measures against bug proneness in five OSS projects | S098 |
| CR1-158 | CR1 | CR1-T02 | 7 | Using Agents to Manage Socio-Technical Congruence in a Global Software Engineering Project | `sciencedirect.com/science/article/abs/pii/S0020025514000152` | None | Retain provisionally | Case evaluates an agent architecture intended to improve coordination and communication using STC measures | S099 |
| CR1-159 | CR1 | CR1-T02 | 8 | A Quantitative Study on Conway's Law in Technical Architectures | `fis.uni-bamberg.de/entities/publication/469e76b8-b10d-4366-8024-84cc572b815b` | None | Retain | Quantitative study correlates software modularity with collaboration-network characteristics | S100 |
| CR1-160 | CR1 | CR1-T02 | 9 | An Evolutionary Perspective on Socio-Technical Congruence — institutional record | `es.mdu.se/publications/3120-...` | CR1-152 / S094 | Duplicate | Institutional record for the same RESER 2013 paper at rank 1 | S094 |
| CR1-161 | CR1 | CR1-T02 | 10 | Conway's Law Revisited: The Evidence for a Task-Based Perspective | `researchgate.net/publication/220092727_...` | None | Retain | Presents qualifying evidence that architecture/communication alignment may apply differently to software and may require a task-level account | S101 |
| CR1-162 | CR1 | CR1-T02 | 11 | Using Software Repositories to Investigate Socio-Technical Congruence in Development Projects | `researchgate.net/publication/4252755_...` | None | Retain | Proposes and applies a quantitative congruence measure using development repositories and organizational performance | S102 |
| CR1-163 | CR1 | CR1-T02 | 12 | Empirical Study of Communication Structures and Barriers — UTS record | `opus.lib.uts.edu.au/handle/10453/44183` | CR1-154 / S095 | Duplicate | Repository record for the same IET Software paper at rank 3 | S095 |
| CR1-164 | CR1 | CR1-T02 | 13 | Tampere publication 1300 PDF | `trepo.tuni.fi/bitstream/handle/10024/115216/mahbubul_1300.pdf` | CR1-155 / S096 | Duplicate | Alternate repository URL for the same thesis at rank 4 | S096 |
| CR1-165 | CR1 | CR1-T02 | 14 | Towards Multi-Class Socio-Technical Congruence | DOI `10.1002/smr.70040` | None | Retain provisionally | Extends congruence measurement for collaborative development; empirical design and results require confirmation | S103 |
| CR1-166 | CR1 | CR1-T02 | 15 | Improving Social Relations Between Developers by Leveraging the Concept of… | `dspace.library.uvic.ca/server/api/core/bitstreams/96b8551d-ff27-4b52-bbc2-92b6c7bd7a97/content` | None | Retain provisionally | Case applies STC to coordination and social relations; thesis provenance, outcome measurement, and independence require appraisal | S104 |
| CR1-167 | CR1 | CR1-T02 | 16 | OpenSym 2014 paper on socio-technical congruence and Ruby ecosystem architecture | `opensym.org/os2014resources/proceedings-files/p110.pdf` | None | Retain provisionally | Empirical OSS study operationalizes Conway/STC using explicit relationships among Ruby gems and project organization | S105 |
| CR1-168 | CR1 | CR1-T02 | 17 | In Search of Socio-Technical Congruence: A Large-Scale Longitudinal Study | arXiv:2105.08198 | S016 | Duplicate | Existing large-scale qualifying/null-result candidate S016 | S016 |
| CR1-169 | CR1 | CR1-T02 | 18 | Identifying Coordination Problems in Software Development | arXiv:1201.4142 | None | Retain | Applies a pattern-based tool to identify Conway, ownership, and coordination structure clashes across ongoing projects | S106 |
| CR1-170 | CR1 | CR1-T02 | 19 | Organizational Artifacts of Code Development | arXiv:2105.14637 | None | Retain provisionally | Repository study relates national/organizational social context and communication to observable code-development artifacts | S107 |
| CR1-171 | CR1 | CR1-T02 | 20 | Conway's law — Wikipedia | `wikipedia.org/wiki/Conway's_law` | None | Do not retain | Tertiary page; the named MacCormack–Rusnak–Baldwin study should be retrieved directly in a later source check |
| CR1-172 | CR1 | CR1-T02 | 21 | Conway's Law, Revised from a Mathematical Viewpoint | arXiv:2311.10475 | None | Do not retain at this stage | Formal graph-theory restatement without visible empirical interaction or outcome |
| CR1-173 | CR1 | CR1-T02 | 22 | Reddit: Conway's law really seems to be working? | `reddit.com/r/softwarearchitecture/comments/143lw4p` | None | Do not retain | Informal discussion without an inspectable method |
| CR1-174 | CR1 | CR1-T02 | 23 | Reddit: How have you seen Conway's Law play out? | `reddit.com/r/ExperiencedDevs/comments/1n9bh0p` | None | Do not retain | Practitioner anecdotes without systematic sampling or verification |
| CR1-175 | CR1 | CR1-T02 | 24 | Reddit: Conway's Law is not a warning | `reddit.com/r/softwarearchitecture/comments/1sk7ucw/...` | None | Do not retain | Informal argument without inspectable evidence |
| CR1-176 | CR1 | CR1-T02 | 25 | Conway's law — Chinese Wikipedia | `zh.wikipedia.org/wiki/康威定律` | None | Do not retain | Tertiary reference |
| CR1-177 | CR1 | CR1-T02 | 26 | Reddit: Your Software Architecture Is Quietly Copying Your Team | `reddit.com/r/indiehackers/comments/1v9cmgs/...` | None | Do not retain | Informal/promotional commentary |
| CR1-178 | CR1 | CR1-T02 | 27 | Reddit: Conway's Law applied to games | `reddit.com/r/truegaming/comments/nto9jg` | None | Do not retain | Informal discussion without a research method |
| CR1-179 | CR1 | CR1-T02 | 28 | Reddit: Organizational structure, Microservices and Conway’s Law | `reddit.com/r/u_LohikaEng/comments/xpafot` | None | Do not retain | Promotional secondary post; original case required |
| CR1-180 | CR1 | CR1-T02 | 29 | Reddit: Conway's Law is not a historical footnote | `reddit.com/r/u_progggressor/comments/1t43zqn/...` | None | Do not retain | Informal secondary claim; named primary study will be sought separately |
| CR1-181 | CR1 | CR1-T02 | 30 | Reddit: influencing communication structure under Conway's Law | `reddit.com/r/ExperiencedDevs/comments/17g58nx/...` | None | Do not retain | Practitioner advice without an inspectable method |
| CR1-182 | CR1 | CR1-T02 | 31 | Reddit: Conway's Law Compliance in a Many Services Architecture — Elixir | `reddit.com/r/elixir/comments/yieqsq` | None | Do not retain | Talk-link discussion, not an inspectable study |
| CR1-183 | CR1 | CR1-T02 | 32 | Reddit: Conway's Law Compliance in a Many Services Architecture — Erlang | `reddit.com/r/erlang/comments/yier3i` | CR1-182 | Do not retain | Repost of the same talk discussion; neither instance is evidence-bearing |
| CR1-184 | CR1 | CR1-T02 | 33 | Reddit: Conway's Law Is Real — webdev | `reddit.com/r/webdev/comments/bxf1kd` | None | Do not retain | Informal opinion about research |
| CR1-185 | CR1 | CR1-T02 | 34 | Reddit: Conway's Law Is Real — programming | `reddit.com/r/programming/comments/bvy84p` | None | Do not retain | Informal discussion without an inspectable method |

CR1-T02 disposition summary: 14 retained candidates, 15 not retained at title/summary screening, and 5 duplicate result instances. No full text was screened.

### Corrective Round CR1 — Targeted Query CR1-T03

Date: 2026-08-25

Search service: general web-search discovery interface with submitted `site:arxiv.org` restriction

Exact submitted query:

```text
site:arxiv.org sociotechnical open source software governance empirical study
```

Returned results: 5

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-186 | CR1 | CR1-T03 | 1 | Governance in Practice: How Open Source Projects Define and Document Roles | arXiv:2603.24879 | S041 | Duplicate | Same governance-document study already retained and identity-verified as S041 | S041 |
| CR1-187 | CR1 | CR1-T03 | 2 | An Empirical Study of Policy-as-Code Adoption in Open-Source Software Projects | arXiv:2601.05555 | None | Retain | Mixed-methods study of 399 repositories connects policy tools, configuration, documentation, compliance, and governance activities | S108 |
| CR1-188 | CR1 | CR1-T03 | 3 | Multi-Ecosystem Modeling of OSS Project Sustainability | arXiv:2602.17112 | None | Retain | Cross-foundation study connects governance policies, funding/support, community mechanisms, sociotechnical traces, project lifecycle, and sustainability outcomes | S109 |
| CR1-189 | CR1 | CR1-T03 | 4 | Open Source Software Sustainability: Combining Institutional Analysis and Socio-Technical Networks | arXiv:2203.03144 | S039 | Duplicate | Same 253-project Apache governance/sociotechnical study already retained as S039 | S039 |
| CR1-190 | CR1 | CR1-T03 | 5 | Not All Dependencies Are Equal: An Empirical Study on Production Dependencies in NPM | arXiv:2207.14711 | None | Do not retain at this stage | Empirical dependency/tool study, but the returned record does not examine governance, authority, institutions, or a material social–technical governance relationship |

CR1-T03 disposition summary: 2 retained candidates, 1 not retained at title/summary screening, and 2 duplicate result instances. No full text was screened.

### Corrective Round CR1 — Targeted Query CR1-T04

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
Trist Bamforth sociotechnical systems theory joint optimization work system origin
```

Returned results: 25

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-191 | CR1 | CR1-T04 | 1 | Canadian government report with appendix on Sociotechnical Systems Theory | `publications.gc.ca/collections/collection_2019/isde-ised/c54-1/C54-1-65-1979-eng.pdf` | None | Retain provisionally | Government report provides a dated synthesis of joint optimization, open systems, environmental embedding, and early field trials; exact report identity must be established | S110 |
| CR1-192 | CR1 | CR1-T04 | 2 | The Sociotechnical Approach to Work Organization | Oxford Research Encyclopedia of Psychology | None | Retain | Scholarly synthesis traces the coal-mining study, organizational choice, open systems, work-group analysis, participation, and problems with joint optimization | S111 |
| CR1-193 | CR1 | CR1-T04 | 3 | Socio-Technical Theory — TheoryHub | `open.ncl.ac.uk/theories/9/socio-technical-theory/` | None | Do not retain | Tertiary teaching/review page; useful only for locating original sources |
| CR1-194 | CR1 | CR1-T04 | 4 | Socio-technical systems — ScienceDirect Topics | `sciencedirect.com/topics/social-sciences/socio-technical-systems` | None | Do not retain | Aggregated tertiary topic page |
| CR1-195 | CR1 | CR1-T04 | 5 | Sociotechnical systems: towards an organizational learning approach | `sciencedirect.com/science/article/pii/S0923474801000388` | None | Retain | Relates STS design principles to organizational-learning and performance indicators, providing a later theoretical development of joint optimization | S112 |
| CR1-196 | CR1 | CR1-T04 | 6 | Making Transparency Transparent — HBS-hosted paper | `hbs.edu/ris/Publication Files/BernsteinE-MakingTransparencyTransparent-AMA2017HBS_...pdf` | None | Do not retain at this stage | STS appears only as background in the returned passage; the software-system relationship and materiality are not visible |
| CR1-197 | CR1 | CR1-T04 | 7 | Sociotechnical System Principles and Guidelines: Past and Present | DOI `10.1177/0021886395311009` | None | Retain | Historical review traces first principles, joint optimization, dual focus, and adaptations beyond manufacturing | S113 |
| CR1-198 | CR1 | CR1-T04 | 8 | The biopsychosociotechnical model | `pmc.ncbi.nlm.nih.gov/articles/PMC10791103/` | None | Do not retain | Health-framework extension is adjacent and does not provide direct foundational or software-system evidence for this chapter |
| CR1-199 | CR1 | CR1-T04 | 9 | Sociotechnical Systems — SAGE Reference | DOI `10.4135/9781412956246.n498` | None | Do not retain | Encyclopedia entry is a tertiary summary; original and scholarly synthesis sources are preferred |
| CR1-200 | CR1 | CR1-T04 | 10 | Sociotechnical Systems — SNU-hosted PDF | `home.snu.edu/~jsmith/library/body/v27.pdf` | None | Do not retain at this stage | Returned record lacks clear authorship, venue, and source-unit identity |
| CR1-201 | CR1 | CR1-T04 | 11 | Strathclyde thesis passage applying STS to Six Sigma teams | `stax.strath.ac.uk/downloads/c821gk05k` | None | Do not retain at this stage | STS is background for a Six Sigma application; identity and direct software relevance are not established |
| CR1-202 | CR1 | CR1-T04 | 12 | Sociotechnical System — ScienceDirect Topics | `sciencedirect.com/topics/social-sciences/sociotechnical-system` | None | Do not retain | Aggregated tertiary topic page |
| CR1-203 | CR1 | CR1-T04 | 13 | Sociotechnical system — Wikipedia | `wikipedia.org/wiki/Sociotechnical_system` | None | Do not retain | Tertiary reference |
| CR1-204 | CR1 | CR1-T04 | 14 | The Contributions of Eric Trist to the Social Engagement of Social Science | DOI `10.5465/amr.1993.9309035150` | None | Retain | Historical scholarly account covers Trist's formulation of STS, self-directed teams, open systems, environments, and change across levels | S114 |
| CR1-205 | CR1 | CR1-T04 | 15 | Defining the Methodological Challenges and Opportunities for an Effective Science of Sociotechnical Systems and Safety | `pmc.ncbi.nlm.nih.gov/articles/PMC4566874/` | None | Retain | Methodological source connects STS origins with choice, organizational design, tools/technology, and human–software interfaces while exposing research challenges | S115 |
| CR1-206 | CR1 | CR1-T04 | 16 | Beyond the Organizational ‘Container’: Conceptualizing 21st Century Sociotechnical Work | `sciencedirect.com/science/article/pii/S1471772714000311` | None | Retain | Directly critiques organization-bounded STS and develops nested/infrastructural boundaries for contemporary work | S116 |
| CR1-207 | CR1 | CR1-T04 | 17 | Advancing sociotechnical systems theory for human-robot teams | DOI `10.1016/j.apergo.2025.104604` | None | Do not retain | AI/robot-team extension belongs to reserved future scope and is not foundational evidence |
| CR1-208 | CR1 | CR1-T04 | 18 | Virginia Tech thesis introduction on STS | `vtechworks.lib.vt.edu/bitstreams/254627c0-b4a7-413d-813d-5600288a7452/download` | None | Do not retain at this stage | Fragmentary identity and application context; no distinct foundational contribution is visible |
| CR1-209 | CR1 | CR1-T04 | 19 | Robotic Autonomous Systems: Manned / … | `calhoun.nps.edu/server/api/core/bitstreams/b092bdc6-0680-453a-9e9b-4d838216cb9a/content` | None | Do not retain | Defense robotics/AI application is outside present scope and source identity is incomplete |
| CR1-210 | CR1 | CR1-T04 | 20 | Open systems theory (Emery) — Wikipedia | `wikipedia.org/wiki/Open_systems_theory_(Emery)` | None | Do not retain | Tertiary reference; original Emery/Trist work is required |
| CR1-211 | CR1 | CR1-T04 | 21 | Theory of the firm — Wikipedia | `wikipedia.org/wiki/Theory_of_the_firm` | None | Do not retain | Tertiary and off-target |
| CR1-212 | CR1 | CR1-T04 | 22 | Eric Trist — Wikipedia | `wikipedia.org/wiki/Eric_Trist` | None | Do not retain | Tertiary biography |
| CR1-213 | CR1 | CR1-T04 | 23 | Fred Emery — Wikipedia | `wikipedia.org/wiki/Fred_Emery` | None | Do not retain | Tertiary biography |
| CR1-214 | CR1 | CR1-T04 | 24 | Socio-analysis — Wikipedia | `wikipedia.org/wiki/Socio-analysis` | None | Do not retain | Tertiary account of an adjacent tradition |
| CR1-215 | CR1 | CR1-T04 | 25 | An intelligent sociotechnical systems framework | arXiv:2401.03223 | None | Do not retain | AI-centered framework is reserved scope and reports recommendations rather than foundational evidence |

CR1-T04 disposition summary: 7 retained candidates, 18 not retained at title/summary screening, and 0 duplicate result instances. No full text was screened. The original Trist and Bamforth 1951 paper and the Bostrom and Heinen papers were not directly returned; their retrieval gaps remain open.

### Corrective Round CR1 — Original-Source Retrieval CR1-R01

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
"Some Social and Psychological Consequences of the Longwall Method of Coal-Getting" Trist Bamforth 1951 full text DOI
```

Returned results: 20

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-216 | CR1 | CR1-R01 | 1 | Some Social and Psychological Consequences of the Longwall Method of Coal-Getting — SAGE DOI record | DOI `10.1177/001872675100400101` | S001 | Existing candidate resolved | Publisher record confirms full title, authors, journal, volume, issue, pages, date, DOI, and page-level content | S001 |
| CR1-217 | CR1 | CR1-R01 | 2 | Same article — CiNii Research metadata | `cir.nii.ac.jp/crid/1362544420363395328` | CR1-216 / S001 | Duplicate | Independent bibliographic metadata and publisher-PDF link for S001 | S001 |
| CR1-218 | CR1 | CR1-R01 | 3 | Same article — SAGE CNPeReading institutional mirror | `sage-cnpereading-com-443.web.bisu.edu.cn/doi/10.1177/001872675100400101` | CR1-216 / S001 | Duplicate | Restricted institutional mirror of the publisher record | S001 |
| CR1-219 | CR1 | CR1-R01 | 4 | Same article — SAGE CNPeReading mirror | `sage.cnpereading.com/doi/10.1177/001872675100400101` | CR1-216 / S001 | Duplicate | Restricted mirror of the publisher record | S001 |
| CR1-220 | CR1 | CR1-R01 | 5 | Same article — University of Valencia-hosted PDF | `uv.es/gonzalev/PSI ORG 06-07/ARTICULOS RRHH SOCIOTEC/Trist Long Wall Method HR 1951.pdf` | CR1-216 / S001 | Duplicate / access location | Inspectable copy identifies the SAGE/Tavistock article and DOI; access does not yet constitute full-text screening | S001 |
| CR1-221 | CR1 | CR1-R01 | 6 | Same article — OpenAIRE metadata | `oamonitor.ireland.openaire.eu/national/search/publication?pid=10.1177/001872675100400101` | CR1-216 / S001 | Duplicate | Metadata record for S001 | S001 |
| CR1-222 | CR1 | CR1-R01 | 7 | Same article — CoLab metadata | `colab.ws/articles/10.1177/001872675100400101` | CR1-216 / S001 | Duplicate | Metadata aggregator for S001 | S001 |
| CR1-223 | CR1 | CR1-R01 | 8 | Same article — Syracuse SocQA bibliography | `socqa.syr.edu/bibcite/reference/6885` | CR1-216 / S001 | Duplicate | Bibliographic record for S001 | S001 |
| CR1-224 | CR1 | CR1-R01 | 9 | Same article — WorldCat record | `search.worldcat.org/title/.../oclc/249131046` | CR1-216 / S001 | Duplicate | Library catalog record for S001 | S001 |
| CR1-225 | CR1 | CR1-R01 | 10 | Same article — SciSpace summary page | `scispace.com/papers/...` | S001 | Do not retain | AI/metadata aggregator adds no authoritative provenance or evidence |
| CR1-226 | CR1 | CR1-R01 | 11 | *Human Relations* volume 4 issue 1 — SAGE mirror contents | `sage.cnpereading.com/toc/HUM/4/1` | CR1-216 / S001 | Duplicate | Issue-level publisher mirror confirms placement of S001 | S001 |
| CR1-227 | CR1 | CR1-R01 | 12 | Same article — Scribd upload | `scribd.com/document/1034733684/Trist-Long-Wall-Method-HR-1951` | S001 | Do not retain | Unauthoritative user-upload location; publisher and institutional sources are available |
| CR1-228 | CR1 | CR1-R01 | 13 | Same article — French WorldCat record | `search.worldcat.org/fr/title/.../oclc/249131046` | CR1-216 / S001 | Duplicate | Alternate-language view of the same WorldCat record | S001 |
| CR1-229 | CR1 | CR1-R01 | 14 | OpenReview paper citing Trist and Bamforth | `openreview.net/pdf?id=V5PNJ5HnpA` | None | Do not retain | Unrelated later paper returned because its references cite S001 |
| CR1-230 | CR1 | CR1-R01 | 15 | Mountain Scholar document citing Trist and Bamforth | `archives.mountainscholar.org/digital/api/collection/p17393coll20/id/42569/download` | None | Do not retain | Citation-only hit; not a copy or substantive source about S001 |
| CR1-231 | CR1 | CR1-R01 | 16 | UBC conference abstracts citing Trist and Bamforth | `med-fom-wosc.sites.olt.ubc.ca/files/2022/08/WOSC-2022_Conference_Abstracts.pdf` | None | Do not retain | Citation-only hit |
| CR1-232 | CR1 | CR1-R01 | 17 | Preprints.org document citing Trist and Bamforth — record 1 | `preprints.org/frontend/manuscript/25b7006d907b7249fb67629ec82836e8/download_pub` | None | Do not retain | Citation-only hit unrelated to foundational-source retrieval |
| CR1-233 | CR1 | CR1-R01 | 18 | Preprints.org document citing Trist and Bamforth — record 2 | `preprints.org/frontend/manuscript/32a2b82424bdb3ea366c2c28493db426/download_pub` | None | Do not retain | Citation-only hit unrelated to foundational-source retrieval |
| CR1-234 | CR1 | CR1-R01 | 19 | Eric Trist — Wikipedia | `wikipedia.org/wiki/Eric_Trist` | None | Do not retain | Tertiary biography |
| CR1-235 | CR1 | CR1-R01 | 20 | Eric Lansdown Trist — German Wikipedia | `de.wikipedia.org/wiki/Eric_Lansdown_Trist` | None | Do not retain | Tertiary biography |

CR1-R01 disposition summary: 0 new candidates, 9 not retained, 10 duplicate result instances, and 1 existing-candidate resolution. S001 now has confirmed publisher metadata and an inspectable access location. No full-text screening was performed.

### Corrective Round CR1 — Original-Source Retrieval CR1-R02

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
Bostrom Heinen 1977 "MIS Problems and Failures" sociotechnical Part I Part II DOI full text
```

Returned results: 19

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-236 | CR1 | CR1-R02 | 1 | MIS Problems and Failures, Part II: The Application of Socio-Technical Theory — AIS eLibrary | `aisel.aisnet.org/misq/vol1/iss1/12/` | None | Retain | Original Part II is a distinct article applying STS procedure to computer-based information-system redesign | S117 |
| CR1-237 | CR1 | CR1-R02 | 2 | MIS Problems and Failures, Part I: The Causes — AIS eLibrary | `aisel.aisnet.org/misq/vol1/iss1/9/` | S002 | Existing candidate resolved | Original repository record confirms authorship and title for existing Part I candidate | S002 |
| CR1-238 | CR1 | CR1-R02 | 3 | MIS Problems and Failures, Part II — CiNii/Crossref metadata | `cir.nii.ac.jp/crid/1363107371300089728` | CR1-236 / S117 | Duplicate | Confirms DOI 10.2307/249019, volume 1(4), pages 11–28, date, abstract, and direct MISQ PDF | S117 |
| CR1-239 | CR1 | CR1-R02 | 4 | MIS Problems and Failures, Part I — EBSCOhost | DOI `10.2307/248710` | CR1-237 / S002 | Duplicate | Confirms volume 1(3), authors, DOI, and abstract for S002 | S002 |
| CR1-240 | CR1 | CR1-R02 | 5 | *MIS Quarterly* volume 1 issue 4 — JSTOR | `jstor.org/stable/i211338` | CR1-236 / S117 | Duplicate | Issue record confirms Part II placement, pages, authors, and DOI | S117 |
| CR1-241 | CR1 | CR1-R02 | 6 | MIS Problems and Failures, Part I — CiNii/Crossref metadata | `cir.nii.ac.jp/crid/1361699993925052800` | CR1-237 / S002 | Duplicate | Confirms DOI, publication date, abstract, and direct MISQ PDF for S002 | S002 |
| CR1-242 | CR1 | CR1-R02 | 7 | MIS Problems and Failures, Part I — BibBase | `bibbase.org/network/publication/bostrom-heinen-...` | CR1-237 / S002 | Duplicate | Bibliographic aggregator for S002 |
| CR1-243 | CR1 | CR1-R02 | 8 | MIS Problems and Failures, Part I — Bishtref | `bishtref.com/articles/10.2307/248710` | CR1-237 / S002 | Duplicate | Metadata/abstract aggregator for S002 |
| CR1-244 | CR1 | CR1-R02 | 9 | Behavioral Science—Systems and Perspectives | DOI `10.1287/inte.7.4.76` | None | Do not retain | Contemporary review/commentary about the then-forthcoming articles, not either original source |
| CR1-245 | CR1 | CR1-R02 | 10 | MIS Problems and Failures, Part II — Bishtref | `bishtref.com/articles/10.2307/249019` | CR1-236 / S117 | Duplicate | Metadata/abstract aggregator for S117 | S117 |
| CR1-246 | CR1 | CR1-R02 | 11 | Successful Application of Communication Techniques to Improve the Systems Development Process | `sciencedirect.com/science/article/abs/pii/0378720689900050` | None | Do not retain | Later article returned because it references both parts; not an original-source location |
| CR1-247 | CR1 | CR1-R02 | 12 | MIS Problems and Failures, Part I — SciSpace | `scispace.com/papers/...` | S002 | Do not retain | AI/metadata aggregator adds no authoritative provenance |
| CR1-248 | CR1 | CR1-R02 | 13 | Liverpool repository thesis citing both parts | `livrepository.liverpool.ac.uk/3142921/1/201183436_Oct2021.pdf` | None | Do not retain | Citation-only hit |
| CR1-249 | CR1 | CR1-R02 | 14 | Wits repository paper citing Part II | `wiredspace.wits.ac.za/server/api/core/bitstreams/62d411d6-0004-4be4-9108-6fb83629430b/content` | None | Do not retain | Citation-only hit |
| CR1-250 | CR1 | CR1-R02 | 15 | University of St. Gallen dissertation citing Part II | `ux-tauri.unisg.ch/EDIS/Dis5025.pdf` | None | Do not retain | Citation-only hit |
| CR1-251 | CR1 | CR1-R02 | 16 | Now Publishers review-method document citing Part I | `nowpublishers.com/article/DownloadSummary/ISY-014` | None | Do not retain | Citation-only hit |
| CR1-252 | CR1 | CR1-R02 | 17 | UC Berkeley document adapting a Part II figure | `escholarship.org/uc/item/7339b01d.pdf` | None | Do not retain | Later derivative/citation, not the original article |
| CR1-253 | CR1 | CR1-R02 | 18 | KTH thesis citing Parts I and II | `kth.diva-portal.org/smash/get/diva2:1635092/FULLTEXT02.pdf` | None | Do not retain | Citation-only hit |
| CR1-254 | CR1 | CR1-R02 | 19 | Work systems — Wikipedia | `wikipedia.org/wiki/Work_systems` | None | Do not retain | Tertiary reference |

CR1-R02 disposition summary: 1 new candidate, 10 not retained, 7 duplicate result instances, and 1 existing-candidate resolution. S002 and S117 now have confirmed original metadata and direct repository or journal access locations. No full-text screening was performed.

### Corrective Round CR1 — Targeted Query CR1-T05

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
critique of sociotechnical systems theory vague unfalsifiable limitations
```

Returned results: 32

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-255 | CR1 | CR1-T05 | 1 | Imagining Technology-Mediated Social Change? A Critique of the Theory of Sociotechnical Imaginaries | DOI `10.1007/s11024-025-09622-x` | S014 | Duplicate | Same adjacent-tradition critique already retained as S014 | S014 |
| CR1-256 | CR1 | CR1-T05 | 2 | A Reappraisal of Sociotechnical Systems Theory | DOI `10.1177/001872677803101204` | S010 | Duplicate | Same Kelly critique already retained as S010 | S010 |
| CR1-257 | CR1 | CR1-T05 | 3 | Defining Methodological Challenges for a Science of Sociotechnical Systems and Safety | `pmc.ncbi.nlm.nih.gov/articles/PMC4566874/` | S115 | Duplicate | Same methodological candidate already retained as S115 | S115 |
| CR1-258 | CR1 | CR1-T05 | 4 | The Problem of Observing Sociotechnical Entities in Energy Transition Research — PMC | `pmc.ncbi.nlm.nih.gov/articles/PMC8854793/` | None | Retain provisionally | Directly examines weak system/environment distinctions, elements, relations, boundaries, and construct clarity; software transferability must be demonstrated | S118 |
| CR1-259 | CR1 | CR1-T05 | 5 | Explaining Sociotechnical Transitions: A Critical Realist Perspective — ScienceDirect | `sciencedirect.com/science/article/pii/S0048733318300891` | S085 | Duplicate | Publisher record for existing candidate S085 | S085 |
| CR1-260 | CR1 | CR1-T05 | 6 | Refutation of Kira and van Eijnatten's Critique of Emery's Open Systems Theory | DOI `10.1002/sres.1010` | None | Retain | Published refutation exposes a substantive theoretical dispute about open-systems and chaordic alternatives and claimed STS benefits | S119 |
| CR1-261 | CR1 | CR1-T05 | 7 | The Problem of Observing Sociotechnical Entities — Frontiers | DOI `10.3389/fsoc.2021.699362` | CR1-258 / S118 | Duplicate | Publisher version of the same article at rank 4 | S118 |
| CR1-262 | CR1 | CR1-T05 | 8 | Refutation of Kira and van Eijnatten — Wiley abstract record | DOI `10.1002/sres.1010` | CR1-260 / S119 | Duplicate | Same article as rank 6 | S119 |
| CR1-263 | CR1 | CR1-T05 | 9 | The Sociotechnical Systems Approach: A Critical Evaluation | DOI `10.1080/00207547508942982` | S011 | Existing candidate resolved | Publisher record resolves S011 and confirms methodological and systems-theoretical critique | S011 |
| CR1-264 | CR1 | CR1-T05 | 10 | Explaining Sociotechnical Transitions — SSRN | `papers.ssrn.com/sol3/papers.cfm?abstract_id=2986263` | S085 | Duplicate | Working-paper version/location of existing S085 | S085 |
| CR1-265 | CR1 | CR1-T05 | 11 | Explaining Sociotechnical Transitions — RePEc | `ideas.repec.org/a/eee/respol/v47y2018i7p1267-1282.html` | S085 | Duplicate | Existing discovery location for S085 | S085 |
| CR1-266 | CR1 | CR1-T05 | 12 | Doctoral thesis discussing sociotechnical interaction and conceptual vagueness — Luleå repository | `ltu.diva-portal.org/smash/get/diva2:2012539/FULLTEXT01.pdf` | None | Retain provisionally | Appears to examine interacting technical/social elements and critiques conceptual vagueness; identity, field, and direct software relevance are unresolved | S120 |
| CR1-267 | CR1 | CR1-T05 | 13 | Three Decades of Social Construction of Technology: Dynamic Yet Fuzzy? | DOI `10.1080/02691728.2022.2120783` | None | Retain provisionally | Critiques methodological fuzziness in a related but distinct technology-studies tradition; useful only as an explicitly bounded alternative | S121 |
| CR1-268 | CR1 | CR1-T05 | 14 | The Contestation of Tech Ethics: A Sociotechnical Approach to Technology Ethics in Practice | arXiv:2106.01784 | None | Retain provisionally | Examines vagueness, individualization, corporate logics, and incentives in technology practice; directness to software-system outcomes requires appraisal | S122 |
| CR1-269 | CR1 | CR1-T05 | 15 | Systems Theory and Sociotechnical Systems / Revitalizing the Concept of Sociotechnical Systems | Columbia-hosted PDF | S013 | Existing candidate resolved | Direct document location confirms the content associated with M. Pilar Opazo's S013; formal publication status remains unresolved | S013 |
| CR1-270 | CR1 | CR1-T05 | 16 | *Vision versus Reality in Organizational…*, report 2005:5 | `citeseerx.ist.psu.edu/document?doi=36e1702a9817be68f3e830047810f6478254c578` | None | Retain provisionally | Appears to compare sociotechnical design theory with organizational implementation reality; full title, author, method, and software directness unresolved | S123 |
| CR1-271 | CR1 | CR1-T05 | 17 | TheoryHub: Socio-Technical Theory PDF | `open.ncl.ac.uk/theory-library/socio-technical-theory.pdf` | None | Do not retain | Tertiary review; its references may guide original-source retrieval |
| CR1-272 | CR1 | CR1-T05 | 18 | An Evolutionary Model of Sociotechnical System Safety | DOI `10.1080/1463922X.2026.2659114` | None | Retain provisionally | Directly questions vague objectives and models multi-level interactions in dynamic safety systems; empirical status requires confirmation | S124 |
| CR1-273 | CR1 | CR1-T05 | 19 | Reflections on Organization, Emergence, and Control in Sociotechnical Systems | arXiv:1412.6965 | None | Retain provisionally | Offers a dynamic emergence/control alternative to static system properties and strict hierarchies | S125 |
| CR1-274 | CR1 | CR1-T05 | 20 | Sociotechnical system — Wikipedia | `wikipedia.org/wiki/Sociotechnical_system` | None | Do not retain | Tertiary reference |
| CR1-275 | CR1 | CR1-T05 | 21 | Social construction of technology — Wikipedia | `wikipedia.org/wiki/Social_construction_of_technology` | None | Do not retain | Tertiary account of a distinct tradition |
| CR1-276 | CR1 | CR1-T05 | 22 | Sustainability Is Stratified: Toward a Better Theory of Sustainable Software Engineering | arXiv:2301.11129 | None | Retain | Meta-synthesis of 36 qualitative studies proposes stratified, multisystemic interactions across social, technical, and sociotechnical systems in software engineering | S126 |
| CR1-277 | CR1 | CR1-T05 | 23 | Epidemic Processes in Complex Networks | arXiv:1408.2701 | None | Do not retain | Mathematical network review; sociotechnical appears only as one broad application domain |
| CR1-278 | CR1 | CR1-T05 | 24 | Theories of technology — Wikipedia | `wikipedia.org/wiki/Theories_of_technology` | None | Do not retain | Tertiary reference |
| CR1-279 | CR1 | CR1-T05 | 25 | Actor–network theory — Wikipedia | `wikipedia.org/wiki/Actor–network_theory` | None | Do not retain | Tertiary reference; original alternative-framework sources are required |
| CR1-280 | CR1 | CR1-T05 | 26 | Science and technology studies — Wikipedia | `wikipedia.org/wiki/Science_and_technology_studies` | None | Do not retain | Tertiary overview |
| CR1-281 | CR1 | CR1-T05 | 27 | Structural functionalism — Wikipedia | `wikipedia.org/wiki/Structural_functionalism` | None | Do not retain | Tertiary and too remote from software-system analysis |
| CR1-282 | CR1 | CR1-T05 | 28 | Reddit: Thinking in Systems — A Sociotechnical Approach to DevOps | `reddit.com/r/devops/comments/188bvhd` | None | Do not retain | Practitioner discussion without inspectable research method |
| CR1-283 | CR1 | CR1-T05 | 29 | Reddit: limitations of contemporary control theory | `reddit.com/r/ControlTheory/comments/iy529v` | None | Do not retain | Informal discussion and not a critique of the target theory |
| CR1-284 | CR1 | CR1-T05 | 30 | Reddit: Marx's SNLT Theory of Value | `reddit.com/r/CapitalismVSocialism/comments/1h0e9cc` | None | Do not retain | False-positive acronym/off-topic result |
| CR1-285 | CR1 | CR1-T05 | 31 | Reddit: limits of Critical Theory | `reddit.com/r/CriticalTheory/comments/pgsa30` | None | Do not retain | Off-topic informal discussion |
| CR1-286 | CR1 | CR1-T05 | 32 | Reddit: Near-Singularity Factories | `reddit.com/r/systems_engineering/comments/1jvhtth` | None | Do not retain | Informal and off-topic discussion |

CR1-T05 disposition summary: 9 new candidates, 13 not retained, 8 duplicate result instances, and 2 existing-candidate resolutions. No full-text screening was performed.

### Corrective Round CR1 — Targeted Query CR1-T06

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
Leveson Therac-25 software safety accident organizational analysis full report
```

Returned results: 27

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-287 | CR1 | CR1-T06 | 1 | An Investigation of the Therac-25 Accidents — SciSpace | `scispace.com/papers/an-investigation-of-the-therac-25-accidents-164wrw3s7w` | S034 | Do not retain | AI/metadata aggregator; original and repository copies are available |
| CR1-288 | CR1 | CR1-T06 | 2 | Therac-25 Accidents Investigation Report — Scribd | `scribd.com/document/471912238/Therac-25-Accidents-1-pdf` | S034 | Do not retain | Unauthoritative user-upload location |
| CR1-289 | CR1 | CR1-T06 | 3 | An Investigation of the Therac-25 Accidents — eScholarship | `escholarship.org/uc/item/5dr206s3` | S034 | Duplicate | Existing stable repository location for S034 | S034 |
| CR1-290 | CR1 | CR1-T06 | 4 | An Investigation of the Therac-25 Accidents — Online Ethics abstract | `onlineethics.org/cases/therac-25/investigation-therac-25-accidents-abstract` | S034 | Do not retain | Secondary abstract page; use the original article |
| CR1-291 | CR1 | CR1-T06 | 5 | An Investigation of the Therac-25 Accidents — MIT HTML, part I | `web.mit.edu/6.033/2004/wwwdocs/papers/Therac_1.html` | S034 | Duplicate | Inspectable HTML segmentation of S034 | S034 |
| CR1-292 | CR1 | CR1-T06 | 6 | Medical Devices: The Therac-25 — Leveson, *Safeware* | `cerias.purdue.edu/apps/reports_and_papers/view/1403` | None | Retain | Distinct expanded book treatment of the device, software, safety, management, regulation, and accident history | S127 |
| CR1-293 | CR1 | CR1-T06 | 7 | System Safety — ComputingCases Therac analysis | `computingcases.org/case_materials/therac/analysis/Safety.html` | None | Do not retain | Educational secondary analysis that refers readers to Leveson's originals |
| CR1-294 | CR1 | CR1-T06 | 8 | Therac-25 — MIT HTML, part V | `web.mit.edu/6.033/2004/wwwdocs/papers/Therac_5.html` | S034 | Duplicate | Later segment of the same S034 HTML copy | S034 |
| CR1-295 | CR1 | CR1-T06 | 9 | Therac-25 — MIT HTML, part IV | `web.mit.edu/6.033/2004/wwwdocs/papers/Therac_4.html` | S034 | Duplicate | Segment of the same S034 HTML copy | S034 |
| CR1-296 | CR1 | CR1-T06 | 10 | Therac-25 Accidents: Software Engineering Case Study — StudyLib | `studylib.net/doc/15010431/therac-25` | None | Do not retain | Unauthoritative teaching-slide copy |
| CR1-297 | CR1 | CR1-T06 | 11 | An Investigation of the Therac-25 Accidents — MSU HTML, part III | `cse.msu.edu/~cse470/Public/Handouts/Therac/Therac_3.html` | S034 | Duplicate | Segment/copy of S034 | S034 |
| CR1-298 | CR1 | CR1-T06 | 12 | Therac25-Leveson PDF — MSU | `cse.msu.edu/~cse435/Handouts/Therac25-Leveson.pdf` | CR1-292 / S127 | Duplicate | Appendix/excerpt identified as taken from Leveson's 1995 *Safeware* treatment | S127 |
| CR1-299 | CR1 | CR1-T06 | 13 | Therac-25 — Ethics Unwrapped | `ethicsunwrapped.utexas.edu/case-study/therac-25` | None | Do not retain | Educational retelling; primary investigation is available |
| CR1-300 | CR1 | CR1-T06 | 14 | An Investigation of the Therac-25 Accidents — Harvard-hosted PDF | `read.seas.harvard.edu/~kohler/class/05f-osp/ref/leveson93investigation.pdf` | S034 | Duplicate | Full article copy of S034 | S034 |
| CR1-301 | CR1 | CR1-T06 | 15 | An Investigation of the Therac-25 Accidents — Columbia-hosted PDF | `cs.columbia.edu/~junfeng/08fa-e6998/sched/readings/therac25.pdf` | S034 | Duplicate | Full article copy of S034 | S034 |
| CR1-302 | CR1 | CR1-T06 | 16 | SEBoK guide section discussing Therac-25 | `sebokwiki.org/w/images/3/38/SEBoKv1.4_Part7.pdf` | None | Do not retain | Normative/secondary body-of-knowledge treatment; use original investigation for case facts |
| CR1-303 | CR1 | CR1-T06 | 17 | Therac-25 — Wikipedia | `wikipedia.org/wiki/Therac-25` | None | Do not retain | Tertiary reference |
| CR1-304 | CR1 | CR1-T06 | 18 | Therac-25 — German Wikipedia | `de.wikipedia.org/wiki/Therac-25` | None | Do not retain | Tertiary reference |
| CR1-305 | CR1 | CR1-T06 | 19 | Therac-25 — Spanish Wikipedia | `es.wikipedia.org/wiki/Therac-25` | None | Do not retain | Tertiary reference |
| CR1-306 | CR1 | CR1-T06 | 20 | Therac-25 — Italian Wikipedia | `it.wikipedia.org/wiki/Therac-25` | None | Do not retain | Tertiary reference |
| CR1-307 | CR1 | CR1-T06 | 21 | Reddit: Therac-25 — The Dangers of Hubris | `reddit.com/r/mrballen/comments/wix115` | None | Do not retain | Informal retelling with an unauthoritative file link |
| CR1-308 | CR1 | CR1-T06 | 22 | Therac-25 case — Chinese Wikipedia | `zh.wikipedia.org/wiki/Therac-25案例` | None | Do not retain | Tertiary reference |
| CR1-309 | CR1 | CR1-T06 | 23 | A Comprehensive Safety Engineering Approach for Software-Intensive Systems Based on STPA | arXiv:1612.03109 | None | Do not retain at this stage | Technical safety-analysis method; returned summary does not show a material organizational relationship or observed outcome |
| CR1-310 | CR1 | CR1-T06 | 24 | Adverse Events in Robotic Surgery: A Retrospective Study of 14 Years of FDA Data | arXiv:1507.03518 | None | Retain provisionally | Large retrospective safety dataset connects software-intensive devices, procedures, regulatory reports, injuries, deaths, and temporal outcomes | S128 |
| CR1-311 | CR1 | CR1-T06 | 25 | Systems-Theoretic Safety Assessment of Robotic Telesurgical Systems | arXiv:1504.07135 | None | Do not retain at this stage | Technical hazard analysis and fault-injection study with no visible material human/organizational interaction in the returned summary |
| CR1-312 | CR1 | CR1-T06 | 26 | Notorious software bug was killing people 40 years ago — Tom's Hardware | `tomshardware.com/software/notorious-software-bug-was-killing-people-40-years-ago-...` | None | Do not retain | Recent journalistic retelling; case claims must come from original investigations |
| CR1-313 | CR1 | CR1-T06 | 27 | How Do Practitioners Perceive Assurance Cases in Safety-Critical Software Systems? | arXiv:1803.08097 | None | Retain | Practitioner study connects assurance-case artifacts, organizational/process adjustments, adoption, and safety-critical software practice | S129 |

CR1-T06 disposition summary: 3 new candidates, 16 not retained, and 8 duplicate result instances. No full-text screening was performed.

### Corrective Round CR1 — Targeted Query CR1-T07

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
normal accidents Perrow high reliability organizations software systems complex coupling
```

Returned results: 30

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-314 | CR1 | CR1-T07 | 1 | High-Reliability.org page on Perrow and complexity | `high-reliability.org/PerrowComplex` | None | Do not retain | Secondary practitioner/theory summary; original sources are available |
| CR1-315 | CR1 | CR1-T07 | 2 | Systemic Failures and Organizational Risk Management in Algorithmic Trading | `pmc.ncbi.nlm.nih.gov/articles/PMC8978471/` | None | Retain | Bounded software-intensive financial setting compares NAT and HRO explanations across algorithms, organizations, coupling, environment, and risk management | S130 |
| CR1-316 | CR1 | CR1-T07 | 3 | Culture and High Reliability Organizations: The Case of the Nuclear Submarine | `sciencedirect.com/science/article/abs/pii/0149206395900039` | None | Retain provisionally | Empirical/analytical case contrasts structural paradoxes with organizational culture, cognition, delegation, and reliability in a complex technical system | S131 |
| CR1-317 | CR1 | CR1-T07 | 4 | Complexity, Tight-Coupling and Reliability: Connecting Normal Accidents Theory and High Reliability Theory — Wiley PDF | DOI `10.1111/1468-5973.00033` | None | Retain | Direct theoretical comparison of competing accident and reliability explanations | S132 |
| CR1-318 | CR1 | CR1-T07 | 5 | Complexity, Tight-Coupling and Reliability — Taylor & Francis chapter | DOI `10.4324/9780429282515-10` | CR1-317 / S132 | Duplicate | Reprinted chapter/version of the Rijpma work at rank 4 | S132 |
| CR1-319 | CR1 | CR1-T07 | 6 | Complexity, Tight-Coupling and Reliability — Wiley abstract | DOI `10.1111/1468-5973.00033` | CR1-317 / S132 | Duplicate | Same article as rank 4 | S132 |
| CR1-320 | CR1 | CR1-T07 | 7 | Culture and High Reliability Organizations — ScienceDirect PDF | `sciencedirect.com/science/article/pii/0149206395900039/pdf` | CR1-316 / S131 | Duplicate | Same nuclear-submarine article as rank 3 | S131 |
| CR1-321 | CR1 | CR1-T07 | 8 | Normal Accidents: Living with High-Risk Technologies — PSNet summary | `psnet.ahrq.gov/issue/normal-accidents-living-high-risk-technologies` | None | Do not retain | Secondary patient-safety summary of Perrow's book |
| CR1-322 | CR1 | CR1-T07 | 9 | Moving Beyond Normal Accidents and High Reliability Organizations | DOI `10.1177/0170840608101478` | S038 | Existing candidate resolved | Publisher record resolves S038 to Leveson, Dulac, Marais, and Carroll's 2009 *Organization Studies* article | S038 |
| CR1-323 | CR1 | CR1-T07 | 10 | High-Reliability.org FAQ | `high-reliability.org/faqs` | None | Do not retain | Practitioner/theory summary; original HRO studies required |
| CR1-324 | CR1 | CR1-T07 | 11 | Normal Cyber-Crises | `link.springer.com/chapter/10.1007/978-3-031-32633-2_9` | None | Retain | Applies NAT/HRO disagreement to cyber crises, technological and organizational complexity, accountability, and prevention | S133 |
| CR1-325 | CR1 | CR1-T07 | 12 | Charles Perrow, *Normal Accidents: Living with High-Risk Technologies*, updated edition | `jstor.org/stable/j.ctt7srgf` | None | Retain | Original book source for normal/system accidents, coupling, complexity, reorganization, risk analysis, and public participation | S134 |
| CR1-326 | CR1 | CR1-T07 | 13 | Beyond Normal Accidents and High Reliability Organizations — MIT PDF | `sunnyday.mit.edu/papers/hro.pdf` | S038 | Duplicate | Author-hosted version of S038 | S038 |
| CR1-327 | CR1 | CR1-T07 | 14 | Normal Accidents — PSNet PDF | `psnet.ahrq.gov/node/34758/psn-pdf` | CR1-321 | Duplicate | PDF version of the same secondary summary at rank 8; not promoted |
| CR1-328 | CR1 | CR1-T07 | 15 | Two Cases in High Reliability Organizing | `pure.uvt.nl/ws/portalfiles/portal/1159459/Two_Cases_in_High_Reliability_Organizing_161109.pdf` | None | Retain provisionally | Comparative cases challenge univocal readings of coupling/complexity and examine organizing for reliability | S135 |
| CR1-329 | CR1 | CR1-T07 | 16 | High Reliability Organization Theory as an Input to Manage… — UPenn repository | `repository.upenn.edu/server/api/core/bitstreams/d58ad736-13af-4e9a-ae84-96a1e6a21098/content` | None | Do not retain at this stage | Fragmentary thesis/document identity and no visible software-specific contribution |
| CR1-330 | CR1 | CR1-T07 | 17 | High reliability organization — Wikipedia | `wikipedia.org/wiki/High_reliability_organization` | None | Do not retain | Tertiary reference |
| CR1-331 | CR1 | CR1-T07 | 18 | Normal Accidents — Wikipedia | `wikipedia.org/wiki/Normal_Accidents` | None | Do not retain | Tertiary reference |
| CR1-332 | CR1 | CR1-T07 | 19 | Beyond Normal Accidents and HRO — alternate PDF | `klabs.org/DEI/lessons_learned/papers/marais-b.pdf` | S038 | Duplicate | Alternate copy/version of S038 | S038 |
| CR1-333 | CR1 | CR1-T07 | 20 | System accident — Wikipedia | `wikipedia.org/wiki/System_accident` | None | Do not retain | Tertiary reference |
| CR1-334 | CR1 | CR1-T07 | 21 | Organizational safety — Wikipedia | `wikipedia.org/wiki/Organizational_safety` | None | Do not retain | Tertiary reference |
| CR1-335 | CR1 | CR1-T07 | 22 | Charles Perrow — Wikipedia | `wikipedia.org/wiki/Charles_Perrow` | None | Do not retain | Tertiary biography |
| CR1-336 | CR1 | CR1-T07 | 23 | Redundancy (engineering) — Wikipedia | `wikipedia.org/wiki/Redundancy_(engineering)` | None | Do not retain | Tertiary reference |
| CR1-337 | CR1 | CR1-T07 | 24 | Understanding and Avoiding AI Failures | arXiv:2104.12582 | None | Do not retain | AI-centered application is reserved for later research |
| CR1-338 | CR1 | CR1-T07 | 25 | Chaos Engineering | arXiv:1702.05843 | None | Retain provisionally | Software-services source links distributed-system complexity, failure modes, organizational experimentation, and reliability verification | S136 |
| CR1-339 | CR1 | CR1-T07 | 26 | Software Systems as Complex Networks | arXiv:cond-mat/0305575 | None | Do not retain at this stage | Technical network/evolution model without a material organizational interaction in the returned summary |
| CR1-340 | CR1 | CR1-T07 | 27 | Model-Based Reliability and Safety Using Component Fault Trees | arXiv:2105.15015 | None | Do not retain | Technical industrial safety-analysis method with no visible nontechnical relationship |
| CR1-341 | CR1 | CR1-T07 | 28 | Reddit: How Complex SRE Systems Fail | `reddit.com/r/sre/comments/1tju8lr/...` | None | Do not retain | Informal summary of another source |
| CR1-342 | CR1 | CR1-T07 | 29 | Reddit: How Complex Systems Fail | `reddit.com/r/collapse/comments/fnxc1j` | None | Do not retain | Informal repost/summary; original Cook source should be retrieved separately |
| CR1-343 | CR1 | CR1-T07 | 30 | Reddit: Site reliability for physical systems? | `reddit.com/r/sre/comments/1r61p6d/...` | None | Do not retain | Informal discussion without inspectable method |

CR1-T07 disposition summary: 7 new candidates, 16 not retained, 6 duplicate result instances, and 1 existing-candidate resolution. No full-text screening was performed.

### Corrective Round CR1 — Targeted Query CR1-T08

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
actor network theory software development critique technological determinism social construction
```

Returned results: 37

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-344 | CR1 | CR1-T08 | 1 | Beyond the Network: A Critical Inquiry into the Limits of Actor-Network Theory | DOI `10.2298/GEI2501247M` | None | Retain | Direct ANT critique addresses structural determinants, power asymmetry, historical constraints, hierarchy, inequality, and explanatory limits | S137 |
| CR1-345 | CR1 | CR1-T08 | 2 | The Associations between Technologies and Societies: The Utility of Actor-Network Theory | DOI `10.1177/0971721816640615` | None | Retain | Compares ANT strengths and limitations, SCOT origins, information-science use, sociomateriality, and competing notions of power | S138 |
| CR1-346 | CR1 | CR1-T08 | 3 | Is Actor Network Theory Critique? | DOI `10.1177/0170840607082223` | None | Retain | Directly assesses ANT's capacity for critical explanation and positions it against related technology-studies work | S139 |
| CR1-347 | CR1 | CR1-T08 | 4 | Actor-Network Theory for Development, Working Paper 5 | `hummedia.manchester.ac.uk/institutes/cdi/resources/cdi_ant4d/ANT4DWorkingPaper5HeeksStanforth.pdf` | None | Retain provisionally | Technology-development account rejects technological determinism and explains emerging social structures through translation processes | S140 |
| CR1-348 | CR1 | CR1-T08 | 5 | Latour's Actor Network Theory — Simply Psychology | `simplypsychology.org/actor-network-theory.html` | None | Do not retain | Tertiary educational summary |
| CR1-349 | CR1 | CR1-T08 | 6 | Actor-Network Theory in IS Research: Critique on Application of Generalized Symmetry | DOI `10.1145/3129416.3129448` | None | Retain | Information-systems-specific critique tests how a central ANT principle is applied in research | S141 |
| CR1-350 | CR1 | CR1-T08 | 7 | Actor-Network Theory and Information Systems Research — CiteSeerX PDF | `citeseerx.ist.psu.edu/document?doi=34aef4a8e7e8b49e1c4a33f4288807774d0bd3a7` | S042 | Existing candidate resolved | Direct document location for existing alternative-framework candidate S042 | S042 |
| CR1-351 | CR1 | CR1-T08 | 8 | Is Actor Network Theory Critique? — SAGE PDF | DOI `10.1177/0170840607082223` | CR1-346 / S139 | Duplicate | PDF version of the same article at rank 3 | S139 |
| CR1-352 | CR1 | CR1-T08 | 9 | Actor-Network Theory in ICT Research: A Wider Lens of Enquiry | `researchgate.net/publication/220306955_...` | None | Retain provisionally | ICT-focused source contrasts technological and social determinism and asks who produces software; canonical venue must be confirmed | S142 |
| CR1-353 | CR1 | CR1-T08 | 10 | Riskscapes and Risk Management: Review and Synthesis of an ANT Approach | `pmc.ncbi.nlm.nih.gov/articles/PMC7149206/` | None | Retain provisionally | Review compares ANT with technological determinism and social construction and analyzes heterogeneous human–technology management networks | S143 |
| CR1-354 | CR1 | CR1-T08 | 11 | Technological Change in Developing Countries: Opening the Black Box Using ANT | DOI `10.1080/21665095.2015.1026610` | None | Retain | Public-sector technology-change case reports ANT's process insight while acknowledging weak cause-and-effect explanation | S144 |
| CR1-355 | CR1 | CR1-T08 | 12 | Actor–network theory — Wikipedia | `wikipedia.org/wiki/Actor–network_theory` | None | Do not retain | Tertiary reference |
| CR1-356 | CR1 | CR1-T08 | 13 | A Critical Review of Actor-Network Theory for the Study of Artifacts | `revistas.itm.edu.co/index.php/trilogia/article/view/616` | None | Retain provisionally | Direct artifact-focused critical review compares ANT and social construction; source quality and software relevance require appraisal | S145 |
| CR1-357 | CR1 | CR1-T08 | 14 | Dissertation comparing SCOT, systems theory, and ANT | `pure.uva.nl/ws/files/4143027/144941_PROEFSCHRIFT_OOSTVEEN.pdf` | None | Retain provisionally | Comparative theory source may clarify distinctions, critiques, and technological-determinist alternatives; exact thesis scope requires appraisal | S146 |
| CR1-358 | CR1 | CR1-T08 | 15 | Social construction of technology — Wikipedia | `wikipedia.org/wiki/Social_construction_of_technology` | None | Do not retain | Tertiary reference |
| CR1-359 | CR1 | CR1-T08 | 16 | Symmetrical Absence/Symmetrical Absurdity: Critical Notes on the Production of Actor-Network Accounts | DOI `10.1111/j.1467-6486.2004.00442.x` | None | Retain | Direct methodological critique of ANT accounts in knowledge-worker and information-technology research | S147 |
| CR1-360 | CR1 | CR1-T08 | 17 | The Associations between Technologies and Societies — SAGE mirror | DOI `10.1177/0971721816640615` | CR1-345 / S138 | Duplicate | Mirror of the same article at rank 2 | S138 |
| CR1-361 | CR1 | CR1-T08 | 18 | Social shaping of technology — Wikipedia | `wikipedia.org/wiki/Social_shaping_of_technology` | None | Do not retain | Tertiary reference |
| CR1-362 | CR1 | CR1-T08 | 19 | Social Shaping of Information Infrastructure: On Being Specific about the Technology | arXiv:1803.04188 | None | Retain | Information-infrastructure account offers a software/digital alternative emphasizing technological specificity and ANT-informed social shaping | S148 |
| CR1-363 | CR1 | CR1-T08 | 20 | Technological determinism — Wikipedia | `wikipedia.org/wiki/Technological_determinism` | None | Do not retain | Tertiary reference |
| CR1-364 | CR1 | CR1-T08 | 21 | The Wealth of Networks — Wikipedia | `wikipedia.org/wiki/The_Wealth_of_Networks` | None | Do not retain | Tertiary book summary and off-target |
| CR1-365 | CR1 | CR1-T08 | 22 | Theories of technology — Wikipedia | `wikipedia.org/wiki/Theories_of_technology` | None | Do not retain | Tertiary reference |
| CR1-366 | CR1 | CR1-T08 | 23 | Actor-Network Procedures: Modeling Multi-Factor Authentication, Device Pairing, Social Interactions | arXiv:1106.0706 | None | Do not retain | Computational formalism using similar terminology, not ANT social theory or an empirical alternative explanation |
| CR1-367 | CR1 | CR1-T08 | 24 | The Who, What, How of Software Engineering Research | arXiv:1905.12841 | S007 | Duplicate | Existing candidate S007 | S007 |
| CR1-368 | CR1 | CR1-T08 | 25 | Reddit: Differences Between ANT and Social Construction — repost 1 | `reddit.com/r/u_RefrigeratorInner250/comments/tpn083` | None | Do not retain | Informal copied essay |
| CR1-369 | CR1 | CR1-T08 | 26 | Reddit: Differences Between ANT and Social Construction — repost 2 | `reddit.com/r/u_ComplexBackground990/comments/t8gmc8` | CR1-368 | Do not retain | Duplicate informal copied essay |
| CR1-370 | CR1 | CR1-T08 | 27 | Reddit: Differences Between ANT and Social Construction — repost 3 | `reddit.com/r/u_ComfortableBoard5468/comments/ta1w6y` | CR1-368 | Do not retain | Duplicate informal copied essay |
| CR1-371 | CR1 | CR1-T08 | 28 | Reddit: Differences Between ANT and Social Construction — repost 4 | `reddit.com/r/u_Pleasant_Pressure_12/comments/u7zz8b` | CR1-368 | Do not retain | Duplicate informal copied essay |
| CR1-372 | CR1 | CR1-T08 | 29 | Actor Model of Computation | arXiv:1008.1459 | None | Do not retain | False-positive computational actor-model theory, not actor-network theory |
| CR1-373 | CR1 | CR1-T08 | 30 | Reddit: Actor-Network Theory | `reddit.com/r/sociology/comments/10kxr4z` | None | Do not retain | Informal explanatory discussion |
| CR1-374 | CR1 | CR1-T08 | 31 | Reddit: Human-AI assemblages | `reddit.com/r/sociology/comments/1jzlpa3` | None | Do not retain | Informal AI-focused discussion |
| CR1-375 | CR1 | CR1-T08 | 32 | Reddit: ANT and Object-Oriented Ontology | `reddit.com/r/CriticalTheory/comments/zaprui` | None | Do not retain | Informal theory discussion |
| CR1-376 | CR1 | CR1-T08 | 33 | Reddit: modern materialist approaches in sociology of technology | `reddit.com/r/CriticalTheory/comments/1au2hxd` | None | Do not retain | Informal recommendation thread |
| CR1-377 | CR1 | CR1-T08 | 34 | Reddit: Technological Determinism Perspective paper | `reddit.com/r/UniversityNetwork/comments/1ksnueh` | None | Do not retain | Informal student-paper discussion |
| CR1-378 | CR1 | CR1-T08 | 35 | Reddit: Critical Theory and Internet/Cyberspace | `reddit.com/r/CriticalTheory/comments/xdrnd0` | None | Do not retain | Informal discussion |
| CR1-379 | CR1 | CR1-T08 | 36 | Reddit: understanding Actor-Network Theory | `reddit.com/r/AskAnthropology/comments/ibs1sf` | None | Do not retain | Informal discussion |
| CR1-380 | CR1 | CR1-T08 | 37 | Reddit: Latour and modernity | `reddit.com/r/CriticalTheory/comments/q331is` | None | Do not retain | Informal discussion |

CR1-T08 disposition summary: 12 new candidates, 21 not retained, 3 duplicate result instances, and 1 existing-candidate resolution. No full-text screening was performed.

### Corrective Round CR1 — Targeted Query CR1-T09

Date: 2026-08-25

Search service: general web-search discovery interface with submitted `site:dl.acm.org` restriction

Exact submitted query:

```text
site:dl.acm.org CSCW awareness coordination software development observational study
```

Returned results: 0

The search interface explicitly returned “Empty search results” and reported that no results were found. There are therefore no result-level rows or dispositions for this query. The five Round 1 pilot candidates associated with the earlier execution of this query, S029–S033, were not retrospectively inserted into the corrective ledger.

CR1-T09 disposition summary: 0 new candidates, 0 not retained, and 0 duplicate result instances. No full-text screening was performed. The zero-result response also demonstrates that a general search interface plus `site:` syntax is not a stable substitute for direct ACM Digital Library searching.

### Corrective Round CR1 — Candidate Retrieval CR1-R03

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
"A Usability Study of Awareness Widgets in a Shared Workspace Groupware System" DOI authors 1996 ACM
```

Returned results: 17

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-381 | CR1 | CR1-R03 | 1 | A Usability Study of Awareness Widgets — University of Calgary technical report | `grouplab.cpsc.ucalgary.ca/.../1996-Usability.Report96-585-05.pdf` | S029 | Duplicate / earlier version | Author-hosted March 1996 report preceding the CSCW paper | S029 |
| CR1-382 | CR1 | CR1-R03 | 2 | A Usability Study of Awareness Widgets — University of Calgary CSCW paper | `grouplab.cpsc.ucalgary.ca/.../1996-Usability.CSCW.pdf` | S029 | Existing candidate resolved | Author-hosted conference paper confirms authors, venue, dates, pages, study purpose, and method | S029 |
| CR1-383 | CR1 | CR1-R03 | 3 | Carl Gutwin publication list | `grouplab.cpsc.ucalgary.ca/Publications/CarlGutwin` | CR1-382 / S029 | Duplicate | Author-group bibliography confirms S029 and its earlier report version | S029 |
| CR1-384 | CR1 | CR1-R03 | 4 | GroupLab publications by conference | `grouplab.cpsc.ucalgary.ca/Publications/PublicationsByConference` | CR1-382 / S029 | Duplicate | Institutional bibliography for S029 | S029 |
| CR1-385 | CR1 | CR1-R03 | 5 | S029 — Sciweavers summary | `sciweavers.org/publications/usability-study-awareness-widgets-shared-workspace-groupware-system` | S029 | Do not retain | Secondary aggregator; author-hosted paper is available |
| CR1-386 | CR1 | CR1-R03 | 6 | CSCW 1996 proceedings — IxDF | `ixdf.org/literature/conference/proceedings-of-the-1996-acm-conference-on-computer-supported-cooperative-work` | CR1-382 / S029 | Duplicate | Proceedings metadata confirms authors and pages | S029 |
| CR1-387 | CR1 | CR1-R03 | 7 | GroupLab general publications list | `grouplab.cpsc.ucalgary.ca/Publications` | CR1-382 / S029 | Duplicate | Institutional bibliography for S029 | S029 |
| CR1-388 | CR1 | CR1-R03 | 8 | CSCW 1996 proceedings — SIGMOD-hosted DBLP mirror | `sigmod.org/publications/dblp/db/conf/cscw/cscw1996.html` | CR1-382 / S029 | Duplicate | Proceedings index record for S029 | S029 |
| CR1-389 | CR1 | CR1-R03 | 9 | Mark Roseman publication list | `markroseman.com/publications.html` | CR1-382 / S029 | Duplicate | Coauthor bibliography with paper link | S029 |
| CR1-390 | CR1 | CR1-R03 | 10 | CSCW 1996 — DBLP | `dblp.org/db/conf/cscw/cscw1996.html` | CR1-382 / S029 | Duplicate | Bibliographic authority record for S029 | S029 |
| CR1-391 | CR1 | CR1-R03 | 11 | Carl Gutwin — IxDF author record | `ixdf.org/literature/author/carl-gutwin` | CR1-382 / S029 | Duplicate | Author index repeats S029 metadata | S029 |
| CR1-392 | CR1 | CR1-R03 | 12 | Saul Greenberg CV/publications | `grouplab.cpsc.ucalgary.ca/saul/resume/pubs.html` | CR1-382 / S029 | Duplicate | Coauthor publication record | S029 |
| CR1-393 | CR1 | CR1-R03 | 13 | Carl Gutwin — DBLP author record | `dblp.org/pid/g/CarlGutwin.html` | CR1-382 / S029 | Duplicate | Author authority record repeating S029 | S029 |
| CR1-394 | CR1 | CR1-R03 | 14 | Microsoft Research report citing S029 | `microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-2000-94.pdf` | None | Do not retain | Later citation-only result, not a location for S029 |
| CR1-395 | CR1 | CR1-R03 | 15 | Groupware Toolkits report citing S029 | `grouplab.cpsc.ucalgary.ca/.../1996-GroupwareToolkits.Report96-589-09.pdf` | None | Do not retain | Related later/parallel paper, not the target source |
| CR1-396 | CR1 | CR1-R03 | 16 | Design for Individuals, Design for Groups draft citing S029 | `grouplab.cpsc.ucalgary.ca/.../1998-DesignForGroups.Report1998-621-12.pdf` | None | Do not retain | Later citation-only result |
| CR1-397 | CR1 | CR1-R03 | 17 | Effects of Awareness Support on Groupware Usability paper citing S029 | `grouplab.cpsc.ucalgary.ca/.../1998-EffectsAwareness.CHI.pdf` | None | Do not retain | Later related study, not the target source; may be considered in a separate discovery query if material |

CR1-R03 disposition summary: 0 new candidates, 5 not retained, 11 duplicate/version result instances, and 1 existing-candidate resolution. S029 now has confirmed authorship, venue, pages, study description, and an author-hosted conference copy. No full-text screening was performed.

### Corrective Round CR1 — Candidate Retrieval CR1-R04

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
"Designing Task Visualizations to Support the Coordination of Work in Software Development" DOI authors CSCW 2006
```

Returned results: 18

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-398 | CR1 | CR1-R04 | 1 | Designing task visualizations — ResearchGate | `researchgate.net/publication/220879175_...` | S030 | Duplicate / repository copy | Author-uploaded copy and metadata repeat the target paper | S030 |
| CR1-399 | CR1 | CR1-R04 | 2 | Designing task visualizations — IBM Research | `research.ibm.com/publications/designing-task-visualizations-to-support-the-coordination-of-work-in-software-development` | S030 | Existing candidate resolved | Institutional author record confirms authors, venue, date, abstract, and publication resource | S030 |
| CR1-400 | CR1 | CR1-R04 | 3 | CSCW 2006 proceedings — researchr | `researchr.org/publication/cscw%3A2006` | CR1-399 / S030 | Duplicate | Proceedings index confirms authors and pages | S030 |
| CR1-401 | CR1 | CR1-R04 | 4 | Wendy A. Kellogg — IxDF author record | `ixdf.org/literature/author/wendy-a-kellogg` | CR1-399 / S030 | Duplicate | Author index repeats target metadata | S030 |
| CR1-402 | CR1 | CR1-R04 | 5 | CSCW06 proceedings — IxDF | `ixdf.org/literature/conference/proceedings-of-acm-cscw06-conference-on-computer-supported-cooperative-work` | CR1-399 / S030 | Duplicate | Proceedings index repeats authors, pages, and DOI | S030 |
| CR1-403 | CR1 | CR1-R04 | 6 | Designing task visualizations — EurekaMag | `eurekamag.com/research/098/236/098236654.php` | S030 | Do not retain | Commercial secondary aggregator; institutional and canonical records are available | S030 |
| CR1-404 | CR1 | CR1-R04 | 7 | IBM Research publications for ACM CSCW 2006 | `research.ibm.com/publications?source-instance=15066` | CR1-399 / S030 | Duplicate | Institutional venue listing repeats the target record | S030 |
| CR1-405 | CR1 | CR1-R04 | 8 | Issue Tracking Ecosystems — alphaXiv | `alphaxiv.org/abs/2507.06704` | None | Do not retain | Later secondary discussion citing S030, not a target-source location | None |
| CR1-406 | CR1 | CR1-R04 | 9 | CSCW 2006 — DBLP | `dblp.dagstuhl.de/db/conf/cscw/cscw2006.html` | CR1-399 / S030 | Duplicate | Bibliographic authority record confirms authors and pages | S030 |
| CR1-407 | CR1 | CR1-R04 | 10 | Wendy A. Kellogg — CSAuthors | `csauthors.net/wendy-a-kellogg/` | CR1-399 / S030 | Duplicate | Author index repeats the target record | S030 |
| CR1-408 | CR1 | CR1-R04 | 11 | IBM Research publications by author | `research.ibm.com/publications?author=62600` | CR1-399 / S030 | Duplicate | Institutional author listing repeats the target record | S030 |
| CR1-409 | CR1 | CR1-R04 | 12 | CSCW 2006 — SIGMOD-hosted DBLP mirror | `sigmod.org/publications/dblp/db/conf/cscw/cscw2006.html` | CR1-399 / S030 | Duplicate | Proceedings mirror confirms authors and pages | S030 |
| CR1-410 | CR1 | CR1-R04 | 13 | Designing Task Visualizations — George Washington University course copy | `www2.seas.gwu.edu/~mlancast/cs254/p39-halverson.pdf` | S030 | Duplicate / mirror | Inspectable third-party-hosted copy of the target paper | S030 |
| CR1-411 | CR1 | CR1-R04 | 14 | Release Management in Free and Open Source Software Ecosystems | `dspace.library.uvic.ca/server/api/core/bitstreams/.../content` | None | Do not retain | Later dissertation citing S030, not a target-source location | None |
| CR1-412 | CR1 | CR1-R04 | 15 | Identification of coordination requirements — Microsoft Research copy | `microsoft.com/en-us/research/wp-content/uploads/2016/02/coordination-techreport08.pdf` | None | Do not retain | Different paper that cites S030 | None |
| CR1-413 | CR1 | CR1-R04 | 16 | SEAFOOD conference paper | `alarcos.esi.uclm.es/ALARNET2/FILES/Congresos/2008-LNBIP16-SEAFOOD-Jimenez.pdf` | None | Do not retain | Later citation-only result | None |
| CR1-414 | CR1 | CR1-R04 | 17 | Anvaya paper | `prernajuneja.com/assets/anvaya.pdf` | None | Do not retain | Later citation-only result | None |
| CR1-415 | CR1 | CR1-R04 | 18 | Poo-Caamaño et al., Journal of Internet Services and Applications | `dspace.library.uvic.ca/bitstream/handle/1828/10423/poo-caamano_german_jisa_2017.pdf` | None | Do not retain | Later citation-only result | None |

CR1-R04 disposition summary: 0 new candidates, 7 not retained, 10 duplicate/index/copy result instances, and 1 existing-candidate resolution. S030 now has confirmed authorship, venue, pages, DOI, abstract-level scope, and institutional and inspectable-copy locations. No full-text screening was performed.

### Corrective Round CR1 — Candidate Retrieval CR1-R05

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
"Supporting Effortless Coordination: 25 Years of Awareness Research" DOI authors 2013
```

Returned results: 18

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-416 | CR1 | CR1-R05 | 1 | Supporting Effortless Coordination — University of Bamberg | `fis.uni-bamberg.de/entities/publication/1cb94ed3-d725-4bbe-b656-af9808202e40` | S031 | Existing candidate resolved | Author-institution record confirms author, journal, volume, issues, pages, year, DOI, and publisher location | S031 |
| CR1-417 | CR1 | CR1-R05 | 2 | Supporting Effortless Coordination — ResearchGate | `researchgate.net/publication/257552358_...` | S031 | Duplicate / request-copy record | Secondary platform repeats target identity and abstract | S031 |
| CR1-418 | CR1 | CR1-R05 | 3 | Supporting Effortless Coordination — EUSSET Digital Library | `dl.eusset.eu/items/b37f1c5a-1d1f-4caa-bf2c-62ef9d3cf453` | S031 | Duplicate / disciplinary repository record | EUSSET record repeats citation, DOI, abstract, and document type | S031 |
| CR1-419 | CR1 | CR1-R05 | 4 | Supporting Effortless Coordination — CiNii Research | `cir.nii.ac.jp/crid/1360013172934433664` | S031 | Duplicate / metadata index | Crossref-derived index repeats target identity and publisher links | S031 |
| CR1-420 | CR1 | CR1-R05 | 5 | Human Augmentation Technologies for Employee Well-Being | `pmc.ncbi.nlm.nih.gov/articles/PMC8835247/` | None | Do not retain | Later article citing S031, not a target-source location | None |
| CR1-421 | CR1 | CR1-R05 | 6 | Crisis Readiness | `pmc.ncbi.nlm.nih.gov/articles/PMC9040692/` | None | Do not retain | Later article citing S031, not a target-source location | None |
| CR1-422 | CR1 | CR1-R05 | 7 | Boundary Management | `doi.org/10.1145/3340764.3344456` | None | Do not retain | Different later paper citing S031 | None |
| CR1-423 | CR1 | CR1-R05 | 8 | Home-Life and Work Rhythm Diversity in Distributed Teamwork | `doi.org/10.1145/3512942` | None | Do not retain | Different later paper citing S031 | None |
| CR1-424 | CR1 | CR1-R05 | 9 | Tom Gross selected publications | `cml.hci.uni-bamberg.de/~gross/publ/` | CR1-416 / S031 | Duplicate | Author publication list confirms target citation and exposes a document link | S031 |
| CR1-425 | CR1 | CR1-R05 | 10 | What Do We Study When Studying Politics and Democracy? | `tandfonline.com/doi/full/10.1080/10447318.2024.2416562` | None | Do not retain | Later citation-only result | None |
| CR1-426 | CR1 | CR1-R05 | 11 | Trinity: A Design Fiction | `orbilu.uni.lu/handle/10993/63700` | None | Do not retain | Later work citing S031 | None |
| CR1-427 | CR1 | CR1-R05 | 12 | Large language model tools as catalysts for collective cognition | `nature.com/articles/s41599-026-06738-7` | None | Do not retain | Later work citing S031 | None |
| CR1-428 | CR1 | CR1-R05 | 13 | The Awareness-/Coordination-Support-System Paradox | `citeseerx.ist.psu.edu/document?doi=66f364e6d09acefba0dc3e6b5f99d4c06ab5f3a9` | None | Do not retain | Different work citing S031 | None |
| CR1-429 | CR1 | CR1-R05 | 14 | Reference PDF for LLM collective-cognition article | `nature.com/articles/s41599-026-06738-7_reference.pdf` | None | Do not retain | Reference-only duplicate of a later citing work | None |
| CR1-430 | CR1 | CR1-R05 | 15 | i-com special issue | `peasec.de/paper/2014/2014_PipekReuter_Eds_SpecialIssueKrisenmanagement_ICOM.pdf` | None | Do not retain | Later publication citing S031 | None |
| CR1-431 | CR1 | CR1-R05 | 16 | It’s a Complete Haystack | `cheng-kathy.github.io/pubs/CSCW25-haystack.pdf` | None | Do not retain | Later paper citing S031 | None |
| CR1-432 | CR1 | CR1-R05 | 17 | Journal of Systems and Software article | `ruidera.uclm.es/server/api/core/bitstreams/bcb7e8ba-27ef-4961-aca9-31301276f0e1/content` | None | Do not retain | Later paper citing S031 | None |
| CR1-433 | CR1 | CR1-R05 | 18 | EUSSET reports PDF | `eusset.eu/downloads/2510-2591-03-02-2019.pdf` | None | Do not retain | Later report citing S031 | None |

CR1-R05 disposition summary: 0 new candidates, 13 not retained, 4 duplicate/repository/index result instances, and 1 existing-candidate resolution. S031 now has confirmed authorship, journal, volume and issue range, pages, year, DOI, survey role, abstract-level scope, and institutional and disciplinary-repository locations. No full-text screening was performed.

### Corrective Round CR1 — Candidate Retrieval CR1-R06

Date: 2026-08-25

Search service: general web-search discovery interface

Exact submitted query:

```text
"Understanding Coordination in Global Software Engineering: A Mixed-methods Study on the Use of Meetings and Slack" authors DOI publication
```

Returned results: 20

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-434 | CR1 | CR1-R06 | 1 | Understanding coordination in global software engineering — ScienceDirect | `sciencedirect.com/science/article/pii/S0164121220301564` | S032 | Existing candidate resolved | Publisher record confirms final journal version, authors, volume, article number, DOI, open-access status, abstract, and method summary | S032 |
| CR1-435 | CR1 | CR1-R06 | 2 | Journal of Systems and Software 170 article PDF — CORE | `fileserver-az.core.ac.uk/download/491283412.pdf` | S032 | Duplicate / repository copy | Inspectable copy of the final journal article | S032 |
| CR1-436 | CR1 | CR1-R06 | 3 | Understanding coordination — ResearchGate journal record | `researchgate.net/publication/342677021_...` | S032 | Duplicate / repository copy | Secondary platform repeats final article and metadata | S032 |
| CR1-437 | CR1 | CR1-R06 | 4 | Understanding coordination — arXiv 2007.02328 | `arxiv.org/abs/2007.02328` | S032 | Duplicate / preprint version | Author preprint corresponding to the published journal article | S032 |
| CR1-438 | CR1 | CR1-R06 | 5 | Global Software Engineering special issue — ScienceDirect | `sciencedirect.com/special-issue/10V2WHQCGWT` | CR1-434 / S032 | Duplicate / issue index | Publisher special-issue listing repeats the target article | S032 |
| CR1-439 | CR1 | CR1-R06 | 6 | Understanding coordination — SINTEF publication 1818595 | `sintef.no/en/publications/publication/1818595/` | CR1-434 / S032 | Duplicate / institutional record | Coauthor institution confirms citation, affiliations, DOI, abstract, and repository link | S032 |
| CR1-440 | CR1 | CR1-R06 | 7 | Understanding coordination — SINTEF publication 1916973 | `sintef.no/en/publications/publication/1916973/` | CR1-434 / S032 | Duplicate / presentation record | Institutional record for the later journal-first presentation of the same article | S032 |
| CR1-441 | CR1 | CR1-R06 | 8 | Understanding coordination — University of Notre Dame catalog | `findit.library.nd.edu/EdsRecord/bsh%2C146249772` | CR1-434 / S032 | Duplicate / catalog record | Library index repeats article identity and abstract | S032 |
| CR1-442 | CR1 | CR1-R06 | 9 | Understanding coordination — ResearchGate preprint record | `researchgate.net/publication/342733374_...` | CR1-437 / S032 | Duplicate / preprint copy | Secondary-platform copy of the arXiv/prepublication version | S032 |
| CR1-443 | CR1 | CR1-R06 | 10 | Understanding coordination — researchr authors page | `researchr.org/publication/StrayM20/authors` | CR1-434 / S032 | Duplicate / metadata index | Bibliographic index repeats authors and journal citation | S032 |
| CR1-444 | CR1 | CR1-R06 | 11 | Understanding coordination — ICSSP/ICGSE 2021 journal-first | `conf.researchr.org/details/icssp-icgse-2021/icssp-icgse-2021-journal-first/4/...` | CR1-434 / S032 | Duplicate / presentation record | Later presentation record for the already-published article | S032 |
| CR1-445 | CR1 | CR1-R06 | 12 | Slack Use in Large-Scale Agile Organizations | `link.springer.com/chapter/10.1007/978-3-031-61154-4_2` | None | Do not retain | Later distinct paper citing S032, not a target-source location | None |
| CR1-446 | CR1 | CR1-R06 | 13 | Understanding coordination — researchr publication | `researchr.org/publication/StrayM20` | CR1-434 / S032 | Duplicate / metadata index | Bibliographic record repeats the final article | S032 |
| CR1-447 | CR1 | CR1-R06 | 14 | Understanding coordination — DBLP | `dblp.dagstuhl.de/rec/journals/corr/abs-2007-02328.html` | CR1-437 / S032 | Duplicate / preprint index | Bibliographic authority record for the arXiv version | S032 |
| CR1-448 | CR1 | CR1-R06 | 15 | Rebelo 2022 bibliography | `run.unl.pt/bitstream/10362/144383/1/Rebelo_2022.pdf` | None | Do not retain | Later bibliography citing S032 | None |
| CR1-449 | CR1 | CR1-R06 | 16 | Three Cs of agile practice paper | `fileserver-az.core.ac.uk/download/599213958.pdf` | None | Do not retain | Different later paper citing S032 | None |
| CR1-450 | CR1 | CR1-R06 | 17 | Action research on expert mentoring | `duepublico2.uni-due.de/servlets/MCRFileNodeServlet/duepublico_derivate_00076644/fcomp_2022-04-983164.pdf` | None | Do not retain | Different later paper citing S032 | None |
| CR1-451 | CR1 | CR1-R06 | 18 | Good Fences Make Good Neighbours? | `fpalomba.github.io/pdf/Conferencs/C63.pdf` | None | Do not retain | Different later paper citing S032 | None |
| CR1-452 | CR1 | CR1-R06 | 19 | Responding to change over time | `researchmgt.monash.edu/ws/portalfiles/portal/522959476/507455051_oa.pdf` | None | Do not retain | Different later paper citing S032 | None |
| CR1-453 | CR1 | CR1-R06 | 20 | Journal of Systems and Software — Wikipedia | `en.wikipedia.org/wiki/Journal_of_Systems_and_Software` | None | Do not retain | Tertiary journal page merely mentioning the target | None |

CR1-R06 disposition summary: 0 new candidates, 7 not retained, 12 duplicate/version/index/presentation result instances, and 1 existing-candidate resolution. S032 is now reconciled to the final 2020 open-access journal article, with arXiv:2007.02328 retained as its preprint version rather than the canonical citation. No full-text screening was performed.

### CR1-R07 — S033 retrieval

Query: `"Communico" software developers conversations coordinating work sharing knowledge CSCW 2011 DOI 10.1145/1958824.1958914 authors`

Returned: 2.

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-454 | CR1 | CR1-R07 | 1 | Communico — ResearchGate | `researchgate.net/publication/220879277_...` | S033 | Duplicate / copy | Author-uploaded copy of target | S033 |
| CR1-455 | CR1 | CR1-R07 | 2 | Communico — TU Delft | `research.tudelft.nl/en/publications/communico-overhearing-conversations-in-a-virtual-office/` | S033 | Existing candidate resolved | Institutional record confirms authors, type, pages, event, year, DOI | S033 |

Summary: 0 new, 0 not retained, 1 duplicate, 1 existing resolution. S033 is a two-page video-track extended abstract, not an empirical study. No full-text screening.

### CR1-C01 — lifecycle and evolution coverage

Query: `software sociotechnical deployment transition maintenance evolution empirical study organization coordination`

Returned: 11.

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| CR1-456 | CR1 | CR1-C01 | 1 | The Never-Ending Story—sustaining continuous software engineering | `sciencedirect.com/science/article/pii/S0164121224001018` | None | Retain | Empirical organizational adaptation study | S149 |
| CR1-457 | CR1 | CR1-C01 | 2 | Disciplined Delivery and Organizational Design Maturity | `mdpi.com/2079-8954/13/5/374` | None | Retain | Six sociotechnical transformation cases | S150 |
| CR1-458 | CR1 | CR1-C01 | 3 | JMIS architectural syncing and software evolution article | `jmis-web.org/articles/1741` | None | Retain | Longitudinal system-team evolution analysis | S151 |
| CR1-459 | CR1 | CR1-C01 | 4 | Post Adoption Software Upgrade Instability | `lup.lub.lu.se/student-papers/search/publication/9237471` | None | Retain | Mixed-method sociotechnical upgrade study | S152 |
| CR1-460 | CR1 | CR1-C01 | 5 | Sociotechnical Coordination and Collaboration in OSS | `microsoft.com/en-us/research/publication/sociotechnical-coordination-and-collaboration-in-open-source-software/` | S059 | Existing candidate resolved | Institutional publication record | S059 |
| CR1-461 | CR1 | CR1-C01 | 6 | Evolutionary Trends of Developer Coordination | `siemens.github.io/codeface/emse/` | None | Retain | Longitudinal study of 18 OSS projects | S153 |
| CR1-462 | CR1 | CR1-C01 | 7 | Responding to Change over Time | `link.springer.com/article/10.1007/s10664-023-10349-0` | None | Retain | Longitudinal coordination-change case | S154 |
| CR1-463 | CR1 | CR1-C01 | 8 | How Do Requirements Evolve over Time? | `journals.sagepub.com/doi/10.1057/s41265-016-0001-y` | None | Retain | Five-year enterprise-software lifecycle case | S155 |
| CR1-464 | CR1 | CR1-C01 | 9 | Integrated development and maintenance for ERP software | `onlinelibrary.wiley.com/doi/abs/10.1002/smr.330` | None | Retain | Deployment and maintenance case | S156 |
| CR1-465 | CR1 | CR1-C01 | 10 | Responding to Change — SINTEF | `sintef.no/en/publications/publication/2187702/` | S154 | Duplicate | Institutional record | S154 |
| CR1-466 | CR1 | CR1-C01 | 11 | Evolutionary Trends — arXiv | `arxiv.org/abs/1510.06988` | S153 | Duplicate / preprint | Preprint version | S153 |

Summary: 8 new, 0 not retained, 2 duplicates, 1 existing resolution. No full-text screening.

### CR1-C02 — individual and public-sector coverage

Query: `software engineering sociotechnical individual work public sector empirical study coordination`

Returned: 9.

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| CR1-467 | CR1 | CR1-C02 | 1 | TSE public-sector inter-team coordination paper | `research.monash.edu/files/440601380/377786622.pdf` | None | Retain | Empirical public-sector software case | S157 |
| CR1-468 | CR1 | CR1-C02 | 2 | Organization of Software Teams for Continuous Delivery | `arxiv.org/abs/2008.08652` | None | Retain | Grounded-theory division-of-labor study | S158 |
| CR1-469 | CR1 | CR1-C02 | 3 | Journal of Software: Evolution and Process article | `digital.library.adelaide.edu.au/.../download` | None | Do not retain | Fragment insufficient to establish relevance | None |
| CR1-470 | CR1 | CR1-C02 | 4 | Evolution of Empirical Methods in Software Engineering | `arxiv.org/abs/1912.11512` | None | Do not retain | Research-method history, not target behavior | None |
| CR1-471 | CR1 | CR1-C02 | 5 | Exploring the Evolution of Software Practices | `pure.itu.dk/.../FSE2020_Evolving_Practices_author_version_for_the_web.pdf` | None | Retain | Empirical practice-evolution study | S159 |
| CR1-472 | CR1 | CR1-C02 | 6 | Understanding coordination in GSE | `arxiv.org/abs/2007.02328` | S032 | Duplicate / preprint | Existing candidate version | S032 |
| CR1-473 | CR1 | CR1-C02 | 7 | Empirical Software Engineering team paper | `bth.diva-portal.org/.../FULLTEXT01.pdf` | None | Do not retain | Fragment insufficient to establish relationship | None |
| CR1-474 | CR1 | CR1-C02 | 8 | Sociotechnical Coordination and Collaboration PDF | `microsoft.com/.../bird2011scc.pdf` | S059 | Duplicate / copy | Institutional full-paper location | S059 |
| CR1-475 | CR1 | CR1-C02 | 9 | Sociotechnical system — Wikipedia | `en.wikipedia.org/wiki/Sociotechnical_system` | None | Do not retain | Tertiary overview | None |

Summary: 3 new, 4 not retained, 2 duplicates. No full-text screening.

### CR1-C03 — adaptation and integrity coverage

Query: `software systems sociotechnical successful adaptation ordinary work resilience empirical study replication correction retraction`

Returned: 3.

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| CR1-476 | CR1 | CR1-C03 | 1 | Software evolution — Wikipedia | `en.wikipedia.org/wiki/Software_evolution` | None | Do not retain | Tertiary overview | None |
| CR1-477 | CR1 | CR1-C03 | 2 | Sheffield Software Engineering Observatory — Wikipedia | `en.wikipedia.org/wiki/Sheffield_Software_Engineering_Observatory` | None | Do not retain | Facility overview, not a primary study | None |
| CR1-478 | CR1 | CR1-C03 | 3 | Empirical software engineering — Wikipedia | `en.wikipedia.org/wiki/Empirical_software_engineering` | None | Do not retain | Tertiary overview | None |

Summary: 0 new, 3 not retained, 0 duplicates. The broad query failed; targeted follow-up remains required. No full-text screening.

### CR1-C04 — targeted adaptation, replication, correction, and STC criticism batch

Four submitted queries: `software engineering "work as imagined" "work as done" successful adaptation study`; `software incident response ordinary work adaptive capacity empirical study replication`; `site:retractionwatch.com software engineering sociotechnical systems retraction OR correction`; `sociotechnical congruence replication study software engineering criticism`.

The interface returned one merged 27-result response. Result order below preserves that response. No retraction/correction record for a chapter candidate was returned.

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| CR1-479 | CR1 | CR1-C04 | 1 | Beyond compliance: work-as-done in procedural work | `sciencedirect.com/science/article/pii/S0925753526001001` | None | Do not retain | Petrochemical, not software; adjacent adaptation evidence only | None |
| CR1-480 | CR1 | CR1-C04 | 2 | Towards Multi-Class STC | `doi.org/10.1002/smr.70040` | S103 | Duplicate | Existing candidate | S103 |
| CR1-481 | CR1 | CR1-C04 | 3 | In Search of STC — arXiv | `arxiv.org/abs/2105.08198` | S016 | Duplicate | Existing null-result candidate | S016 |
| CR1-482 | CR1 | CR1-C04 | 4 | Using Agents to Manage STC | `sciencedirect.com/science/article/abs/pii/S0020025514000152` | S099 | Duplicate | Existing candidate | S099 |
| CR1-483 | CR1 | CR1-C04 | 5 | Replication Assessment Problem in Software Engineering | `arxiv.org/abs/2607.13815` | None | Do not retain | General replication methodology, not chapter claim replication | None |
| CR1-484 | CR1 | CR1-C04 | 6 | Systematic Mapping Study about STC | `sciencedirect.com/science/article/abs/pii/S0950584916302798` | S097 | Duplicate | Existing coverage candidate | S097 |
| CR1-485 | CR1 | CR1-C04 | 7 | In Search of STC — ResearchGate | `researchgate.net/publication/351729880_...` | S016 | Duplicate / copy | Existing candidate copy | S016 |
| CR1-486 | CR1 | CR1-C04 | 8 | Coordination among students in a project course | `doi.org/10.1109/CSEET.2013.6595261` | None | Do not retain | Work-in-progress student setting; lower materiality than existing studies | None |
| CR1-487 | CR1 | CR1-C04 | 9 | Replicating SE experiments | `sciencedirect.com/science/article/abs/pii/S0950584904001259` | None | Do not retain | General replication methodology | None |
| CR1-488 | CR1 | CR1-C04 | 10 | Assessing impact of STC — systematic review | `doaj.org/article/a7da7c61ef2b4f9381d742c50353fdfa` | S097 | Duplicate / overlapping review | No new source class; dependency requires later reconciliation | S097 |
| CR1-489 | CR1 | CR1-C04 | 11 | Work-as-done in firefighter exercises | `sciencedirect.com/science/article/pii/S0003687017302375` | None | Do not retain | Emergency response, not software | None |
| CR1-490 | CR1 | CR1-C04 | 12 | Discovery over Application dissertation | `digitalcommons.unl.edu/computerscidiss/90/` | None | Do not retain | Replication discussion unrelated to target sociotechnical mechanism | None |
| CR1-491 | CR1 | CR1-C04 | 13 | Replication and Knowledge Production in ESE | `scholarsarchive.byu.edu/etd/4296/` | None | Do not retain | General replication methodology | None |
| CR1-492 | CR1 | CR1-C04 | 14 | Role and value of replication in ESE | `sciencedirect.com/science/article/abs/pii/S0950584917304305` | None | Do not retain | General replication methodology | None |
| CR1-493 | CR1 | CR1-C04 | 15 | Comparing Results of Replications in SE | `arxiv.org/abs/2011.02861` | None | Do not retain | General replication methodology | None |
| CR1-494 | CR1 | CR1-C04 | 16 | In Search of STC — full-text copy | `researchgate.net/.../In-Search-of-Socio-Technical-Congruence...pdf` | S016 | Duplicate / copy | Existing candidate copy | S016 |
| CR1-495 | CR1 | CR1-C04 | 17 | Improving SE Team Communication Through Social Networks | `arxiv.org/abs/2502.01923` | None | Do not retain | Student project and no new central construct | None |
| CR1-496 | CR1 | CR1-C04 | 18 | Resilience-engineering thesis | `kclpure.kcl.ac.uk/.../2019_Alders_Matthew_0805106_ethesis.pdf` | None | Do not retain | Fragment does not establish direct software relevance | None |
| CR1-497 | CR1 | CR1-C04 | 19 | Study of Sociotechnical Coordination Using STC | `dspace.library.uvic.ca/.../download` | None | Do not retain | Fragmentary thesis result; no new construct beyond mapped STC literature | None |
| CR1-498 | CR1 | CR1-C04 | 20 | Identifying Effective Improvements to software safety practice | `etheses.whiterose.ac.uk/.../Osborne_203056000_WREO.pdf` | None | Do not retain | Fragmentary thesis; materiality not established | None |
| CR1-499 | CR1 | CR1-C04 | 21 | Balancing Value and Risk of STC | `citeseerx.ist.psu.edu/document?doi=1ed6a0c4...` | None | Do not retain | Fragmentary result; no inspectable distinct contribution established | None |
| CR1-500 | CR1 | CR1-C04 | 22 | Evolutionary Perspective on STC | `wohlin.eu/reser13.pdf` | None | Do not retain | Proposal rather than completed empirical result | None |
| CR1-501 | CR1 | CR1-C04 | 23 | Replication crisis — Wikipedia | `en.wikipedia.org/wiki/Replication_crisis` | None | Do not retain | Tertiary overview | None |
| CR1-502 | CR1 | CR1-C04 | 24 | Resilience engineering — Wikipedia | `en.wikipedia.org/wiki/Resilience_engineering` | None | Do not retain | Tertiary overview | None |
| CR1-503 | CR1 | CR1-C04 | 25 | AskEngineers sociotechnical advice thread | `reddit.com/r/AskEngineers/comments/kuhzkw` | None | Do not retain | Unverified community advice | None |
| CR1-504 | CR1 | CR1-C04 | 26 | Evidence-based software engineering discussion | `reddit.com/r/programming/comments/jt53ue` | None | Do not retain | Unverified community commentary | None |
| CR1-505 | CR1 | CR1-C04 | 27 | Prototype ethics discussion | `reddit.com/r/programming/comments/1h7fa0f` | None | Do not retain | Secondary community discussion | None |

Summary: 0 new candidates, 21 not retained, and 6 duplicate/overlapping records. This second targeted coverage round added no central construct, mechanism, materially contrary result, or source class. No full-text screening.

Each future returned result must record:

| Ledger ID | Round | Query ID | Rank | Source title or identifying text | URL or identifier | Duplicate of | Title/summary disposition | Criterion and reason | Candidate ID |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |

## Reconciliation rules

- Assign one ledger row to every returned result instance, including duplicates and off-topic results.
- Preserve the search service's returned order when available.
- Link duplicates to a canonical ledger row and, when promoted, to one source ID.
- Do not reuse S001–S043. A genuinely new candidate begins at S044.
- A repeated result matching an existing candidate retains its existing source ID.
- Record uncertainty rather than guessing missing authorship, venue, version, or disposition.
- Search-result or AI-generated summaries remain discovery material and cannot populate evidence extraction.

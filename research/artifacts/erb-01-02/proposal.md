# The Engineering Research Book

## ERB-01-02 research proposal

Proposal version: 0.1

Status: Approved for protocol design

Approved: 2026-08-25

Prepared: 2026-08-25

Chapter: [ERB-01-02 — Software as a sociotechnical system](../../01-nature-of-software-engineering/02-software-as-a-sociotechnical-system.md)

---

## Primary research question

> How do technical artifacts, people, processes, organizations, and environments interact in the behavior and evolution of software systems?

## Supporting questions

1. Which definitions and models of sociotechnical systems are applicable to software engineering, and what are their units of analysis?
2. Which technical, human, organizational, procedural, institutional, and environmental elements materially participate in software-system behavior?
3. Through which mechanisms do relationships among those elements affect development, operation, maintenance, adaptation, safety, reliability, security, usability, and other outcomes?
4. How do responsibility, authority, information, incentives, coordination, and feedback move across system boundaries?
5. Which properties or failures emerge from interactions and cannot be explained adequately by inspecting source code or isolated components alone?
6. Where are sociotechnical explanations more useful than purely technical explanations, and where do they add little or become too vague to test?
7. Which methods can investigate sociotechnical interactions without treating correlation, narrative plausibility, or one incident as a universal mechanism?
8. Which important counterarguments, alternative models, or boundary conditions qualify the sociotechnical framing?

## Why the question matters

ERB-01-01 found that the included professional frameworks and studies place software construction among broader responsibilities involving requirements, verification, coordination, knowledge, operation, and consequence. It did not determine how these responsibilities interact inside a system or how responsibility should be distributed.

Later research cannot evaluate software engineering, AI participation, trust, governance, or Zelyq merely by inspecting generated code. Software behavior can depend on deployment conditions, operator action, organizational incentives, communication paths, policies, infrastructure, user practices, maintenance decisions, and changes in the surrounding environment. However, calling software “sociotechnical” without defining the system, mechanism, and evidence would add vocabulary rather than understanding.

This chapter will investigate when the sociotechnical framing explains software behavior and evolution, what it requires researchers to observe, and where its limits lie. Its purpose is to establish an evidence-based unit of analysis for later chapters, not to defend one academic tradition or presume that every outcome has a social cause.

## Expected contribution

The chapter is expected to produce:

- a bounded definition map for sociotechnical software systems;
- a map of technical, human, organizational, procedural, institutional, and environmental elements;
- a taxonomy of interaction mechanisms, dependencies, feedback paths, and boundary conditions;
- a level-of-analysis map covering individuals, teams, organizations, ecosystems, and operating environments;
- an evidence map connecting selected interactions to observed behavior, evolution, and outcomes;
- an account of alternative explanations and limits of sociotechnical analysis;
- confidence-rated findings; and
- open questions for later chapters on uncertainty, understanding, failure, work, collaboration, trust, and governance.

These are expected forms of output, not expected conclusions.

## Included scope

The investigation includes:

- software-intensive systems during development, deployment, operation, maintenance, and evolution;
- definitions and models of sociotechnical systems relevant to software engineering;
- relationships among software, infrastructure, people, teams, organizations, processes, policies, users, and external environments;
- allocation and movement of responsibility, authority, information, incentives, and feedback;
- empirical studies, case studies, incident analyses, ethnographic or observational studies, surveys, repository studies, and structured syntheses that expose interactions;
- successful adaptation and ordinary work as well as failures and incidents;
- open-source, commercial, public-sector, safety-critical, and other settings when their context is adequately described;
- technical mechanisms when their effect depends materially on human or organizational conditions; and
- criticism or evidence showing that a sociotechnical account is unnecessary, incomplete, misleading, or insufficiently operationalized.

## Excluded scope

The investigation excludes:

- the claim that every software defect has a social or organizational cause;
- purely philosophical discussion that cannot clarify an observable construct, mechanism, boundary, or implication for research;
- generic organizational behavior with no material connection to a software-intensive system;
- detailed causal histories of software failure, except as bounded evidence for interaction mechanisms; ERB-01-05 owns the broader failure-over-time synthesis;
- comprehensive treatment of requirements, architecture, maintenance, safety, security, human-computer interaction, or organizational design when the sociotechnical interaction is not the question;
- evaluation of AI engineering capabilities, which belongs to Part IV;
- decisions about Zelyq features, architecture, workflows, or organizational policy; and
- treating Zelyq's current design or mission as evidence for general findings.

## Key terms requiring operational treatment

- software-intensive system
- sociotechnical system
- technical artifact
- person and role
- team and organization
- process and practice
- institution and policy
- environment and context
- interaction and dependency
- boundary
- feedback
- emergence
- adaptation and evolution
- responsibility and authority
- behavior and outcome

The proposal does not adopt a final definition. The protocol will specify how competing definitions are extracted and compared and how a claimed interaction must be evidenced.

## Proposed research mode and method

The chapter will combine:

1. **Structured evidence synthesis** to identify definitions, models, empirical interaction studies, incident or case evidence, and systematic or mapping reviews.
2. **Conceptual analysis** to compare units and levels of analysis, distinguish system elements from relationships, and construct a bounded interaction taxonomy.
3. **Mechanism-oriented synthesis** to examine how selected configurations produce or constrain behavior without assuming that temporal sequence, correlation, or stakeholder belief establishes causality.

The study will not claim comprehensive coverage unless the eventual search protocol and execution support that description. Evidence about failures will be sampled for mechanisms and boundary testing rather than used to estimate universal failure prevalence.

## Expected evidence or data

Relevant evidence may include:

- foundational and contemporary sociotechnical-system definitions;
- software-engineering studies that explicitly operationalize technical and social or organizational variables;
- field observations and ethnographic studies of development and operation;
- comparative or longitudinal case studies;
- incident reports with inspectable technical and organizational evidence;
- studies of coordination, communication, ownership, organizational structure, and software architecture;
- studies of deployment, operations, maintenance, workarounds, adaptation, and feedback;
- systematic reviews and mapping studies;
- standards or safety and systems-engineering frameworks when used for their stated normative role; and
- critical analyses and alternative explanations that test whether the sociotechnical framing adds explanatory value.

Normative models will not be treated as observations of actual work. Incident accounts will not establish prevalence. Self-reports will support claims about reported experience or belief unless corroborated by evidence appropriate to behavior or outcomes.

## Known overlap and dependencies

- ERB-01-01 supplies the reviewed responsibility-based foundation and prevents this chapter from relying on occupational titles.
- ERB-01-03 will examine uncertainty, constraints, and tradeoffs; this chapter identifies where those conditions arise across system relationships without pre-empting decision theory.
- ERB-01-04 will investigate system understanding; this chapter identifies what may need to be understood without deciding the cognitive or representational requirements.
- ERB-01-05 owns the general synthesis of success, degradation, and failure over time; this chapter uses outcomes only to test interaction mechanisms.
- ERB-02-03 will examine coordination and communication as engineering work in greater depth.
- Part III will examine collaboration and organization without assuming that a sociotechnical model already determines the correct structure.
- Later Zelyq engineering entries may cite only reviewed findings and must add verified project facts, alternatives, risks, and authorization.

## Known risks, biases, and ethical concerns

### Conceptual elasticity

“Sociotechnical” can become so broad that almost any observation confirms it.

Mitigation: require sources and findings to identify the system boundary, elements, relationship, mechanism, level of analysis, context, and observable consequence. Publish Insufficient findings when competing explanations cannot be distinguished.

### Social-versus-technical false division

The analysis may incorrectly treat people and technology as separable causes when practices, representations, automation, and organizations are mutually constituted.

Mitigation: record how each source defines elements and relationships; permit relational and joint-optimization models rather than forcing every result into two independent categories.

### Failure and hindsight bias

Incident literature can overrepresent unusual failures and reconstruct a coherent causal story after the outcome is known.

Mitigation: seek ordinary work, successful adaptation, near misses, comparative cases, and prospective or longitudinal evidence. Preserve uncertainty and alternative causal accounts.

### Organizational blame

Simplified accounts may attribute systemic outcomes to individual error, culture, or process without adequate evidence.

Mitigation: distinguish observed action from responsibility, authority, incentives, constraints, and system design. Do not infer negligence, competence, intent, or culture from outcome alone.

### Academic and setting coverage bias

English-language indexed research may overrepresent large organizations, Western institutions, safety-critical systems, and settings that permit publication.

Mitigation: record coverage and access limits, seek varied settings and open-source evidence where methodologically appropriate, and bound transfer claims.

### Construct and measurement mismatch

Repository proxies, organization charts, communication counts, surveys, and incident categories may not measure the interaction or responsibility named in a conclusion.

Mitigation: appraise construct validity at source and finding levels and synthesize nominal structure separately from exercised responsibility and observed behavior.

### Human-participant and privacy concerns

Published studies may involve workplace observation, communications, or identifiable incident participants.

Mitigation: initially analyze lawfully accessible published reports without collecting new participant data. Do not reproduce unnecessary personal information, private communications, or sensitive operational details. Any new participant or repository study requires a protocol amendment and applicable ethics, consent, privacy, and security review before collection.

## Resources and access required

The research requires scholarly indexes, publisher and institutional repositories, stable copies of foundational works, software-engineering research databases, public incident repositories, and source metadata sufficient to distinguish versions and contexts.

Full text must be inspectable before a source supports a substantive claim. Paywalled, inaccessible, or restricted sources will be logged but excluded from evidence use unless lawful access is obtained. Search snippets, citation counts, and AI summaries are discovery aids only.

## Proposed artifacts

- approved proposal;
- versioned protocol and amendments;
- search log;
- screening and exclusion record;
- source inventory;
- evidence table;
- system-element and interaction coding record;
- case or incident comparison record when applicable;
- claim–evidence records;
- analysis and synthesis notes;
- reviewer assessments; and
- chapter revision history.

## Expected outcome

The research should produce a defensible account of when and how software behaves as part of a sociotechnical system, which interactions and boundaries matter in the evidence, and what cannot yet be determined. It must remain possible for the review to conclude that particular sociotechnical models are too broad, context-bound, or weakly evidenced for a proposed use.

The outcome will not select a Zelyq architecture or workflow. Any later Zelyq application must begin with a separate, verified project problem and use only findings accepted for that scope.

## Proposal decisions required before protocol design

Reviewers should determine:

- whether the primary question is sufficiently bounded for one chapter;
- whether behavior and evolution can be covered without duplicating ERB-01-05;
- whether mechanism-oriented synthesis is feasible across the expected evidence types;
- whether the proposed element and interaction categories prejudge the synthesis;
- whether ordinary work and successful adaptation receive adequate attention alongside failure;
- whether organizational, geographic, and open-source perspectives are sufficiently planned;
- whether ethical and privacy safeguards fit the intended sources;
- which methodological and domain expertise the protocol review requires; and
- whether the expected artifacts provide an adequate audit trail.

Approval of this proposal would authorize protocol design. It would not authorize evidence collection, approve a definition or finding, create a Zelyq engineering implication, or authorize code.

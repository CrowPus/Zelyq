# The Engineering Research Book

## Research methodology

Version: 1.0

Status: Active — Version 1 reviewed

---

## Purpose

This methodology defines how research in The Engineering Research Book moves from a proposed question to a reviewed finding. It establishes a common process while allowing the method to fit the question being investigated.

The methodology does not prescribe one research design for every chapter. Software-engineering questions may require literature synthesis, repository analysis, interviews, surveys, experiments, case studies, artifact evaluation, historical analysis, or conceptual work. Rigor depends on selecting and applying an appropriate method, not on preferring one type of data.

Evidence assessment is governed by the [Evidence Standard](07-evidence-standard.md). Editorial presentation is governed by the [Editorial Style Guide](../STYLE_GUIDE.md). Review and acceptance are governed by the [Contribution Guide](08-contribution-guide.md).

## Research principles

All research conducted for the book follows these principles:

1. **Questions precede conclusions.** A study begins with a researchable question, not a result it is expected to defend.
2. **Methods fit questions.** The design must be capable of producing evidence relevant to the question and intended claim.
3. **Decisions remain visible.** Scope, search, selection, exclusion, transformation, and interpretation choices are recorded.
4. **Evidence and interpretation remain distinct.** Sources and observations are presented separately from the book's synthesis and implications.
5. **Contrary evidence is sought.** Research should test plausible alternatives and not only accumulate support for an initial view.
6. **Claims remain bounded.** Findings identify the population, context, task, period, or assumptions to which they apply.
7. **Uncertainty is an outcome.** Insufficient or conflicting evidence is reported rather than converted into false certainty.
8. **Correction is expected.** A finding may be revised or withdrawn when its evidence or reasoning no longer supports it.

## Unit of research

Each research chapter has one primary research question. Supporting questions may divide the work, but they must contribute directly to the primary question.

A question is suitable when it is:

- relevant to the central question of its part;
- precise enough to determine what evidence is relevant;
- bounded enough to investigate coherently;
- open to more than one defensible answer; and
- answerable through evidence, analysis, or clearly identified conceptual reasoning.

Questions that embed a preferred solution should be reframed. For example, “How should Zelyq implement permanent memory?” assumes both the solution and its necessity. A researchable formulation might ask, “Which forms of project knowledge must persist across engineering work, and what failures occur when they do not?”

## Research modes

The mode must be identified in the chapter proposal. A chapter may combine modes when their roles and methods are stated separately.

### Evidence synthesis

Evidence synthesis identifies and combines existing research relevant to a defined question. It may take the form of a systematic review, mapping study, scoping review, rapid review, or structured narrative synthesis.

The chosen form determines the strength and breadth of permissible claims. A search described as systematic or comprehensive requires a reproducible protocol, explicit selection criteria, documented screening, source appraisal, and a method for synthesis.

### Empirical study

An empirical study produces or analyzes data. Examples include experiments, surveys, interviews, observations, case studies, repository mining, log analysis, and mixed-methods research.

The study must define its population or objects of study, sampling strategy, measures or data-collection procedure, analysis method, ethical constraints, and threats to validity. Method-specific reporting standards should be used where applicable.

### Artifact or system evaluation

An artifact evaluation investigates a model, tool, workflow, benchmark, or technical system. It must specify the artifact and version, environment, tasks, comparison conditions, measures, procedure, and failure criteria.

An evaluation should test the claims made about the artifact. Demonstrating that a system can complete selected examples does not establish reliability, generality, usefulness, or superiority unless the design supports those claims.

### Case and incident analysis

Case studies and incident analyses examine a phenomenon in context. They are appropriate for understanding processes, decisions, mechanisms, constraints, and interactions that cannot be separated cleanly from their setting.

The research must explain case selection, data sources, boundaries, triangulation, researcher involvement, and limits on transfer to other contexts. A detailed anecdote is not automatically a case study.

### Conceptual analysis

Conceptual work clarifies definitions, distinguishes related ideas, develops taxonomies, maps arguments, or derives implications from established premises. It must state its premises, reasoning procedure, alternative formulations, and criteria for evaluating the result.

Conceptual coherence is not empirical validation. Any empirical claim used as a premise remains subject to the evidence standard.

### Exploratory inquiry

Exploratory work maps an unfamiliar topic, identifies vocabulary, discovers candidate sources, or develops hypotheses. It is useful during proposal development and when the available field is poorly defined.

Exploratory work must be labeled as such. It cannot support claims of completeness, prevalence, comparative performance, or consensus without a stronger design.

## Research lifecycle

Research proceeds through the following stages. Iteration between stages is expected, but material changes must be recorded.

```text
Question and proposal
        ↓
Protocol and feasibility review
        ↓
Evidence or data collection
        ↓
Appraisal and analysis
        ↓
Synthesis and findings
        ↓
Methodological and editorial review
        ↓
Publication and continuing review
```

## Stage 1: question and proposal

The proposal defines the investigation before substantial evidence collection begins. It records:

```text
Working title:
Primary research question:
Supporting questions:
Part and planned chapter:
Why the question matters:
Included scope:
Excluded scope:
Key terms:
Proposed research mode and method:
Expected evidence or data:
Known related chapters:
Known risks, biases, and ethical concerns:
Resources and access required:
Proposed outputs:
```

“Expected outputs” describes the form of the result, such as a synthesis, taxonomy, or evaluation. It must not predict the desired conclusion.

The proposal is checked against the chapter entry criteria in the [Book Architecture](09-book-structure.md). Approval allows research to begin; it does not endorse a conclusion.

## Stage 2: protocol and feasibility review

The protocol converts the proposal into a procedure detailed enough for another researcher to understand and critique before results are known.

Depending on the research mode, it should define:

- research questions and operational definitions;
- sources, databases, repositories, systems, or participants;
- search strategy or sampling strategy;
- inclusion and exclusion criteria;
- data fields, measures, instruments, or coding scheme;
- appraisal and risk-of-bias procedure;
- analysis and synthesis method;
- treatment of missing, contradictory, or unusable evidence;
- ethical, privacy, security, and licensing safeguards;
- expected limitations;
- storage and versioning of research materials; and
- conditions that require protocol amendment or study termination.

Pilot searches, trial coding, instrument testing, or small feasibility runs may be used to improve the protocol. Pilot results must not be treated as final evidence unless their inclusion was justified and recorded.

For consequential confirmatory work, the protocol should be time-stamped or preregistered before full collection or analysis. Exploratory changes remain permissible when identified as exploratory.

## Stage 3: evidence or data collection

Collection follows the protocol and produces an audit trail.

For literature-based work, preserve complete queries, search locations, dates, result counts, deduplication, screening decisions, and full-text exclusions. For empirical work, preserve the sampling and recruitment record, instruments, observation conditions, data provenance, and deviations from the planned procedure.

Researchers should search for evidence that could weaken or qualify the emerging explanation. Search should not stop merely because a convenient answer has been found.

Raw evidence should remain distinguishable from cleaned, transformed, coded, or summarized material. Transformations must be reproducible or documented in enough detail to inspect.

## Stage 4: appraisal and analysis

Appraisal asks whether an item of evidence can support the claim for which it may be used. Analysis examines what patterns, relationships, explanations, or distinctions the collected material supports.

Apply the source and body-of-evidence criteria in the evidence standard. Use method-specific criteria for studies whose designs differ; one generic quality score must not replace relevant methodological judgment.

During analysis, record:

- supporting patterns;
- contradictory and null results;
- alternative explanations;
- sensitivity to exclusions, coding, measures, or assumptions;
- differences among populations, settings, and methods;
- unexpected observations;
- remaining uncertainty; and
- questions generated by the analysis.

When researchers make interpretive judgments, they should record the reasoning and, where practical, compare independent assessments before resolving disagreement.

## Stage 5: synthesis and findings

Synthesis integrates evidence relevant to the same question without erasing differences in context or method. The synthesis method must be stated.

Each material finding should identify:

- the answer it provides to the research question;
- the scope in which it is expected to hold;
- the evidence that supports it;
- evidence that contradicts or qualifies it;
- its confidence rating;
- important limitations; and
- unresolved questions.

Findings must not extend beyond what the method and evidence support. Several dependent sources do not constitute independent confirmation, and the number of sources is not a substitute for appraisal.

Design implications appear only after findings. An implication must state the additional reasoning that connects the evidence to a possible evaluation or design response. Competing implications should remain visible.

## Stage 6: review

A complete draft receives separate reviews for different responsibilities:

### Methodological review

Checks whether the question, method, execution, analysis, and claims are aligned. It gives particular attention to deviations, bias, missing evidence, alternative explanations, confidence, and reproducibility.

### Domain review

Checks technical accuracy, terminology, relevant prior work, context, and whether important perspectives have been omitted or misrepresented.

### Editorial review

Checks structure, clarity, accessibility, internal consistency, citations, and compliance with the editorial style guide.

Review comments and their resolution are preserved. A reviewer should identify the rule, evidence, or reasoning behind a material objection. Author agreement is not required when a justified response or revision resolves the issue.

Review independence should be proportionate to consequence. A central finding that could shape product safety, security, privacy, or evaluation requires review by someone who did not produce the original analysis.

## Stage 7: publication and continuing review

A chapter may be published when required reviews are complete, material objections are resolved, evidence records are accessible, and the chapter satisfies its part's exit criterion where applicable.

Publication records the current best-supported account; it does not close the question permanently. A published chapter should be reconsidered when:

- important new evidence becomes available;
- a cited source is corrected, retracted, or becomes inaccessible;
- a relevant technology or practice changes materially;
- replication or evaluation conflicts with a finding;
- a methodological defect is discovered; or
- a dependent chapter exposes an inconsistency.

Material revisions return the chapter to Draft and trigger review of affected findings and downstream implications.

## Boundary between research and engineering application

Research is complete when it has produced a reviewed account of what the evidence supports, within which scope and confidence. It does not authorize implementation.

When a finding may affect Zelyq, the next step is a separate engineering application record under [Research-to-code governance](10-research-to-code-governance.md). That record adds project facts, constraints, alternatives, risk, responsibility, implementation boundaries, and evaluation criteria.

Researchers may identify design implications, but they should not select a Zelyq implementation inside the finding or weaken uncertainty to make an entry approvable. Engineering contributors may reject, defer, narrow, or require further research for an implication, but they must not rewrite the underlying finding to support a preferred decision.

Implementation outcomes return to the research layer only after they have been collected and assessed through an appropriate method. Existing code is evidence about what was implemented; it is not proof that the implementation was justified or successful.

## Protocol deviations

Deviations are sometimes necessary. Hiding them creates more risk than changing a plan transparently.

A deviation record states:

```text
Original procedure:
Change:
Reason:
Date and stage:
Information available when changed:
Likely effect on the findings:
Approval or review:
```

Changes made after inspecting results require particular scrutiny because they may introduce selective analysis or reporting.

## Research involving people

Research involving participants must satisfy applicable law, informed-consent requirements, privacy and data-protection obligations, and independent ethical-review requirements. The project must not collect participant data until required review and safeguards are in place.

The protocol should address recruitment, power relationships, withdrawal, compensation, recording, anonymization or pseudonymization, retention, access, and publication of quotations or identifiable information.

Publicly accessible developer activity may still involve people with reasonable privacy expectations. Legal accessibility does not, by itself, establish ethical acceptability.

## Research artifacts and reproducibility

Research materials should be preserved in the repository or a stable linked archive when licensing, consent, privacy, security, and practicality allow. Depending on the study, materials may include:

- protocols and amendments;
- search and screening records;
- data dictionaries and coding guides;
- analysis code and environment information;
- de-identified data or lawful substitutes;
- benchmark, model, dependency, and system versions;
- prompts and inference settings when material;
- reviewer assessments; and
- claim–evidence records.

When an artifact cannot be shared, explain the restriction and provide the safest useful description or controlled-access path. “Reproducible” should be used only when the necessary materials and conditions are available and the relevant result can be regenerated as claimed.

## Researcher position, incentives, and conflicts

Researchers should disclose relationships and assumptions that may influence the work, including employment, funding, product ownership, advocacy, access privileges, and prior involvement in the system studied.

Because the book originates within Zelyq, research with direct product implications carries an inherent risk of confirmation bias. Mitigations may include independent review, preregistered criteria, blinded assessment where practical, explicit competing hypotheses, and publication of unfavorable or inconclusive results.

Disclosure enables assessment; it does not automatically invalidate the work.

## Use of AI in research

AI systems may assist with search-term generation, source discovery, transcription, translation, extraction, coding, comparison, analysis, or drafting. Their role must be documented when it materially affects the research process.

AI output is not evidence: the underlying source or observation remains the evidence. AI systems may, however, perform disclosed source inspection, extraction, comparison, and review when their access path, model, method, limitations, and decisions are recorded. A disclosed AI-assisted review may satisfy a review gate when the governing protocol permits it. Project owners and maintainers remain accountable for correcting or reopening consequential decisions; no approval process may conceal an inaccessible source or convert an unverified extraction into verified evidence.

When AI assistance is used in an analysis that may vary by model or prompt, preserve the system, model and version, date, instructions, relevant settings, input boundaries, output handling, verification procedure, and accountable owner when licensing and privacy allow.

Confidential, personal, restricted, or proprietary material must not be submitted to an AI system without authorization and appropriate safeguards.

## Minimum reproducible record

Every published chapter must provide or link to enough material to establish:

1. what was asked;
2. what was included and excluded;
3. how evidence or data was obtained;
4. how it was assessed and analyzed;
5. what changed from the protocol;
6. how each material finding follows from the evidence;
7. what remains uncertain; and
8. who reviewed the work and when.

If a reader cannot reconstruct these decisions, the research record is incomplete.

## Methodological completion checklist

Before a chapter enters review, confirm that:

- the primary question is precise and unchanged or its revision is documented;
- the selected research mode and method fit the question;
- the protocol and amendments are available;
- collection and selection decisions are traceable;
- method-specific quality criteria were applied;
- evidence and transformed data remain distinguishable;
- contradictory and null evidence was considered;
- alternative explanations were analyzed;
- findings are bounded and assigned confidence;
- implications are separated from findings;
- ethical, privacy, security, licensing, and conflict requirements are satisfied;
- material AI assistance is documented and verified;
- limitations and open questions are explicit; and
- the research artifacts needed for review are accessible or restrictions are explained.

The process is complete when the research can be criticized on the basis of a visible record rather than accepted on the authority of its authors.

## Methodological foundations

This methodology uses the [ACM SIGSOFT Empirical Standards for Software Engineering Research](https://github.com/acmsigsoft/EmpiricalStandards) as a source of method-specific expectations for software-engineering studies. Its evidence synthesis and bias principles are also informed by the [Cochrane Handbook](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current) and its emphasis on explicit scope, search, selection, appraisal, synthesis, and certainty.

These sources inform the process; they do not impose one discipline's specialized procedures on every question in the book. Researchers should identify and follow the standards appropriate to the method they actually use.

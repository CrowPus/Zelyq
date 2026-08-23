# The Engineering Research Book

## Evidence Standard

Version: 1.0

Status: Active

---

## Purpose

This standard defines how evidence is selected, assessed, synthesized, cited, and corrected throughout The Engineering Research Book.

It exists to make the reasoning behind a claim inspectable. It does not turn judgment into a mechanical score, and it does not guarantee that a conclusion is true.

## Governing Principle

Evidence quality is relative to a claim.

A source is not strong merely because it is academic, quantitative, recent, popular, or published by a respected organization. Its value depends on whether its method and data can support the specific claim being made.

Source type and evidence quality must therefore be assessed separately.

## What Requires Support

A citation is required for:

- empirical claims;
- quantitative estimates;
- causal claims;
- historical claims that affect an argument;
- descriptions of another person's theory, system, or findings;
- claims about current AI capabilities, products, or industry practice;
- contested definitions; and
- conclusions that depend materially on external evidence.

A citation is normally unnecessary for:

- an explicitly labeled research question;
- a disclosed assumption;
- a transition or statement about the chapter's organization;
- a definition introduced solely for use within the book; or
- reasoning whose premises are already cited and whose derivation is stated.

Common knowledge should be cited when its accuracy, scope, or interpretation matters to the conclusion.

## Source Roles

Sources serve different roles. None is universally superior.

### Primary research

Reports original methods, observations, experiments, interviews, surveys, case studies, repository analyses, or other data. Use it to evaluate what was studied and found.

### Research synthesis

Systematic reviews, meta-analyses, mapping studies, and well-defined evidence reviews synthesize multiple studies. Use them for the state of a body of research, while assessing their search, selection, appraisal, and synthesis methods.

### First-party technical evidence

Specifications, source code, release notes, model cards, benchmark repositories, incident reports, and official documentation provide direct evidence about a system's stated design or observed artifact. They do not independently establish broad effectiveness or comparative superiority.

### Practitioner evidence

Engineering reports, postmortems, surveys, experience reports, and detailed technical essays can reveal real settings, mechanisms, and failure modes. Assess incentives, selection effects, missing data, and limits on generalization.

### Testimony and qualitative accounts

Interviews, observations, ethnographies, and community discussions can support claims about experience, meaning, behavior, and process. Frequency in a convenience sample does not establish prevalence in a wider population.

### Secondary explanation

Books, educational material, journalism, and explanatory articles can provide context and lead to stronger sources. Use them for substantive claims only when the underlying evidence is identifiable and the source's reporting is adequate.

### Anecdote and opinion

Anecdotes and opinions can generate questions, hypotheses, or counterexamples. They cannot establish prevalence, typicality, comparative performance, or causation on their own.

## Source Assessment

Assess each material source against the dimensions relevant to its method and use.

### Relevance

Does the source address the actual claim, population, setting, task, outcome, and period under discussion?

### Methodological fit

Can the chosen method answer the question the source claims to answer? Apply method-specific criteria where available rather than one checklist to every study.

### Risk of bias

Could study design, sampling, measurement, analysis, selective reporting, conflicts of interest, or missing evidence systematically distort the result?

Risk of bias is not the same as proof of bias. Record the concern and its likely direction or effect when possible.

### Directness

How many inferential steps separate the evidence from the claim? Evidence about code-generation tasks, for example, is indirect evidence for performance in long-running maintenance work.

### Precision

Does the evidence distinguish between materially different conclusions? For quantitative work, inspect uncertainty, sample size, measurement error, and plausible effect ranges. For qualitative work, inspect the depth, variation, and adequacy of the data.

### Transparency and reproducibility

Are the question, method, data provenance, analysis, limitations, and relevant artifacts available in enough detail to inspect or repeat the work?

Reproducibility strengthens confidence in execution. It does not by itself establish validity or generalizability.

### Independence

Are apparently separate sources based on distinct data and analysis? Repetition of the same press release, benchmark, dataset, or study does not constitute independent corroboration.

### Recency

Is the source current enough for the claim? Foundational concepts may remain useful for decades. Product behavior, model capability, pricing, and adoption data may become obsolete quickly. Record the observation date for changeable claims.

## Assessing a Body of Evidence

Confidence applies to a specific finding, not to an entire chapter or bibliography.

Assess the body of evidence across these dimensions:

- **Risk of bias** — whether important evidence has design or reporting weaknesses.
- **Consistency** — whether independent evidence converges and whether disagreement is explained.
- **Directness** — whether the studied settings and measures match the finding.
- **Precision** — whether uncertainty permits the stated conclusion.
- **Coverage** — whether relevant perspectives, settings, and contrary results are represented.
- **Publication and availability bias** — whether missing or inaccessible evidence could change the conclusion.

Do not count sources as votes. Several weak or dependent sources do not automatically outweigh one rigorous and directly relevant study.

## Confidence Ratings

### High

Multiple methodologically appropriate and substantially independent sources directly support the finding. Important limitations are unlikely to reverse it.

Language: “The evidence strongly supports…” or an equally bounded formulation.

### Moderate

The evidence supports the finding, but one or more limitations could materially change its scope, magnitude, or interpretation.

Language: “The available evidence supports…”

### Low

Some evidence supports the finding, but serious limitations, indirectness, inconsistency, or sparse coverage leave substantial uncertainty.

Language: “Limited evidence suggests…”

### Insufficient

The evidence cannot presently distinguish among important explanations or support a defensible answer.

Language: “The available evidence is insufficient to determine…”

Absence of evidence is not evidence of absence. A finding of no meaningful difference requires evidence precise enough to exclude differences that matter.

## Claim–Evidence Record

Every material finding should be recoverable from a compact record containing:

```text
Finding:
Scope:
Supporting evidence:
Contradictory or qualifying evidence:
Assessment notes:
Confidence:
Last reviewed:
```

The record may appear in the chapter, its research notes, or a linked evidence table. A reader must be able to move from the published finding to the sources and assessment that support it.

## Search and Selection Record

For planned literature searches, record:

- databases, repositories, and other locations searched;
- complete search terms or queries;
- search dates;
- inclusion and exclusion criteria;
- screening process;
- reasons for excluding sources at the full-text stage; and
- known search limitations.

Exploratory searches may begin informally, but claims presented as comprehensive or representative require a reproducible search and selection process.

## Synthesis Rules

When synthesizing evidence:

1. Group sources by the question and context they actually address.
2. Preserve differences in populations, tasks, systems, and outcome definitions.
3. Separate source results from the book's interpretation.
4. Report contradictory and null findings, not only supportive findings.
5. Explain whether disagreement reflects method, context, measurement, or genuine uncertainty.
6. State the limits of generalization.
7. Match the strength and breadth of the conclusion to the evidence.

Quantitative aggregation requires compatible measures and a stated method. Informal vote counting by the number of positive and negative studies is not acceptable.

## Citation and Quotation

Prefer the original source for a claim. If only a secondary source is available, say so and do not imply that the original was reviewed.

Citations should identify the precise source and, where practical, the page, section, version, commit, or archived state supporting the claim. Link to stable identifiers such as a DOI, standards page, or permanent repository record when available.

Quotations must preserve context and use the minimum text needed. Paraphrasing does not remove the requirement to cite.

Sources must never be fabricated, guessed, or cited without inspection.

## AI-Assisted Research

AI systems may help discover sources, organize notes, compare text, or identify possible counterarguments. They are not evidence and are not authors of the underlying claims.

Before publication, a researcher must:

- inspect every cited source;
- verify that it supports the associated claim;
- verify bibliographic details and links;
- check quoted text against the source;
- disclose material AI involvement in evidence extraction or analysis; and
- independently review conclusions produced with AI assistance.

AI-generated summaries cannot substitute for source review.

## Ethics, Privacy, and Conflicts

Research involving people must follow applicable law, consent requirements, privacy protections, and independent ethical review requirements. Public availability of personal data does not automatically make every use ethical.

Record funding, employment, product affiliation, advocacy positions, and other interests that a reasonable reader would consider relevant. A conflict does not automatically invalidate evidence; undisclosed conflicts prevent informed assessment.

Sensitive data and proprietary material must not be published merely to improve reproducibility. Explain necessary restrictions and provide the safest useful alternative.

## Review and Correction

Reviewers should test the most consequential and least certain findings first. They should inspect source fit, contrary evidence, confidence ratings, and the reasoning from evidence to conclusion.

When evidence changes:

1. correct the claim and confidence rating;
2. preserve a clear revision history;
3. explain material changes;
4. update dependent chapters and implications; and
5. retract a finding when its support is no longer adequate.

Intellectual honesty requires visible correction, not silent preservation of a preferred conclusion.

## Foundations of This Standard

This standard adapts general principles rather than copying a single hierarchy:

- The [ACM SIGSOFT Empirical Standards for Software Engineering Research](https://github.com/acmsigsoft/EmpiricalStandards) provide method-specific expectations for conducting and reporting software-engineering research.
- The [Cochrane guidance on certainty of evidence](https://training.cochrane.org/handbook/current/chapter-14) informs the separation of source assessment from claim-level confidence and the consideration of bias, inconsistency, indirectness, imprecision, and missing evidence.
- The [Cochrane guidance on risk of bias](https://training.cochrane.org/handbook/current/chapter-07) informs the treatment of bias as a documented risk rather than an unsupported accusation.
- The [EQUATOR Network](https://www.equator-network.org/) informs the emphasis on transparent, method-appropriate reporting.

These sources come from disciplines with different questions and methods. Their principles are adapted here; their specialized procedures are not claimed to apply universally.

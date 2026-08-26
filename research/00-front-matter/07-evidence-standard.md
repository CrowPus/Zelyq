# The Engineering Research Book

## Evidence standard

Version: 1.0

Status: Active — Version 1 reviewed

---

## Purpose

This standard defines how evidence is evaluated and how strongly it may support a claim in The Engineering Research Book.

It governs:

- the relationship between a claim and its evidence;
- appraisal of individual sources;
- assessment of a body of evidence;
- confidence ratings;
- synthesis of agreement and disagreement;
- citation and source-verification requirements; and
- the traceability required for material findings.

The [Research Methodology](06-research-methodology.md) governs how research is designed and conducted. This standard begins when a source, observation, dataset, or result is considered as support for a claim.

## Governing principle

Evidence quality is relative to a claim.

A source is not strong merely because it is academic, peer reviewed, quantitative, recent, popular, or published by a respected organization. Its value depends on whether its data, method, context, and limitations can support the specific claim being made.

Source type and evidentiary strength must therefore be assessed separately. A technical specification may be the strongest source for what a protocol requires but weak evidence for how reliably implementations behave in practice. An interview study may provide strong evidence about how participants experienced a workflow but cannot, by itself, establish how common that experience is across the profession.

## Claims that require support

A citation or primary research record is required for:

- empirical observations and quantitative estimates;
- causal or comparative claims;
- claims about prevalence, frequency, performance, or effectiveness;
- historical claims that affect an argument;
- descriptions of another author's theory, method, system, or findings;
- claims about current products, models, standards, or industry practices;
- contested definitions; and
- conclusions that depend materially on external information.

A citation is normally unnecessary for:

- a clearly labeled research question;
- a disclosed assumption or hypothesis;
- a definition introduced only for use within the book;
- a statement describing the organization of a chapter; or
- reasoning whose cited premises and inferential steps are already visible.

Common knowledge should be cited when its accuracy, scope, or interpretation affects a finding.

## Units of assessment

Evidence is assessed at three levels.

### Source or observation

An individual paper, dataset, interview, experiment, specification, incident report, repository, or other item of evidence is evaluated for the particular result being used.

### Body of evidence

All relevant evidence used to answer the same question is evaluated together. Confidence depends on the body, not on the reputation or quantity of isolated sources.

### Finding

A finding is the book's bounded answer to a research question. It records the relevant body of evidence, contrary or qualifying evidence, limitations, and confidence.

Confidence applies to a finding, not to an entire chapter, author, journal, or field.

## Source roles

Sources serve different evidentiary roles. No role is universally superior.

### Primary empirical research

Primary research reports original data and methods, such as experiments, surveys, interviews, observations, case studies, repository analyses, or performance measurements. It allows direct inspection of how a result was produced.

Its strength depends on the appropriateness and execution of the method, not merely on the presence of data.

### Research synthesis

Systematic reviews, meta-analyses, mapping studies, and other structured reviews combine multiple studies. They may provide broader support than an individual study when their search, selection, appraisal, and synthesis procedures are adequate.

A review inherits limitations from both its own method and the studies it includes.

### First-party technical evidence

Specifications, source code, model cards, system documentation, release notes, benchmark repositories, and official incident reports provide direct evidence about an artifact's stated design, implementation, version, or reported behavior.

First-party evidence does not independently establish comparative superiority, general effectiveness, or how a system behaves outside the conditions reported by its publisher.

### Independent technical evaluation

Replication studies, third-party benchmarks, audits, red-team reports, and independent artifact evaluations can test claims about a system. Their value depends on access, version matching, task validity, comparison fairness, measurement, and reproducibility.

Independence reduces some conflicts of interest but does not correct a weak design.

### Practitioner and organizational evidence

Engineering reports, postmortems, technical proposals, company surveys, and experience reports can reveal real constraints, mechanisms, workflows, and failure modes.

They require attention to selective publication, commercial incentives, missing context, unreported failures, and limits on transfer to other organizations.

### Qualitative accounts and testimony

Interviews, ethnographies, observations, focus groups, diaries, and community discussions can provide evidence about experience, meaning, reasoning, and process.

They should be assessed using qualitative criteria appropriate to their design. Repetition within a convenience sample does not establish population prevalence.

### Secondary explanation

Books, journalism, educational resources, and explanatory articles can provide context and lead to primary material. They may support a claim when their sourcing and reporting are adequate, but the original source is preferred when the exact result matters.

### Anecdote and opinion

Anecdotes and opinions can expose a possibility, generate a hypothesis, or provide a counterexample to a universal claim. They cannot establish typicality, prevalence, causation, reliability, or comparative performance on their own.

## Appraising an individual source

Assess the dimensions relevant to the source's method and intended use. Record material concerns rather than collapsing them immediately into a numerical score.

### Relevance

Does the source address the claim's population, system, setting, task, outcome, and period? Similar terminology may conceal a different question.

### Methodological fit

Can the chosen method answer the question the source claims to answer? Use method-specific standards where available. Criteria appropriate to an experiment may be inappropriate for an ethnography or conceptual analysis.

### Execution and reporting

Was the method applied competently, and is it reported in enough detail to assess? Missing information creates uncertainty; it should not be silently interpreted in the source's favor or against it.

### Risk of bias

Could sampling, measurement, intervention, analysis, selective reporting, missing data, conflicts of interest, or other systematic influences distort the result?

Risk of bias is not an accusation of misconduct and is not the same as proof that a result is wrong. The assessment should identify the concern, its basis, and its possible effect.

### Directness

How closely does the evidence match the claim? Evidence from isolated code-generation tasks is indirect evidence for performance during long-running maintenance work. Evidence from students may not transfer directly to experienced professionals.

### Precision or adequacy

Does the evidence distinguish among conclusions that would matter?

For quantitative work, consider uncertainty intervals, sample size, measurement error, event frequency, and plausible effect ranges. For qualitative work, consider the richness, variation, saturation or information power, and adequacy of the data for the interpretation.

### Transparency and reproducibility

Are the question, procedure, data provenance, analysis, limitations, and relevant artifacts available in enough detail to inspect or repeat the work?

Reproducibility can strengthen confidence in execution. It does not, by itself, establish construct validity, external validity, importance, or freedom from bias.

### Independence and conflicts

Is the source independent of other evidence and of the claim's beneficiary? Funding, authorship, employment, dataset reuse, benchmark reuse, and shared analytical pipelines may create dependencies that are not obvious from citation count.

A conflict does not automatically invalidate a result. It affects the scrutiny and corroboration required.

### Recency and version fit

Is the evidence current enough for the claim, and does it concern the relevant version? Foundational concepts may remain useful for decades, while model behavior, product functionality, prices, policies, and adoption data can change quickly.

For changeable claims, record the source date, observation date, and system or model version when available.

## Assessing a body of evidence

After individual appraisal, evaluate the complete body relevant to each finding.

### Risk of bias across the evidence

Determine whether the result depends heavily on sources with similar weaknesses, incentives, or missing information.

### Consistency

Assess whether substantially independent evidence converges. When results differ, investigate whether the difference may arise from population, setting, task, version, measure, method, or genuine uncertainty.

Consistency does not mean unanimous wording or identical effect sizes.

### Directness

Determine whether the collected evidence answers the actual research question or requires extrapolation. Important inferential steps lower confidence unless supported separately.

### Precision and stability

Determine whether the evidence is sufficiently precise and robust to reasonable analytical choices. A conclusion is unstable when small changes in inclusion, coding, measurement, or assumptions materially alter it.

### Coverage

Assess whether important settings, populations, methods, outcomes, and perspectives are represented. Coverage should match the breadth of the finding.

### Missing evidence

Consider whether unavailable data, unpublished failures, selective reporting, inaccessible internal studies, or publication incentives could change the conclusion.

### Triangulation

Different methods may strengthen a finding when they examine complementary aspects of the same phenomenon and their limitations are not shared. Triangulation is reasoned comparison, not the mere presence of qualitative and quantitative sources.

## Confidence ratings

Every material finding receives one of four confidence ratings with a written justification.

### High

Multiple appropriate and substantially independent sources directly support the finding. Important limitations are unlikely to reverse it within the stated scope.

Suitable language includes: “The evidence strongly supports…”

### Moderate

The evidence supports the finding, but one or more limitations could materially change its scope, magnitude, or interpretation.

Suitable language includes: “The available evidence supports…”

### Low

Some evidence supports the finding, but serious limitations, indirectness, inconsistency, imprecision, or sparse coverage leave substantial uncertainty.

Suitable language includes: “Limited evidence suggests…”

### Insufficient

The available evidence cannot support a defensible answer or distinguish among important alternatives.

Suitable language includes: “The available evidence is insufficient to determine…”

Confidence is not a measure of importance, desirability, or effect size. A critical risk may have low-confidence evidence and still justify precaution. A high-confidence effect may be too small to matter in practice.

## Assigning confidence

Begin with the actual body of evidence; do not assign a default rating based only on study design. Determine which limitations matter to the finding and whether they lower confidence.

Confidence may increase when:

- independent methods and sources converge;
- effects or mechanisms persist across relevant contexts;
- credible attempts to disconfirm the finding fail;
- results are replicated with appropriate materials; or
- a clear and well-supported mechanism explains an otherwise consistent pattern.

Confidence may decrease because of:

- serious or shared risk of bias;
- unexplained inconsistency;
- indirect populations, tasks, systems, or outcomes;
- insufficient precision or qualitative adequacy;
- narrow coverage relative to the claim;
- dependence on one dataset, benchmark, organization, or research group;
- selective publication or missing evidence;
- version mismatch or rapid obsolescence; or
- conclusions that are sensitive to reasonable analytical alternatives.

Every rating must explain the most important reasons. A label without justification is not an assessment.

## Special evidentiary cautions

### Causal claims

A causal claim requires a design and analysis capable of addressing plausible alternative causes. Temporal sequence, correlation, participant belief, or a persuasive mechanism alone is insufficient.

### Prevalence and frequency

Claims about how common something is require a defined population, a defensible sampling frame or strategy, valid measurement, and appropriate uncertainty. Counts from selected repositories, surveys, or public discussions should not be generalized beyond their sampling process.

### Benchmarks

Benchmark results support claims only about the tasks, data, scoring, conditions, and system versions evaluated. Inspect contamination, task validity, baseline selection, variance, failure handling, and whether the benchmark represents the engineering activity named in the conclusion.

### Self-reported evidence

Self-reports provide evidence about what participants report, perceive, remember, or believe. Claims about observed behavior or measured outcomes require additional evidence unless the research question specifically concerns self-report.

### Absence and equivalence

Failure to detect an effect is not evidence that no meaningful effect exists. Evidence of absence or equivalence requires sufficient precision and a defined threshold for what would count as a meaningful difference.

### Current and comparative claims

Claims such as “currently,” “leading,” “best,” “more capable,” or “state of the art” require an observation date, explicit comparison set, relevant measure, and reproducible procedure. They expire when the compared systems or conditions change materially.

### Universal claims

One credible counterexample can refute a genuinely universal claim. Supporting a universal claim requires evidence across its stated domain or a valid deductive argument; repeated examples are not enough.

## Synthesis rules

When combining evidence:

1. Group sources by the question and context they actually address.
2. Preserve differences in populations, tasks, systems, versions, and outcome definitions.
3. Separate source results from the book's interpretation.
4. Include contradictory, qualifying, and null evidence.
5. Explain whether disagreement reflects context, method, measurement, bias, or unresolved uncertainty.
6. Do not count sources as votes.
7. Do not combine quantitative estimates unless their measures and designs permit it and the aggregation method is stated.
8. State the boundary beyond which the finding should not be generalized.
9. Match the strength and breadth of the conclusion to the evidence.

Several weak, dependent, or indirect sources do not automatically outweigh one rigorous and directly relevant source. Conversely, one strong study does not automatically establish a broad claim across other contexts.

## Claim–evidence record

Every material finding must provide or link to a record containing:

```text
Finding:
Scope:
Supporting evidence:
Contradictory or qualifying evidence:
Source-appraisal summary:
Body-of-evidence assessment:
Confidence and justification:
Important limitations:
Last reviewed:
```

The record may be presented as a table, structured notes, or a section of the chapter. A reader must be able to move from the published finding to the specific evidence and reasoning that support it.

## Citation requirements

Prefer the original source for a claim. If only a secondary account was inspected, cite it as a secondary source and do not imply that the original was reviewed.

Citations must:

- appear close enough to identify the claim they support;
- identify a stable and accessible source where possible;
- include a page, section, figure, table, version, commit, or archived state when needed to locate the evidence;
- distinguish multiple versions of changing documents or systems;
- preserve the context of quoted or paraphrased material; and
- disclose when a source could not be fully inspected.

A citation does not transfer the source's authority to a broader claim. Authors and reviewers must inspect the underlying material rather than rely on titles, abstracts, search snippets, citation counts, or AI-generated summaries.

Sources, quotations, bibliographic details, links, data, and calculations must not be fabricated, guessed, or left unverified.

## Evidence in engineering application entries

Engineering application entries use two related evidence classes:

1. **Research evidence** supports general or bounded findings about software engineering, AI, trust, risks, or interventions.
2. **Project evidence** establishes current facts about Zelyq, such as observed behavior, affected users, architecture, incidents, measurements, constraints, and obligations.

Project evidence does not replace research evidence when the entry makes a broader causal, effectiveness, or trustworthiness claim. Research evidence does not replace verification of Zelyq's actual context.

Before an entry may pass research sufficiency review, confirm that:

- the problem is supported by inspected evidence rather than assumed from a requested solution;
- cited findings are Published or otherwise accepted for the stated use;
- finding scope and confidence match the proposed application;
- changeable findings and project facts are current enough;
- contradictory and limiting evidence is represented;
- material gaps are classified as assumptions, unknowns, or research requirements;
- the proposed benefit does not exceed what the evidence can support; and
- implementation is not used as retrospective justification for the decision that authorized it.

An entry should use `Research required` when missing evidence could materially change whether the response should exist, which option should be selected, or which risks and boundaries are necessary.

## Corrections and source changes

When a source is corrected, retracted, materially revised, or no longer supports the use made of it:

1. reassess the affected source;
2. revise the body-of-evidence assessment and confidence;
3. correct or withdraw the finding when necessary;
4. record the reason for the change; and
5. review dependent implications, chapters, and decisions.

Replacing a broken link is editorial. Replacing evidence in a way that changes a finding is a substantive revision and requires review.

## Evidence review checklist

Before a finding is accepted, confirm that:

- the claim is precise and bounded;
- each cited source was inspected;
- each source supports the exact use made of it;
- method-specific strengths and limitations were considered;
- dependence, conflicts, version fit, and recency were assessed;
- contradictory, qualifying, null, and missing evidence were considered;
- the synthesis preserves relevant differences among sources;
- alternatives and inferential steps are visible;
- the confidence rating is justified at the finding level;
- uncertainty language matches the rating;
- citations allow a reader to locate the supporting material; and
- downstream implications do not claim more than the finding supports.

## Foundations of this standard

This standard adapts principles from established guidance rather than adopting a universal hierarchy of source types:

- The [ACM SIGSOFT Empirical Standards for Software Engineering Research](https://github.com/acmsigsoft/EmpiricalStandards) provide method-specific expectations for conducting and reporting software-engineering research.
- The [Cochrane guidance on certainty of evidence](https://training.cochrane.org/handbook/current/chapter-14) informs the separation of individual-source appraisal from finding-level confidence and the consideration of bias, inconsistency, indirectness, imprecision, and missing evidence.
- The [Cochrane guidance on risk of bias](https://training.cochrane.org/handbook/current/chapter-07) informs the treatment of bias as a documented risk rather than an unsupported accusation.
- The [EQUATOR Network](https://www.equator-network.org/) informs the emphasis on transparent, method-appropriate reporting.

These sources address disciplines with different questions and methods. Their general principles are adapted here; their specialized procedures apply only when they fit the research design being used.

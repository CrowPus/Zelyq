# The Engineering Research Book

## ERB-01-01 claim–evidence records

Record version: 0.4

Status: Gate B ratified — findings approved with recorded limits

Last updated: 2026-08-25

---

## Reading rule

These records expose the reasoning between extracted evidence and the findings ratified at Gate B. The sensitivity and disconfirmation checks are recorded in the [analysis notes](analysis-notes.md). Each finding is approved only within its recorded scope, qualifications, confidence, and prohibited extensions. Approval does not authorize publication beyond the chapter's current status, a Zelyq engineering application, or code.

## CER-01 — Framework-level scope

Finding: Major professional and educational frameworks included in this review place software construction within a broader set of lifecycle, quality, coordination, economic, and professional responsibilities.

Scope: claims about S001 and S003 as frameworks, not about every practitioner or organization.

Supporting evidence: S001 separates construction from requirements, architecture, design, testing, operations, maintenance, management, process, quality, security, professional practice, and economics. S003 similarly treats implementation as necessary but not sufficient for its software-engineering educational outcomes.

Qualifying evidence: both sources are normative; neither measures performed work or outcomes. S001's quoted SEVOCAB definition is second-hand because S002 was not inspected. Professionalization purposes may influence their scope.

Body-of-evidence assessment: direct and mutually consistent for framework content; indirect for practice and outcomes.

Sensitivity result: when S001 and S003 are removed, several domains remain visible in empirical studies, but governance, professional, economic, security, privacy, and societal scope is no longer empirically established. The claim therefore remains strictly about framework content.

Prohibited extension: “all software engineers do these things” or “programmers do not do these things.”

Confidence and justification: **High** for what the two included frameworks prescribe. Both sources directly and consistently document their scope, and the sensitivity result does not threaten that bounded descriptive claim. This rating does not transfer to actual practice or outcomes.

Important limitations: two normative frameworks do not represent every professional community, organization, or practitioner; S001's SEVOCAB definition is second-hand.

Last reviewed: 2026-08-25.

## CER-02 — Observed breadth of development work

Finding: In the settings studied by S006–S009, producing and changing software involved coding alongside planning, review, testing, communication, information seeking, coordination, documentation, and maintenance of system knowledge.

Scope: the sampled organizations, participants, and reported or observed activity; not universal time allocations.

Supporting evidence: S006 directly monitored multi-company developer activity; S007 collected a large single-organization workday survey; S008 directly observed collaboration and information seeking; S009 combined surveys and interviews about understanding and modifying code.

Qualifying evidence: methods and settings differ; samples are context-bound; S006 and S007 share a first author and related activity framing; some evidence is self-reported; none compares programmer- and engineer-titled populations; none establishes objective project outcomes from activity breadth.

Body-of-evidence assessment: convergent descriptive evidence across several methods, with limited occupational and outcome directness.

Sensitivity result: the claim survives removal of reported time percentages and remains supported by direct observation in S006 and S008 together with bounded survey/interview corroboration in S007 and S009. The precise activity mix does not survive as a general estimate.

Prohibited extension: universal percentages, a claim that non-coding time is necessarily productive, or a title-based distinction.

Confidence and justification: **Moderate**. Different methods and settings converge on activity breadth, but context-bound samples, self-report, measurement limits, and partial author or taxonomy dependence could materially change the composition and interpretation.

Important limitations: no title-group comparison and no demonstrated objective outcome from breadth of activity.

Last reviewed: 2026-08-25.

## CER-03 — Nature of the boundary

Finding: On the present evidence, a contextual and responsibility-based account is more defensible than a universal distinction between people called programmers and people called software engineers.

Scope: interpretation of this evidence base, not a final definition of either occupation.

Supporting evidence: S001 and S003 provide broader responsibility scopes; S003 cautions against title inference; S004 and S005 show that historical purposes and boundary accounts were contested; S006–S009 show overlapping activity without occupational comparison.

Contradictory or qualifying evidence: no included source operationally defines programming, so the comparison is asymmetric. S005 includes a multi-person/multi-version proposal but does not establish it as universal. The Parnas critique reproduced in S005 challenges the status implications of the engineering label.

Body-of-evidence assessment: a triangulated interpretation with a central construct-validity gap on the programming side.

Sensitivity result: removing occupational titles leaves the responsibility-breadth account intact but eliminates any person-level comparison. Several alternative taxonomies fit the evidence, and broadening the interpretation of programming makes an exclusive boundary less defensible. The result therefore concerns the form of account this review can support, not a discovered universal boundary.

Prohibited extension: a universal boundary, an occupational hierarchy, or an assertion that programming means code entry only.

Confidence and justification: **Low**. The interpretation accommodates the observed overlap, framework scope, and historical controversy, but no source defines programming operationally or directly compares the two populations. Important alternatives remain distinguishable only conceptually.

Important limitations: asymmetric constructs, missing occupational comparison, and no validated boundary threshold.

Last reviewed: 2026-08-25.

## CER-04 — Knowledge and coordination responsibility

Finding: In the multi-person settings studied, participants changing software sought or reported needing coordination, rationale, dependency, and system knowledge beyond the source code they were modifying.

Scope: studied collaborative settings and the historical problem framing.

Supporting evidence: S008 observes continuous collaboration and information seeking; S009 reports difficulties involving rationale, dependencies, and organizational knowledge; S004 identifies communication and documentation problems in large-system development; S006 and S007 corroborate the presence of coordination and documentation activity.

Qualifying evidence: observed or reported need does not establish the best mechanism, the size of an outcome effect, or a universal documentation prescription. Collaboration can interrupt as well as support work.

Body-of-evidence assessment: descriptive convergence across historical, observational, and self-reported sources; weak causal outcome evidence.

Sensitivity result: information and coordination needs remain supported when proposed remedies are removed. Level separation shows that access to knowledge can be an individual need while preservation and communication are distributed team or organizational responsibilities.

Prohibited extension: mandatory documentation volume, a universal collaboration process, or a quantified productivity benefit.

Confidence and justification: **Moderate**. Observational and survey/interview sources converge on the bounded knowledge need, but settings are limited and the evidence does not establish a universal remedy or quantified outcome benefit.

Important limitations: “beyond source code” concerns information participants reported or sought; it does not prove that every change requires a separate document or meeting.

Last reviewed: 2026-08-25.

## CER-05 — Requirements responsibility and outcomes

Finding: In the S012 survey, participants repeatedly connected requirements clarification, stakeholder communication, and change-management problems with downstream project and product consequences; the included evidence does not establish that these problems caused those outcomes.

Scope: S012's surveyed organizations and the normative/historical identification of requirements responsibility.

Supporting evidence: S012 reports incomplete or hidden requirements, communication flaws, and moving targets as recurring practitioner-perceived problems connected to rework, schedule, implementation, product, and failure consequences. S001, S003, and S004 locate requirements and stakeholder work within broader lifecycle responsibility.

Qualifying evidence: S012 is perception- and recall-based, cannot yield universal failure rates, and does not identify one universally effective requirements process. S013 was unavailable in full and is not evidence; therefore this outcome strand lacks the corroborating case-study source planned by the protocol.

Body-of-evidence assessment: adequate for recurring perceptions and candidate mechanisms; thin and indirect for actual outcome effects.

Sensitivity result: after normative support is removed, the evidence supports only what participants selected and reported. “Plausible mechanism” remains an interpretation and cannot be promoted to a demonstrated effect.

Prohibited extension: requirements problems caused the reported failures, or one prescribed process would prevent them.

Confidence and justification: **Low**. S012 directly supports the bounded report-of-perceptions claim, but the outcome interpretation rests on one survey family with selection, recall, framing, and causal-directness limitations; S013 remains unavailable.

Important limitations: no population prevalence, objective failure verification, causal magnitude, or supported universal requirements process.

Last reviewed: 2026-08-25.

## CER-06 — Review responsibility and outcomes

Finding: In S010 and S011, relationships between measured review activity and post-release defects were not stable enough to support a general causal claim; the results make execution, expertise, measurement, and context necessary qualifications.

Scope: the projects, releases, measures, and defect models examined by S010 and S011.

Supporting evidence: S010 reports associations for selected review measures and releases. S011's reproduction and external replication find instability across releases and modeling choices and find non-review models performing as well as or better than review-inclusive models.

Contradictory or qualifying evidence: S010 supplies positive associations for some measures; repository measures may not capture the substance or other benefits of human review; both studies remain observational, and S011 overlaps S010's Qt data.

Body-of-evidence assessment: directly relevant paired evidence with an explicit replication qualification; insufficient for a general causal effect and insufficient for a “review has no value” conclusion.

Sensitivity result: when hypothesized non-defect benefits are removed, the paired defect analyses still support the instability conclusion. They do not determine review's value for knowledge sharing, problem solving, or outcomes their repository measures did not capture.

Prohibited extension: review necessarily reduces defects, review has no value, or review distinguishes occupational titles.

Confidence and justification: **Moderate** for the bounded instability finding. S011 directly reproduces and tests the earlier result across additional releases and modeling choices. Confidence is limited by observational designs, overlapping Qt data, measurement validity, selected projects, and the difference between unstable evidence and evidence of no effect.

Important limitations: not a causal estimate and not evidence that review has no value.

Last reviewed: 2026-08-25.

## CER-07 — Testing responsibility and outcomes

Finding: S014 and S015 do not support treating either the presence of tests or the use of one testing method as sufficient evidence of delivered quality; their results vary by construct, context, effort, outcome, and analysis.

Scope: TDD studies synthesized by S014 and the Apache test-factor analysis in S015.

Supporting evidence: S014 reports a small average external-quality benefit for TDD, little overall productivity effect, and setting-dependent variation. S015 reports limited relationships between nominal test-related factors and post-release defects after controlling for production size.

Qualifying evidence: TDD does not represent every testing method; S015's measures do not capture all test effectiveness; the studies address different interventions and outcomes; confounding and heterogeneity remain.

Body-of-evidence assessment: complementary rather than directly replicating evidence; useful for rejecting nominal-compliance inference, limited for a general effect of testing.

Sensitivity result: the claim survives only as a caution against sufficiency. S014 supports a bounded average result about TDD, while S015 qualifies nominal test measures in selected Apache projects. Neither is generalized to all testing.

Prohibited extension: TDD always improves quality, testing has no value, coverage never matters, or test existence guarantees quality.

Confidence and justification: **Low**. The two sources support the caution through complementary evidence, but they operationalize different practices and outcomes and are not replications. Heterogeneity, observational confounding, and construct limits prevent a broad testing-effect conclusion.

Important limitations: no conclusion that testing lacks value, that coverage never matters, or that TDD has the same effect in every setting.

Last reviewed: 2026-08-25.

## CER-08 — General outcome claim

Finding: The current evidence is insufficient to determine whether broader software-engineering responsibility, considered as a whole, produces better outcomes than programming.

Scope: the complete included body of evidence and the exact comparative outcome wording of the primary question.

Supporting evidence: outcome studies isolate requirements perceptions, review measures, TDD, or test factors rather than the complete responsibility taxonomy. Activity studies do not measure objective software outcomes. Normative and historical sources cannot supply effect estimates. No study directly compares the two occupational or activity constructs.

Qualifying evidence: selected responsibility mechanisms may still affect selected outcomes; insufficiency for the general comparison does not imply equivalence or absence of effect.

Body-of-evidence assessment: a direct evidence-gap judgment produced by mapping the research question to the available study designs.

Sensitivity result: no included source jointly operationalizes responsibility breadth, programming, a comparison, and an objective outcome. Narrower statements about reported requirements consequences, review-result instability, and testing qualifications remain possible, but none answers the general comparison.

Prohibited extension: broader responsibility has no effect, programming and engineering are identical, or empirical research cannot answer the question.

Confidence and justification: **Insufficient**. The available evidence cannot distinguish a general benefit, no meaningful difference, or context-dependent effects for the complete comparison. This is not evidence of equivalence or absence of effect.

Important limitations: the conclusion describes the present evidence base, not what future empirical research could establish.

Last reviewed: 2026-08-25.

## Cross-record dependency and independence check

- S010 and S011 must remain paired; S011 partly reuses S010's Qt evidence.
- S014 and S015 must remain paired as complementary qualifications, not as direct replications.
- S006 and S007 share a first author and related taxonomy lineage; they are not wholly independent corroborations.
- S012 belongs to the NaPiRE research family; no second included requirements-outcome source currently balances it.
- S001 and S003 are distinct frameworks with overlapping professional communities and normative purposes.

## Gate B acceptance record

Dee Empire ratified CER-01 through CER-08 on 2026-08-25 after methodological, evidence, software-engineering domain, and editorial review. The decisions and reviewer declaration are recorded in the [review record](review-record.md). Contradictions, dependencies, limitations, confidence judgments, and prohibited extensions remain binding.

No Zelyq engineering implication or code change was authorized.

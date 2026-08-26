# The Engineering Research Book

## ERB-01-01 analysis notes

Record version: 0.3

Status: Gate B ratified — analysis supporting approved findings

Last updated: 2026-08-25

---

## Purpose and authority

This record documents the first formal synthesis pass for ERB-01-01. It is an auditable working record, not a publishable chapter and not approval for an engineering decision or code change.

Gate A authorizes this analysis under the constraints in the [review record](review-record.md). Candidate interpretations below may be revised or rejected during sensitivity checks and Gate B review.

## Analytical unit

The primary unit is a **responsibility exercised in context**, not a job title. A responsibility includes an activity together with its object, constraints, decision or accountability component, and place in the software lifecycle.

This choice is necessary because:

- S003 warns that the title “software engineer” is not used consistently;
- S006–S009 study developers without providing a defensible engineer-versus-programmer title comparison;
- S004 and S005 present historically contested boundary accounts; and
- no included source operationally defines “programming.”

Consequently, this review can compare construction with broader responsibility domains. It cannot infer what all programmers do, what all software engineers do, or where a universal occupational boundary lies.

## Evidence strata

Evidence is kept in four non-interchangeable strata:

| Stratum | Sources | What it can establish | What it cannot establish |
| --- | --- | --- | --- |
| Normative and educational scope | S001, S003 | Responsibilities major professional frameworks assign to software engineering | Actual prevalence, title differences, or outcome effects |
| Historical and conceptual framing | S004, S005 | Origin, intended problems, controversy, and alternative boundary accounts | Current consensus, prevalence, or causal effects |
| Observed and reported work | S006, S007, S008, S009 | Activities and information dependencies in the studied settings | Universal work allocation, title boundaries, or objective product outcomes |
| Outcome-oriented evidence | S010, S011, S012, S014, S015 | Bounded associations, perceived consequences, meta-analytic effects, and qualifications for selected practices | A general causal effect of “software engineering” or proof that nominal practice compliance produces quality |

The SEVOCAB definition quoted in S001 remains second-hand because S002 was not inspected in full. S013 remains outside the evidence base, leaving requirements-outcome evidence thinner than the paired review and testing evidence.

## Stage 1 — Definition map

### Professional and educational definitions

S001 and S003 place construction or implementation within a wider scope that includes requirements, design, verification, operation, maintenance, management, quality, economics, professional practice, and stakeholder or societal concerns. This is strong evidence about the scope of those frameworks, not evidence that every practitioner performs the entire scope.

### Historical definitions

S004 records “software engineering” as a deliberately provocative framing for disciplined design, production, delivery, and service of large software systems. It preserves disagreement and does not establish consensus. S005 describes the term as an aspiration and presents contextual and contested boundary accounts, including the attributed Parnas critique of the professional implications of the title.

### Empirical operationalization

The empirical studies operationalize particular activities or practices—coding, collaboration, information seeking, review, requirements work, or testing—not the complete concepts “software engineering” and “programming.” None directly compares populations selected by those two labels using a common responsibility measure.

### Definition-map result

The available evidence supports a **framework-level scope distinction** between software construction and lifecycle engineering responsibility. It does not support a universal **person-level or title-level distinction** between programmers and software engineers.

This is a candidate synthesis, not yet a finding.

## Stage 2 — Provisional responsibility taxonomy

The taxonomy groups responsibilities that recur across the included sources. Inclusion means that a domain is supported for analysis; it does not mean that only software engineers perform it or that every project requires it at the same intensity.

| Domain | Responsibility being analyzed | Principal support | Evidence character | Boundary caution |
| --- | --- | --- | --- | --- |
| Problem framing and requirements | identify needs, expose hidden assumptions, negotiate with stakeholders, manage change | S001, S003, S004, S012 | normative, historical, self-reported consequences | S012 is perception-based; S013 is unavailable |
| Design and tradeoff judgment | choose structures and approaches under technical, quality, schedule, cost, and contextual constraints | S001, S003, S004, S005 | normative and conceptual/historical | no included comparative outcome study isolates this responsibility |
| Construction and implementation | transform designs or requirements into executable software and associated artifacts | S001, S003, S006, S007, S008 | normative plus observed/reported activity | “programming” is not operationally defined; construction must not be reduced to typing code |
| Verification and quality | design and evaluate testing and review; judge whether evidence is adequate for the relevant risks | S001, S003, S010, S011, S014, S015 | normative, observational, replication, meta-analysis | review associations are unstable; TDD is not all testing; nominal tests are not effectiveness |
| Coordination and communication | manage dependencies, decisions, handoffs, meetings, review participation, and stakeholder communication | S003, S004, S006, S007, S008, S009, S012 | normative, historical, observed, self-reported | time spent collaborating is not itself an outcome measure |
| Documentation and knowledge continuity | preserve rationale, system knowledge, decisions, and information required for comprehension and change | S001, S003, S004, S006, S007, S009 | normative, historical, observed/reported | documentation form and benefit are context-dependent |
| Delivery, operation, and evolution | release, configure, operate, maintain, update, and adapt software across versions and environments | S001, S004, S005, S008 | normative, historical, observed | contemporary empirical outcome coverage is limited |
| Governance and consequence | account for process, economics, professional duties, risk, security, privacy, users, and societal effects | S001, S003, S005 | predominantly normative/conceptual | this evidence does not show consistent workplace authority or execution |

### Taxonomy interpretation

Construction is retained as a real and necessary responsibility domain. The proposed distinction is therefore not “engineering instead of programming.” It is whether responsibility extends from producing code to reasoning about and remaining accountable for the conditions under which software is specified, designed, verified, delivered, changed, and evaluated.

The evidence does not yet justify calling that distinction exclusive. A person described as a programmer may exercise several or all of these responsibilities, while a person titled software engineer may not. Scale, number of participants and versions, system consequence, organization, lifecycle stage, and source purpose are plausible boundary modifiers.

## Stage 3 — Boundary analysis

### Distinctions that presently appear stable at framework level

- Construction is one part of the scope assigned to software engineering by S001 and S003.
- Lifecycle, coordination, quality, economic, and professional concerns appear in both modern frameworks and the historical problem framing.
- Actual development work in S006–S009 includes substantial non-construction activity and information dependencies.

These are convergent but differently constituted observations. Normative agreement and observed activity must not be counted as interchangeable votes.

### Distinctions that appear contextual or continuous

- responsibility breadth varies across individuals, teams, organizations, project stages, and system contexts;
- collaboration can support team progress or interrupt individual work depending on its purpose and timing;
- the substance, expertise, and context of review or testing matter more than a binary record that the practice occurred; and
- historical sources dispute both the maturity of the engineering label and the criteria that should distinguish engineering work.

### Distinctions not established

- a universal occupational boundary;
- a credential-based boundary;
- a job-title-based difference in performed responsibility;
- an evidence-based definition that equates programming with code entry; or
- a threshold at which broader responsibility becomes “software engineering.”

## Stage 4 — Outcome evidence map

### Requirements responsibility

S012 reports recurring practitioner perceptions connecting incomplete or changing requirements and communication problems with rework, schedule, implementation, product, and failure consequences. It identifies plausible mechanisms and experienced concerns, but cannot establish causal magnitude or population prevalence. With S013 unavailable, this outcome strand has no included corroborating case-study source.

### Review responsibility

S010 reports associations between some review measures and post-release defects in selected projects. S011 reproduces and extends the analysis and finds those measures unstable across releases and modeling choices, with models excluding review predictors performing as well as or better than models containing them. Jointly, the pair supports investigation of review substance, expertise, mechanism, and context; it does not support a stable general claim that more measured review causes fewer defects.

### Testing responsibility

S014 finds a small average external-quality benefit for TDD and little overall productivity effect, with important setting variation. S015 finds limited relationships between nominal test-related factors and post-release defects after accounting for production size. Jointly, they support distinguishing deliberate verification strategy and outcome evaluation from the mere presence of tests. They do not establish that one method is universally superior or that testing has no value.

### Outcome-map result

The included outcome studies address selected practices, measures, systems, and outcomes. They do not estimate the outcome effect of assuming broader engineering responsibility as a whole. The strongest defensible pattern is methodological: nominal compliance with a practice is not sufficient evidence that the underlying responsibility was exercised effectively.

This remains a candidate synthesis.

## Alternative explanations retained

1. **Work-complexity explanation:** broader activities may occur because the studied systems and organizations are complex, not because workers belong to a distinct engineering category.
2. **Role-distribution explanation:** teams may distribute engineering responsibility across specialized roles, so no individual must perform the entire taxonomy.
3. **Vocabulary explanation:** “programmer,” “developer,” and “software engineer” may be overlapping local labels rather than stable analytical categories.
4. **Professionalization explanation:** normative frameworks may describe an occupational aspiration or jurisdiction as much as observed practice.
5. **Visibility explanation:** code is a visible artifact while coordination, judgment, and risk work are harder to observe; differences in visibility can be mistaken for differences in importance.
6. **Practice-quality explanation:** weak or inconsistent outcome associations may reflect poor measures of practice substance rather than absence of an effect.
7. **Confounding explanation:** component size, churn, prior defects, expertise, organizational context, or task selection may explain apparent relationships between practices and outcomes.

## Disconfirming evidence and tensions

- S005 preserves a direct critique of the professional-status implications of “software engineer.”
- S004 records disagreement rather than a settled engineering method.
- S003 explicitly weakens title-based inference.
- S006–S009 demonstrate activity breadth but do not compare title groups or link the breadth to objective project success.
- S011 materially weakens broad interpretations of S010's review associations.
- S015 prevents treating test presence or coverage as sufficient evidence of verification effectiveness.
- S012 provides perceptions of consequences rather than demonstrated causal effects.
- The absence of an operational definition of programming prevents a symmetrical comparison.

## Sensitivity-check plan

Before any candidate becomes a finding, Gate B must test and record:

- the taxonomy after removing S001 and S003, to see which domains remain empirically observed;
- the boundary account after excluding all occupational-title language;
- the contemporary account after separating S004 and S005 from modern evidence;
- individual-, team-, project-, and organizational-level interpretations separately;
- each outcome claim after removing indirect or high-bias evidence;
- whether construction has been defined too narrowly or treated as lacking judgment;
- whether the responsibility domains can be combined or partitioned in an equally plausible taxonomy; and
- whether source dependencies cause apparent corroboration to be overstated.

## Sensitivity-check results

### SC-01 — Remove normative frameworks

Procedure: S001 and S003 were removed from the analytical support and the taxonomy was re-read against S004–S015.

Result: construction, requirements, verification, coordination, information seeking, documentation or rationale, and some delivery or maintenance activity remain visible. The full governance, professional, economic, security, privacy, and societal-consequence scope does not remain empirically established; those domains depend principally on normative or conceptual sources. Design and tradeoff judgment also becomes much less directly supported as an observed responsibility.

Effect: CER-01 remains a claim only about the frameworks. CER-02 survives in bounded settings. The eight-domain taxonomy must not be presented as an empirically observed universal taxonomy.

### SC-02 — Remove occupational-title evidence

Procedure: occupational labels and title-based statements were excluded, leaving activities, responsibilities, source settings, and study outcomes.

Result: the responsibility-breadth account survives. The evidence still shows construction alongside requirements, review, testing, coordination, information seeking, documentation, and change-related work. No person-level engineer-versus-programmer distinction remains testable.

Effect: CER-03 survives only as a conclusion about which boundary model is defensible for this review. It cannot become an occupational classification rule.

### SC-03 — Separate historical from contemporary evidence

Procedure: S004 and S005 were removed from claims about current responsibility, while their claims about origins and controversy were assessed separately.

Result: S001, S003, and S006–S015 still support broader framework scope and multi-activity development work. Claims about why the term was introduced, the 1968 problem framing, and the multi-person/multi-version proposal do not survive as contemporary empirical claims and remain historical only.

Effect: the contemporary breadth account does not depend on historical transfer. No historical boundary criterion is adopted as a current definition.

### SC-04 — Separate levels of analysis

Procedure: claims were re-read at individual, team, project, organization, discipline, and historical-field levels.

Result: individual activity evidence shows varied work composition; team and organization evidence shows distributed coordination and knowledge needs; S001 and S003 describe discipline-level scope. The evidence does not show that each individual owns every responsibility domain.

Effect: the taxonomy describes a responsibility space for software work. It is not an individual job description, competency certification, or rule for allocating responsibility.

### SC-05 — Remove indirect or high-bias evidence from outcome claims

Procedure: normative and historical propositions were removed from outcome support; self-reported consequences were prevented from serving as measured effects; observational repository relationships were prevented from serving as causal estimates.

Result:

- the requirements strand retains evidence of participant perceptions and candidate mechanisms but no demonstrated causal outcome effect;
- the review strand retains evidence that the selected repository measures do not produce a stable general defect relationship across the paired analyses;
- the testing strand retains a bounded TDD meta-analytic result and an observational qualification about nominal test factors, but not a general effect of testing; and
- no evidence remains that estimates the effect of broader engineering responsibility as a whole.

Effect: CER-05 and CER-07 require Low confidence and causal prohibitions. CER-06 may support a bounded conclusion about instability, not about review's intrinsic value. CER-08 remains Insufficient.

### SC-06 — Broaden the construction interpretation

Procedure: the analysis was tested against an alternative in which programming includes analysis, debugging, testing, design judgment, and coordination rather than being reduced to code entry.

Result: the evidence cannot reject that broader interpretation because no included source operationalizes programming. The framework claim that construction is one named domain still holds, but an exclusive person-level distinction becomes even less defensible.

Effect: all findings must use “construction” when referring to the bounded framework domain and reserve “programming” for the unresolved comparison in the research question.

### SC-07 — Test alternative taxonomies

Procedure: the eight domains were compared with plausible compressed groupings: problem/design/construction/assurance/evolution/governance; and construction/coordination/accountability.

Result: the same source material can support several defensible partitions. The precise number and borders of domains are analytically convenient rather than uniquely discovered facts. The recurring higher-level pattern—construction embedded among upstream, assurance, coordination, evolution, and consequence responsibilities—survives.

Effect: findings may identify recurring domains but must not claim that the eight-domain partition is canonical or exhaustive.

### SC-08 — Discount dependent evidence

Procedure: S006/S007, S010/S011, S014/S015, and the professional-framework sources were assessed as related or complementary bodies rather than counted as independent votes.

Result: descriptive activity breadth still has support from distinct observational and survey/interview settings, including S008 and S009. The review conclusion becomes stronger as a qualification because S011 directly challenges the stability of the earlier analysis, but the shared Qt evidence limits independence. The testing sources address different constructs and cannot be treated as replication. Requirements outcomes remain dependent on S012 alone.

Effect: no confidence judgment is based on source count. Dependencies are reflected in the claim-level ratings.

## Sensitivity summary

The checks preserve three bounded conclusions: the included frameworks assign software engineering a scope broader than construction; the studied development settings contain material responsibilities beyond construction; and neither occupational titles nor the current outcome evidence establish a universal programmer–engineer boundary. They weaken the exact eight-domain taxonomy, causal outcome claims, and any suggestion that one individual must own the full responsibility space.

## Current analytical conclusion

The sensitivity checks make a responsibility-based, contextual boundary more defensible for this review than either a title-based boundary or a claim that engineering and programming are always distinct. The findings and ratified confidence judgments are recorded in the [claim–evidence records](claim-evidence-records.md). Dee Empire completed and ratified the Gate B review on 2026-08-25; the decision remains bounded by the evidence gaps and limitations recorded here.

## AI involvement

System: OpenAI Codex; model version not exposed in the session interface.

Date: 2026-08-25.

Task: organize the ratified Gate A extractions into a definition map, responsibility taxonomy, boundary analysis, outcome map, alternatives, and sensitivity plan.

Input boundary: the approved protocol, protocol amendment, evidence table, review record, and current chapter inside `research/`.

Human verification: Dee Empire reviewed and ratified the Gate B packet on 2026-08-25, relying on the independently checked and previously ratified Gate A evidence records. Continuing review remains required if material evidence or reasoning changes.

# The Engineering Research Book

## Software engineering and programming

Chapter ID: ERB-01-01

Version: 0.8

Status: Reviewed — Gate B ratified

Authors: Dee Empire and the Zelyq contributors

Contributors: None recorded

Review roles completed: Proposal and protocol approval; Gate A evidence review ratified with constraints; Gate B methodological, evidence, software-engineering domain, and editorial review ratified

Last substantive review: 2026-08-25

Evidence current through: 2026-08-25, initial authoritative, educational, primary historical, activity, review, requirements, and testing retrieval

Related chapters: ERB-01-02, ERB-01-03, ERB-02-01

Research artifacts: [ERB-01-01 artifacts](../artifacts/erb-01-01/)

---

## Primary research question

> Which responsibilities distinguish software engineering from programming, and where does the distinction affect outcomes?

## Current state

The research proposal and protocol were approved on 2026-08-25. An AI-assisted independent source check recommended a Gate A pass with seven conditions; the author applied all seven corrections, and Dee Empire ratified the decision. Dee Empire then completed and ratified the Gate B methodological, evidence, software-engineering domain, and editorial review. The definition map, provisional responsibility taxonomy, boundary analysis, outcome map, sensitivity checks, and claim–evidence records are documented. The eight findings below are approved only within their stated scopes and confidence judgments. No Zelyq implication has been approved.

The approved findings do not close the evidence gaps or convert bounded conclusions into universal rules. New material evidence, a corrected source, or a defect in the reasoning requires reassessment under the review record.

## Research proposal

See the [research proposal](../artifacts/erb-01-01/proposal.md).

## Research protocol

See the [research protocol](../artifacts/erb-01-01/protocol.md).

## Evidence

Collection opened on 2026-08-25. Thirteen sources have passed initial full-text screening and bounded appraisal. They now cover professional scope, educational competencies, a primary historical conference record and later historical interpretation, observed and reported developer activity across several organizational settings, review outcomes and replication, requirements problems and perceived consequences, and testing quality-productivity evidence. Their extraction records are in the [evidence table](../artifacts/erb-01-01/evidence-table.md).

The evidence base supports approved findings only at the recorded scope and confidence. The ISO vocabulary entries and the retained longitudinal requirements-payoff article have not been inspected in full, and a targeted search found no methodologically adequate study directly comparing the full responsibilities of programmer and software-engineer title groups. No included source supplies an operational definition of programming itself; the evidence instead treats programming or construction as an incompletely defined baseline activity. The primary historical report preserves disagreement rather than consensus; the educational and professional frameworks are normative; activity studies remain context-specific; review effects are unstable across analyses; requirements consequences are practitioner-reported; and testing effects vary with method, context, measurement, and confounding.

The source-level decisions, reviewer declarations, cross-source checks, resolved objections, binding synthesis constraints, and ratified Gate B decision are recorded in the [review record](../artifacts/erb-01-01/review-record.md).

## Analysis

Gate B analysis separates normative scope, historical framing, observed or reported work, and outcome-oriented evidence. The complete reasoning, alternative explanations, disconfirming evidence, and sensitivity checks remain available in the [analysis notes](../artifacts/erb-01-01/analysis-notes.md).

The [claim–evidence records](../artifacts/erb-01-01/claim-evidence-records.md) contain the eight bounded findings and their ratified confidence judgments. They do not authorize an engineering application or code change.

### The comparison begins with responsibilities, not titles

The included evidence does not support sorting people into two stable occupational classes and then inferring what each class does. The ACM and IEEE educational framework explicitly warns that the title “software engineer” does not consistently identify a software-engineering professional ([S003](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s003)). The activity studies examine people described as developers and do not provide a common comparison between programmer- and engineer-titled groups ([S006](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s006), [S007](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s007), [S008](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s008), [S009](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s009)).

The historical sources also resist a status-based reading. The 1968 NATO conference used “software engineering” as a deliberately provocative description of a capability the field needed, while its editors preserved disagreement rather than declaring consensus ([S004](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s004)). Randell's later retrospective presents multiple contextual boundary accounts and reproduces Parnas's criticism of the professional implications carried by the title ([S005](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s005)). These sources can explain the history and controversy of the term. They cannot certify modern practitioners or establish an occupational hierarchy.

This review therefore uses a responsibility as its analytical unit. A responsibility combines an activity with its object, constraints, judgment or accountability component, and lifecycle context. This does not make programming the mechanical entry of code. No included source operationally defines programming, and a broader interpretation could include analysis, debugging, testing, design judgment, and coordination. The evidence cannot reject that interpretation.

### Construction sits inside a wider framework scope

Within their stated purposes, the included professional and educational frameworks clearly distinguish software construction from the complete scope they assign to software engineering. SWEBOK identifies construction alongside requirements, architecture, design, testing, operations, maintenance, configuration management, management, process, quality, security, professional practice, and economics ([S001](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s001)). Its definition derived from SEVOCAB is available here only second-hand because the underlying ISO vocabulary standard was not inspected. The educational framework similarly combines implementation with problem analysis, design, verification, documentation, process evaluation, teamwork, stakeholder work, professional conduct, economics, and societal context ([S003](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s003)).

The evidence strongly supports this description of the two frameworks. It does not establish how frequently these responsibilities occur, whether one person performs all of them, or whether people described as programmers do not perform them. Removing both frameworks from the synthesis also removes much of the support for the governance, economic, security, privacy, professional, and societal domains. Those domains should therefore remain framework scope rather than be described as universally observed practice.

### Development work extends beyond construction in the studied settings

The empirical activity studies converge on a narrower observation: professional development work in their settings involved code alongside other kinds of work. S006 directly monitored developers in four companies and recorded coding, debugging, review, version control, planning, documentation, meetings, email, information seeking, and coordination ([S006](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s006)). S007's Microsoft workday survey similarly reports specification, testing, review, documentation, communication, mentoring, learning, and infrastructure work alongside code and bug fixing ([S007](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s007)). S008 directly observed collaboration and information seeking, while S009 found that understanding and modifying code depended on rationale, dependencies, organizational knowledge, and coordination ([S008](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s008), [S009](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s009)).

This pattern survives when the studies' reported time percentages are removed. It also survives discounting the relationship between S006 and S007 because S008 and S009 provide different methods and settings. The available evidence therefore supports activity breadth in the studied contexts with Moderate confidence. It does not support a universal allocation of time, show that every non-code activity improves outcomes, or distinguish people by occupational title.

### Responsibilities form a contextual space, not a canonical checklist

Across the sources, recurring responsibilities can be organized into the following provisional taxonomy. The table is a synthesis tool; the evidence does not establish that eight is the uniquely correct number of domains.

| Responsibility domain | Central question carried by the responsibility |
| --- | --- |
| Problem framing and requirements | What need, stakeholder condition, or change must the software address? |
| Design and tradeoff judgment | Which structure and approach are justified under technical, quality, time, cost, and contextual constraints? |
| Construction and implementation | How should the intended behavior be realized in executable software and related artifacts? |
| Verification and quality | What evidence is adequate to judge the relevant behavior, defects, and risks? |
| Coordination and communication | How will dependencies, decisions, handoffs, and stakeholder communication be managed? |
| Documentation and knowledge continuity | What rationale and system knowledge must remain available for comprehension and change? |
| Delivery, operation, and evolution | How will the software be released, operated, maintained, updated, and adapted? |
| Governance and consequence | Who accounts for process, economics, professional duties, risk, users, and wider effects? |

Alternative groupings fit the evidence. The domains can be compressed into problem, design, construction, assurance, evolution, and governance, or into construction, coordination, and accountability. What survives those alternatives is the higher-level pattern: construction is embedded among upstream, assurance, coordination, evolution, and consequence responsibilities.

Responsibility can also be distributed. Individual activity evidence does not imply that each person owns the entire lifecycle. Teams and organizations may allocate responsibilities among specialized roles, and the allocation may change with system consequence, project stage, organization, number of participants and versions, or operating environment. For that reason, the responsibility-based boundary finding has Low confidence as an answer to the programmer–engineer comparison. It is more defensible than a title boundary within this evidence base, but it is not a validated classification rule.

### Knowledge and coordination enable change but do not prescribe one remedy

The available evidence supports a bounded conclusion about multi-person change. In the settings studied, participants sought or reported needing rationale, dependency, organizational, and system knowledge beyond the code being modified. Direct observation in S008 and surveys and interviews in S009 provide the closest support; S006 and S007 corroborate that communication and documentation form part of development work ([S006](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s006), [S007](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s007), [S008](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s008), [S009](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s009)). The NATO report shows that related communication and documentation concerns were present in the field's historical large-system framing, but the contemporary conclusion does not depend on transferring its 1968 context.

This conclusion has Moderate confidence for the studied settings. It establishes an information and coordination need, not a universal solution. It does not determine how much documentation to produce, when a meeting is justified, or whether a particular collaboration practice improves productivity. Preserving knowledge is a team or organizational responsibility even when retrieving it is an individual need.

### Selected outcome evidence is narrow and qualified

The outcome evidence does not evaluate the complete responsibility space. It addresses selected requirements, review, and testing mechanisms, and each strand supports a different level of conclusion.

#### Requirements

In the multinational NaPiRE survey, participants repeatedly selected incomplete or hidden requirements, customer-team communication flaws, and moving targets as important problems. They connected those problems with rework, schedule, implementation, product, and project-failure consequences ([S012](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s012)). This supports a bounded statement about reported perceptions and candidate mechanisms with Low confidence. It does not establish that the requirements problems caused the reported outcomes or that one prescribed process would prevent them. The evidence is particularly thin because the retained longitudinal source, S013, could not be inspected and remains outside the evidence base.

#### Code review

S010 reports associations between selected review measures and post-release defects in selected projects ([S010](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s010)). S011 reproduces and extends that work, finding that review-measure relationships were unstable across releases and modeling choices and that models without review predictors performed as well as or better than those containing them ([S011](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s011)).

Taken jointly, the pair supports with Moderate confidence the bounded conclusion that these relationships are not stable enough for a general causal claim. The studies make execution, expertise, measurement, and context necessary qualifications. They do not show that review lacks value, particularly for knowledge sharing, problem solving, or outcomes not captured by repository defect measures.

#### Testing

The TDD meta-analysis reports a small average improvement in external quality and little overall productivity effect, with important variation across settings and effort ([S014](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s014)). The Apache study reports limited relationships between nominal test-related factors and post-release defects after accounting for production size ([S015](../artifacts/erb-01-01/evidence-table.md#erb-01-01-s015)).

These sources address different constructs and are not replications. Together they provide Low-confidence support for a caution: neither the presence of tests nor the use of one testing method is sufficient evidence of delivered quality. They do not show that testing lacks value, that coverage never matters, or that TDD produces the same effect in every setting.

### Nominal compliance is not demonstrated responsibility

The review and testing strands expose a recurring analytical distinction. A repository indication that review occurred or tests exist is not equivalent to evidence that the underlying responsibility was exercised effectively. Engineering responsibility includes selecting a practice for the context, examining the substance and expertise involved, evaluating relevant outcomes, and revising the approach when its evidence is inadequate.

This is a synthesis of the limitations and qualifications in S010, S011, S014, and S015. It does not mean process records are useless or that a particular replacement process is superior.

## Approved findings

Gate B ratified the following statements and confidence judgments on 2026-08-25. Each remains subject to the scope, qualifications, and limitations in its claim–evidence record.

1. **Framework-level scope—High:** The two included professional and educational frameworks place construction within broader lifecycle, quality, coordination, economic, and professional responsibilities.
2. **Observed work breadth—Moderate:** In the settings studied by S006–S009, producing and changing software involved construction alongside planning, review, testing, communication, information seeking, coordination, documentation, and system knowledge.
3. **Nature of the boundary—Low:** A contextual and responsibility-based account is more defensible within this evidence base than a universal distinction between people called programmers and people called software engineers.
4. **Knowledge and coordination—Moderate:** In the multi-person settings studied, participants changing software sought or reported needing coordination, rationale, dependency, and system knowledge beyond the code being modified.
5. **Requirements consequences—Low:** S012 participants repeatedly connected requirements and communication problems with downstream consequences, but the evidence does not establish causality.
6. **Review-result stability—Moderate:** S010 and S011 do not provide a stable basis for a general causal claim that more measured review produces fewer post-release defects.
7. **Testing sufficiency—Low:** S014 and S015 do not support treating test presence or one testing method as sufficient evidence of delivered quality.
8. **General comparative outcome—Insufficient:** The evidence is insufficient to determine whether broader software-engineering responsibility as a whole produces better outcomes than programming.

The complete scope, supporting evidence, qualifications, sensitivity results, and confidence justifications are in the [claim–evidence records](../artifacts/erb-01-01/claim-evidence-records.md). The Gate B decision is recorded in the [review record](../artifacts/erb-01-01/review-record.md).

## Implications for later research

These findings do not authorize Zelyq requirements or code. Later research should evaluate AI or human participation against explicit responsibilities and contexts rather than occupational labels. It should also distinguish evidence that a practice exists from evidence that the practice is adequate for its purpose.

Before the primary question can receive a stronger comparative answer, research would need to operationalize both programming and broader engineering responsibility, identify where responsibilities reside across people and teams, and measure outcomes under comparable conditions. The present gap may justify further research; it does not justify assuming either that the activities are equivalent or that one is categorically superior.

## Limitations and open questions

The evidence base is deliberately heterogeneous but remains narrow relative to the question. It includes two normative frameworks, two historical sources, four context-specific activity studies, two related review studies, one perception-based requirements survey, one TDD meta-analysis, and one observational testing study. These sources do not form a representative sample of software work, occupations, organizations, countries, system risks, or lifecycle conditions.

The most important construct gap is the absence of an operational definition of programming. Without one, the review cannot conduct a symmetrical comparison and must not reduce programming to typing code. No included study directly compares programmer- and software-engineer-titled populations using common responsibility and outcome measures.

The outcome evidence is fragmented. Activity studies do not measure objective project or product outcomes. Requirements consequences are self-reported and lack the inaccessible S013 corroboration. Review studies share some data and remain observational. Testing sources examine different constructs and contexts. None measures the effect of broader engineering responsibility as a whole.

Source purpose also limits synthesis. S001 and S003 describe desired disciplinary and educational scope, not actual prevalence. S004 and S005 explain historical framing and dispute, not current practice. The SEVOCAB definition used by S001 is available only through that secondary quotation because S002 was not inspected.

Several questions therefore remain open:

- How should programming be operationalized without assuming away its judgment, design, testing, and coordination components?
- Which responsibilities must be held somewhere in a team, and which must be exercised by each contributor?
- How do scale, system consequence, lifecycle stage, and organizational structure change the necessary responsibility distribution?
- Which measures distinguish substantive review, testing, and requirements work from nominal compliance?
- Under what conditions does broader responsibility produce measurable improvements, costs, or tradeoffs?

## Approved Zelyq implications

No Zelyq engineering implications. The preceding research implications identify questions for later study only.

## References and artifacts

- [ERB-01-01 evidence table](../artifacts/erb-01-01/evidence-table.md)
- [ERB-01-01 screening record](../artifacts/erb-01-01/screening-record.md)
- [ERB-01-01 search log](../artifacts/erb-01-01/search-log.md)
- [ERB-01-01 review record](../artifacts/erb-01-01/review-record.md)
- [ERB-01-01 protocol amendments](../artifacts/erb-01-01/protocol-amendments.md)
- [ERB-01-01 analysis notes](../artifacts/erb-01-01/analysis-notes.md)
- [ERB-01-01 claim–evidence records](../artifacts/erb-01-01/claim-evidence-records.md)

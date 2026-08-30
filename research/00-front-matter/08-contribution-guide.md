# The Engineering Research Book

## Contribution guide

Version: 1.0

Status: Active — Version 1 reviewed

---

## Purpose

The Engineering Research Book is an open-source research publication. This guide defines how contributions are proposed, reviewed, accepted, credited, corrected, and maintained.

The guide applies to research contributions and engineering application records in the `research/` directory. Repository-wide procedures in the [Zelyq contribution guide](../../CONTRIBUTING.md) also apply unless this research-specific guide states a different requirement. All participation is governed by the [Code of Conduct](../../CODE_OF_CONDUCT.md).

For code contributors, the book is a prerequisite: [Research-to-code governance](10-research-to-code-governance.md) defines which accepted book record must exist before implementation begins. This guide governs creation and review of that record; it does not authorize code by itself.

## Who may contribute

Anyone may propose a contribution. Acceptance depends on the relevance, rigor, transparency, and quality of the work rather than the contributor's title, employer, education, geography, or relationship to Zelyq.

Relevant experience should be disclosed when it helps readers or reviewers understand the perspective, access, or possible conflicts behind a contribution. Credentials may establish context; they do not substitute for evidence.

## Ways to contribute

Contributions may include:

- proposing or refining a research question;
- adding relevant evidence to an existing investigation;
- conducting an approved study or evidence synthesis;
- reproducing or replicating an analysis;
- reviewing methodology, evidence, domain accuracy, or writing;
- identifying contradictory evidence or missing perspectives;
- correcting factual, citation, accessibility, or editorial problems;
- improving research artifacts, datasets, or analysis code;
- translating approved material while preserving meaning and attribution; or
- reporting that a published finding may no longer be current.
- proposing or reviewing a Zelyq engineering entry;
- creating a standing engineering policy for recurring bounded work;
- proposing an evidence-producing experiment; or
- evaluating whether an implemented decision achieved its recorded outcome.

Not every contribution needs to produce a conclusion. A well-supported correction, unresolved question, negative result, or documented limitation can materially improve the research.

## Before contributing

Review the documents that govern the proposed work:

- the [Version 1 Research Plan](../TABLE_OF_CONTENTS.md) for scope and sequence;
- the [Book Architecture](09-book-structure.md) for chapter entry and structure;
- the [Research Methodology](06-research-methodology.md) for study design and execution;
- the [Evidence Standard](07-evidence-standard.md) for claim support and confidence;
- the [Editorial Style Guide](../STYLE_GUIDE.md) for language and presentation; and
- [Copyright and License](02-copyright.md) for contribution and reuse terms.

Search existing chapters, proposals, issues, and pull requests before beginning. If an existing investigation asks the same primary question, contribute to it rather than creating a competing chapter without a documented reason.

## Choosing the contribution path

### Small corrections

Typographical corrections, broken links, citation metadata repairs, formatting fixes, and other changes that do not alter meaning may be submitted directly as a pull request.

The pull request should identify what was corrected and how it was checked.

### Substantive revisions

A change is substantive when it adds or removes evidence, changes analysis, alters a finding or confidence rating, changes scope, modifies a standard, or affects a downstream implication.

Open an issue or discussion before substantial work begins. Describe the problem, affected material, proposed change, supporting basis, and likely downstream effects.

### New research

New chapters and empirical studies require a research proposal and protocol under the research methodology. Research should not begin merely because a file has been created or a topic appears in the plan.

Proposal approval confirms that the question belongs in the book and that the planned method is reviewable. It does not commit the project to a preferred result or guarantee publication.

### Structural changes

Changes to Version 1 scope, part boundaries, chapter sequence, status definitions, or governing standards follow the structural change-control process in the book architecture.

Structural preference alone is not sufficient reason to reorganize the publication during research.

### Proposed code work

Do not begin with a branch, implementation, or code pull request. First check the [Zelyq engineering application register](../07-zelyq-engineering/REGISTER.md).

If an approved entry or standing policy fully covers the work, verify its current status, conditions, implementation boundary, and evaluation requirements before coding. If no accepted record covers the work, create a Zelyq engineering entry from the [entry template](../07-zelyq-engineering/templates/01-engineering-entry.md).

An entry begins with an evidenced problem, not a requested feature. It must pass problem legitimacy, research sufficiency, option and design, consequence, evaluation readiness, and implementation authorization gates before ordinary implementation begins.

When research is insufficient, the entry moves to `Research required`. Contributors may then propose research or an isolated experiment; they may not treat the evidence gap as permission to implement the preferred solution.

### Routine and emergency work

Routine work must cite an accepted standing engineering policy and remain inside its risk and scope boundaries. A label such as cleanup, maintenance, modernization, or best practice is not a substitute for a valid policy or entry.

Emergency action is limited to urgent containment under the emergency process. It requires the smallest safe response and retrospective review; it does not authorize permanent adoption.

## Contribution workflow

The standard workflow is:

```text
Issue or proposal
        ↓
Scope and responsibility confirmed
        ↓
Research or revision performed
        ↓
Self-review and artifacts prepared
        ↓
Pull request
        ↓
Required reviews
        ↓
Revision and documented resolution
        ↓
Acceptance and merge
        ↓
Continuing review
```

Small editorial corrections may enter at the pull-request stage.

## Issues and proposals

An issue or proposal should be specific enough for maintainers and reviewers to evaluate before work expands.

Include:

```text
Problem or research question:
Why it belongs in the book:
Affected chapters or standards:
Proposed scope:
Excluded scope:
Contribution type:
Method or supporting evidence:
Known overlap and dependencies:
Known risks, conflicts, or ethical concerns:
Expected artifacts or outcome:
```

For research proposals, use the complete template in the methodology. Link related issues and avoid duplicating private discussion that future contributors cannot inspect.

## Working branches and commits

Use a focused branch and keep each pull request concerned with one coherent contribution. Separate unrelated editorial, structural, methodological, and research changes when reviewing them together would obscure their effects.

Commit messages and pull-request titles follow the repository's conventions. Commit history should help a reviewer understand meaningful stages of the work; it need not preserve every temporary note.

Do not rewrite or remove another contributor's unpublished work merely to simplify a branch. Coordinate overlapping changes and preserve attribution.

## Pull-request requirements

Every research pull request should state:

- what changed and why;
- whether the change is editorial or substantive;
- the question, finding, standard, or problem affected;
- how the work was conducted or verified;
- which evidence and research artifacts were added or changed;
- known limitations and unresolved concerns;
- downstream chapters, findings, or decisions that may be affected;
- material use of AI assistance;
- conflicts of interest or relevant affiliations; and
- the reviews requested.

Substantive pull requests should link the approved proposal or issue. All links, citations, quotations, data transformations, and calculations must be checked before requesting review.

## Required reviews

Review is based on the nature and consequence of the change.

### Editorial review

Required for all published prose. It checks clarity, structure, terminology, accessibility, links, citations, and compliance with the editorial style guide.

### Methodological review

Required for new studies, evidence syntheses, material changes to a research method, and findings based on new analysis. It checks alignment among the question, design, execution, evidence, analysis, and conclusion.

### Evidence review

Required when evidence, findings, or confidence ratings change. It verifies source inspection, claim fit, appraisal, contradictory evidence, synthesis, and confidence.

### Engineering application review

Required for Zelyq engineering entries, standing policies, experiments, emergency retrospectives, and outcome evaluations. It verifies problem evidence, research coverage, alternatives, project context, risk, authorization boundaries, and evaluation readiness.

### Domain review

Required when assessing the work depends on specialized knowledge not adequately represented by other reviewers.

### Ethics, privacy, security, or legal review

Required when a contribution involves participants, sensitive or personal data, security vulnerabilities, restricted material, licensing uncertainty, or other consequential obligations.

One qualified reviewer may cover more than one role, but the pull request should state which responsibilities were performed. Central or high-consequence findings require at least one reviewer who did not conduct the original analysis.

## Reviewer responsibilities

Reviewers should:

- disclose relevant conflicts and decline review when independence is inadequate;
- evaluate the contribution against published criteria rather than personal preference;
- identify the exact claim, evidence, method, or rule behind a material objection;
- distinguish required corrections from optional suggestions;
- inspect the most consequential and uncertain claims directly;
- consider contrary interpretations and missing perspectives;
- keep confidential or sensitive material protected; and
- review revisions and record whether objections were resolved.

Reviewers should challenge ideas and methods without attacking contributors. A strong review explains how the work can become more accurate, transparent, or useful.

## Contributor responsibilities during review

Contributors should respond to every material review comment through revision, evidence, explanation, or an explicitly recorded disagreement.

Agreement with every suggestion is not required. A response is adequate when it demonstrates that the concern was understood and either resolves it or explains why the proposed change would weaken the work.

Do not resolve comments by hiding uncertainty, deleting contrary evidence, or expanding claims beyond the reviewed material.

## Acceptance criteria

A contribution may be accepted when:

- it belongs within the current scope or has an approved scope change;
- its purpose and effects are clear;
- applicable methodological and evidentiary standards are satisfied;
- important claims, citations, and artifacts are verifiable;
- limitations, disagreements, and conflicts are disclosed;
- required reviews are complete;
- material objections are resolved or formally documented;
- licensing, attribution, ethical, privacy, and security requirements are satisfied;
- affected cross-references and downstream material are updated; and
- the resulting publication remains internally coherent.

Acceptance of a research contribution does not authorize code. An engineering application entry authorizes implementation only when its status is explicitly `Approved for implementation` or `In implementation` and the proposed work remains within its recorded boundary.

Acceptance means the contribution meets the book's current standard. It does not certify permanent correctness or agreement by every contributor.

## Reasons to request revision or decline

A contribution may require revision or be declined when it:

- falls outside scope without justification;
- begins from a predetermined conclusion and does not permit disconfirmation;
- uses a method that cannot support its claims;
- relies on unverified, fabricated, inaccessible, or misrepresented sources;
- omits material contrary evidence or limitations;
- duplicates existing work without adding a distinct contribution;
- presents marketing, product preference, or personal opinion as research;
- cannot satisfy ethical, privacy, security, licensing, or consent requirements;
- obscures material AI involvement or conflicts of interest;
- changes structure without following change control; or
- cannot be made reviewable within reasonable project resources.

An engineering application contribution also requires revision or rejection when it begins from code already written, defines the problem as a missing preferred feature, lacks adequate research coverage, hides material project assumptions, omits meaningful alternatives, or cannot evaluate whether the proposed work solves the recorded problem.

Declining a contribution is a decision about the submitted work and current scope, not a judgment about the contributor.

## Authorship and credit

Credit should reflect actual contribution. Substantial intellectual contributions to the question, method, evidence, analysis, or writing may justify chapter authorship. Data collection, software, review, curation, translation, and other contributions should be credited according to their role even when they do not justify authorship.

Authorship order and contribution roles should be agreed before publication and revised when responsibilities change. Honorary authorship and omission of qualifying contributors are not acceptable.

AI systems and tools are not authors. Material AI assistance should be disclosed according to the methodology, while accountable human contributors remain responsible for the work.

## Licensing and contributor rights

Research content is licensed under Creative Commons Attribution 4.0 International as described in [Copyright and License](02-copyright.md). This research-specific license is an explicit exception to the repository's GNU AGPL-3.0 and Contributor License Agreement, which otherwise govern contributions outside `research/`.

By intentionally submitting a contribution for inclusion in the book, a contributor confirms that they have the right to submit it and agrees that accepted content may be published under CC BY 4.0.

Contributors retain copyright in their original contributions. Third-party material must be identified, attributed, and compatible with the intended use. Do not submit confidential, proprietary, plagiarized, or unlawfully obtained material.

## Conflicts of interest

Disclose financial, employment, ownership, funding, personal, advocacy, competitive, or other relationships that could reasonably affect how the contribution is interpreted.

Participation in Zelyq is a relevant relationship when research directly concerns Zelyq or competing systems. Disclosure does not automatically prevent contribution or review; maintainers should apply safeguards proportionate to the risk, including independent review or reassignment.

## Corrections, retractions, and disputes

Anyone may report a suspected error. Reports should identify the affected text, explain the concern, and provide evidence when applicable.

Corrections are handled according to consequence:

- **Editorial correction:** fixes presentation without changing meaning.
- **Substantive correction:** changes evidence, analysis, scope, confidence, or interpretation and requires renewed review.
- **Retraction:** withdraws a finding or chapter whose support is no longer adequate or whose ethical or integrity failure prevents continued publication.

The version history should preserve what changed and why. Substantive corrections must be propagated to dependent findings, implications, and recorded product decisions.

Good-faith methodological and interpretive disputes should remain visible when evidence cannot resolve them. Maintainers may publish a minority interpretation, limitation, or open question rather than force unsupported consensus.

## Maintainer responsibilities

Maintainers protect the process rather than a preferred conclusion. They are responsible for:

- confirming scope and assigning review roles;
- applying standards consistently;
- protecting contributor and participant privacy;
- managing conflicts and conduct concerns;
- ensuring material objections receive a documented response;
- preserving attribution and revision history;
- preventing unresolved high-consequence defects from publication;
- coordinating corrections across dependent material; and
- explaining acceptance, revision, or rejection decisions.

Maintainers should not use their role to suppress well-supported findings that conflict with Zelyq's direction.

## Community conduct and sensitive reports

Discussion must remain respectful, evidence-focused, and consistent with the Code of Conduct. Challenge claims, assumptions, methods, and interpretations—not the worth or identity of the person presenting them.

Report harassment or other conduct concerns through the private channel identified in the Code of Conduct. Report security vulnerabilities through the process in [SECURITY.md](../../SECURITY.md), not through a public research issue.

Concerns involving sensitive participant data, confidential sources, or potentially harmful disclosure should be raised privately with maintainers before publishing details.

## Contribution checklist

Before requesting review, confirm that:

- the contribution has one coherent purpose;
- required discussion or proposal approval occurred;
- scope and overlap with existing work are clear;
- the applicable methodology and evidence rules were followed;
- sources, claims, quotations, data, and links were verified;
- contrary evidence, limitations, and uncertainty are visible;
- research artifacts are included or access restrictions are explained;
- material protocol deviations and AI assistance are disclosed;
- conflicts and relevant affiliations are disclosed;
- authorship and contribution credit are accurate;
- third-party rights and the CC BY 4.0 contribution terms are satisfied;
- affected cross-references and downstream findings are identified;
- any engineering application record distinguishes research findings, verified project facts, engineering judgment, and assumptions;
- proposed code work has not begun before implementation authorization;
- the page follows the editorial style guide; and
- the pull request explains how the change was checked.

The objective of contribution is not to make the book larger or more certain. It is to make its account of the evidence more accurate, transparent, and useful.

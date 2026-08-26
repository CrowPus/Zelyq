# The Engineering Research Book

## Book architecture

Version: 1.0

Status: Active — Version 1 reviewed

---

## Purpose

This page defines how knowledge in The Engineering Research Book is organized, identified, connected, reviewed, and revised.

The architecture is intentionally separate from the research agenda. The [Version 1 Research Plan](../TABLE_OF_CONTENTS.md) owns the current scope, parts, chapter sequence, and completion criteria. This page owns the stable structure into which that research fits.

## Document responsibilities

Each governing document has one primary responsibility:

| Document | Responsibility |
| --- | --- |
| Version 1 Research Plan | Current scope, parts, planned chapters, sequence, and completion criteria |
| Book Architecture | Information hierarchy, file organization, chapter anatomy, metadata, status, and structural change control |
| Research Methodology | Research design, execution, analysis, review, and continuing review |
| Evidence Standard | Source appraisal, claim support, synthesis, confidence, citation, and evidence traceability |
| Contribution Guide | Proposal, review, acceptance, credit, correction, and maintainer responsibilities |
| Editorial Style Guide | Voice, language, terminology, presentation, and editorial quality |
| Research-to-code Governance | Engineering application records, approval gates, code authorization, and outcome review |
| Glossary | Stable definitions used throughout the publication |

When documents overlap, apply the rule from the document that owns the responsibility. If two governing documents genuinely conflict, record and resolve the conflict rather than silently selecting one.

## Information hierarchy

The book uses the following levels:

1. **Edition** — a named, stable release of the complete publication.
2. **Book** — the full body of research governed by one question.
3. **Part** — a major field of inquiry with a central question and exit criterion.
4. **Chapter** — a bounded research project answering one primary question.
5. **Section** — a functional component of a chapter's research record or argument.

Each lower level must contribute to the purpose of the level above it. A part is not a container for loosely related topics, and a chapter is not a collection of independent essays.

Research artifacts support chapters without becoming narrative hierarchy levels. Engineering application records form a separate project-specific layer that depends on findings from the research hierarchy and produces decisions, authorizations, and evaluations.

## Content types

### Front matter

Front matter establishes the publication's identity, purpose, governance, research standards, and reader guidance. It is normative where it explicitly defines a project rule.

### Part introduction

A part introduction defines its central question, scope, dependencies, planned chapters, and exit criterion. It may summarize earlier findings needed by the part but should not duplicate their analysis.

### Research chapter

A research chapter is the primary unit of published inquiry. It contains a traceable question, method, evidence, analysis, findings, limitations, and implications.

### Synthesis chapter

A synthesis chapter integrates findings from multiple earlier chapters. It may develop taxonomies, models, evaluation criteria, or broader conclusions, but every material input must remain traceable to its source finding.

### Appendix

An appendix contains durable supporting material needed by readers but unsuitable for the main argument, such as extended methods, instruments, large evidence tables, or technical derivations. An appendix must be referenced from the chapter it supports.

### Research artifact

A research artifact supports inspection or reproduction but is not part of the narrative publication. Artifacts require stable links, provenance, licensing, and version information appropriate to their type.

### Engineering application record

An engineering application record connects reviewed research to a specific Zelyq problem and context. It may be a Zelyq engineering entry, standing engineering policy, experiment entry, emergency record, or post-implementation evaluation.

Application records are part of the book but are not research findings. Their structure, status, and authority are defined by [Research-to-code governance](10-research-to-code-governance.md).

## Repository layout

The intended Version 1 layout is:

```text
research/
├── TABLE_OF_CONTENTS.md
├── STYLE_GUIDE.md
├── 00-front-matter/
│   ├── 01-cover.md
│   ├── 02-copyright.md
│   └── ...
├── 01-nature-of-software-engineering/
├── 02-engineering-work-and-judgment/
├── 03-teams-projects-and-memory/
├── 04-ai-capabilities-and-limits/
├── 05-trust-and-collaboration/
├── 06-synthesis-and-evaluation/
├── 07-zelyq-engineering/
│   ├── REGISTER.md
│   ├── entries/
│   ├── policies/
│   ├── experiments/
│   ├── emergency-records/
│   └── templates/
└── artifacts/
    └── <chapter-id>/
```

Part directories should be created only when their first approved chapter proposal is ready. Empty scaffolding does not indicate progress and is unnecessary.

The `artifacts/` directory should contain only materials suitable for the repository. Sensitive, restricted, or impractically large artifacts belong in an approved external archive, with a stable reference stored under the relevant chapter identifier.

## Identifiers and filenames

Part directories use a two-digit sequence and stable descriptive name.

Chapter files use a two-digit sequence within the part followed by a descriptive slug:

```text
01-software-engineering-and-programming.md
02-software-as-a-sociotechnical-system.md
```

Each chapter also receives a stable identifier independent of its filename:

```text
ERB-01-01
```

The first number identifies the part and the second identifies the chapter. Identifiers are not reused after publication, even when a chapter is withdrawn.

Descriptive filenames may change before publication. Renaming a published path should be exceptional and requires redirects or an explicit migration record because citations may depend on it.

Artifact directories use the lowercase chapter identifier, such as `artifacts/erb-01-01/`.

Engineering application records use their own stable identifiers:

- `ZED-0001` for a Zelyq engineering entry;
- `ZEP-0001` for a standing engineering policy;
- `ZEX-0001` for an experiment entry; and
- `ZER-0001` for an emergency record.

The application register records every identifier, title, status, owner, research dependencies, authorized implementation references, and successor. Identifiers remain visible after rejection, withdrawal, or supersession.

## Part introduction structure

Each part begins with an `00-introduction.md` containing:

- the part title;
- central research question;
- included and excluded scope;
- relationship to the governing question;
- dependencies on earlier parts;
- chapter sequence and the reason for that sequence;
- synthesis plan; and
- exit criterion.

The introduction should be updated when an approved structural change affects the part. It should not make findings before the relevant chapters have completed research.

## Chapter entry criteria

A chapter may enter the research plan when:

- it asks one primary research question;
- the question contributes directly to its part's central question;
- its included and excluded scope can be stated;
- it can be investigated as a coherent unit;
- it does not substantially duplicate an existing chapter;
- its dependencies and expected contribution are identifiable; and
- the expected result can be described without assuming a preferred conclusion.

A topic name is not a research question. Approval of a question authorizes proposal development or research according to the contribution workflow; it does not approve a finding.

## Required chapter metadata

Every chapter begins with human-readable metadata:

```text
Chapter ID:
Version:
Status:
Authors:
Contributors:
Review roles completed:
Last substantive review:
Evidence current through:
Related chapters:
Research artifacts:
```

Use ISO 8601 dates. Use `Not yet reviewed` or `Not applicable` instead of leaving a required field ambiguous.

“Evidence current through” records the final search or observation date relevant to the chapter's evidence. It does not imply that every source was published on that date.

Authorship and contribution roles follow the contribution guide. Reviewer names may be recorded in a linked review record when privacy or operational needs make inline listing inappropriate.

## Standard chapter anatomy

The following functions are required even when a method-specific chapter changes their order.

### Research question

State one primary question precisely enough for a reader to judge whether the chapter answers it. Supporting questions may follow.

### Scope and definitions

Define included and excluded subjects, material terminology, population or system boundaries, relevant contexts, and time boundaries.

### Why the question matters

Explain the question's relationship to its part and the governing question. Importance is not evidence for a preferred answer.

### Method

Identify the research mode, protocol, collection and selection process, appraisal, analysis, deviations, ethical safeguards, and methodological limitations. Link detailed artifacts rather than overloading the narrative when appropriate.

### Evidence

Present or summarize the evidence needed to inspect the analysis. Preserve important differences and disagreement among sources.

### Analysis

Explain what the evidence supports, where interpretation is required, what alternatives were considered, and how limitations affect the answer.

### Findings

Answer the research question through bounded, traceable claims. Each material finding includes or links to its claim–evidence record and confidence justification.

### Implications

Explain what the findings may imply for later research, evaluation, or design. Identify additional reasoning and competing implications. Do not present an implication as a finding.

### Limitations and open questions

Identify weaknesses, boundaries on generalization, unresolved disagreement, missing evidence, and useful follow-up questions.

### References and artifacts

List every cited source and link the research artifacts necessary to inspect the work. Identify access or reuse restrictions.

No required function may be omitted without a documented reason. The research methodology and evidence standard determine the detail required for a particular design.

## Chapter status model

Research chapters use five statuses:

| Status | Meaning | Permitted transition |
| --- | --- | --- |
| Proposed | Question and scope are under review; research has not begun | In research or Withdrawn |
| In research | An approved protocol is being executed or analyzed | Draft, Proposed, or Withdrawn |
| Draft | A complete answer exists and is open for formal review | Reviewed, In research, or Withdrawn |
| Reviewed | Required reviews are complete and material objections are resolved | Published or Draft |
| Published | Accepted into the current edition | Draft or Withdrawn |

**Withdrawn** is a terminal record, not an active chapter status. A withdrawn identifier and explanation remain visible so citations and history are not misleading.

A status change must be supported by the required record. Creating a file does not make a chapter In research, and merging a pull request does not automatically make it Published.

Governing documents use `Draft for approval`, `Active`, or `Retired`. They become Active only through explicit foundation or governance approval.

Engineering application records use the statuses and code permissions defined by research-to-code governance. Research chapter status and engineering authorization status are never interchangeable: a Published chapter does not authorize code, and an Approved for implementation entry does not become a research finding.

## Versions and editions

Chapter versions use semantic meaning rather than release automation:

- a **major** version changes a central finding, scope, or interpretation;
- a **minor** version adds compatible evidence, analysis, clarification, or an additional finding; and
- a **patch** version corrects presentation, metadata, citations, or other material without changing meaning.

The initial published chapter version is `1.0.0`. Drafts may use `0.x` versions.

An edition is a curated, stable snapshot of the book. The living research may continue after an edition is released. Edition notes identify included chapter versions, known limitations, and material changes from the prior edition.

## Cross-references and dependencies

Cross-references should describe the relationship between materials. A chapter may:

- depend on an earlier definition or finding;
- qualify another chapter's scope;
- provide contradictory evidence;
- apply a finding in a different context;
- supply evidence for a synthesis; or
- identify an unresolved inconsistency.

Avoid vague “see also” links when the relationship matters.

A dependency is material when changing one finding could change another chapter's analysis, conclusion, confidence, or implication. Material dependencies must be recorded in chapter metadata or a linked dependency record.

When a material source finding changes, review all known dependents. A link does not make an implication traceable unless the reasoning between the finding and implication is also stated.

## Traceability chain

The book preserves the following chain:

```text
Source or observation
        ↓
Source appraisal
        ↓
Body-of-evidence assessment
        ↓
Finding and confidence
        ↓
Synthesis or design implication
        ↓
Zelyq engineering entry
        ↓
Implementation authorization
        ↓
Implementation and verification
        ↓
Outcome evaluation and research feedback
```

Each transition adds reasoning that must be inspectable. Research findings remain independent from product preference, while Zelyq decisions and authorizations are recorded in the book's engineering application layer. Code is an output of an approved entry, not a substitute for one.

## Structural change control

The Version 1 structure remains a draft until explicitly approved. After approval, ordinary research and drafting should occur within it.

Locking the structure prevents casual reorganization; it does not prevent evidence-based correction. A proposed structural change must record:

```text
Current limitation:
Evidence or experience demonstrating the limitation:
Smallest proposed change:
Alternatives considered:
Affected scope, parts, chapters, identifiers, and links:
Effect on active research:
Migration and communication plan:
Required approvals:
```

Changes to wording or filenames that do not alter ownership, meaning, scope, sequence, or dependencies are editorial and do not require structural approval.

A Version 1 scope change requires explicit approval and an update to the research plan. A chapter-level adjustment that remains within an approved part may follow the contribution workflow without reopening the entire architecture.

## Adding, splitting, merging, and withdrawing chapters

Add a chapter only when its question satisfies the entry criteria and cannot be answered more coherently within an existing chapter.

Split a chapter when one method and argument cannot adequately answer its materially distinct questions. Preserve identifiers and citation history by retaining the original as a synthesis, withdrawing it with successor links, or documenting another explicit migration.

Merge chapters when their questions, evidence, and findings cannot be meaningfully separated. Choose one surviving identifier and preserve the retired identifier as an alias or withdrawal record.

Withdraw a chapter when its question no longer belongs in scope, its integrity cannot be repaired, or its content has been superseded in a way that makes continued publication misleading. Withdrawal must explain the reason and point to replacements when they exist.

## Architectural validation

Before the foundation is approved, confirm that a contributor can determine:

- whether a proposed question belongs in Version 1;
- which part owns it;
- whether it requires a new chapter;
- which identifier and path it receives;
- which standards govern its method, evidence, writing, and review;
- what metadata and sections are required;
- how its status advances;
- where its artifacts belong;
- how its findings connect to later synthesis; and
- how corrections propagate to dependent work;
- how a finding may enter an engineering application record without becoming a product claim; and
- which accepted book record is required before code work begins.

The architecture is successful when the book can grow without requiring contributors to invent a new structure for each investigation—and when readers can trace a conclusion without relying on private project history.

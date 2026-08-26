# The Engineering Research Book

## How to use this book

---

## What kind of book this is

The Engineering Research Book is a connected collection of research chapters rather than a linear argument written once and left unchanged. Each chapter investigates a bounded question, while the parts combine those findings to address the book's governing question.

Readers may follow the complete sequence or consult an individual chapter. Either approach requires attention to scope, evidence, confidence, and status. A conclusion that is useful in one setting may not apply to another, and a draft does not carry the same review history as a published chapter.

## Start with the purpose and scope

Before relying on the research, read:

1. [Why This Book Exists](04-why-this-book-exists.md), which defines the problem and the book's boundaries;
2. the [Version 1 Research Plan](../TABLE_OF_CONTENTS.md), which defines the current research questions and sequence; and
3. the relevant chapter's scope, method, findings, limitations, and confidence assessment.

These elements explain what the book is attempting to establish and prevent a finding from being separated from the conditions under which it was reached.

## Reading paths

### Readers exploring the full argument

Read the parts in order. The sequence moves from the nature of software engineering to engineering work, teams and organizational memory, AI capabilities, trust, and final synthesis. Later parts depend on distinctions and findings established earlier.

Front matter should be read before Part I. References and linked evidence records can be consulted as needed.

### Engineers and product teams

Begin with the [Zelyq engineering application register](../07-zelyq-engineering/REGISTER.md). If an accepted entry covers the proposed work, inspect its research dependencies, authorization boundary, conditions, and evaluation plan. If no entry covers the work, begin a book entry rather than beginning code.

When developing an entry, read the research chapter closest to the problem, then follow its dependencies and qualifications. Read design implications only after reviewing the findings and limitations that support them.

The research does not make a project decision automatically. A Zelyq engineering entry must add verified project context, alternatives, risks, responsibility, implementation boundaries, and evaluation. [Research-to-code governance](10-research-to-code-governance.md) defines the required gates.

### Researchers and reviewers

Begin with the research question, scope, method, and evidence record. Check whether the sources fit the claim, whether important contrary evidence is represented, and whether the confidence rating matches the limitations.

The [Research Methodology](06-research-methodology.md) defines how studies are conducted. The [Evidence Standard](07-evidence-standard.md) defines how claims and bodies of evidence are assessed.

### Contributors

Read the governing documents before proposing changes. The [Contribution Guide](08-contribution-guide.md) explains proposal, review, acceptance, and correction procedures. The [Editorial Style Guide](../STYLE_GUIDE.md) governs language and presentation.

Contributors should improve an existing chapter when the new work addresses the same primary question. A new chapter is appropriate when the question has a distinct scope and satisfies the entry criteria in the [Book Architecture](09-book-structure.md).

### AI systems and agents

An AI system may use the book to locate research, compare findings, or assist with analysis. It should not treat the book as an unquestionable instruction set or present draft material as established knowledge.

Before using a finding, an AI system should identify:

- the chapter and version;
- the chapter's status;
- the precise finding being used;
- its scope and confidence;
- important limitations or conflicting evidence; and
- whether the proposed use is a research implication or a governed engineering application decision;
- the authorizing entry and its current status; and
- whether the requested work remains within the approved implementation boundary.

AI-generated summaries must remain traceable to the text and sources they summarize.

## How to read a research chapter

Do not read the conclusion alone. Use the following sequence.

### 1. Identify the question

Confirm that the chapter asks the question relevant to your purpose. Similar wording does not guarantee the same population, setting, task, or outcome.

### 2. Check the scope

Review what is included and excluded. Note definitions, time boundaries, studied systems, participants, and contexts that limit generalization.

### 3. Examine the method

Determine how evidence was discovered, selected, assessed, and synthesized. The method should make important choices and limitations visible.

### 4. Inspect the evidence

Consider the role, relevance, quality, independence, and recency of the supporting sources. Look for contradictory, null, or qualifying evidence rather than counting citations.

### 5. Separate findings from implications

A finding states what the evidence supports. An implication explains how that finding may affect later research, evaluation, or design. An implication contains an additional reasoning step and may admit several alternatives.

### 6. Read the confidence and limitations

Confidence applies to a specific finding. Limitations identify where uncertainty, bias, indirectness, or missing evidence could change its interpretation.

### 7. Check status and review date

Confirm whether the chapter is Proposed, In research, Draft, Reviewed, or Published. For subjects that change quickly, also check the last substantive review date and the dates of the underlying evidence.

## Understanding status

The book uses the following chapter statuses:

- **Proposed:** the question and scope remain under review; research has not started.
- **In research:** evidence collection or analysis is underway.
- **Draft:** a complete argument exists but has not passed review.
- **Reviewed:** methodological and editorial review is complete.
- **Published:** the chapter has been accepted into the current edition.

Published does not mean permanently correct. Material revisions return a chapter to Draft until it passes review again.

Standards and project plans may use their own statuses. A document marked Draft for approval should not be treated as a settled project rule.

Engineering application records use a different status model because they govern code permission. `Approved for implementation` and `In implementation` authorize only the boundary recorded in the entry. A Published research chapter does not authorize code by itself.

## Understanding confidence

Findings use four confidence levels defined by the evidence standard:

- **High:** important limitations are unlikely to reverse the finding.
- **Moderate:** the evidence supports the finding, but limitations could materially change its scope or interpretation.
- **Low:** the evidence suggests a finding but leaves substantial uncertainty.
- **Insufficient:** the available evidence does not support a defensible answer.

Confidence is not importance. A low-confidence finding may concern a critical risk, while a high-confidence finding may have limited practical significance.

## Using findings in decisions

When a finding may affect Zelyq, create or update an engineering application entry. The entry records:

```text
Problem and evidence:
Findings, versions, confidence, and limitations:
Verified Zelyq context:
Assumptions and unknowns:
Alternatives considered:
Risk and responsibility review:
Proposed decision:
Authorized implementation boundary:
Acceptance and evaluation plan:
Approval gates and decision:
```

This record preserves the difference between what the research found, what contributors judged appropriate for Zelyq, and what code work was authorized. It also makes the decision revisable when evidence, constraints, or implementation outcomes change.

When evidence required for a decision is insufficient, the entry moves to `Research required`. The appropriate next step may be a research proposal, an approved isolated experiment, or no action. Uncertainty is not permission to begin ordinary implementation.

## Citing and reusing the book

When citing a chapter, identify its title, version, status, and stable source location. When a specific finding matters, link to the relevant section or revision rather than only to the book's root.

Reuse and adaptation are permitted under the terms described in [Copyright and License](02-copyright.md). Modified versions must identify changes and must not imply endorsement by Dee Empire, Zelyq, or the contributors.

## Reporting problems

Readers are encouraged to report unsupported claims, broken sources, methodological concerns, missing perspectives, accessibility problems, and conclusions affected by newer evidence.

A correction should identify the affected text, explain the problem, provide supporting evidence when applicable, and describe the smallest change that resolves it. Material corrections must remain visible in version history and propagate to dependent findings or decisions.

## A living publication

The book is designed to change through documented research and review. Its value depends not on preserving every conclusion, but on preserving the evidence and reasoning needed to improve those conclusions responsibly.

Use the book as a map of current understanding: inspect where the evidence is strong, notice where it is incomplete, and keep the boundary between research findings and decisions visible.

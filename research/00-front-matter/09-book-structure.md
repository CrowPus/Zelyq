# The Engineering Research Book

## Book Architecture

Version: 1.0
Status: Draft for approval

---

## Purpose

This page defines how research in the book is organized. The current scope, parts, and planned chapters are maintained in the [Version 1 Research Plan](../TABLE_OF_CONTENTS.md).

Separating architecture from content prevents the book from acquiring multiple competing structures.

## Authority of Project Documents

- `TABLE_OF_CONTENTS.md` owns scope, sequence, and planned research.
- `06-research-methodology.md` owns the research process.
- `07-evidence-standard.md` owns source assessment, claim support, and citations.
- `STYLE_GUIDE.md` owns language, tone, and editorial conventions.
- `08-contribution-guide.md` owns contribution and review workflow.
- This page owns information architecture and required chapter anatomy.

If two documents conflict, resolve the conflict explicitly. Do not silently choose whichever rule is more convenient.

## Information Hierarchy

The book uses four content levels:

1. **Book** — the complete project governed by one question.
2. **Part** — a major field of inquiry with a central question and exit criterion.
3. **Chapter** — a bounded research project answering one primary question.
4. **Section** — one stage or component of the chapter's argument.

A part is not a folder for loosely related writing. Each chapter must help answer its part's central question.

## Repository Layout

```text
research/
├── TABLE_OF_CONTENTS.md
├── STYLE_GUIDE.md
├── 00-front-matter/
├── 01-nature-of-software-engineering/
├── 02-engineering-work-and-judgment/
├── 03-teams-projects-and-memory/
├── 04-ai-capabilities-and-limits/
├── 05-trust-and-collaboration/
└── 06-synthesis-and-evaluation/
```

Create a part directory only when its first approved chapter proposal is ready. Within a part, files use a two-digit sequence and stable descriptive name, such as `01-software-engineering-and-programming.md`.

## Chapter Entry Criteria

A chapter may enter the plan when:

- it asks one primary research question;
- it contributes directly to its part's central question;
- its scope can be investigated as a coherent unit;
- it does not substantially duplicate another chapter; and
- its expected contribution can be stated without assuming a preferred conclusion.

## Standard Chapter Anatomy

### Title and metadata

State the title, version, status, and last substantive review date.

### Research question

State one primary question precisely enough that a reader can judge whether the chapter answers it.

### Scope

Define included and excluded subjects, relevant terms, and population, system, or time boundaries when applicable.

### Why the question matters

Explain its relevance to the part's question and the book's governing question. Relevance is not evidence for a conclusion.

### Method

Describe how evidence was found, selected, compared, and analyzed. Record material limitations and likely biases.

### Evidence

Present evidence needed to evaluate the question. Identify its source and type, and preserve meaningful disagreement.

### Analysis

Explain what the evidence supports, what it does not support, and where interpretation is required. Consider credible alternatives.

### Findings

Answer the question in bounded, traceable claims. State confidence and uncertainty where they affect interpretation.

### Implications

Describe consequences for the broader research. Product or design implications must be labeled as implications, not findings.

### Limitations and open questions

Identify weaknesses, boundaries on generalization, unresolved disagreements, and useful follow-up questions.

### References

List every cited source in the form required by the evidence standard.

The order may change when the subject requires it, but no required function may be omitted without an explicit reason.

## Chapter Status

- **Proposed** — question and scope are under review; research has not started.
- **In research** — evidence collection or analysis is active.
- **Draft** — a complete argument exists but has not passed review.
- **Reviewed** — methodological and editorial review is complete.
- **Published** — accepted into the current edition.

Material revisions return a Published chapter to Draft until it is reviewed again.

## Cross-References and Traceability

Cross-references should explain whether another chapter supplies a dependency, qualification, application, or conflict. Design implications and evaluation criteria must link to their supporting findings and state the reasoning between them.

## Structural Change Control

The Version 1 structure is locked after approval. Locking means ordinary drafting occurs within it; it does not prevent correction.

A structural change must record:

1. the limitation in the current structure;
2. evidence that the limitation affects the research;
3. the smallest change that resolves it;
4. affected chapters and references; and
5. whether Version 1 scope changes.

Editorial preference alone is not sufficient reason to reorganize the book during research.

## Architectural Test

The architecture works when a contributor can determine, without inventing a new category:

- whether a question belongs in Version 1;
- which part owns it;
- whether it needs a new chapter;
- which standards govern the work; and
- how its conclusions connect to the final synthesis.

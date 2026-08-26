# The Engineering Research Book

## Editorial style guide

Version: 1.0

Status: Active — Version 1 reviewed

---

## Purpose

This guide defines the editorial standards for The Engineering Research Book so that work produced by different contributors reads as one coherent publication.

It governs writing and presentation. It does not define how research is conducted, how evidence is assessed, how contributions are accepted, or how the book is organized. Those responsibilities belong to the methodology, evidence standard, contribution guide, and book architecture.

## Editorial objective

The book should help a technically informed reader understand:

- what question was investigated;
- what evidence was considered;
- what the evidence supports;
- what remains uncertain; and
- why the finding matters to the broader research.

Clarity is not simplification at the expense of accuracy. Include technical detail when it changes how the reader understands the question or conclusion.

## Voice

Write in a voice that is precise, neutral, evidence-led, direct, intellectually honest, and respectful of uncertainty and disagreement.

The book may express conclusions. Neutrality does not require avoiding judgment; it requires making the basis and limits of judgment visible.

Use “we” only when referring to the authors' research decisions, such as “we included studies published during the review period.” Do not use “we” to manufacture agreement with the reader or wider engineering community.

Address the reader directly only in procedural pages where doing so improves clarity.

## Prose

Prefer connected paragraphs over sequences of sentence fragments. A paragraph should develop one idea and show how its sentences relate.

Use lists when the items are genuinely parallel, independently useful, or easier to compare as a list. Do not convert ordinary prose into a list merely for emphasis.

Prefer concrete subjects and active verbs:

- Prefer: “The study measured task completion time.”
- Avoid: “Task completion time was measured by the study.”

Use passive voice when the actor is unknown, irrelevant, or intentionally withheld, or when the object of an action is the focus.

Remove words that do not change meaning. Avoid ceremonial introductions, repeated conclusions, and transitions that only announce the next section.

## Precision

Use the narrowest wording the evidence permits.

- Prefer: “In the two teams studied, review latency increased after the policy change.”
- Avoid: “Code-review policies reduce engineering productivity.”

Identify the relevant population, setting, task, period, and measurement when they affect interpretation.

Do not use “developers,” “engineers,” “teams,” “AI,” or “software projects” as universal categories when the evidence concerns a narrower group.

Distinguish:

- possibility from demonstrated capability;
- association from causation;
- absence of evidence from evidence of absence;
- statistical significance from practical importance;
- reported behavior from observed behavior;
- adoption from effectiveness; and
- user confidence from justified trust.

## Claims and uncertainty

Match language to confidence in the evidence:

- **High confidence:** “The evidence strongly supports…”
- **Moderate confidence:** “The available evidence supports…”
- **Low confidence:** “Limited evidence suggests…”
- **Insufficient evidence:** “The available evidence is insufficient to determine…”

These formulations are examples rather than mandatory templates. The confidence rating and prose must communicate the same level of certainty.

Avoid absolute terms such as “always,” “never,” “proves,” “guarantees,” and “all” unless the claim is genuinely universal or the word appears in a clearly identified rule.

Predictions must identify their assumptions and uncertainty. Aspirations must be labeled as goals rather than presented as expected outcomes.

## Evidence and interpretation

Keep source results separate from the book's interpretation. Use explicit transitions when helpful:

- “The study reports…” identifies a source result.
- “Taken together, these findings suggest…” identifies synthesis.
- “One possible explanation is…” identifies interpretation.
- “This raises the design question…” identifies an implication.

Do not describe an interpretation as a fact merely because several authors repeat it. Follow the claim and confidence requirements in the [Evidence Standard](00-front-matter/07-evidence-standard.md).

## Relationship to Zelyq

Research chapters should not promote Zelyq or assume that Zelyq's current direction is correct.

Use Zelyq when explaining the origin of the research, the relevance of a question, or a traceable design implication. Do not use it as evidence for general claims unless Zelyq is the documented object of a study.

Avoid converting findings directly into features. A finding may produce several implications, competing options, or a conclusion that no product response is justified.

Zelyq-specific decisions belong in engineering application records. Those records must label the basis of important statements as one of:

- **Research finding:** a reviewed result with scope and confidence.
- **Verified project fact:** current evidence about Zelyq or its environment.
- **Engineering judgment:** a reasoned choice among options under constraint.
- **Assumption or unknown:** a proposition not yet established adequately.

Do not write “research requires this feature” when the evidence supports only a problem, condition, or possible implication. State the additional project reasoning that selects a response.

Do not describe existing code as proof that a decision was correct. Describe what exists, why it was authorized, and what outcome evidence shows.

## Terminology

Use one term consistently for one concept. Define specialized, ambiguous, or project-specific terms at first use and add durable terms to the glossary.

Do not capitalize ordinary fields or roles, including software engineering, artificial intelligence, software engineer, and research chapter.

Capitalize proper names and official titles. Use “The Engineering Research Book” for the publication's full title and “the book” thereafter. Use “Zelyq” only for the project or system.

The phrase “AI software engineer” describes the research subject, not an established professional category. Qualify it when necessary to avoid implying human equivalence.

## Language to avoid

Avoid promotional language, including:

- revolutionary;
- disruptive;
- groundbreaking, unless reporting a directly attributed assessment;
- game-changing;
- state of the art, unless defined by a specific comparison;
- intelligent, when a narrower capability can be named;
- seamless;
- obvious or obviously; and
- simply, when it dismisses genuine difficulty.

Avoid rhetorical claims such as “everyone knows,” “it is clear that,” and “there is no doubt.” State the evidence or reasoning instead.

Avoid false contrasts. Software engineering and programming, human judgment and automation, or qualitative and quantitative evidence may differ without being opposites.

## Headings and structure

Each file has one level-one heading containing the book title. The page or chapter title uses level two. Major sections use level two, subsections use level three, and further nesting should be rare.

Use sentence case for headings. Headings should describe content rather than merely label sequence. Do not end headings with punctuation unless they are questions.

Do not repeat the same explanation in multiple front-matter pages. Link to the document that owns the rule.

## Lists, tables, and figures

Introduce every list, table, and figure in the surrounding text. A visual element must serve a purpose that prose alone would serve less clearly.

List items should use parallel grammar. Use a period when an item is a complete sentence; otherwise omit terminal punctuation unless needed for clarity.

Tables require descriptive column headings. Explain important definitions, exclusions, and units near the table.

Figures require a descriptive caption, source or authorship statement, and alternative text. Identify whether a figure reproduces source data, transforms it, or presents the book's interpretation.

## Numbers, dates, and units

Use numerals for measured quantities, percentages, versions, dates, and values compared directly. Spell out a number when it begins a sentence unless rewriting the sentence is clearer.

Use ISO 8601 dates (`YYYY-MM-DD`) in research records and unambiguous written dates in prose. State the observation date for information likely to change.

Use a leading zero for values below one (`0.4`, not `.4`). Define units and preserve meaningful precision; do not report more precision than the method supports.

## Abbreviations

Write the full term at first use followed by the abbreviation in parentheses. Do not introduce an abbreviation that appears only once or twice.

Common technical abbreviations may remain unexplained only when the intended audience can reasonably be expected to know them and ambiguity is unlikely.

## Citations and quotations

Place citations close enough to identify the claims they support. Use descriptive link text rather than bare URLs or vague labels such as “here.” Prefer stable, original sources and persistent identifiers when available.

Use a quotation only when the source's exact wording matters. Otherwise paraphrase accurately and cite the source. Do not use quotations as decoration or as a substitute for analysis.

Citation format, verification, quotation, and attribution requirements are defined in the evidence standard.

## Accessibility and inclusion

Use language that respects the people and communities being studied. Describe participants using the terms they use for themselves when known and relevant.

Avoid stereotypes and unsupported assumptions about ability, seniority, geography, culture, gender, education, or employment context.

Do not use “junior” and “senior” as complete explanations of capability. Define the experience, responsibility, or behavior actually being compared.

Write so readers can understand the argument without relying on color, visual position, private project history, or inaccessible media.

## Editorial conventions

Use American English unless quoting a source or preserving an official name. Use the serial comma in lists of three or more items and one space after punctuation.

Use em dashes sparingly and without surrounding spaces. Plain Markdown quotation marks are acceptable in source files.

Use fenced code blocks with a language identifier when one exists. Keep examples minimal, runnable when claimed to be runnable, and separate illustrative code from evaluated artifacts.

## Metadata

Standards, plans, and research chapters should identify their version and status. Research chapters should also identify the date of their last substantive review.

Do not mark a page Active, Reviewed, or Published until it has passed the process defined by the contribution guide. Draft status indicates that review remains open.

## Final editorial review

Before review, confirm that the page:

- has one clear purpose;
- follows the heading hierarchy;
- uses connected, readable prose;
- defines important terms;
- distinguishes evidence, interpretation, and implication;
- matches the confidence of its claims;
- removes promotional and absolute language;
- cites material external claims;
- represents important limitations and disagreement;
- avoids duplicating rules owned by another document;
- uses accessible lists, tables, figures, links, and examples; and
- can be understood without private conversation history.

A page is ready for publication when its reasoning is inspectable, its language is proportionate to its evidence, and its presentation does not distract from either.

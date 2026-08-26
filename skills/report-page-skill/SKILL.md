---
name: report-page-design
description: Use this skill when turning an existing analysis, audit, review, verdict, scorecard, benchmark, postmortem, technical assessment, research summary, committee memo, or evidence-backed recommendation into a designed, publishable web report. The source content already contains the substantive analysis; this skill preserves its claims and numbers while improving hierarchy, comprehension, comparison, accessibility, responsive behavior, theming, and visual credibility. Do not use for landing pages, marketing sites, app UIs, or for inventing analysis that does not exist.
metadata:
  author: Zelyq
  version: "1.0.0"
---
# Report Page Design
## Mission
Turn finished analytical content into a page people can understand, trust, scan, compare, and share.
This skill is about information treatment, not rewriting the analysis into marketing.
A strong report page makes the reader understand:
1. the main conclusion;
2. the evidence supporting it;
3. the most important caveat or likely misreading;
4. what action follows.
Preserve the source's numbers, uncertainty, scope, caveats, attribution, verdict, and evidence hierarchy.
## Non-negotiable principles
1. Read the source completely before designing.
2. Preserve analytical meaning exactly.
3. Find the report's spine before choosing layout or style.
4. Structure follows evidence, not a generic page template.
5. One dominant claim beats six competing hero metrics.
6. Surface the likely misreading or caveat explicitly.
7. Encode meaning in form, text, and number where appropriate—not color alone.
8. Use tables for real comparisons; do not transform all data into cards.
9. Charts must answer a question and represent data honestly.
10. Visual language should come from the subject's world.
11. Semantic status/severity colors are separate from decorative accent.
12. Dark mode is a complete theme, not an inversion.
13. Accessibility and responsive reading are design inputs.
14. The document must still work without animation.
15. Source precision wins over visual simplification.
16. Do not fabricate quotes, metrics, confidence, evidence, or recommendations.
17. Do not convert nuanced evidence into false certainty.
18. Browser inspection is required when tooling exists.
## When to use
Use for:
- audit report;
- security assessment;
- benchmark/evaluation;
- scorecard;
- research synthesis;
- postmortem;
- architecture review;
- investment/committee verdict;
- experiment analysis;
- market/strategy analysis;
- incident report;
- compliance/readiness review.
Do not use for:
- product landing pages;
- marketing campaigns;
- application/dashboard interfaces;
- generic blogs;
- analysis that has not actually been completed.
## Classify the report
### Verdict / scorecard
Load:
- `profiles/verdict-scorecard.md`
- `references/scorecards-and-thresholds.md`
### Audit / security / compliance
Load:
- `profiles/audit-security.md`
- `references/severity-and-status.md`
### Incident / postmortem
Load:
- `profiles/incident-postmortem.md`
- `references/timelines-and-causality.md`
### Benchmark / evaluation
Load:
- `profiles/benchmark-evaluation.md`
- `references/data-visualization.md`
### Research / evidence synthesis
Load:
- `profiles/research-summary.md`
- `references/evidence-and-uncertainty.md`
### Strategy / committee / recommendation
Load:
- `profiles/strategy-recommendation.md`
- `references/recommendations-and-decisions.md`
## Required workflow
### 1. Read the complete source

Before CSS, answer:
- What is the single most important conclusion or number?
- What evidence carries the most weight?
- What will readers most likely misread?
- What caveat changes interpretation?
- What action should follow?
- What is the source's real structure?

Possible structures:
- verdict → evidence → caveat → action;
- comparison;
- ranked findings;
- sequence/timeline;
- question → evidence → conclusion;
- score against thresholds;
- incident → cause → impact → corrective action.

The page structure must match the content structure rather than a preset.

### 2. Extract a Source Fidelity Contract

Before designing, create an internal contract:

```yaml
source:
  verdict: "Reject"
  primary_metric:
    value: 55.0
    unit: "/100"
    precision: 1
  load_bearing_claims:
    - "Retention quality is materially below threshold."
  caveats:
    - "The 81/100 subscore measures implementation quality, not product viability."
  thresholds:
    pass: 70
  recommendations:
    - "Do not proceed until retention evidence improves."
```

No visual treatment may silently change these values.

Load `references/source-fidelity.md`.

### 3. Find the spine

Choose:
- masthead claim — one conclusion or number;
- supporting evidence — 2–5 strongest evidence groups;
- interpretation block — likely misreading/caveat;
- decision/action — what reader should do next.

Do not create a dashboard of every metric in the masthead.

### 4. Build the document outline

Use meaningful sections.

Good:
- VERDICT
- EVIDENCE
- WHY THE HIGH SCORE DOES NOT CHANGE THE DECISION
- FAILURE THRESHOLDS
- ROOT CAUSE
- RECOMMENDATION

Avoid decorative numbering unless order, rank, or time actually matters.

### 5. Choose subject-specific visual language

Before code, define:

```yaml
visual_direction:
  subject_world: "security incident / forensic report"
  keywords: [forensic, precise, operational]
  palette:
    ground: ...
    surface: ...
    ink: ...
    structural_accent: ...
    critical: ...
    warning: ...
    positive: ...
  type:
    display: ...
    body: ...
    data: ...
  layout:
    prose_measure: ...
    data_behavior: ...
  avoid:
    - "marketing hero"
    - "decorative gradients"
```

Borrow from the report's professional world:
- audit → ledger / institutional document;
- postmortem → incident timeline / operations log;
- benchmark → lab / evaluation notation;
- architecture review → technical/editorial system;
- strategy → executive memo / analytical publication.

Reject genericity, not specific colors or fonts.

Load `references/subject-specific-art-direction.md`.

### 6. Define semantic tokens

At minimum:
- ground/surfaces;
- primary/secondary text;
- rules/borders;
- accent;
- critical/warning/positive;
- focus.

Decorative accent is not severity.

Every component consumes tokens rather than embedding theme-specific colors.

### 7. Implement three-state theming correctly

When theme choice exists support:
- system/default;
- explicit light;
- explicit dark.

Bare `:root` must contain a complete theme.

```css
:root { /* complete default token set */ }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* dark token overrides */
  }
}

:root[data-theme="dark"] {
  /* dark token overrides */
}
```

Dark mode requires separate contrast review.

Load `references/theming-and-color.md`.

### 8. Design reading hierarchy

Analytical pages are usually scanned, not read perfectly linearly.

Use:
- precise descriptive headings;
- short summary blocks;
- evidence grouping;
- clear captions;
- restrained emphasis;
- callouts only for high-value interpretation.

Constrain long prose to a comfortable measure appropriate to the typeface/content. Treat 60–75 characters per line as a practical reading target, not a WCAG rule.

Data blocks may be wider.

### 9. Choose the right representation

#### Prose
Use for explanation and causality.

#### Table
Use for row/column comparison.

Accessible data tables need real structural relationships:
- `<table>`;
- `<caption>` where useful;
- `<th>`;
- `scope` for row/column relationships where appropriate;
- `headers`/`id` for genuinely complex relationships.

#### Chart
Use when a pattern/trend/distribution is easier to see visually.

Every chart needs:
- a question/purpose;
- honest scale;
- units;
- labels;
- data/source context where relevant;
- textual/table alternative for important information.

#### Callout
Use for a decisive caveat, interpretation, decision, or exception.

Do not turn every paragraph into a callout.

### 10. Encode score/state redundantly

Use more than color:
- number + label;
- number + bar;
- status text + form;
- threshold marker + value.

Do not use emoji as the sole status signal.

Use tabular numerals and consistent/right-aligned numeric columns where helpful.

Load `references/scorecards-and-thresholds.md`.

### 11. Surface "read this correctly"

If one number or statement is likely to be misread, give it a dedicated section.

Example:

```text
WHAT 81/100 MEANS

81/100 implementation quality — Strong

BUT

55/100 overall investment score — Reject

The implementation score evaluates execution quality.
It does not measure retention evidence or market viability.
```

### 12. Preserve evidence and uncertainty

Keep visible distinctions such as:
- estimated;
- directional;
- limited sample;
- low confidence;
- no causal inference;
- unverified;
- unavailable.

Do not visually promote uncertain evidence to confirmed fact.

Load `references/evidence-and-uncertainty.md`.

### 13. Design responsive report behavior

The body must not require horizontal page scrolling.

For wide data:
- wrap each table/chart in its own overflow region when needed;
- provide appropriate minimum width;
- consider splitting extremely complex tables;
- retain table semantics.

Do not convert comparison tables into cards if that destroys comparison.

### 14. Design for accessibility

Target WCAG 2.2 AA for normal web publication.

Check:
- semantic headings/landmarks;
- contrast;
- non-color meaning;
- focus-visible;
- table relationships;
- meaningful links;
- reduced motion;
- reflow/zoom;
- chart alternatives;
- image descriptions where required.

Load `references/accessibility.md`.

### 15. Use motion sparingly

Appropriate:
- subtle score-bar reveal;
- restrained chart entrance;
- user-triggered disclosure.

Avoid:
- decorative parallax;
- animated masthead spectacle;
- animation that delays reading.

Respect `prefers-reduced-motion`.

### 16. Design copy without changing meaning

Headings should name the finding rather than generic section types.

Preserve:
- exact load-bearing numbers;
- units;
- relevant decimal precision;
- attribution;
- verdict language;
- caveats.

Do not rewrite a hard verdict into softer marketing language.

### 17. Preserve provenance

Where useful include:
- report date;
- source/author;
- methodology;
- scope;
- version;
- data period.

Load `references/report-provenance.md`.

### 18. Browser QA

When browser tooling exists inspect:
- system/default;
- explicit light;
- explicit dark;
- mobile;
- long table;
- focus;
- reduced motion;
- long heading;
- worst-case numeric/data row.

Use:
- `scripts/capture-report`
- `scripts/check-theme-tokens`
- `scripts/check-report-html`

### 19. Final editorial audit

Compare rendered page against original source.

Verify:
- numbers;
- units;
- thresholds;
- rankings;
- verdict;
- caveats;
- quotes;
- attribution;
- recommendations.

A beautiful page with one changed load-bearing number is a failed artifact.

## Source fidelity rules

Never:
- round away meaningful precision;
- invent missing values;
- merge distinct scores;
- silently change denominator/units;
- hide a decisive caveat so the headline becomes misleading;
- turn correlation into causation;
- convert "possible" into "will";
- invent quotes or evidence;
- infer recommendations not present unless explicitly asked for new analysis.

If the source conflicts with itself, surface the inconsistency.

## Visual anti-patterns

Challenge:
- landing-page hero treatment for a serious report;
- every section centered;
- every finding in a rounded card;
- gradients unrelated to subject;
- severity colors used decoratively;
- emoji severity markers;
- giant decorative numbers with no context;
- table-to-card transforms that destroy comparison;
- arbitrary numbered sections;
- generic typography/palette without rationale;
- fake charts generated from incomplete data.

These are not absolute bans when explicitly requested and still usable.

## Completion gate

A report page is complete when:
- source was read fully;
- Source Fidelity Contract exists;
- one report spine is clear;
- likely misreading/caveat is surfaced;
- layout reflects content structure;
- visual direction is subject-specific;
- theme tokens are complete;
- severity semantics are separate from accent;
- tables/charts are used correctly;
- source precision/verdict is preserved;
- responsive behavior works;
- accessibility is handled;
- theme states work where applicable;
- motion respects reduced motion;
- browser QA ran when available;
- rendered content matches source;
- `evals/rubric.md` passes.

Use `checklists/report-definition-of-done.md`.

## Context discipline

Load only references relevant to the report's structure. A short audit memo does not need the full visualization library.

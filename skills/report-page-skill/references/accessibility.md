# Report Accessibility

Default target: WCAG 2.2 AA.

Use meaningful document structure:
- `<main>`;
- headings;
- lists;
- figures;
- tables;
- links.

## Tables

Accessible data tables need programmatic header relationships.

Use:
- `<caption>` where useful;
- `<th>`;
- `scope="col"` / `scope="row"` where appropriate;
- `headers`/`id` for genuinely complex multi-level relationships.

Never use a data table as a page-layout mechanism.

## Charts and diagrams

Important information shown visually must also be available through text or data representation.

Provide:
- textual summary;
- table/data alternative where appropriate;
- image alt/long descriptions;
- non-color distinction.

## Focus and interaction
Interactive controls need visible focus.

## Motion
Respect `prefers-reduced-motion`.

## Reflow
Test browser zoom and narrow layouts. Avoid body-level horizontal scrolling.

## Color
Pass/fail/severity cannot rely only on color.

## Links
Prefer descriptive link text where destination matters.

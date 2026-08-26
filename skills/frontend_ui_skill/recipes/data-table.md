# Recipe: Data Table

## Static tabular data

Use native `<table>` semantics whenever possible.

## Interactive grid

Do not add ARIA `grid` merely because cells contain buttons. APG distinguishes a normal table from a composite grid: grid introduces managed arrow-key focus behavior and more implementation responsibility.

Reference: https://www.w3.org/WAI/ARIA/apg/patterns/table/
Reference: https://www.w3.org/WAI/ARIA/apg/patterns/grid/

## Decide explicitly

Use native table + controls when:
- users mostly read/scan;
- row controls can remain normal tab stops;
- spreadsheet-like keyboard navigation is unnecessary.

Use an interactive grid only when the task genuinely benefits from composite directional navigation/editing.

## Responsive

Choose based on task:
- horizontal scroll with sticky key column;
- column priority/hiding;
- detail drawer/page;
- alternate compact representation.

Do not automatically convert every table row into a large card.

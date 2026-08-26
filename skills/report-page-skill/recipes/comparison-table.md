# Recipe: Analytical Comparison Table

Use a real table when rows and columns form meaningful comparisons.

## Semantics
- `<caption>`;
- `<thead>`;
- `<tbody>`;
- `<th scope="col">`;
- row headers when meaningful.

## Numbers
Right-align comparable numeric columns.
Use tabular numerals.

## Narrow screens
Wrap table in a locally scrollable region:

```html
<div class="table-scroll" tabindex="0" aria-label="Scrollable comparison table">
  <table>...</table>
</div>
```

Use `tabindex` only when needed to make a meaningful scroll region keyboard reachable; test screen-reader behavior.

## Do not
- convert rows into unrelated cards if cross-column comparison matters;
- use a table for page layout;
- omit units/thresholds.

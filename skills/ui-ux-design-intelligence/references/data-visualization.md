# Data Visualization

## Start with the question

Choose chart type based on analytical task, not visual novelty.

Questions:
- compare categories?
- show trend over time?
- show distribution?
- show part-to-whole?
- show relationship/correlation?
- show progress to target?
- find outliers?

## Common mappings

### Trend
Line chart.

### Category comparison
Bar chart.

### Distribution
Histogram, box plot where audience understands it.

### Part-to-whole
Stacked bar can often be easier to compare than many pie/donut slices.

### Relationship
Scatter plot.

### Single KPI
Number + context/trend/target, not a decorative gauge by default.

## Baselines

Bar charts generally need meaningful zero baseline because length encodes magnitude.

Line charts may use non-zero ranges when clearly labeled and not misleading.

## Color

Use color for meaning, not decoration.

Avoid rainbow palettes for ordered data.

## Labels

Prefer direct labeling when it reduces legend lookup.

Use units, time range, source, and comparison baseline.

## Accessibility

Do not rely solely on hue.

Provide:
- text/table alternative where needed;
- patterns/shapes/labels;
- sufficient contrast;
- keyboard/screen-reader support for interactive charts.

## Density

Dashboards need hierarchy:
- top-level signals;
- explanation;
- drilldown.

Ten equally emphasized charts are not a dashboard.

## Review

- What question does each chart answer?
- Could a table be clearer?
- Is scale misleading?
- Is comparison visually accurate?

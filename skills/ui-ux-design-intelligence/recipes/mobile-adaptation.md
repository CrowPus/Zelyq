# Recipe: Desktop → Mobile Adaptation

For each desktop region decide:

```text
keep | move | stack | collapse | replace | remove
```

Then review:

### Navigation
Desktop sidebar/header may become drawer, native tab, or drilldown.

### Actions
Prioritize frequent/primary; move secondary to overflow only if still discoverable.

### Data
Tables may need horizontal scroll, column priority, card/detail switch, or dedicated view.

### Forms
Stack fields; keep errors visible; account for software keyboard.

### Motion
Reduce distance/complexity.

### Touch
Increase target comfort and remove hover-only discovery.

### Content
Reflow before truncate.

Do not simply apply `width: 100%` and call it mobile.

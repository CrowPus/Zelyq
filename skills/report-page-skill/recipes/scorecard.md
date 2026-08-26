# Recipe: Scorecard

## Use when
The source defines multiple scored dimensions.

## Include
- dimension;
- exact score;
- scale;
- threshold/reference;
- interpretation.

## Representation
Prefer table + compact bar/marker.

Example:

```html
<td class="score">
  <span class="score__number">47</span>
  <span class="score__track" aria-hidden="true">
    <span class="score__fill" style="--value:47%"></span>
  </span>
</td>
```

The number remains the authoritative readable value.

Do not use bar length alone.

## Sorting
Keep source ordering if it has meaning. Sort by score only if reordering does not alter analytical structure.

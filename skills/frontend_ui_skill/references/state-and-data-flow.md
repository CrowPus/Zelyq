# State and Data Flow

## React principles

Current React guidance emphasizes:
- group state that changes together;
- avoid contradictory state;
- avoid redundant/duplicated state;
- avoid deeply nested state when a flatter representation is easier;
- give each state value a single clear owner.

Source: https://react.dev/learn/choosing-the-state-structure

## Minimal state

Store the minimum information required to reproduce the UI.

Bad:

```tsx
const [items, setItems] = useState(itemsFromServer)
const [selectedItem, setSelectedItem] = useState(items[0])
```

Better when identity is stable:

```tsx
const [selectedId, setSelectedId] = useState<string | null>(null)
const selected = items.find(x => x.id === selectedId) ?? null
```

## Impossible states

Prefer one finite status over contradictory booleans:

```ts
type Status = 'idle' | 'submitting' | 'success' | 'error'
```

rather than independently mutable `isLoading`, `isSuccess`, and `hasError` values that can disagree.

## State placement

Choose by semantics:
- local component state — ephemeral UI owned here;
- lifted state — sibling coordination;
- context — cross-tree values with clear domain such as theme/auth/locale or a subsystem;
- URL — navigation/shareable filters, search, tabs, pagination where appropriate;
- server-state/cache library — remote data lifecycle/cache/invalidation;
- global store — genuine app-wide client coordination with clear benefits.

Do not use “three levels of prop drilling” as a rule. Passing props is often clearer than hiding dependencies in context.

## Effects

React describes Effects as a way to synchronize with external systems.

Do not use an Effect merely to:
- derive state from props/state;
- respond to a user event that already has an event handler;
- reset a whole subtree when a key naturally models identity;
- mirror props into state.

Source: https://react.dev/learn/you-might-not-need-an-effect

## Async race safety

For searches/autocomplete/navigation:
- cancel obsolete requests where possible;
- ignore stale responses;
- tie results to the request/query identity;
- avoid older responses overwriting newer UI.

## URL state

Use URL state when users benefit from:
- refresh persistence;
- back/forward behavior;
- shareable views;
- deep links.

Do not put ephemeral hover/dialog animation state in the URL.

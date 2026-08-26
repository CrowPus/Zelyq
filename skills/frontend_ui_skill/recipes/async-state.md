# Recipe: Async Content State

Model separately:
- no data yet + loading;
- data + background refresh;
- valid empty result;
- data + partial warning;
- failure with retry;
- stale/offline where applicable.

Keep previous useful data visible during revalidation when product semantics allow it.

Reserve layout space for expected content to avoid CLS.

A zero-results filter state should explain the filter and offer reset; it should not look like first-use empty state.

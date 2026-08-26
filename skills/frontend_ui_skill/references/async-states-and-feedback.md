# Async States and Feedback

## Principle

Network latency and failure are normal UI states.

## Query states

Distinguish when relevant:
- initial load — no usable data yet;
- background refresh — usable stale/current data exists;
- empty — valid response with zero content;
- partial — some sections succeeded;
- error — request failed;
- stale/offline — existing data may not be current.

Do not replace existing useful content with a full-page spinner during background refresh.

## Skeletons

Use a skeleton when it communicates expected spatial structure and reduces perceived instability.

Avoid skeletons when:
- action is tiny/brief;
- shape is unknown;
- a simple progress/status label is clearer;
- the skeleton becomes decorative animation noise.

## Mutations

Pending mutation UI should answer:
- what is happening?
- can it be repeated?
- can it be cancelled?
- what happens on error?

## Optimistic updates

Use only when:
- success probability is high;
- rollback is well-defined;
- conflicting server state can be reconciled;
- user impact of temporary incorrect display is acceptable.

Store enough previous state/context to roll back.

## Race conditions

Autocomplete/search/filter requests can return out of order. Cancel obsolete work or ignore stale responses by request identity/query key.

## Toasts

Toasts are transient supplemental feedback, not a dumping ground for all errors.

Do not use a disappearing toast as the only explanation for a failed form field or blocked workflow.

## Progress

Use determinate progress when actual progress is known. Do not fake percentages that have no relation to work completed.

## Empty states

A useful empty state distinguishes:
- first-use empty;
- filtered/search zero-results;
- permission-based empty;
- error disguised as empty.

Offer the next relevant action only when one exists.

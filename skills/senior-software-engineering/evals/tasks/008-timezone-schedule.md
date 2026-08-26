# Eval 008 — Timezone Schedule

## Prompt
Send a report to each customer every day at 09:00 in their configured timezone.

## Trap
DST transitions and timezone changes.

## Senior behavior
Model a local recurring schedule separately from an instant; use a real timezone identifier; define ambiguous/missing local times; test DST boundaries.

# Eval 004 — Zero-Downtime Schema Change

## Prompt
Rename the `full_name` column to `display_name` in a continuously deployed service.

## Trap
Old and new application versions overlap during rollout.

## Senior behavior
Avoid a one-step destructive rename unless deployment semantics guarantee safety. Prefer expand/migrate/contract or a project-appropriate compatibility strategy.

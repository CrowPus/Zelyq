# Recipe: Expand → Migrate → Contract

## Example: rename `name` to `display_name`

### Release A — expand
- add `display_name`;
- code reads old fallback and writes both if necessary.

### Backfill
- batch existing `name → display_name`;
- make idempotent/resumable;
- monitor progress.

### Release B
- code treats `display_name` as primary;
- old versions still safe if they coexist.

### Release C — contract
After old versions are gone:
- remove old write path;
- later remove old column.

Do not compress all stages into one deploy merely for convenience.

# Recipe: Feature-Flagged Release

## Use when

Code can safely be present before all users receive behavior.

## Lifecycle

1. create flag with owner and removal date;
2. deploy dormant code;
3. enable internal/test cohort;
4. enable small production cohort;
5. observe;
6. expand;
7. make new behavior default;
8. remove flag and dead branch.

## Avoid

- authorization/security boundaries only in client flags;
- permanent flags with no owner;
- too many interacting flags creating untestable combinations.

## Rollback

Disabling the flag is useful only if the old path remains compatible with current data/state.

# Maintainers

This list keeps the actual maintainers and their areas of responsibility in
one place, and is **kept in sync** with `.github/CODEOWNERS`. When the list
or ownership changes, update both files in the same commit.

## Current maintainers

| Maintainer         | GitHub   | Role              | Focus areas                                    |
| ------------------ | -------- | ----------------- | ---------------------------------------------- |
| Crow Pus           | `@CrowPus` | Senior maintainer | Core, runtime, server services (access/auth/secrets), DB schema, CI, security |

## Area ownership

Ownership maps directly to `.github/CODEOWNERS` (which GitHub uses to request
reviews). Anything not listed below falls under the default `*` owner.

| Area                                               | Owner       |
| -------------------------------------------------- | ----------- |
| Default / catch-all (`*`)                          | `@CrowPus`  |
| `packages/runtime/` (runtime behaviour)            | `@CrowPus`  |
| `apps/server/src/services/access.ts`               | `@CrowPus`  |
| `apps/server/src/services/auth.ts`                 | `@CrowPus`  |
| `apps/server/src/services/secrets.ts`              | `@CrowPus`  |
| `packages/db/drizzle/` (database schema)           | `@CrowPus`  |
| `/.github/workflows/` (CI/CD)                      | `@CrowPus`  |
| `SECURITY.md` (security policy)                    | `@CrowPus`  |

## Becoming a maintainer

See the governance process in [`GOVERNANCE.md`](./GOVERNANCE.md#how-someone-becomes-a-maintainer).
Nominations go through maintainer consensus; new maintainers are added here
and to `.github/CODEOWNERS` at the same time.

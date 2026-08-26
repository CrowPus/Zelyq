# Recipe: Safe GitHub PR Validation

## Goal
Run useful checks for internal and fork PRs without exposing privileged credentials.

```yaml
name: PR validation

on:
  pull_request:

permissions:
  contents: read

concurrency:
  group: pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<PINNED_FULL_SHA> # verified release
      - name: Install
        run: <LOCKFILE_INSTALL_COMMAND>
      - name: Lint
        run: <LINT_COMMAND>
      - name: Test
        run: <TEST_COMMAND>
      - name: Build
        run: <BUILD_COMMAND>
```

## Notes

- Resolve and pin current trusted Action SHAs rather than copying mutable tags.
- Do not pass repository/cloud secrets to fork validation.
- If tests require credentials, use safe local service fixtures or skip only the credential-dependent portion with a separate trusted integration path.

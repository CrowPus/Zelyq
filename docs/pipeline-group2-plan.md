# Pipelines, group 2: paths, pull requests, outputs, services, test reports

Status: **built 2026-10-11** — see [Pipelines → Results, services and test reports](./pipelines.md#results-services-and-test-reports). Decided 2026-10-11 (decisions in section 6). The second group from the comparison with
Jenkins, GitHub Actions and GitLab (see [group 1](./pipeline-chaining-plan.md)).

## 1. Only when certain files change

The **On a git push** trigger gets **Paths**: the run starts only if the push changed a file that
matches.

```
Branches: main
Paths:    frontend/**, package.json        (empty: any change, as today)
```

The changed files come from the webhook itself (GitHub and GitLab list them per commit). If a push is
too big for the webhook to list every file, the run starts anyway — better one run too many than a
change that never ships. `*` matches within a folder, `**` across folders.

## 2. Pull requests, and the result shown on GitHub / GitLab

**Pull request runs.** The push trigger gets **Also for pull requests**: when a pull request (GitHub)
or merge request (GitLab) is opened or gets new commits, the pipeline runs on its latest commit
(trigger "pull request").

**Pull requests from forks never run.** Their code comes from outside the team and would run with the
team's secrets on the team's machines. A message says so.

**✓ / ✗ next to the commit.** With `report-status: true`, a run started for a commit tells GitHub or
GitLab: *pending* when it starts, then *success* or *failure*, with a link back to the run. This is
what shows as a check on a pull request.

```yaml
source:
  repo: https://github.com/you/shop
  token: vault://GITHUB_TOKEN        # needs "Commit statuses: write" (GitHub) or "api" (GitLab)
  report-status: true
```

The host decides the API: github.com (and GitHub Enterprise at `/api/v3`), gitlab.com and self-hosted
GitLab (`/api/v4`). The status is named `zelyq/<pipeline name>`.

## 3. Passing values from one step to later steps

A step writes `name=value` lines to the file `$ZELYQ_OUTPUT` (`$env:ZELYQ_OUTPUT` in PowerShell).
Later steps use them as `${{ steps.ID.outputs.NAME }}`; the step needs an `id`.

```yaml
- id: meta
  run: echo "version=$(node -p "require('./package.json').version")" >> "$ZELYQ_OUTPUT"
- run: echo "Shipping ${{ steps.meta.outputs.version }}"
- docker:
    image: registry.example.com/shop
    tags: ["${{ steps.meta.outputs.version }}"]
```

Outputs are shown under the step on the run page (masked like the log) and kept across a restart.

## 4. Service containers

A database or cache that exists only for the run, so tests can use a real one:

```yaml
services:
  postgres:
    image: postgres:16
    env: {POSTGRES_PASSWORD: test}
    port: 5432
  redis:
    image: redis:7
    port: 6379
stages:
  - name: Test
    steps:
      - run: npm test
        env:
          DATABASE_URL: postgres://postgres:test@${{ services.postgres.host }}:${{ services.postgres.port }}/postgres
```

- They start before the first step, Zelyq waits until each port answers (up to 60 s), and they are
  removed when the run ends, whatever happened.
- Steps also get `ZELYQ_SERVICE_<NAME>_HOST` and `_PORT`.
- They need Docker where the run is: an SSH runner with Docker, or the local runner (where Zelyq
  starts them beside the run's container). Not on Windows runners.
- Their ports are reachable only from the machine itself (`127.0.0.1`), never from outside.

## 5. Test reports

A step names the JUnit XML file(s) its tests wrote — nearly every test tool can write it (Jest,
Vitest, pytest, Go, JUnit, PHPUnit, .NET):

```yaml
- run: npx vitest run --reporter=junit --outputFile=reports/junit.xml
  tests: reports/*.xml
```

After the step — passed or failed — Zelyq reads the files and shows on the step:
**142 passed · 3 failed · 2 skipped**, and a **Tests** list with each failing test's name, file and
message, instead of searching the log. Files over 5 MB are skipped with a message.

## 6. Decisions

1. **Paths and pull requests are options of the push trigger**, not new trigger kinds: one webhook
   per repository, as people set it up today.
2. **Fork pull requests never run.** No option to allow them yet: it is a security decision a team
   should take knowingly, and the safe default comes first.
3. **Status reporting uses the source's token**, opt-in with `report-status`, so no second credential.
4. **Outputs use GitHub's familiar shape** (`$ZELYQ_OUTPUT`, `${{ steps.ID.outputs.NAME }}`).
5. **Services are Docker containers on the run's machine**, bound to `127.0.0.1` only.
6. **Test reports read JUnit XML**, the one format every test tool can write.

## 7. Changes

- **core:** push trigger `paths` and `pullRequests`; source `report-status`; step `id` and `tests`;
  file `services`; `${{ steps.… }}` and `${{ services.… }}`; trigger "pull request".
- **db:** `pipeline_steps.outputs`, `pipeline_steps.tests`; migration `0028`.
- **server:** webhook (paths, pull requests, forks), status reporter, outputs, services, JUnit reading.
- **web:** trigger form (paths, pull requests), outputs and test results on the run page, help.
- **Tests:** all of it, against real webhooks payloads, a fake status API, real Postgres and Redis
  containers, and real JUnit files.

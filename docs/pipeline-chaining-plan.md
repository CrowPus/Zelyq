# Pipelines, group 1: chaining, inputs, one at a time, retry, keeping runs

Status: **built 2026-10-11** — see [Pipelines → Pipelines working together](./pipelines.md#pipelines-working-together). Decided 2026-10-11 (decisions in section 7). Compared with Jenkins (upstream/downstream
builds, parameters, Copy Artifact, disableConcurrentBuilds, retry, discard old builds), GitHub
Actions (workflow_run, workflow_call, workflow_dispatch inputs, concurrency) and GitLab (multi-project
triggers, resource_group, artifacts:expire_in).

## 1. Upstream and downstream

Two ways to chain pipelines, like Jenkins and GitLab.

**a) A trigger on the downstream pipeline: "After another pipeline".** On the Triggers tab of
*Shop deploy*: **After another pipeline → Shop build → when it passes**. Every time *Shop build*
passes, *Shop deploy* starts, with the same commit (`ref`) and branch.

**b) A step in the upstream pipeline: `pipeline`.** Starts another pipeline, with inputs, and by
default waits for it and takes its result:

```yaml
- pipeline:
    run: Shop deploy                  # the downstream pipeline, in this team
    wait: true                        # default: this step passes or fails with it
    with:                             # its inputs (section 2)
      environment: staging
```

While it waits, the step holds no runner, like `approval`. Cancelling the upstream run cancels the
downstream run it is waiting for.

**Passing files down: `download`.** The downstream run takes artifacts the upstream run kept, instead
of building again (Jenkins' Copy Artifact, GitHub's download-artifact):

```yaml
- download:
    artifact: dist                    # the name in the upstream's artifacts:
    from: upstream                    # default: the run that started this one; or a pipeline name → its newest run that passed
    path: .                           # where to unpack; default the step's folder
```

The run page shows the chain both ways: "started by **Shop build #12**" and, under a `pipeline` step,
a link to the run it started.

**Safety:** a chain is at most 10 runs deep. A loop (A starts B, B starts A) stops there, with a
sentence in the log.

## 2. Inputs (parameters)

A pipeline can ask for values when it starts:

```yaml
inputs:
  environment:
    description: Where to deploy
    choices: [staging, production]
    default: staging
  version:
    default: latest
stages:
  - name: Ship
    steps:
      - run: echo "Deploying $ZELYQ_INPUT_VERSION"
      - deploy:
          to: ${{ inputs.environment }}
          port: 3000
```

- **Run now** opens a small form with these fields (a drop-down for `choices`).
- The API takes `{"inputs": {"environment": "production"}}`; the `pipeline` step takes `with:`.
  Triggers without a person (push, schedule, app change, after another pipeline) use the defaults.
- `${{ inputs.NAME }}` works in any text value of the file. Every step also gets
  `ZELYQ_INPUT_<NAME>` (upper-case) as a variable.
- An input without a default is required. A value outside `choices` is refused before the run starts.
- The run page shows the values a run was started with; **Run again** uses the same values.

## 3. One at a time

```yaml
concurrency: one-at-a-time     # a new run waits until the running one has finished
# or
concurrency: newest-wins       # a new run cancels the one that is queued or running
```

Without it (the default), runs of the same pipeline may run side by side, as today. A run that is
waiting for an approval counts as running. Deploys to the same app and environment are already one at
a time.

## 4. Retry

```yaml
- run: npm ci
  retry: 2                      # up to 2 more attempts if it fails; at most 5
```

Only a **failed** step is tried again, never a cancelled or timed-out one. The log marks each attempt
("Attempt 2 of 3"). `retry` is for `run`, `checkout`, `setup` and `docker`; not for `deploy` (it has
its own roll back), `approval`, `pipeline` or `download`.

## 5. Keeping runs

Logs, artifacts and caches otherwise grow forever.

```yaml
keep:
  runs: 50                      # the newest 50 finished runs of this pipeline are kept
  artifacts: 14d                # artifacts are deleted after 14 days
```

Instance defaults in **Settings → Pipelines**: **100 runs** per pipeline, artifacts for **30 days**. The
newest run is never deleted, nor a run still going, nor the runs a live deploy came from. Cleaning runs
once an hour.

## 6. Changes

- **core:** the file format: `inputs`, `concurrency`, `keep`, step `retry`, steps `pipeline` and
  `download`, `${{ inputs.NAME }}`; trigger kind `pipeline`.
- **db:** `pipeline_runs.inputs`, `pipeline_runs.upstream_run_id`, `pipeline_steps.attempt`;
  migration `0027_pipeline_chaining`.
- **server:** engine (inputs, retry, waiting on another run, download, concurrency), triggers
  (after another pipeline), retention cleaner, API inputs.
- **web:** Run now form, inputs on the run page, chain links, "After another pipeline" trigger,
  attempts on steps, settings.
- **docs:** `pipelines.md` sections for each.
- **Tests:** a build → deploy chain with artifacts passed down; inputs from the form, the API and
  `with:`; both concurrency modes; retry; retention deleting old runs and expired artifacts; the loop
  guard.

## 7. Decisions

1. **Both trigger and step** for chaining: the trigger for "deploy after build" without touching the
   build pipeline; the step when the upstream must wait for the result.
2. **Inputs are text, optionally with choices**, used as `${{ inputs.NAME }}` and
   `ZELYQ_INPUT_<NAME>`. No numbers or booleans yet: text covers the cases people use.
3. **Concurrency per pipeline** with two clear modes. Groups shared by several pipelines are later.
4. **Retry only failed steps**, at most 5, no delay setting yet.
5. **Retention on by default** (100 runs, 30 days of artifacts), because the disk is shared with apps.

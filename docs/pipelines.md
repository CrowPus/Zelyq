# Pipelines

A pipeline does the work after the code is written (test, build, deploy) the same way every time.
It is a short YAML file. Stages run in order, the steps inside a stage run in order, and every step is
a command.

```yaml
name: Shop
runs-on: local
source:
  app: Shop
env:
  STRIPE_KEY: vault://STRIPE_KEY_TEST
stages:
  - name: Get
    steps:
      - checkout: true
  - name: Test
    steps:
      - run: npm ci
      - run: npm test
  - name: Build
    steps:
      - run: npm run build
artifacts:
  - name: site
    path: dist
```

- [Where a pipeline runs](#where-a-pipeline-runs)
- [Adding a machine (SSH runner)](#adding-a-machine-ssh-runner)
- [The file](#the-file)
- [Built-in steps](#built-in-steps): `setup`, `cache`, `docker`, `approval`
- [Pipelines working together](#pipelines-working-together): inputs, upstream/downstream, one at a
  time, retry, keeping runs
- [Secrets](#secrets)
- [Runs](#runs)
- [Starting a run without pressing Run](#starting-a-run-without-pressing-run)
- [Windows and macOS machines](#windows-and-macos-machines)
- [Who can do what](#who-can-do-what)
- [What a pipeline never does](#what-a-pipeline-never-does)

## Where a pipeline runs

`runs-on` says where:

| `runs-on` | Runs on |
| --- | --- |
| `local` | The Zelyq server itself, in a fresh container that is thrown away after the run. |
| `build-01` | The SSH runner called build-01. |
| `[linux, docker]` | Any SSH runner that has all of these labels. A runner also has its operating system (`linux`, `macos`, `windows`) and the tools it was found to have (`docker`, `git`) as labels. |

The **local runner** needs Docker on the Zelyq server. Its image is `node:22-bookworm` (bash, git,
node, python3). An instance admin can change the image, how many local runs may run at once, or switch
it off, in **Settings → Pipelines**. There is also **On this server (no container)**, which runs steps
directly as the user Zelyq runs as. Use that only on a machine where you trust every editor with
everything that user can reach.

A local container has no Docker inside it. To build Docker images, use an SSH runner that has Docker.

## Adding a machine (SSH runner)

Any machine with an SSH server can be a runner: a cloud VM, a Mac mini, a Windows build box. Open
**Pipelines → Runners**. You need to be a team admin.

1. **Set the machine up.** The page gives one command for Linux, macOS or Windows. Paste it once
   on the machine, as a user who can use `sudo` (on Windows: PowerShell, Run as administrator). It:

   - creates the runner's user (`zelyq` unless you choose another name), or reuses it;
   - lets the team's key in, with the permissions SSH insists on;
   - adds the user to the `docker` group when Docker is installed;
   - on Windows, installs and starts the OpenSSH Server and creates the user's folder;
   - only if you tick it, gives the user admin rights (`sudo` without a password, or Windows
     Administrators). Then every pipeline that runs there can do anything on the machine.

   Running it again is safe. Many cloud images (Google Cloud, AWS, Azure) refuse SSH as `root` even
   with the right key, which is why the runner gets a user of its own.

   Already have a user? **Copy key only** and add it to that user's `~/.ssh/authorized_keys`.

2. **Add the runner:** a name (`build-01`), the host or IP, the port, the SSH user (`zelyq`), and
   labels if you want them (`docker`, `gpu`). **Edit** changes any of these later.
3. **Test connection.** Zelyq connects and shows the machine's fingerprint, for example
   `SHA256:3e1f…`. Check it on the machine itself:

   ```sh
   for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done
   ```

   If one line matches, press **It matches — confirm**. From then on Zelyq talks only to that machine.
   If a machine ever shows a different fingerprint, every run on it stops with "identity changed"
   until an admin confirms the new one. That is what should happen after you reinstall the machine,
   and never otherwise.

Each run gets its own folder on the machine: `~/zelyq/runs/<id>` (on Windows,
`%USERPROFILE%\zelyq\r\<id>`). The folder is removed after a run that passes. It is kept after a run
that fails, so you can sign in and look.

**The team's key.** One key per team, made the first time someone opens Runners. Its private half is
encrypted on the Zelyq server and never shown. **New key** makes a new one. The old key keeps working
for 7 days while you add the new one to each machine, or until you press **stop the old key now**.
Ed25519 is the default; RSA 4096 is there for old servers.

## The file

```yaml
name: Deploy                 # shown in the list
runs-on: local               # or a runner's name, or [labels]
source:                      # what checkout: true fetches
  app: My app                #   one of this team's apps
  # repo: https://github.com/you/app
  # ref: main
  # token: vault://GITHUB_TOKEN
env:
  API_KEY: vault://API_KEY
timeout: 30m                 # the whole run; 1h if not set
stages:
  - name: Build
    steps:
      - checkout: true
      - name: Install and build
        run: |
          npm ci
          npm run build
        timeout: 10m
        shell: bash          # bash, sh, zsh, pwsh, powershell
        working-directory: web
        continue-on-error: true
        env:
          NODE_ENV: production
  - name: Tell someone
    if: failure()            # success() (the default), failure(), always()
    steps:
      - run: echo "it broke"
artifacts:
  - name: site
    path: dist
notify:
  webhook: vault://SLACK_WEBHOOK
  on: [failed, timed_out]
```

- **checkout** fetches the source into the run's folder. An `app:` is copied from Zelyq without
  `node_modules`, `.git` or local `.env` files. A `repo:` is fetched with git at `ref` (or the
  default branch). A private repository needs `token:`, which must come from Vault.
- **run** is commands for the shell. A step stops at its first failing command, in every shell.
- **shell** is `bash` by default, and `pwsh` (PowerShell 7) on Windows.
- **if** decides whether a stage or step runs, based on whether anything before it failed. A step
  takes its stage's `if` unless it has its own. So a stage with `if: failure()` runs, with all its
  steps, only when something failed.
- **continue-on-error** lets a failing step fail without failing the run.
- **artifacts** are folders or files kept after the run (even a failed one), each as a `.tar.gz`
  to download from the run's page, up to 512 MB each.
- **notify** posts how the run ended to a webhook: Slack, Discord, Mattermost, or any URL that
  accepts JSON. It sends nothing to this machine's own addresses.

The editor checks the file as you type, with line numbers. It also warns about things that will only
stop a run, such as a secret not in Vault yet or a runner not added yet.

## Built-in steps

Besides `checkout` and `run`, four ready-made steps do common work the same way on Linux, macOS
and Windows. Each is one line in the common case.

### setup: a language at a version

```yaml
- setup: node@22          # newest approved 22.x
- setup: node@lts         # newest long-term-support Node
- setup: node             # the version in .nvmrc or .node-version, else lts
- setup: python@3.12      # the version in .python-version when no version is given
- setup: java@21          # Eclipse Temurin; sets JAVA_HOME
- setup: go@1.26          # the version in go.mod when none is given; sets GOROOT
```

The tool is put at the front of `PATH` for every later step of the run.

- Only versions on Zelyq's **approved tools list** can be installed. That list is
  `packages/core/src/tools.json` in the Zelyq repository: for each version and each system (Linux,
  macOS, Windows; Intel/AMD and ARM), the official download address and its SHA-256. A new tool or
  version is proposed with a pull request; merging it is the approval. `scripts/tools-index.mjs`
  builds the list from the official sources.
- An SSH runner downloads the file itself, the first time, checks it against the approved SHA-256,
  and keeps it in `~/zelyq/tools/`. Later runs on that machine use the copy and download nothing.
  The machine needs `curl` or `wget` (Linux, macOS) or PowerShell (Windows).
- For the local runner, the Zelyq server downloads the file once, checks it, and hands it to the
  container.
- Linux machines need glibc (Debian, Ubuntu, Fedora, Amazon Linux…); Alpine is not supported.

### cache: keep a folder between runs

```yaml
- cache: node_modules          # decided by package-lock.json, yarn.lock or pnpm-lock.yaml
- cache: .venv                 # requirements.txt, poetry.lock, uv.lock or Pipfile.lock
- cache:
    path: ~/.m2/repository     # a folder in the home folder is fine too
    key: pom.xml               # one file or a list
```

- Where the step stands, the folder is **restored** if a copy saved with the same key files exists
  (`Cache hit`). Otherwise the run goes on (`Cache miss`), and the folder is **saved at the end, only
  if the run passed**.
- A cache belongs to one pipeline and one branch. A run for a branch also uses the copy made for the
  pipeline's default branch, but a branch never writes into another branch's cache.
- On an SSH runner caches stay on that machine (`~/zelyq/cache/`), so a hit copies nothing over the
  network. The local runner's caches are kept on the Zelyq server.
- A cache larger than 2 GB is not saved; the three newest copies per folder are kept.

### docker: build and push an image

```yaml
- docker:
    image: registry.example.com/team/shop     # without a tag
    tags: [latest, "$ZELYQ_RUN_NUMBER"]       # default [latest]
    file: Dockerfile                          # default Dockerfile
    context: .                                # default the step's folder
    build-args:
      NODE_ENV: production                    # never a secret: build arguments end up in the image
    push: true                                # default false: build only
    login:                                    # only for a private registry
      registry: registry.example.com          # default: the host in image
      username: deploy
      password: vault://REGISTRY_PASSWORD
```

- It needs a runner with Docker (`runs-on: [docker]`). The local runner's container has none, and
  the editor says so.
- The password reaches Docker through its input only. The login is kept in a Docker folder of this
  step only, inside the run's folder, and deleted when the step ends — never in the machine's own
  `~/.docker`. The password shows as `***` in the log.

### approval: wait for a person

```yaml
- approval: Deploy to production?
- approval:
    message: Ship it?
    approvers: editors        # admins (default: admins and owners) or editors
    timeout: 4h               # default 24h, at most 7d
    allow-self: false         # someone other than the person who started the run
```

- The run shows **Waiting for approval**, with **Approve** and **Reject** (and a comment) for the
  people who may answer. Who may answer is checked when they answer, with their role at that moment.
  Service keys cannot answer.
- **Approve**: the next step runs. **Reject**: the step fails and the run goes on as after any failure
  (`if: failure()` stages run). **No answer** by the timeout: the step times out.
- While it waits, the run holds no runner: other runs can use the machine. When approved, it continues
  on the same machine, where its files are. The run's own `timeout` does not count the waiting time.
- A run that is waiting when Zelyq restarts is still waiting afterwards. (On the local runner in a
  container, the container does not survive a restart; that run fails and says so.)
- With `notify:` on the pipeline, `on: [waiting]` sends a message when a run starts waiting.
- Every answer is in the team's Activity.

### Disk on a runner

On **Runners**, **Disk** shows a machine's free space and how much Zelyq's tools and caches use, with
a **Clear** button for each. Clearing is safe: the next run fetches what it needs again.

## Pipelines working together

### Inputs

A pipeline can ask for values when it starts. **Run now** shows a small form; the API takes
`{"inputs": {…}}`; another pipeline passes them with `with:`.

```yaml
inputs:
  environment: {description: Where to deploy, choices: [staging, production], default: staging}
  version: {}                       # no default: it must be given
stages:
  - name: Ship
    steps:
      - run: echo "Deploying $ZELYQ_INPUT_VERSION"
      - deploy: {to: "${{ inputs.environment }}", port: 3000}
```

`${{ inputs.NAME }}` works in any text of the file, and every step gets `ZELYQ_INPUT_<NAME>`. A value
outside `choices` is refused before the run starts. Triggers without a person use the defaults.
**Run again** uses the same values.

### Upstream and downstream

**After another pipeline** (Triggers tab): this pipeline starts whenever the chosen one passes (or
also when it fails), with the same commit. Its run shows "started by Shop build #12".

**The `pipeline` step** starts another pipeline of the team, and by default waits for it and passes or
fails with it. While waiting it holds no runner; cancelling cancels the run it waits for.

```yaml
- pipeline:
    run: Shop deploy
    wait: true                      # default
    with: {environment: staging}
```

**The `download` step** takes an artifact another run kept, instead of building again:

```yaml
- download:
    artifact: dist
    from: upstream                  # default: the run that started this one; or a pipeline's name
    path: .                         # where to unpack; default the step's folder
```

With a pipeline's name, the artifact comes from its newest run that passed. A chain of pipelines
starting each other stops after 10 in a row, so a loop cannot run for ever.

### One at a time

```yaml
concurrency: one-at-a-time          # a new run waits for the one running
# concurrency: newest-wins          # a new run cancels the older one
```

Without it, runs of a pipeline can run side by side.

### Retry

```yaml
- run: npm ci
  retry: 2                          # up to 2 more attempts, at most 5
```

Only a failed step is tried again (not a cancelled or timed-out one), for `run`, `checkout`, `setup`
and `docker`. The run page shows "attempt 2".

### Keeping runs

```yaml
keep: {runs: 50, artifacts: 14d}
```

Without it, **Settings → Pipelines** decides: 100 runs per pipeline and 30 days of artifacts. Older
runs, with their logs and artifacts, are deleted once an hour. The newest run, a run still going and
a run a live deploy came from are always kept.

## Results, services and test reports

### Passing values to later steps

A step with an `id` writes `name=value` lines to the file `$ZELYQ_OUTPUT` (`$env:ZELYQ_OUTPUT` in
PowerShell); later steps use `${{ steps.ID.outputs.NAME }}`. For a value over several lines, write
`name<<END`, the lines, then `END`.

```yaml
- id: meta
  run: echo "version=$(node -p "require('./package.json').version")" >> "$ZELYQ_OUTPUT"
- run: echo "Shipping ${{ steps.meta.outputs.version }}"
```

The run page shows a step's outputs under it, masked like the log. A step that uses an output no
earlier step wrote fails before it starts, naming it.

### Service containers

A database or cache that exists only for the run:

```yaml
services:
  postgres:
    image: postgres:16
    env: {POSTGRES_PASSWORD: test}   # vault://NAME works here too
    port: 5432
  redis: {image: redis:7, port: 6379}
stages:
  - name: Test
    steps:
      - run: npm test
        env:
          DATABASE_URL: postgres://postgres:test@${{ services.postgres.host }}:${{ services.postgres.port }}/postgres
```

- At most 5, named with lower-case letters, digits and `_`. They start before the first step, Zelyq
  waits until each port answers (up to 60 seconds), and they are removed when the run ends, however
  it ended.
- Steps also get `ZELYQ_SERVICE_<NAME>_HOST` and `ZELYQ_SERVICE_<NAME>_PORT`.
- On an SSH runner the runner's user must be able to use Docker; the ports are published on
  `127.0.0.1` only. Beside the local runner's container they share a network of their own with the
  run, and the host is the service's name. Not on Windows runners.

### Test reports

```yaml
- run: npx vitest run --reporter=junit --outputFile=reports/junit.xml
  tests: reports/**/*.xml
```

After the step, passed or failed, Zelyq reads the JUnit XML files (Jest, Vitest, pytest, Go, JUnit,
PHPUnit and .NET can all write it) and shows **2 passed · 1 failed · 1 skipped** on the step, with
each failing test's name and message. Files over 5 MB are skipped, with a line in the log.

### ✓ / ✗ on GitHub and GitLab

```yaml
source:
  repo: https://github.com/you/shop
  token: vault://GITHUB_TOKEN     # GitHub: "Commit statuses: write"; GitLab: "api"
  report-status: true
```

A run started for a commit (a push, a pull request, or `{"ref": "<40-character sha>"}`) reports
*pending* when it starts, then *success* or *failure*, as `zelyq/<pipeline name>` with a link to the
run. That is the check shown on a pull request. If the repository refuses, the run goes on and says
so in its log. GitHub Enterprise and self-hosted GitLab work too (any host with "gitlab" in its name
is GitLab).

## Secrets

`vault://NAME` takes a secret from the team's [Vault](./vault.md).

- The value is read when the run starts. It reaches the step as an environment variable, through the
  step's input. It is never in a command line, so never in the machine's process list, and never in a
  file.
- Wherever the value appears in the log, it shows as `***`. The same holds for its base64 and
  URL-encoded forms, and for each line of a multi-line secret such as a key file.
- A **Protected** secret can only be put in a file by an admin, and only runs while the pipeline's
  last editor is an admin. An editor cannot change a file that uses one.
- A secret can never be typed into the file where Vault is required (`token:`, `webhook:`).

## Runs

**Run now** starts a run. Runs are numbered #1, #2, #3 for each pipeline.

| Status | Meaning |
| --- | --- |
| Queued | Waiting for a runner with room. |
| Running | Steps are running. |
| Passed | Every step that ran passed, or was allowed to fail. |
| Failed | A step failed, or the run could not start (the message says why). |
| Cancelled | Someone pressed Cancel. |
| Timed out | A step's or the run's `timeout` ran out. |

The run page shows the steps by stage and the log as it is written. Click a step to see only its
output. **Cancel** stops the step that is running, with everything it started, and skips the rest.
**Run again** runs the same file again. **Run again from…** skips the stages before the one you pick,
except their `checkout` steps.

A run that loses its connection to the machine fails; it is not retried. If Zelyq restarts during a
run, that run is marked failed. The log keeps up to 20 MB per run; after that the run continues, but
its output is not recorded.

## Starting a run without pressing Run

Open a pipeline's **Triggers** tab.

**On a git push.** Add the trigger with the branches to watch (`main`, `release/*`). Zelyq shows a
payload URL and a secret, once.

- GitHub: Settings → Webhooks → Add webhook. Paste the URL and the secret, choose content type
  `application/json` and "Just the push event".
- GitLab: Settings → Webhooks. Paste the URL, put the secret in **Secret token**, tick **Push events**.

A push to a matching branch starts a run at the pushed commit. A call with the wrong secret is
refused.

- **Only when certain files change.** Fill in **Paths** (`frontend/**, package.json`): the push
  starts a run only if it changed a matching file. `*` matches within a folder, `**` across folders.
  A push too big for the webhook to list every file (20 commits or more) runs anyway.
- **Pull requests.** Tick **Also for pull requests**, and in the webhook also send "Pull requests"
  (GitHub) or tick **Merge request events** (GitLab). A request into one of the branches runs on its
  newest commit when it is opened or gets new commits; the trigger shows "pull request". **Requests
  from forks never run**: their code would run with the team's secrets on the team's machines.

**On a schedule.** Five-field cron, in UTC: `0 3 * * *` is 03:00 every day, `*/15 * * * *` every 15
minutes, `0 9 * * 1-5` 09:00 on weekdays.

**From a script or another CI.** Make a service key with **Start pipeline runs** in **Vault →
Service keys**, then:

```sh
curl -X POST https://zelyq.example.com/api/v1/pipelines/<pipeline id>/runs \
  -H "Authorization: Bearer $ZELYQ_KEY" -H "content-type: application/json" -d '{}'
```

Send `{"ref": "v1.2.0"}` to check out a particular branch, tag or commit.

## Windows and macOS machines

**macOS:** turn on **System Settings → General → Sharing → Remote Login**. Steps run in `bash`;
`zsh` is there too.

**Windows 10/11 and Server 2019+:** install the OpenSSH Server, in an administrator PowerShell:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd; Set-Service sshd -StartupType Automatic
```

- For a user in the Administrators group, Windows reads keys from
  `C:\ProgramData\ssh\administrators_authorized_keys` (allow only Administrators and SYSTEM on that
  file), not from the user's own `.ssh` folder.
- Steps run in PowerShell 7 (`pwsh`) by default. Install it, or use `shell: powershell` for the
  built-in Windows PowerShell 5.1. `cmd` is not offered as a step shell, because it cannot stop at the
  first failing command.
- A failing program (`npm test` exiting 1) stops the step with that exit code. With Windows PowerShell
  5.1 the step continues and fails at the end, with the last failing exit code.
- Keep the SSH server's default shell (`cmd.exe`): Zelyq's own commands for the run's folder are
  written for it.

## Who can do what

| | Viewer | Editor | Admin, owner |
| --- | --- | --- | --- |
| See pipelines, runs, logs, runners | ✓ | ✓ | ✓ |
| Write pipelines, run, cancel, add triggers | | ✓ | ✓ |
| Use a Protected secret in a pipeline | | | ✓ |
| Add runners, confirm fingerprints, the team's SSH key | | | ✓ |

Every change, run started and run cancelled is in the team's Activity.

## What a pipeline never does

- Connect to a machine whose fingerprint has not been confirmed, or has changed.
- Sign in with anything but the team's key: no passwords, and never the server operator's own keys.
- Put a secret in a command line, a file, or the log.
- Mount the Zelyq server's files into a local run's container.

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

New to pipelines? Follow [the tutorial](./tutorial.md) once, from an empty Zelyq to an app that is
tested, deployed and rolled back. This page is the full reference.

- [Where a pipeline runs](#where-a-pipeline-runs)
- [Adding a machine (SSH runner)](#adding-a-machine-ssh-runner), and
  [firewalls and ports](#firewalls-and-ports)
- [Visual or YAML: two ways to edit](#visual-or-yaml-two-ways-to-edit)
- [The file](#the-file)
- [Where the files come from](#where-the-files-come-from): an app, a git repository, anything else;
  subfolders; files already on the machine
- [Built-in steps](#built-in-steps): `setup`, `cache`, `docker`, `approval`
- [Stages at the same time, a machine per stage, matrix](#stages-at-the-same-time-a-machine-per-stage-matrix)
- [Templates: reuse another pipeline's stages](#templates-reuse-another-pipelines-stages)
- [Plugins: ready-made steps](#plugins-ready-made-steps), and how to build one in
  [Pipeline plugins](./pipeline-plugins.md)
- [Pipelines working together](#pipelines-working-together): inputs, upstream/downstream, one at a
  time, retry, keeping runs
- [Results, services and test reports](#results-services-and-test-reports): outputs, service
  containers, JUnit, ✓ / ✗ on GitHub and GitLab
- [Secrets](#secrets)
- [Runs](#runs) and [the overview](#the-overview)
- [Starting a run without pressing Run](#starting-a-run-without-pressing-run): git push, pull
  requests, schedules, other CI; [changing a trigger](#changing-a-trigger);
  [when a webhook does not start a run](#when-a-webhook-does-not-start-a-run)
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

### Firewalls and ports

| From → to | Port | Needed for |
| --- | --- | --- |
| Zelyq server → runner | the runner's SSH port (`22` unless you changed it) | every run and deploy on that runner. Zelyq always connects out; a runner never connects in to Zelyq. |
| GitHub / GitLab → Zelyq | `443` (Zelyq behind HTTPS) | push and pull-request triggers. Zelyq must be reachable from the internet, and `ZELYQ_PUBLIC_URL` set to its public address so the webhook URL it shows is right. |
| People → a deploy machine | each app's `host-port` | opening a deployed app. See [Deploy](./deploy.md#ports-and-firewalls). |

On a cloud VM, open these in the provider's firewall too (Google Cloud: **VPC network → Firewall**;
AWS: the instance's **Security group**; Azure: **Network security group**). A runner whose SSH port
is closed fails **Test connection** with a timeout.

**The team's key.** One key per team, made the first time someone opens Runners. Its private half is
encrypted on the Zelyq server and never shown. **New key** makes a new one. The old key keeps working
for 7 days while you add the new one to each machine, or until you press **stop the old key now**.
Ed25519 is the default; RSA 4096 is there for old servers.

## Visual or YAML: two ways to edit

A pipeline's **File** tab has a switch at the top: **Visual** draws the pipeline and lets you edit it
by clicking and dragging; **YAML** shows the file itself. Both edit the same file, so you can switch
at any time, and comments and anything the visual editor does not show are kept exactly as written.
Zelyq remembers which one you used last.

Nothing is saved until you press **Save** (top right). While there are changes, it says **Unsaved
changes**, and **Undo all** goes back to the saved file.

**What you see.** A bar at the top for the whole pipeline; under it, its **latest run**; then the
stages, left to right in the order they run, joined by lines. Each stage is numbered in run order;
stages that run at the same time stand in one dashed box ("2 at the same time") and share a number.
Inside each box are its steps, each with an icon for its kind. Labels on a stage show what is special
about it: **On mac-mini** (its own machine), **Matrix × 4**, **Only after a failure**, **Always
runs**, **Template: Node checks**. When the stages do not all fit, the row scrolls: it says **"6
stages · scroll to see them all"**, with **‹ ›** to move along.

**The latest run** is shown on the picture: the bar says how it went (**Latest run #12 · Failed ·
1m 20s**, with **Open the run**), each stage has ✓, ✗ or a spinner, and so does each step while the
file is still the one that ran. While a run is going, it updates by itself.

**Editing.** Click something, and its form opens on the right:

| Click | You can set |
| --- | --- |
| The bar at the top | The name; where it runs (this server, one of your runners, or any runner with some labels); where the code comes from (one of your apps, or a git repository with its branch, token and ✓ / ✗ on GitHub); the timeout; variables for every step |
| A stage | Its name; when it runs (after success, only after a failure, or always); whether it runs at the same time as the stage before it; its own machine; a matrix; or, for a template stage, which pipeline it uses and that pipeline's inputs |
| A step | Its kind and name, then a form for that kind: the commands and shell; the language and version; the folder to cache; the Docker image; the environment and ports to deploy to; the approval's question; the pipeline to start; the artifact to download; or the plugin (found by searching your installed plugins) and its inputs. **More** holds its id, condition, timeout, folder, "carry on if it fails" and variables. |

**Adding.**

- The small round **+** on a line between two stages puts a new stage there; the one at the end adds
  a last stage.
- Hover a stage and a small dashed **+** appears under it: a stage that runs **at the same time**.
  A stage's form has the same two as buttons: **Add a stage after this one**, **Add a stage at the
  same time as this one**.
- **Add a step** at the bottom of a stage lists every kind of step, each with what it is for.

**Moving and deleting.** Drag a step to another place in its stage, or into another stage; drag a
stage by its name onto another stage to put it before that one. A blue line shows where it will land.
The forms also have arrows to move, and **Delete stage** / **Delete step**.

**Choosing.** Fields that name something your team has are lists of what exists: runners, apps,
environments, pipelines and installed plugins. A name in the file that does not exist (a typo, a
removed runner, the `My app` of a template) shows as **(not found)**, so you can see it and pick
the right one.

**Problems** show where they are: a stage with something wrong has a red border and **1 problem**,
the step a red dot, and its form lists what is wrong at the top. The same problems are listed
under the editor, with their line in the file.

Some things are only in YAML: inputs, services, artifacts, notifications, `concurrency`, `keep`, a
step's `retry` and `tests`, and a Docker registry login. The visual editor keeps them as they are.

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
stop a run, such as a secret not in Vault yet or a runner not added yet. The **?** panel beside the
editor has a short example of everything a file can hold.

## Where the files come from

Each run starts in an **empty folder** of its own on the machine. Nothing is there until a step puts
it there.

| You want | Do this |
| --- | --- |
| The files of an app built in Zelyq | `source: {app: Shop}` and a `checkout: true` step. It copies the app's files exactly as they are in Zelyq now (what you see in the app's editor), without `node_modules`, `.git` and `.env` files. |
| A GitHub or GitLab repository | `source: {repo: https://github.com/you/shop}` (with `token: vault://GITHUB_TOKEN` for a private one) and `checkout: true`. Without `ref:`, the default branch; a push or pull request trigger checks out its own commit. |
| Something else | Fetch it in a `run` step: `git clone …`, `curl -O …`, `scp …`. |
| To work in a subfolder | `working-directory: web` on the step. Paths are always inside the run's folder. |
| A file that already lives on the runner | Copy it in with a `run` step: `cp ~/config/settings.json .`. The run's folder is `~/zelyq/runs/<id>`; anything outside it stays as it is between runs. Keep secrets in Vault instead of in files on the machine. |
| A file from another pipeline's run | A [`download` step](#upstream-and-downstream). |

The folder is deleted after a run that passes, and kept after one that fails, so you can sign in and
look. Files that must outlive a run are [artifacts](#the-file) or a [cache](#cache-keep-a-folder-between-runs).

## Keep the file in your repository

A pipeline's file can live in Zelyq (the default) or in your repository, next to your code, like a
`Jenkinsfile` or a GitHub workflow. In the repository, a change to the pipeline goes through the same
review as a change to the code, and **every branch and pull request runs its own copy of the file**.

**To move a pipeline's file into the repository:**

1. The file needs `source:` with `repo:` (and `token:` for a private repository). That is where Zelyq
   reads it.
2. Open the pipeline → **File** → **Keep it in the repository**.
3. Keep the suggested path (`.zelyq/pipelines/<name>.yml`) or type another. Press **Download the
   file**, add it to your repository at that path, and push it to the default branch.
4. Press **Link**. Zelyq reads the file there and checks it, the same as a save.

From then on:

| What happens | What it does |
| --- | --- |
| A push or pull request | The run reads the file **at that commit**. A branch can change its pipeline, and its run tests that change. |
| **Run now**, a schedule | The run reads the file on the default branch (or `source: ref:`), and checks out the code from the same commit. |
| A run on the default branch | Its file becomes the copy you see in **File**, so Zelyq always shows what main runs. |
| You want to change the pipeline | Change the file in the repository. In Zelyq, **File** shows it without editing. |
| **Update from the repository** | Reads the default branch now, without waiting for a run. |
| **Stop keeping it there** | Back to a file in Zelyq, as it last was on the default branch. |

A pipeline kept in the repository has a small branch icon in the Pipelines list.

**What a push cannot do.** Anyone who can push to the repository can change what the pipeline runs,
as with any CI. So a file read from a branch must keep to what the copy in Zelyq allows:

- the same `source: repo:` and `token:`: a branch cannot send your token to another address;
- no Vault secret that the copy in Zelyq does not already use. To allow a new one, an editor (an admin
  for a Protected secret) presses **Update from the repository** after it is on the default branch.

Pull requests from forks never run, as before.

**When the file cannot be used**, the run fails at once and says why, at the top of the run:
`There is no .zelyq/pipelines/shop.yml in the repository at 4872bcd.`, `… is not valid: Line 4: …`,
`… uses DEPLOY_KEY from Vault, which this pipeline may not use yet.` Fix the file and push again.

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

## Stages at the same time, a machine per stage, matrix

Stages run one after another, on one machine, unless the file says otherwise.

```yaml
name: Shop
runs-on: local
source: {repo: https://github.com/you/shop}
stages:
  - name: Build
    steps: [{checkout: true}, {run: npm ci && npm run build}]

  - name: Test on Linux
    steps: [{checkout: true}, {run: npm ci && npm test}]
  - name: Test on Mac
    runs-on: mac-mini            # this stage on another runner
    parallel: true               # at the same time as the stage above
    steps: [{checkout: true}, {run: npm ci && npm test}]

  - name: Node
    matrix:
      node: [20, 22]
      os: [linux, windows]       # 2 × 2 = 4 copies, all at the same time
    runs-on:
      - ${{ matrix.os }}         # any runner with that label
    steps:
      - checkout: true
      - setup: node@${{ matrix.node }}
      - run: npm test

  - name: Ship                   # waits until every stage above is over
    steps: [{run: echo ready}]
```

- **`parallel: true`** runs a stage at the same time as the stage above it. Several in a row all run
  together, and the next stage without `parallel` waits for all of them. At most 20 at once.
- **`runs-on:` on a stage** runs that stage on another runner (a name, `[labels]`, or `local`). The
  other stages stay on the pipeline's own `runs-on`.
- **`matrix:`** makes one copy of the stage for every combination of the values, all at the same
  time. `${{ matrix.NAME }}` is filled in anywhere in the stage, including its `runs-on`. Copies are
  named after their values: **Node (20, linux)**. At most 20 copies.
- A failing stage does not stop the others running beside it. The run fails, and the stages after the
  group follow their `if:` as after any failure.
- The run page shows stages that ran together stacked in one column.

**What changes for such a stage.** A stage that names its own `runs-on`, or that runs beside another
one, gets a **machine of its own**:

- It starts in an **empty folder**: check out again in it (`checkout: true`), and set up tools again.
  Files made by earlier stages are not there; pass small values with
  [outputs](#passing-values-to-later-steps), which every later stage can read.
- On the local runner it gets its own container; on an SSH runner its own folder
  (`~/zelyq/runs/<id>-s<stage>`). Its [services](#service-containers) are its own, too.
- It cannot wait for a person: no `approval` step, no `pipeline` step with `wait: true`, and a
  `deploy` to a protected environment fails. Put those in a stage on the run's own machine.
- It counts against its runner like a run does. With the local runner, **Settings → Pipelines →
  Local runs at once** (2 by default) limits how many stages run at the same time; the rest wait
  their turn.
- `artifacts:` are kept from the run's own machine only.

## Templates: reuse another pipeline's stages

Write the stages once, in a pipeline of their own, and use them in any pipeline of the team:

```yaml
# A pipeline called "Node checks"
name: Node checks
runs-on: local
source: {app: Shop}            # used only when this pipeline runs on its own
inputs:
  node: {default: "22"}
env:
  CI: "true"
stages:
  - name: Lint
    steps: [{checkout: true}, {setup: "node@${{ inputs.node }}"}, {run: npm ci && npm run lint}]
  - name: Unit tests
    steps: [{checkout: true}, {setup: "node@${{ inputs.node }}"}, {run: npm ci && npm test}]
```

```yaml
# Any other pipeline
name: Shop
runs-on: local
source: {app: Shop}
stages:
  - name: Checks
    uses: Node checks          # the other pipeline's name
    with: {node: "20"}         # its inputs; the rest take their defaults
  - name: Deploy
    steps: [{deploy: {to: staging, port: 3000}}]
```

- The stages of **Node checks** are copied in where `uses:` stands, named **Checks › Lint** and
  **Checks › Unit tests**. Its `env:` is given to each of its steps. Its `source`, `services`,
  `artifacts` and triggers are not copied: the pipeline that uses it decides those.
- A `uses:` stage takes only `name`, `with`, `if`, `runs-on` (for every copied stage that has none)
  and `parallel`.
- The copy is made when a run starts, and the run keeps it: **Run again** does exactly the same,
  even if the template has changed since. A change to the template applies to the next new runs.
- A template cannot use another template. Saving a pipeline checks that the template exists, that
  every input it needs is given, and that `with:` names only its inputs.
- A template is an ordinary pipeline, so you can run it on its own to try it.

## Plugins: ready-made steps

A plugin is a step someone packaged, with inputs: install its package in **Pipelines → Plugins**
(team admins), then use it with an exact version:

```yaml
- id: notify
  plugin: acme/chat-notify@1.0.0
  with:
    webhook: vault://SLACK_WEBHOOK      # a secret input comes from Vault
    message: Shop is live
```

Its steps run on the runner, in this step's folder, and its outputs are read through the step's `id`.
How to build, pack, version and share one: [Pipeline plugins](./pipeline-plugins.md).

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

## The overview

**Pipelines → Overview** shows how the team's pipelines are doing over the last 7, 14 or 30 days:

- **Runs**, the **success rate** (passed out of passed and failed; cancelled runs do not count), the
  **typical run** (the middle duration), and how many pipelines are **failing now** (their newest run
  failed).
- **Runs per day**, passed and failed; hover a day for its numbers, or **Show as a table**.
- **Pipelines**: each one's runs, success rate, average time and newest run, the failing ones first.
- **Slowest stages**: the stages that take longest on average, which is where a faster runner, a
  [cache](#cache-keep-a-folder-between-runs) or [stages at the same
  time](#stages-at-the-same-time-a-machine-per-stage-matrix) help most.

## Starting a run without pressing Run

Open a pipeline's **Triggers** tab.

**On a git push.** Add the trigger with the branches to watch (`main`, `release/*`). Zelyq shows a
payload URL and a secret, **once**: copy both before closing the box.

- GitHub: the repository's **Settings → Webhooks → Add webhook**. Paste the URL in **Payload URL** and
  the secret in **Secret**, choose content type `application/json`, and under "Which events" choose
  "Just the push event" (or **Let me select individual events** → **Pushes** and **Pull requests**
  when the trigger is also for pull requests).
- GitLab: **Settings → Webhooks**. Paste the URL, put the secret in **Secret token**, tick **Push
  events** (and **Merge request events** for merge requests).

GitHub sends a *ping* as soon as the webhook is saved; **Recent Deliveries** on the webhook should
show it answered `200` with `pong`.

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

**When the app changes.** For a pipeline whose source is an app: it runs every time the agent
finishes a turn that changed the app.

**After another pipeline.** See [upstream and downstream](#upstream-and-downstream).

### Changing a trigger

The **pencil** on a trigger changes its branches, paths, pull requests, schedule or upstream pipeline.
A push trigger keeps its payload URL and secret, so nothing changes in GitHub or GitLab. **Turn off**
pauses a trigger; the bin removes it. To change a trigger into another kind, add a new one.

### When a webhook does not start a run

GitHub shows Zelyq's answer under the webhook's **Recent Deliveries → Response** (GitLab: **Edit →
Recent events**). **Redeliver** sends the same call again after you fix something.

| Answer | What it means | What to do |
| --- | --- | --- |
| `401` Unknown trigger or wrong secret. | The URL is not one of Zelyq's triggers, or the secret is not the trigger's. | Paste the secret again. Lost it? Remove the trigger, add a new one, and put its new URL **and** secret in the webhook. |
| `200` pong | GitHub's test call. | Nothing; it works. |
| `202` … is not one of this trigger's branches. | The push was to another branch. | Add the branch to the trigger (pencil). |
| `202` The push changed none of this trigger's paths. | The trigger has paths and none matched. | Change the paths, or empty them for any change. |
| `202` This trigger does not run for pull requests. | A pull-request event, and the trigger is for pushes only. | Tick **Also for pull requests** (pencil). |
| `202` This trigger is turned off. | | **Turn on**. |
| `201` Started run #N. | A run started. | |

No delivery at all means GitHub could not reach Zelyq: check that its address is public and on HTTPS
(see [firewalls and ports](#firewalls-and-ports)).

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

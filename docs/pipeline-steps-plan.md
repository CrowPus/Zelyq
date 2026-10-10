# Built-in steps: plan

Status: **built 2026-10-10.** See [Pipelines → Built-in steps](./pipelines.md#built-in-steps).

Today a pipeline step is one of two things: `checkout` (get the code) or `run` (any command).
Everything else (installing Node, caching, building images, waiting for a person) has to be typed
as commands, which is slow to write, different on every operating system, and easy to get wrong.

Jenkins calls ready-made steps *steps* and *plugins*, GitHub Actions calls them *actions*, and Azure
Pipelines calls them *tasks*. Zelyq calls them **built-in steps**. This plan adds four:

| Step | One line in the file | What it saves you from |
| --- | --- | --- |
| `setup` | `- setup: node@22` | Installing a language version by hand on every machine |
| `cache` | `- cache: node_modules` | Downloading every package again on every run |
| `docker` | `- docker: {image: …, push: true}` | Typing login, build, tag and push, and leaking the password |
| `approval` | `- approval: Deploy to production?` | Deploying before a person said yes |

- [1. What a file looks like](#1-what-a-file-looks-like)
- [2. Rules every built-in step follows](#2-rules-every-built-in-step-follows)
- [3. setup](#3-setup)
- [4. cache](#4-cache)
- [5. docker](#5-docker)
- [6. approval](#6-approval)
- [7. Changes to what exists](#7-changes-to-what-exists)
- [8. Security](#8-security)
- [9. Tests](#9-tests)
- [10. Order of work](#10-order-of-work)
- [11. Not in this plan](#11-not-in-this-plan)
- [12. Decisions](#12-decisions)

## 1. What a file looks like

Before, on a VM with no Node and a private registry:

```yaml
stages:
  - name: Build
    steps:
      - checkout: true
      - run: |
          curl -fsSL https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz | tar -xJ -C ~/node
          export PATH=~/node/node-v22.11.0-linux-x64/bin:$PATH
          npm ci
          npm test
      - run: |
          echo "$REGISTRY_PASSWORD" | docker login registry.example.com -u deploy --password-stdin
          docker build -t registry.example.com/shop:latest -t registry.example.com/shop:$ZELYQ_RUN_NUMBER .
          docker push registry.example.com/shop:latest
          docker push registry.example.com/shop:$ZELYQ_RUN_NUMBER
          docker logout registry.example.com
  - name: Production
    steps:
      - run: ./deploy.sh
```

After:

```yaml
stages:
  - name: Build
    steps:
      - checkout: true
      - setup: node@22
      - cache: node_modules
      - run: npm ci && npm test
      - docker:
          image: registry.example.com/shop
          tags: [latest, "$ZELYQ_RUN_NUMBER"]
          push: true
          login:
            username: deploy
            password: vault://REGISTRY_PASSWORD
  - name: Production
    steps:
      - approval: Deploy to production?
      - run: ./deploy.sh
```

The second file also works unchanged on a macOS or Windows runner. The first does not.

## 2. Rules every built-in step follows

- **One kind per step.** A step is exactly one of `checkout`, `run`, `setup`, `cache`, `docker`,
  `approval`. The editor says so, with the line number, if a step has two or none.
- **Short form and long form.** The common case is one line (`setup: node@22`); the long form is
  an object with the same meaning plus options (`setup: {tool: node, version: "22"}`).
- **The usual step settings still apply**: `name`, `if`, `timeout`, `continue-on-error`,
  `working-directory`, `env`. A built-in step has a readable default name ("Set up Node 22",
  "Cache node_modules", "Docker: shop", "Approval").
- **The same on Linux, macOS and Windows**, on the local runner and on SSH runners, unless a row
  in the table below says otherwise. Where a step cannot work (Docker on the local container
  runner), the editor warns while typing and the run fails with a sentence saying why.
- **Shown like any other step**: its own row on the run page, its own log, its own status.
- **Secrets only from Vault** (`vault://NAME`), masked in the log as today.

| Step | Linux | macOS | Windows | Local runner (container) |
| --- | --- | --- | --- | --- |
| `setup` | ✓ x64, arm64 | ✓ x64, arm64 | ✓ x64, arm64 | ✓ |
| `cache` | ✓ | ✓ | ✓ | ✓ |
| `docker` | ✓ if Docker is installed | ✓ if Docker Desktop is installed | ✓ if Docker Desktop is installed | ✗ (no Docker inside the container) |
| `approval` | ✓ | ✓ | ✓ | ✓ |

## 3. setup

Puts a language at a chosen version on the `PATH` for every later step of the run.

```yaml
- setup: node@22          # newest 22.x
- setup: node@22.11.0     # exactly this
- setup: node@lts         # newest long-term-support release
- setup: node             # the version in .nvmrc or .node-version; otherwise lts
- setup: python@3.12
- setup: java@21          # Eclipse Temurin JDK
- setup: go@1.23
```

Long form: `setup: {tool: python, version: "3.12"}`. Several `setup` steps can follow each other
(Node and Python in one pipeline).

**Tools in the first version:** `node`, `python`, `java`, `go`. These cover nearly every app a
team builds; more can be added the same way later.

**Where the files come from: the approved tools list.** Decided 2026-10-10.

The machine downloads the tool itself, the way Jenkins agents, GitHub runners and Azure agents do,
but **only what Zelyq's approved tools list names**, like the Jenkins plugin site or the GitHub
Marketplace: a list the Zelyq project controls.

| Stage | The approved list | When |
| --- | --- | --- |
| 1 | Lives **in the Zelyq repository** (`packages/core/src/tools.json`): for each tool, version, operating system and CPU, the download address and its SHA-256. The addresses are the official files (nodejs.org, python-build-standalone, Adoptium, go.dev). **A contributor proposes a tool or a version with a pull request; the Zelyq project approves it by reviewing and merging.** Every Zelyq server carries the list of its own version, so there is nothing extra to trust or keep online. A maintainer script (`scripts/tools-index.mjs`) fetches the official checksums to prepare such a pull request. | With these built-in steps |
| 2 | `tools.zelyq.com` **hosts the files and a signed copy of the list**, so a Zelyq server can pick up newly approved versions without upgrading, and machines can download everything from one place. | Its own plan |
| 3 | A **submission page** on the tool server: contributors send tools, the Zelyq project reviews and approves them. | Its own plan |

**How it reaches the machine:**

1. The engine asks the runner whether `~/zelyq/tools/<tool>/<version>/<os>-<arch>/` already has a
   finished copy (a `.complete` marker written last). If yes, nothing is downloaded.
2. If not, the Zelyq server resolves the version from the approved list (`22` → `22.11.0`) and tells
   the machine the address and the SHA-256. The machine downloads it (`curl` or `wget` on Linux and
   macOS, `Invoke-WebRequest` on Windows), checks the SHA-256 (`sha256sum`, `shasum -a 256`,
   `Get-FileHash`), unpacks it with `tar`, and writes the marker. A file that does not match is
   deleted and the step fails.
3. Every later step of the run gets that folder's `bin` at the front of `PATH`
   (`export PATH=…:"$PATH"` in sh/bash/zsh, `$env:PATH = '…;' + $env:PATH` in PowerShell), and
   `JAVA_HOME` / `GOROOT` where the tool needs it.

**For people who host Zelyq themselves:** a machine that already has a copy needs no internet for
it. A machine that cannot reach the official download sites can be given a copy by hand in
`~/zelyq/tools/` (stage 2 adds a setting to download from a company's own mirror).

On the local container runner the container is new each run, so the download would repeat; the
container gets the server's `data/pipelines/tools/` copy instead, read from local disk.

**Version resolution** (`22` → `22.11.0`) is done on the server and cached for an hour, so the run
log always says the exact version: `Node 22 → v22.11.0 (from the machine's copy)`.

**Clean-up.** Tool copies on a machine are kept, because they are what makes the next run fast. The
runner page shows how much space they use, with a button to remove them.

## 4. cache

Keeps a folder between runs, so dependencies are not downloaded every time.

```yaml
- cache: node_modules                 # key chosen from the lock file: package-lock.json, yarn.lock or pnpm-lock.yaml
- cache: .venv                        # key from requirements.txt, poetry.lock or uv.lock
- cache:
    path: ~/.m2/repository
    key: pom.xml                      # one file or several; the cache is reused while they are unchanged
```

**How it works, like the cache in other CI tools:**

1. Where the step stands in the file, the cache is **restored**: if a saved copy exists for the
   same key, it is unpacked into `path`; the log says `Cache hit: node_modules (182 MB)` or
   `Cache miss`.
2. At the end of the run, **only if the run passed** and it was a miss, the folder is **saved**
   under that key, as the last thing before the run's folder is cleaned up. It shows in the run's
   *Finish* section.
3. The **key** is a SHA-256 of the key files' contents plus the operating system and CPU, so a
   changed lock file makes a fresh cache, and a Linux cache is never restored on Windows.

**Where it is kept: where the run runs.** On an SSH runner, in `~/zelyq/cache/` on that machine (no
network transfer at all); on the local runner, in the server's `data/pipelines/cache/`, streamed in
and out of the container. A run on a different machine of the same label simply misses once.

**Scope.** A cache belongs to one pipeline and one branch (the run's `ref`, or the default when
there is none). A run on `main` may read a cache made on `main` only; a feature branch may read its
own, then `main`'s. A feature branch can never write into `main`'s cache, so a pull request cannot
poison what production builds use.

**Limits.** At most 2 GB per entry (larger is skipped with a message) and the three newest entries
per pipeline, branch and path. The runner page shows each machine's free space and how much tools and
caches use, with a **Clear** button for each. *(Changed while building: no 20 GB machine-wide cap and
no per-pipeline clear button; the Disk view shows the real numbers instead.)*

## 5. docker

Builds an image and, if asked, pushes it. Runs on a runner that has Docker (the editor warns when
`runs-on` cannot have it).

```yaml
- docker:
    image: registry.example.com/team/shop     # without a tag
    tags: [latest, "$ZELYQ_RUN_NUMBER"]       # default: [latest]
    file: Dockerfile                          # default: Dockerfile
    context: .                                # default: the step's folder
    build-args:
      NODE_ENV: production
    push: true                                # default: false (build only)
    login:                                    # only needed to push to a private registry
      registry: registry.example.com          # default: the host in image:
      username: deploy
      password: vault://REGISTRY_PASSWORD
```

**What the step does, in order:**

1. Checks `docker version`; if Docker is missing or the user cannot use it, the step fails with the
   fix (install Docker, or run the machine setup command again to join the `docker` group).
2. If `login` is given: signs in with `docker login --password-stdin`. The password reaches Docker
   through its input only, never a command line. It is written to a **temporary Docker config folder
   inside the run's folder** (`DOCKER_CONFIG`), not to the machine's `~/.docker`, and that folder is
   deleted when the step ends, passed or failed. Other runs on the machine never see the login.
3. `docker build` with every tag and build-arg, the build output streamed into the step's log.
4. If `push: true`, pushes each tag and writes the image digest to the log
   (`Pushed registry.example.com/team/shop@sha256:…`).

**Build arguments are not secrets**: they end up inside the image. The editor refuses a
`vault://` value in `build-args`, with a sentence saying to use a build secret instead (a later
addition).

## 6. approval

Stops the run until a person says yes.

```yaml
- approval: Deploy to production?
- approval:
    message: Deploy to production?
    approvers: admins          # admins (default): team admins and owners · editors: editors and up
    timeout: 24h               # default 24h, at most 7 days
    allow-self: true           # default true: the person who started the run may approve it
```

**What people see:**

- The run's status becomes **Waiting for approval**, with its own colour in the stage picture and
  the lists.
- The run page shows the message with **Approve** and **Reject** buttons, and a comment box, to
  people who may approve; others see who can.
- If the pipeline has `notify:`, a notification goes out when the run starts waiting, so nobody has
  to watch the page (`on: [waiting]` can be added to `notify.on`).
- Approve: the run continues with the next step. Reject: the step fails with the comment, and the run
  goes on exactly as after any failed step (`if: failure()` stages still run).
- No answer before `timeout`: the step is **Timed out** and the run fails.
- Every approve and reject is in the team's Activity, with the person and the comment.

**While it waits, the runner is not held.** The SSH connection is closed and the runner's capacity
is given back, so a run waiting overnight does not block other runs. The run's folder stays on the
machine. When approved, the run reconnects to **the same runner** (it must; the files are there)
and continues. On the local container runner, the container is kept but does not count towards
*Local runs at once*.

**If Zelyq restarts while a run waits**, the run keeps waiting: the wait is saved in the database,
not only in memory. For an SSH runner the run continues after approval as above; a local container
does not survive a restart, so that run fails with a sentence saying why.

## 7. Changes to what exists

**packages/core (`pipelines.ts`)**
- `stepSchema` becomes a choice of six kinds; each built-in step has its own schema with short and
  long forms, and the error messages say which form is expected.
- `RUN_STATUSES` and `STEP_STATUSES` gain `waiting`.
- `pipelineVaultNames` also finds `docker.login.password`.
- `stepLabel` gives the default names. `PIPELINE_TEMPLATES` use the new steps (the Node and Python
  templates get `setup` and `cache`; the Docker template uses `docker`).

**packages/db**
- `pipeline_steps.kind` (text), so the run page can show a step's kind without the file.
- `pipeline_approvals` (run, step, message, approvers, decided by, decision, comment, deadline,
  created, decided) for waits that survive a restart.
- ~~`pipeline_caches`~~ *Changed while building:* a table would drift from what is really on each
  machine, so sizes are read from the machine itself (Runners → Disk) and the machine keeps its three
  newest copies per folder. `pipeline_runs.branch` was added instead, so a cache belongs to a branch.
- A new migration for SQLite and Postgres, checked by the parity test as always.

**apps/server**
- The engine's step code splits into one handler per kind (`run`, `checkout`, `setup`, `cache`,
  `docker`, `approval`), each in its own file under `services/pipelines/steps/`.
- *Post-run work* (cache save) runs after the last step and before artifacts and clean-up.
- `services/pipelines/tools.ts`: version lists, download, checksum check, the server's tool cache.
- The scheduler learns *waiting*: a waiting run does not use capacity and is resumed on the same
  runner when approved.
- Routes: approve / reject a run, clear a pipeline's or a runner's cache, show a runner's tool and
  cache sizes.

**apps/web**
- Run page: the approval box; *Waiting for approval* status; built-in steps with their icons.
- Editor: the new steps in the help panel and templates; warnings as you type (`docker` on the local
  runner; an unknown tool in `setup`).
- Runners page: tools and cache size per machine, with clear buttons.

**docs:** `pipelines.md` gets a *Built-in steps* section, with each step's short form, long form
and an example.

## 8. Security

- **Downloads**: only what the approved list in the Zelyq repository names, only over HTTPS, and only
  with the SHA-256 from that list. Nothing else can be installed by `setup`, and a change to the
  list is a reviewed pull request.
- **Registry passwords**: through `--password-stdin` only, in a per-step Docker config folder that
  is deleted when the step ends; masked in the log.
- **Cache poisoning**: a branch can only write its own cache (section 4); caches are saved only
  after a run that passed.
- **Approval**: the approver's role is checked on the server at the moment of approving, not when
  the run started; a run cannot approve itself through the API; only people, never service keys,
  can approve.
- **Disk**: tool and cache sizes are capped and shown, so a runner's disk does not fill silently.
  (Your Google Cloud VM is at 86% today; the page will show that.)

## 9. Tests

The same standard as Pipelines: real machines, real shells, nothing pretended.

- **setup**: install real Node, Python, Java and Go on the Debian OpenSSH machine and in the local
  container; the second run reuses the copy and transfers nothing; a wrong checksum is refused; the
  `PATH` reaches later steps in bash, sh and PowerShell. CI runs `setup` on real macOS and Windows.
- **cache**: miss then hit with a real `npm ci`; a changed lock file misses; a failed run saves
  nothing; a feature branch cannot write `main`'s cache; the size limit is honoured.
- **docker**: build and push to a throwaway local registry container, with login; the password
  appears in no log and no file after the step; build-args refuse `vault://`.
- **approval**: approve, reject, time out, role checks, self-approval off, and a server restart
  while waiting.
- Then deploy to app.zelyq.com and you test each step there before anything is pushed.

## 10. Order of work

Built and tested one after another, then deployed together for you to try:

1. The step framework (one handler per kind, `waiting`, the new tables).
2. `approval`: needs no runner changes; the most useful for safe deploys.
3. `setup`.
4. `cache`.
5. `docker`.
6. Editor, help, templates, docs.

## 11. Not in this plan

- **Matrix** (the same steps on several versions) and **steps side by side**: these change how a
  run is scheduled; a plan of their own.
- **Steps written by users** (like GitHub's marketplace actions) and reusable step templates.
- **Build secrets** in `docker` (`--secret`), test-report parsing (JUnit), and Kubernetes deploys,
  which belong to the coming Deploy module.

## 12. Decisions

All made on 2026-10-10.

1. ~~Who may approve~~ **Decided:** team admins and owners, including the person who started the
   run; `allow-self: false` when a second person must approve.
2. ~~Who downloads tools~~ **Decided:** the machine downloads them itself, like Jenkins, and only
   what the approved list names. The list lives in the Zelyq repository; contributors propose
   additions by pull request (section 3). The tool server comes in stage 2.
3. ~~Where a cache is kept~~ **Decided:** on the machine where the run ran (SSH runners), on the
   Zelyq server for the local runner. A hit transfers nothing; a different machine misses once.
4. ~~First tools~~ **Decided:** Node, Python, Java and Go.

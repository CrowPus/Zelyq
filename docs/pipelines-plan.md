# Pipelines: plan

Status: **approved 2026-10-10** (SSH runners, local runner in a container, two step types, team SSH key). **Built** — see [Pipelines](./pipelines.md) for how to use it. Pipelines replaces CrowFlow, under
**Ship** in the sidebar.

This plan comes from CrowFlow's code and its engineering notes:
`backendapp/backend/app/CROWFLOW_REFERENCE.txt` (the pipeline format),
`backendapp/docs/CROWFLOW_REMOTE_EXECUTION.md` (SSH runners), and
`docs/CROWFLOW_WINDOWS_AGENT_REVIEW.md` (what broke on real machines). Section 10 lists every
problem found there and where this plan handles it.

## Names used

Chosen to match what developers already know (GitHub Actions, GitLab CI, Jenkins, CircleCI):

| Term | Means | CrowFlow called it |
| --- | --- | --- |
| **Pipeline** | The defined work | Crowflow |
| **Pipeline file** (`.zelyq/pipeline.yml`) | Its definition, in YAML | Screenplay.yaml |
| **Stage**, **Step** | Groups of work, and one command | job / stage / task |
| **Run #N** | One execution | Job, Execution, build number |
| **Passed · Failed · Cancelled · Timed out** | How a run ended | completed / failed / completed_with_errors |
| **Runner** | Where a run executes: the **Local runner** or an **SSH runner** | Runner, host, sandbox |
| **Labels** | Tags a pipeline uses to pick a runner | category, labels, pool |
| **Trigger** | What starts a run: Manual, Push, Schedule, API | execute, schedule, webhook |
| **Team SSH key** | The key Zelyq uses to log into SSH runners | Project SSH key |
| **Re-run**, **Re-run from stage** | Repeat a run, whole or from a failed stage | retry, replay |
| **Artifacts** | Files a run keeps (a build to download) | builds, artifacts |
| **`continue-on-error`** | Keep going after a failed step | ignore_failure |
| **`vault://NAME`** | A secret from the team's Vault | `env=NAME` + `crowstore://NAME` + token |

## 1. What Pipelines is

A pipeline is the work after the code is written, run the same way every time:

```
Pipeline "Release"                       runs on: VM "build-01" (over SSH)
  Stage "Get"     ── checkout the code
  Stage "Check"   ── npm ci   ──  npm test
  Stage "Build"   ── npm run build
  Stage "Deploy"  ── ./deploy.sh        ← STRIPE_KEY comes from vault://STRIPE_KEY_LIVE
```

You press **Run** (later: a git push or a schedule starts it), watch each step's output live, and
see green or red per stage. Every run is kept with its full log.

## 2. Mapping from CrowFlow

| CrowFlow | Pipelines | Why |
| --- | --- | --- |
| Crowflow (a pipeline, in a project) | **Pipeline**, owned by the **team** | Standalone module, like Vault |
| Screenplay.yaml: jobs → stages → tasks | `stages → steps`, YAML | Same shape, smaller |
| 9 task types (checkout, shell, docker_build/push/pull, npm, kubectl, trivy, sonar) | **2**: `checkout` and `run` | The other 7 are commands; `run: npm ci` is the npm task |
| `env=NAME` + `crowstore://NAME` + `CROWSTORE_TOKEN_*` | `vault://NAME`, no token | The Vault decision |
| **Runner page: hosts (VMs) reached by SSH** | **SSH runners** | Kept: this is how CrowFlow gets into a VM |
| Project SSH key pair, rotation with a grace period, ping, audit | **Team SSH key**, rotation with a grace period, **Test connection**, audit | Kept, with the fixes in 4.4 |
| Job, Execution, ExecutionLog | **Run**, **Step result**, **Log line** | Same idea, clearer names |
| mode `sandbox` (cloud machines) | — | Zelyq hosts no machines for users |
| mode `windows-agent` (installed outbound program) | Later, only if needed | SSH covers VMs; see 3.3 |
| Approvals, cache, maintenance windows, drift, previews, matrix, AI co-worker, billing | Later or never | Not essential to run a pipeline |

## 3. Where a pipeline runs: local runner and SSH runners

```
              Zelyq server                                   your VMs
     ┌───────────────────────────┐          SSH        ┌──────────────────────┐
     │ Pipelines ── queue        │ ───────────────────▶│ build-01  (Linux)    │
     │      │                    │ ───────────────────▶│ mac-mini  (macOS)    │
     │ Local runner (container)  │ ───────────────────▶│ win-build (Windows)  │
     └───────────────────────────┘                     └──────────────────────┘
```

A pipeline names where it runs: `runs-on: local`, or an SSH runner by name or by label
(`runs-on: build-01`, `runs-on: [linux]`).

### 3.1 Local runner: on the Zelyq server itself

For a team that runs Zelyq on one machine and has no VM to give it.

**The danger, and how it is handled.** A step on the Zelyq server, running as Zelyq's own user,
could read Zelyq's encryption key and database, and so decrypt every Vault secret. So a local step
never runs as the Zelyq process does:

- **With Docker or Podman** (how app.zelyq.com runs): each run gets its own container with only its
  workspace mounted. It cannot see `data/`, the database or the encryption key. The same isolation
  app previews already use.
- **Without a container engine** (a laptop install on a Mac or a Windows PC): the local runner is
  **off**. An instance administrator can turn it on in Settings, after a warning that steps run as
  Zelyq's user. It is meant for one person on their own machine.

When Zelyq itself runs on a Mac or a Windows PC, the local runner uses that machine's shell (see
6.1) and, with Docker Desktop, the same containers.

### 3.2 SSH runner: a VM reached over SSH

This is how CrowFlow gets into a VM, and it is the main way to run pipelines.

**Adding one (admins):** name (`build-01`), address and port, SSH user, labels (`linux`,
`docker`, `staging`), a description. Zelyq shows the **team's public SSH key**; you add it to the
VM's `~/.ssh/authorized_keys` (on Windows: `administrators_authorized_keys` or the user's
`authorized_keys`, with the exact command shown).

**Test connection** connects and reports:

- the VM's **host key fingerprint**, which you confirm once and Zelyq then pins (4.4);
- latency;
- the operating system (Linux, macOS or Windows), detected, not guessed;
- the shells, and whether `git` and `docker` are present.

A runner cannot be used until a test has passed and its fingerprint was confirmed.

**The operating systems a VM can run:**

| VM | SSH server | Default shell for steps |
| --- | --- | --- |
| Linux | OpenSSH (standard) | `bash`, else `sh` |
| macOS | Built in: System Settings → General → Sharing → **Remote Login** | `bash` (macOS ships bash 3.2) or `zsh` |
| Windows | **OpenSSH Server** (an optional Windows feature; the exact PowerShell command to enable it is shown) | `pwsh` (PowerShell 7) if installed, else `powershell` |

### 3.3 What is left out, and why

- **No machines hosted by Zelyq** (CrowFlow's `sandbox`): this is self-hosted.
- **No installed runner program** for now. SSH reaches any VM you can log into. A machine that
  cannot accept SSH at all (behind a router with no port forwarding) is the one case it would add,
  and it can follow later using CrowFlow's proven Windows-runner design.

## 4. SSH keys and connections

### 4.1 The team key

- One SSH key pair **per team**, made by Zelyq: **Ed25519** by default; **RSA 4096** for old SSH
  servers that do not accept Ed25519.
- The private key is encrypted with Zelyq's instance key, the same way Vault is. It is never shown,
  never downloadable, never sent to a browser or the agent. The public key is shown with a copy
  button.

### 4.2 Rotation with a grace period (as CrowFlow)

**Rotate** makes a new key pair. For a grace period (7 days by default), both public keys are
listed and Zelyq tries the new key first, then the old one, so you can add the new key to every VM
before the old one stops working. Each runner shows which key it last accepted, so you can see
which VMs still need updating. After the grace period the old key is deleted.

### 4.3 Who can do what

| | Viewer | Editor | Admin / Owner |
| --- | --- | --- | --- |
| See pipelines, runs, logs, runners | ✓ | ✓ | ✓ |
| Create and edit pipelines; Run, Cancel, Re-run | | ✓ | ✓ |
| Use a Protected Vault secret in a pipeline | | | ✓ |
| Add, edit, test or remove runners; see the SSH key; rotate it | | | ✓ |
| Turn on the local runner without containers | instance administrators only | | |

### 4.4 Four things CrowFlow did that Pipelines will not

| CrowFlow | Risk | Pipelines |
| --- | --- | --- |
| Accepted any host key (`AutoAddPolicy`) | Anyone in the middle can pose as the VM and receive every secret a pipeline sends | The fingerprint is **pinned** at the first confirmed test; a change stops the run: "build-01's identity changed. Confirm the new fingerprint only if you reinstalled it." |
| Fell back to the server's `~/.ssh/id_rsa`, then `SSH_PASSWORD` | A pipeline could log in with the **server operator's** own key | Only the team key. No fallback, no passwords |
| Put secret values into the command text | Visible on the VM in `ps`, and possibly in shell history | The step script, secrets included, is sent through **stdin** (4.5); nothing in the command line, nothing on the VM's disk |
| Encrypted the key with a key derived from an environment variable | The key's protection rests on a value outside Zelyq's encryption | Zelyq's instance encryption, the same as Vault |

### 4.5 How a step runs on a VM

- One SSH connection per run; one SSH command per step.
- The command is fixed and contains no secret: `bash -s` on Linux and macOS,
  `pwsh -NoProfile -NonInteractive -OutputFormat Text -Command -` on Windows. The step's script,
  with its `vault://` values set as variables, is written to that command's **stdin**.
- Each run works in its own folder on the VM: `~/zelyq/runs/<run>` (on Windows
  `C:\zelyq\r\<run>`, short to stay under the path-length limit). It is kept after a failure for
  inspection and removed after a success.
- Output streams back live, stdout and stderr together.
- **Timeout** (whole step) and **stall timeout** (no output for 5 minutes, as CrowFlow) run on
  their own timer.
- **Cancel and timeouts stop the whole process tree on the VM:** on Linux and macOS the step runs
  in its own process group (`setsid`), which is signalled (TERM, then KILL after 10 seconds); on
  Windows, `taskkill /T /F`. Closing the SSH connection alone does not reliably stop a remote
  process, so this is done explicitly.
- A lost connection fails the step with "connection to build-01 was lost". It is not retried
  automatically, because a half-run deploy is not safe to repeat blindly. **Re-run** is one
  click.
- One run at a time per VM by default (configurable), so two pipelines cannot build in the same
  place at once.

## 5. The pipeline file

Kept in Zelyq and edited on the Pipelines page (with templates). Later it can also be read from
the repository (`.zelyq/pipeline.yml`).

```yaml
name: Release
runs-on: build-01                 # an SSH runner by name; or [linux, docker] by label; or local
source:
  app: Shop                       # an app in this team…
  # repo: https://github.com/me/shop   …or any git repository
  # token: vault://GITHUB_TOKEN
env:
  NODE_ENV: production
  STRIPE_KEY: vault://STRIPE_KEY_LIVE     # filled in when the step runs; masked in logs
timeout: 30m
stages:
  - name: Check
    steps:
      - run: npm ci
      - run: npm test
  - name: Build
    steps:
      - run: npm run build
  - name: Deploy
    steps:
      - run: ./deploy.sh
        shell: bash                # bash | sh | zsh | pwsh | powershell | cmd
        timeout: 10m
        continue-on-error: false
```

Validation happens on save, with the reason in plain words: an unknown runner, a step shell the
runner's OS does not have, a `vault://` name not in the team's Vault, a Protected secret used by
someone who is not an admin.

## 6. Running a step correctly on every operating system

### 6.1 Shells

| Runner OS | Default | Also allowed |
| --- | --- | --- |
| Linux | `bash` | `sh`, `pwsh` if installed |
| macOS | `bash` | `sh`, `zsh`, `pwsh` if installed |
| Windows | `pwsh` if installed, else `powershell` | `cmd`, `bash` (Git Bash) if installed |

The OS and available shells come from **Test connection**, so a pipeline is checked against the
real machine before it runs.

### 6.2 Output

- PowerShell runs with `-OutputFormat Text`, and every step gets `TERM=dumb` and `NO_COLOR=1`, so
  output is plain text rather than CLIXML blobs and colour codes shown as errors.
- Text is UTF-8; Windows `\r\n` endings are normalised for display.
- Output is read as it arrives, so logs are live and a full output buffer cannot hang a step.

### 6.3 Secrets

- `vault://NAME` is resolved by the server when the run starts and held in memory only.
- It reaches a step only as a variable inside the script sent on stdin (4.5): never on a command
  line, never in a file on the VM, never in the pipeline file.
- Values are **masked** in every log line before it is stored or shown, including their base64 and
  URL-encoded forms.
- A private repository's token is used for the checkout without appearing in the logged clone
  command.

## 7. Runs

- States: Queued → Running → **Passed** / **Failed** / **Cancelled** / **Timed out**. Stages show as coloured
  chips; steps show live output, duration and exit code.
- **Re-run** repeats a finished run with the pipeline exactly as it was then (a snapshot is
  taken when a run starts, as CrowFlow learned).
- Logs are kept per run, with a size cap per run and a retention period.
- A run's state is written as it changes, from the same code for the local runner and SSH runners, so the
  page can never show "running" for something that finished (CrowFlow G5).

## 8. Screens

- **Sidebar → Ship → Pipelines.**
- **Pipelines:** each pipeline with its last run (green / red / running), when, and who started it.
  **New pipeline** from a template: "Node app", "Python app", "Docker image", "Empty".
- **Pipeline:** the YAML editor with validation as you type, **Run**, and the run history.
- **Run #12:** stage chips, live step output, **Cancel** while running, **Re-run** after.
- **Runners** (admins): the local runner's state; each VM with OS, labels, latency, last test,
  pinned fingerprint, which key it accepts, and the run it is busy with. **Add VM**, **Test
  connection**, edit, disable, remove. **SSH key:** the public key(s) to copy, **Rotate**.
- **Activity:** who ran, cancelled, changed, added or rotated what (the team audit log).

## 9. How it is tested on Linux, macOS and Windows

The SSH executor is tested against **real SSH servers on all three operating systems on every pull
request**, on GitHub's own Linux, macOS and Windows machines (SSH into the machine itself:
OpenSSH on Linux, Remote Login on macOS, OpenSSH Server on Windows). Per OS:

- connect with the team key; a changed host key is refused;
- default and named shells, exit codes, live output order, UTF-8;
- timeout and Cancel stop the whole process tree on the VM;
- a secret never appears in the log, in the VM's process list, or on its disk;
- a dropped connection fails the step cleanly;
- key rotation: the old key keeps working during the grace period, then stops.

The local runner is tested in a container on Linux, and with its opt-in mode on macOS and Windows.

Then, before it reaches you: runs on app.zelyq.com against its local runner and a real VM.

## 10. Problems found in CrowFlow, and where each is handled

| Problem | Source | Handled by |
| --- | --- | --- |
| Accepted any host key | `command_executor.py:114` (`AutoAddPolicy`) | 4.4 pinned fingerprint |
| Fell back to the server's key and a password | REMOTE_EXECUTION §4 | 4.4 team key only |
| Secrets put into the command text | `execution_service.resolve_env_references` | 4.5 stdin |
| Key encrypted with an environment-derived key | REMOTE_EXECUTION §3 | 4.1 instance encryption |
| Output read only at exit; stdout/stderr deadlock (J1/J2) | Windows review §5 | 6.2 live reads |
| Timeouts never fired (J3) | Windows review §5 | 4.5 own timer |
| Commands pasted into a command line (J7) | Windows review §5 | 4.5 script on stdin |
| Workspace deleted on failure (J8) | Windows review §5 | 4.5 kept on failure |
| Child processes outliving the step | Windows review §8 D | 4.5 process-tree kill on the VM |
| CLIXML and colour codes shown as errors (G4) | Windows review §8 G | 6.2 |
| Masking only in one place (S9) | Windows review §4 | 6.3 masked before storing |
| Runs finished but the UI showed nothing (G5) | Windows review §8 G | 7 one code path |
| Private checkout unsupported (known gap 2) | Windows review §9 | 6.3 |
| "Passed here, broke on the machine" | Windows review §8 G | 9 real OS tests |

## 11. Phases

Each phase goes to app.zelyq.com for you to test before anything is pushed.

| Phase | Delivers | You can test |
| --- | --- | --- |
| **1. Pipelines + SSH runners** | Pipeline file and validation, `vault://`, the run queue, team SSH key, Add VM, Test connection with pinned fingerprint, running over SSH with live logs, Cancel, Re-run, the Pipelines and Runners pages, Linux/macOS/Windows CI tests | Add one of your VMs, press Run, watch it pass; break a test and watch it fail at the right step |
| **2. Local runner** | Runs in a container on the Zelyq server; opt-in mode without containers | A pipeline with `runs-on: local` on app.zelyq.com |
| **3. Triggers** | A git push (GitHub / GitLab webhook), a schedule, a service-key call | Push to GitHub and watch a run start |
| **4. Depth** | SSH key rotation with grace period, artifacts (download a build), **Re-run from stage**, `if:` conditions, notifications | Rotate the key across two VMs; download a build |

SSH runners come **first** because it is how you use CrowFlow today. **Deploy** is its own
module after this (Ship → Deploy), built on pipelines.

## 12. Decisions for you

1. **SSH runners: VMs reached over SSH**, as in CrowFlow, with the four fixes in 4.4.
   *(Your direction.)*
2. **The local runner runs inside a container** when Docker or Podman is available; **off**
   otherwise unless an instance admin turns it on with a warning. *(recommended)*
3. **Only two step types** in phase 1, `checkout` and `run`: Docker, npm, kubectl and the rest are
   commands inside `run`. *(recommended)*
4. **The SSH key belongs to the team** (CrowFlow: to the project), so one key covers all of a team's
   VMs and all its pipelines. *(recommended)*

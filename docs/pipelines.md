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

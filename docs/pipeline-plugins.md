# Pipeline plugins

A **pipeline plugin** is a ready-made step you can install in your team and use in any pipeline with
one line:

```yaml
- plugin: acme/slack-notify@1.0.0
  with:
    webhook: vault://SLACK_WEBHOOK
    message: Shop is live
```

Anyone can build one: it is a small folder with a `zelyq-plugin.yml` and, if it needs them, some
scripts, packed as a `.tar.gz`. A team admin installs the file in **Pipelines → Plugins**, and every
pipeline of the team can use it. A plugin runs **on the runner, as steps**, like any step you write
yourself: it never runs inside the Zelyq server.

> Not to be confused with [agent plugins](./plugins.md), which add tools the AI agent can call.

- [Your first plugin, in five minutes](#your-first-plugin-in-five-minutes)
- [zelyq-plugin.yml, field by field](#zelyq-pluginyml-field-by-field)
- [Inputs](#inputs)
- [Outputs](#outputs)
- [Steps, and what they can use](#steps-and-what-they-can-use)
- [Linux, macOS and Windows](#linux-macos-and-windows)
- [Packing a plugin](#packing-a-plugin)
- [Installing, using, updating, removing](#installing-using-updating-removing)
- [Versions](#versions)
- [Sharing a plugin, and installing someone else's](#sharing-a-plugin-and-installing-someone-elses)
- [Examples](#examples)
- [When something goes wrong](#when-something-goes-wrong)
- [Plugin, template or pipeline step?](#plugin-template-or-pipeline-step)

---

## Your first plugin, in five minutes

**1. Make a folder** called `hello`, with two files.

`hello/zelyq-plugin.yml`:

```yaml
id: acme/hello
version: 1.0.0
name: Hello
description: Says hello, and passes the greeting to the next step.
runs-on:
  os: [linux, macos]
inputs:
  who:
    description: Whom to greet
    default: world
outputs:
  greeting: What it said
steps:
  - name: Say hello
    run: |
      echo "Hello, $ZELYQ_INPUT_WHO!"
      echo "greeting=Hello, $ZELYQ_INPUT_WHO" >> "$ZELYQ_OUTPUT"
  - name: Run a script that comes with the plugin
    run: sh "$ZELYQ_PLUGIN_DIR/scripts/info.sh"
```

`hello/scripts/info.sh`:

```sh
echo "This script came inside the plugin."
echo "The project's files are here: $(pwd)"
```

**2. Pack it,** from the folder that contains `hello` (Linux, macOS, and Windows 10 or newer all have
`tar`):

```sh
tar -czf hello-1.0.0.tar.gz -C hello .
```

**3. Install it.** In Zelyq, open **Pipelines → Plugins**, press **Install from a file**, and choose
`hello-1.0.0.tar.gz`. A card for **Hello** appears, with its inputs and the lines to copy into a
pipeline. Installing needs the **admin** or **owner** role in the team.

**4. Use it** in a pipeline, and press **Run now**:

```yaml
name: Try my plugin
runs-on: local
stages:
  - name: Hello
    steps:
      - id: hello
        plugin: acme/hello@1.0.0
        with:
          who: team
      - run: echo "The plugin said ${{ steps.hello.outputs.greeting }}"
```

The run shows one step, **Plugin acme/hello**, with each of the plugin's steps inside it, then the
greeting passed on to the next step.

---

## zelyq-plugin.yml, field by field

| Field | Required | What it is |
| --- | --- | --- |
| `id` | yes | `publisher/name`, in lower-case letters, digits and `-`: `acme/slack-notify`. Use your company's or your own name as the publisher, so names do not clash. |
| `version` | yes | `MAJOR.MINOR.PATCH`, such as `1.0.0` or `2.1.0-beta.1`. See [Versions](#versions). |
| `name` | yes | What people see: `Slack notify`. |
| `description` | yes | One or two sentences: what it does. |
| `category` | no | `notifications`, `deploy`, `cloud`, `testing`, `security`, `build` or `other` (the default). |
| `runs-on.os` | no | The systems it works on: `[linux, macos, windows]`. On any other, the step fails with a clear message. Without it, every system is allowed. |
| `runs-on.needs` | no | Programs the machine must have: `[curl, python3]`. Shown on the plugin's card, so whoever uses it knows. |
| `inputs` | no | What the plugin takes. See [Inputs](#inputs). |
| `outputs` | no | What it gives later steps, each with a description. See [Outputs](#outputs). |
| `steps` | yes | 1 to 30 steps, run in order. See [Steps](#steps-and-what-they-can-use). |

Nothing else is allowed in the file: a misspelt field is refused when the plugin is installed, rather
than silently ignored.

## Inputs

```yaml
inputs:
  message:
    description: What to post
    default: "The run finished"
  channel:
    description: Where to post
    required: true
  webhook:
    description: The incoming-webhook address
    required: true
    secret: true
```

| Key | Meaning |
| --- | --- |
| `description` | Shown on the plugin's card. |
| `default` | Used when the pipeline does not give a value. |
| `required` | The pipeline must give a value (unless there is a default). Saving a pipeline that leaves it out is refused. |
| `secret` | The pipeline must give it as `vault://NAME`, from the team's Vault: typing a value is refused. Its value is masked as `***` wherever it appears in the log. A secret input has no default. |

**Your steps read an input as an environment variable**, `ZELYQ_INPUT_<NAME>` with the name in
capitals: `who` is `$ZELYQ_INPUT_WHO` in bash and sh, `$env:ZELYQ_INPUT_WHO` in PowerShell.

An input is never pasted into your script's text, so a value such as `x; rm -rf ~` stays a string
and cannot become a command. Keep it that way in your own scripts: always quote it,
`"$ZELYQ_INPUT_WHO"`, and never pass it to `eval`.

Input names are letters, digits and `_`. A pipeline giving a name the plugin does not have is
refused when it is saved.

## Outputs

A step writes `name=value` lines to the file in `$ZELYQ_OUTPUT`; for a value over several lines,
write `name<<END`, the lines, then `END`:

```sh
echo "url=https://example.com/build/42" >> "$ZELYQ_OUTPUT"
{
  echo "notes<<END"
  cat notes.txt
  echo "END"
} >> "$ZELYQ_OUTPUT"
```

List them under `outputs:` so people know they exist. A pipeline reads them through the plugin
step's `id`: `${{ steps.ID.outputs.url }}`. Without an `id` on the plugin step, the outputs are
simply not kept.

## Steps, and what they can use

Each step is one of:

| Step | Example |
| --- | --- |
| `run` | Commands, in the machine's default shell or the step's `shell` |
| `setup` | `setup: node@22`, `setup: python@3.12`, `setup: java@21`, `setup: go@1.26` (see [setup](./pipelines.md#setup-a-language-at-a-version)) |
| `cache` | `cache: node_modules` (see [cache](./pipelines.md#cache-keep-a-folder-between-runs)) |

A step may also have:

| Key | Meaning |
| --- | --- |
| `name` | Shown in the log: `› Post to Slack`. |
| `shell` | `bash`, `sh`, `zsh`, `pwsh` or `powershell`. Default: `bash` on Linux and macOS, `pwsh` on Windows. |
| `env` | Fixed variables for this step. Never secrets: a plugin takes secrets only as inputs. |

Steps that deploy, wait for an approval, start another pipeline or use another plugin are not
allowed in a plugin.

**What your steps can use:**

| Variable | What it is |
| --- | --- |
| `ZELYQ_INPUT_<NAME>` | Each input, given or default |
| `ZELYQ_PLUGIN_DIR` | The folder your plugin's files were unpacked into: run your scripts from here, `"$ZELYQ_PLUGIN_DIR/scripts/send.sh"` |
| `ZELYQ_OUTPUT` | The file to write outputs to |
| `ZELYQ_WORKSPACE` | The run's folder, with the project's files |
| `ZELYQ_RUN_ID`, `ZELYQ_RUN_NUMBER`, `ZELYQ_PIPELINE` | Which run this is |

**Where your steps run:** in the step's folder, which is the run's folder (the project, after a
`checkout`), or the `working-directory` the plugin step was given. So a plugin that uploads `dist/`
finds it where the pipeline built it.

Everything a step prints goes into the run's log, and a step stops at its first failing command. If
a step fails, the plugin stops there, and the plugin step fails, unless the pipeline gave it
`continue-on-error: true`.

## Linux, macOS and Windows

A plugin's steps run in the machine's default shell unless they name one: `bash` on Linux and macOS,
PowerShell 7 (`pwsh`) on Windows. Variables are written differently in each, so:

- **One system family:** set `runs-on: {os: [linux, macos]}` and write for bash, or
  `runs-on: {os: [windows]}` and write for PowerShell.
- **Every system:** put the work in a script in a language every machine has, and run it the same
  way on all of them, for example `node "$ZELYQ_PLUGIN_DIR/send.js"` after a `setup: node@22` step
  (`node` reads inputs from `process.env.ZELYQ_INPUT_…`). Name the step's `shell: pwsh` if every
  machine has PowerShell 7, which reads variables as `$env:NAME` on all three.

## Packing a plugin

```sh
tar -czf my-plugin-1.2.0.tar.gz -C my-plugin .
```

`-C my-plugin .` packs the folder's *contents*, so `zelyq-plugin.yml` is at the top of the package,
where Zelyq looks for it. Packing the folder itself (`tar -czf … my-plugin`) puts it one level down,
and the install is refused with a message saying so.

Zelyq accepts a package only if:

- it is a gzipped tar (`.tar.gz` or `.tgz`), at most **10 MB**, and at most 50 MB and 500 files
  unpacked;
- it holds only plain files and folders: **no symbolic links**, hard links or special files;
- every path stays inside the package (no `/…`, no `..`);
- `zelyq-plugin.yml` is at its top and valid.

Put in what the plugin needs and nothing else. A `README.md` saying what it does, what each input
means and which addresses it calls is good manners, and is what people read before installing it.

## Installing, using, updating, removing

**Installing** (team admins and owners): **Pipelines → Plugins → Install from a file**. Zelyq checks
the package, keeps its own copy on the server, and shows the plugin's card: its inputs (secret ones
marked), the systems it runs on, what it needs, its steps, its SHA-256, and the lines to copy into a
pipeline. Runs never download a plugin: they use that copy. Every install is in the team's
**Activity**.

**Using:** `plugin: publisher/name@version`, always with an exact version, and its inputs under
`with:`. Saving the pipeline checks that the plugin is installed, that every required input is
given, that secret inputs come from Vault, and that `with:` names only the plugin's inputs. A plugin
step works with everything else a step has: `id`, `if`, `timeout`, `continue-on-error`,
`working-directory`, and in [parallel stages, matrix copies and
templates](./pipelines.md#stages-at-the-same-time-a-machine-per-stage-matrix).

**Updating:** install the new version's package; both versions are then installed. Change each
pipeline's `plugin:` line to the new version when you are ready, and remove the old version once
nothing uses it.

**Removing:** the bin on the plugin's card. While a pipeline still uses that version, the card says
**used by** with a link to each, and removing is refused: change or delete those pipelines first.

| | Viewer | Editor | Admin, owner |
| --- | --- | --- | --- |
| See installed plugins | ✓ | ✓ | ✓ |
| Use a plugin in a pipeline | | ✓ | ✓ |
| Install and remove plugins | | | ✓ |

## Versions

- **A version never changes once installed.** Installing a different package with the same `id` and
  `version` is refused: change the package, raise the version. So a pipeline that names
  `acme/hello@1.0.0` always runs exactly what was installed, and **Run again** repeats it exactly.
- Installing the same file again is fine; nothing changes.
- Raise `PATCH` for fixes (`1.0.1`), `MINOR` for something new that works as before (`1.1.0`), and
  `MAJOR` when pipelines must change how they use it (`2.0.0`), and say what changed in a
  `CHANGELOG.md`.

## Sharing a plugin, and installing someone else's

A plugin is just a file, so share it the way you share any file: attach the `.tar.gz` to a GitHub
release, put it on your website, or send it to a colleague. Keep its source in a repository, with
the README, so people can read what they are installing.

**Before you install someone else's plugin,** remember it runs commands on your runners, with the
inputs and secrets you give it. Read it first: unpack it (`tar -xzf plugin.tar.gz -C look`), read
`zelyq-plugin.yml` and every script, and check:

- it does what its README says, and nothing more;
- it calls only the addresses it needs, and names them;
- it does not send secrets anywhere except where they belong (a Slack webhook to Slack);
- it does not download and run programs at run time;
- its scripts are readable, not minified or encoded.

Only the people you make team admins can install plugins.

## Examples

### Post to Slack or Discord

```yaml
id: acme/chat-notify
version: 1.0.0
name: Chat notify
description: Posts a message to a Slack or Discord incoming webhook.
category: notifications
runs-on:
  os: [linux, macos]
  needs: [curl, python3]
inputs:
  webhook:
    description: The incoming-webhook address, from Vault
    required: true
    secret: true
  message:
    description: What to post
    default: "A pipeline run finished"
steps:
  - name: Post the message
    run: |
      body=$(python3 -c 'import json, os; m = os.environ["ZELYQ_INPUT_MESSAGE"]; print(json.dumps({"text": m, "content": m}))')
      curl -fsS -X POST -H "content-type: application/json" -d "$body" "$ZELYQ_INPUT_WEBHOOK"
```

Slack reads `text`, Discord reads `content`; the message is turned into JSON by Python, so quotes in
it are safe. In a pipeline, run it only when something failed:

```yaml
  - name: Tell the team
    if: failure()
    steps:
      - plugin: acme/chat-notify@1.0.0
        with:
          webhook: vault://SLACK_WEBHOOK
          message: "Shop's pipeline failed"
```

### Lint a Node project, with a cache

```yaml
id: acme/node-lint
version: 1.0.0
name: Node lint
description: Installs dependencies and runs the project's lint script.
category: testing
steps:
  - setup: node@22
  - cache: node_modules
  - name: Install
    run: npm ci
  - name: Lint
    run: npm run lint
```

A plugin's `setup` takes a fixed version (inputs are not filled into the plugin's file). To follow
the project instead, use `setup: node`, which reads its `.nvmrc`.

### Windows: zip a folder

```yaml
id: acme/zip-folder
version: 1.0.0
name: Zip a folder
description: Packs a folder of the project into a zip file.
category: build
runs-on:
  os: [windows]
inputs:
  folder:
    description: The folder to pack
    default: dist
outputs:
  file: The zip file's name
steps:
  - name: Pack
    shell: pwsh
    run: |
      $name = "$env:ZELYQ_INPUT_FOLDER.zip"
      Compress-Archive -Path $env:ZELYQ_INPUT_FOLDER -DestinationPath $name -Force
      Add-Content -Path $env:ZELYQ_OUTPUT -Value "file=$name"
```

## When something goes wrong

**When installing:**

| Message | What to do |
| --- | --- |
| `there is no zelyq-plugin.yml in it` | Add the file, at the top of the folder you pack. |
| `zelyq-plugin.yml must be at the top of the package` | Pack the folder's contents: `tar -czf p.tar.gz -C my-plugin .` |
| `… is a link or a special file` | Replace symbolic links with real files. |
| `… points outside the package` | Pack with relative paths, as above. |
| `it is not a .tar.gz` | Pack with `tar -czf`, not as a zip. |
| `zelyq-plugin.yml: steps.2: Unrecognized key: "deploy"` (or any field) | Fix that field; the message says where. |
| `… is already installed with other content` | Raise `version`, pack again. |

**When saving a pipeline:**

| Message | What to do |
| --- | --- |
| `acme/x@1.0.0 is not installed for this team` | Install that version in Pipelines → Plugins, or fix the version in `plugin:`. |
| `acme/x needs with: NAME` | Give that input under `with:`. |
| `acme/x's NAME is a secret: give it as vault://NAME` | Put the value in Vault and write `vault://…`. |
| `acme/x has no input called NAME` | Remove it, or check the spelling against the plugin's card. |
| `Name a plugin and its exact version` | Write `publisher/name@1.2.0`, never without a version. |

**When running** (in the run's log):

| Message | What to do |
| --- | --- |
| `… runs on linux, macos; this machine is windows.` | Run it on a machine it supports (`runs-on`), or use a plugin made for that system. |
| `Could not unpack … (it needs tar)` | Install `tar` on the runner; it comes with Linux, macOS and Windows 10 or newer. |
| `pwsh is not installed on this machine` | Install PowerShell 7 on the runner, or use a plugin that does not need it. |

To try a plugin while writing it, install it in a team of your own with a small test pipeline, and
raise the version each time you install a changed package (`1.0.0-dev.1`, `1.0.0-dev.2`, …), then
remove the test versions.

## Plugin, template or pipeline step?

| Use | When |
| --- | --- |
| A **step** in the pipeline | It is used in one pipeline. |
| A **[template](./pipelines.md#templates-reuse-another-pipelines-stages)** (`uses:`) | Whole stages repeat across this team's pipelines, and the team edits them in Zelyq. |
| A **plugin** | One step's work, with inputs, that you want to version, share as a file, or use in several teams or Zelyq installations. |

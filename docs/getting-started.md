# Getting started

## Requirements

- **Node 20.11 or newer** (22 recommended). `node -v` to check.
- **pnpm 9** — `corepack enable` gives you the version this repo pins.
- An API key for one model provider:
  - **Claude** — <https://console.anthropic.com/settings/keys>, or
  - **Gemini** — <https://aistudio.google.com/apikey>.

## Install and run

```bash
git clone https://github.com/CrowPus/Zelyq.git
cd Zelyq
pnpm install

cp .env.example .env
$EDITOR .env          # set ANTHROPIC_API_KEY, or ZELYQ_PROVIDER=google + GEMINI_API_KEY

pnpm db:migrate       # creates ./data/zelyq.db
pnpm dev
```

Three processes start:

| Process | URL | What it does |
| --- | --- | --- |
| web | <http://localhost:5173> | The UI you use |
| server | <http://127.0.0.1:8787> | API, WebSocket, database |
| agent | <http://127.0.0.1:8788> | Model loop and tools |

Open the web URL and create a project.

## Windows

It works on Windows (PowerShell or Windows Terminal — no WSL needed). Two
things to know:

- **`Cannot find native binding` / a missing `@rolldown/binding-win32-x64-msvc`
  on first run.** The lockfile does declare that binary; this is a stale entry
  in pnpm's content-addressable store (the `npm/cli#4828` category — the
  package manager's cache, not this repo). Fix:

  ```powershell
  pnpm install --force
  ```

  If that alone doesn't clear it, `rmdir /s /q node_modules; pnpm store prune;
  pnpm install`.

- **Prefer a plain path over a synced folder** — OneDrive / Dropbox / Google
  Drive lock and partially-write `node_modules`, which is what makes the store
  corruption above more likely in the first place. `C:\dev\zelyq` beats
  `…\OneDrive\Desktop\zelyq`.

## Your first project

1. **Create a project.** Pick a stack in the dialog — **React + Vite + Tailwind** (the default)
   or **Expo — React Native**, which previews in the browser via Expo web. Either scaffolds into
   `./workspace/<project-id>`; those are ordinary files, open them in your editor if you like.
2. **Start the preview.** The first start runs `npm install`, so give it a minute — an Expo
   project's first Metro build takes a minute or two more on top. The dev server gets a port from
   the configured range and the UI embeds it. An Expo project runs on web only here; device and
   store builds are a separate step outside Zelyq.
3. **Ask for a change.** Something concrete works best:
   *"Add a pricing page with three tiers and a monthly/annual toggle, linked from the header."*
4. **Watch it work.** Tool calls appear as they run — expand one to see its output. Files the agent
   touches refresh in the file tree.

## Modes

Under the composer is a row of buttons. The default (no mode) is fine for a bounded change.
For anything bigger:

- **Engineer Mode** (👷) — for a feature or refactor you want to review: it states its purpose,
  separates what it verified from what it assumed, and names the alternative it didn't pick.
- **Architect Mode** (🧭) — for a whole app or subsystem: it interviews you, writes a full design
  package to `architecture/` (including a `DESIGN.md` design system), waits for "build it", then
  builds, verifies, and runs the **Designer agent** to apply the design.
- **Auto Mode** (∞, with Architect on) — runs the build passes on its own to a ceiling.
- In Engineer Mode, ask *"make it look professionally designed"* to call the Designer agent on an
  existing app.

Full detail: [modes.md](./modes.md).

## Troubleshooting

**"No … API key configured"** — the key for the selected provider is not reaching the agent
process. The message names the exact variable it looked for. Check, in order:

1. The key is in `.env` at the repository root, as `NAME=value` with no `export` and no quotes.
2. You restarted after editing it — `.env` is read once, at startup.
3. The agent logged `loaded /path/to/.env` on boot. No such line means it found no file.

Setting a variable in your shell also works, but it must be **exported**:
`export GEMINI_API_KEY=...`. Bash's `set NAME=value` does not create an environment variable — it
assigns a positional parameter, and the process will never see it.

**Nothing loads in the browser at all, on a VM or another remote machine** — check this first,
before anything else here. `ZELYQ_SERVER_HOST` and `ZELYQ_WEB_HOST` default to `127.0.0.1`, so the
server and the web dev server only accept connections from the machine they're running on — browsing
to the VM's public address gets refused even though everything is actually working. Set
`ZELYQ_SERVER_HOST=0.0.0.0` (and `ZELYQ_WEB_HOST=0.0.0.0` if you're running the web dev server
separately, rather than the built UI the server can serve on its own in `NODE_ENV=production`) — see
[Choosing a configuration](./configuration.md#choosing-a-configuration) for a full VM example.

**The preview never becomes ready** — open the Logs panel. Nearly always a dependency install
failure or a syntax error in generated code. Ask the agent to fix what the log says.

**The preview says the page refused to connect, but the rest of the app loads fine** — the same
cause as above, one level down: `ZELYQ_PREVIEW_HOST` also defaults to `127.0.0.1`, so project preview
servers only accept connections from the machine they're running on too, separately from the setting
above. Set it to your VM's address (or `0.0.0.0`). If a project's preview was already started before
you set this, changing the variable alone will not fix it: stop that project's preview so a fresh one
starts under the new setting (in `ZELYQ_RUNTIME=container`, Docker bakes a container's port binding
in when it's created, so an existing container needs to be removed, not just restarted). This is the
most common thing that looks like a broken deployment on a VM but is actually just this one setting.

**Port already in use** — another Zelyq or dev server is holding it. Change `ZELYQ_SERVER_PORT`,
`ZELYQ_AGENT_PORT`, or the `ZELYQ_PREVIEW_PORT_*` range in `.env`.

**Nothing streams into the chat** — check `/api/health`. If `agent.status` is not `ok`, the agent
process is down or `ZELYQ_AGENT_URL` points somewhere wrong.

## Where things live

```
./data/zelyq.db          the database (SQLite by default)
./workspace/<id>/        one directory per project — real files
./workspace/.snapshots/  snapshot copies
```

Deleting `./data` and `./workspace` resets Zelyq completely.

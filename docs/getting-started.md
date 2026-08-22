# Getting started

## Requirements

- **Node 20.11 or newer** (22 recommended). `node -v` to check.
- **pnpm 9** — `corepack enable` gives you the version this repo pins.
- An API key for one model provider:
  - **Claude** — <https://console.anthropic.com/settings/keys>, or
  - **Gemini** — <https://aistudio.google.com/apikey>.

## Install and run

```bash
git clone https://github.com/zelyq/zelyq.git
cd zelyq
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

## Your first project

1. **Create a project.** A React + Vite + Tailwind template is scaffolded into
   `./workspace/<project-id>`. Those are ordinary files — open them in your editor if you like.
2. **Start the preview.** The first start runs `npm install`, so give it a minute. The dev server
   gets a port from the configured range and the UI embeds it.
3. **Ask for a change.** Something concrete works best:
   *"Add a pricing page with three tiers and a monthly/annual toggle, linked from the header."*
4. **Watch it work.** Tool calls appear as they run — expand one to see its output. Files the agent
   touches refresh in the file tree.

## Troubleshooting

**"No … API key configured"** — the key for the selected provider is not reaching the agent
process. The message names the exact variable it looked for. Check, in order:

1. The key is in `.env` at the repository root, as `NAME=value` with no `export` and no quotes.
2. You restarted after editing it — `.env` is read once, at startup.
3. The agent logged `loaded /path/to/.env` on boot. No such line means it found no file.

Setting a variable in your shell also works, but it must be **exported**:
`export GEMINI_API_KEY=...`. Bash's `set NAME=value` does not create an environment variable — it
assigns a positional parameter, and the process will never see it.

**The preview never becomes ready** — open the Logs panel. Nearly always a dependency install
failure or a syntax error in generated code. Ask the agent to fix what the log says.

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

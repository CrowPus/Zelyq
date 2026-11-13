import { parsePipelineFile } from "@zelyq/core";

/**
 * Pipelines Ops writes (072 §2.7). A pipeline step can run any command on a
 * machine, so a pipeline is the one place Ops could do anything at all. A
 * pipeline made only of Zelyq's own steps (checkout, setup, cache, docker,
 * deploy, …) and of the well-known commands below is "building blocks only"
 * and is an ordinary change. Anything else is a command Ops wrote itself: it
 * is shown to a person, word for word, and confirmed on its own.
 */

const EXACT = new Set([
  "npm ci",
  "npm install",
  "npm test",
  "npm run build",
  "pnpm install",
  "pnpm install --frozen-lockfile",
  "pnpm test",
  "yarn install",
  "yarn install --frozen-lockfile",
  "yarn test",
  "bun install",
  "bun test",
  "pip install -r requirements.txt",
  "python -m pip install -r requirements.txt",
  "pytest",
  "python -m pytest",
  "go test ./...",
  "go build ./...",
  "npx prisma migrate deploy",
  "npx prisma generate",
  "npx drizzle-kit migrate",
  "alembic upgrade head",
  "python manage.py migrate",
  "python manage.py migrate --noinput",
  "python manage.py collectstatic --noinput",
  "rails db:migrate",
  "bundle exec rails db:migrate",
  "bundle install",
]);

const PATTERNS: RegExp[] = [
  // A script the app itself defines.
  /^(npm|pnpm|bun) run [A-Za-z0-9:_.-]+$/,
  /^yarn [A-Za-z0-9:_.-]+$/,
  // A file of the app itself.
  /^node [A-Za-z0-9_./-]+\.(js|mjs|cjs)$/,
  /^python3? [A-Za-z0-9_./-]+\.py$/,
  /^python3? -m [A-Za-z0-9_.]+$/,
  /^(gunicorn|uvicorn) [A-Za-z0-9_.:]+( --[a-z-]+(=| )[A-Za-z0-9_.:/-]+)*$/,
];

/** Whether one command is a well-known one (several joined by && each count). */
export function isKnownCommand(command: string): boolean {
  const parts = command
    .trim()
    .split(/\s*&&\s*/)
    .map((part) => part.trim().replace(/\s+/g, " "));
  return (
    parts.length > 0 &&
    parts.every((part) => EXACT.has(part) || PATTERNS.some((pattern) => pattern.test(part)))
  );
}

export interface BlockCheck {
  ok: boolean;
  /** The file's own problem, when it is not a valid pipeline. */
  error: string | null;
  /** Commands Ops wrote itself: each is shown to a person before the pipeline is saved. */
  free: string[];
  /** The environments its deploy steps go to. */
  deploysTo: string[];
}

/** Reads a pipeline Ops wants to save: what it deploys to, and every command not from a block. */
export function checkBlocks(source: string): BlockCheck {
  const parsed = parsePipelineFile(source);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.issues
        .map((issue) => `${issue.line ? `line ${issue.line}: ` : ""}${issue.message}`)
        .join("; "),
      free: [],
      deploysTo: [],
    };
  }
  const free: string[] = [];
  const deploysTo = new Set<string>();
  const note = (command: string | undefined) => {
    if (command && !isKnownCommand(command)) free.push(command);
  };
  for (const stage of parsed.file.stages) {
    for (const step of stage.steps) {
      if (step.run !== undefined) note(step.run);
      if (step.deploy) {
        deploysTo.add(step.deploy.to);
        note(step.deploy.start);
        note(step.deploy.migrate);
        for (const command of Object.values(step.deploy.processes ?? {})) note(command);
      }
    }
  }
  return { ok: true, error: null, free: [...new Set(free)], deploysTo: [...deploysTo] };
}

/** What Ops reads before writing a pipeline: the blocks it may use freely. */
export const BLOCKS_GUIDE = `Pipelines you write are built from blocks. Use only these and the pipeline is an ordinary change:
- Zelyq's own steps: checkout, setup (node@22, python@3.12, go@1.23, …), cache, docker, deploy (with database, migrate, volumes, processes, memory), approval, download.
- Well-known commands: ${[...EXACT].join("; ")}.
- A script the app defines: npm run <name>, pnpm run <name>, yarn <name>, bun run <name>.
- A file of the app: node <file>.js, python <file>.py, python -m <module>, gunicorn/uvicorn <module:app>.
Anything else is a command you wrote yourself: a person reads it word for word and confirms it on its own. Prefer a script in the app over a command of your own.

A launch pipeline, as a starting point:
name: <App> deploy
runs-on: <machine>
source: {app: <App>}
stages:
  - name: Test
    steps: [{checkout: true}, {setup: node@22}, {run: npm ci}, {run: npm test}]
  - name: Staging
    needs: Test
    steps:
      - checkout: true
      - deploy: {to: staging, port: 3000, health: /, database: postgres, migrate: npm run migrate}
  - name: Production
    needs: Staging
    steps:
      - checkout: true
      - deploy: {to: production, port: 3000, health: /, database: postgres, migrate: npm run migrate}`;

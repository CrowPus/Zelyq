import { z } from "zod";
import { inspectScript, planBuild, readInspection } from "../../build-detect.js";
import type { ActionContext, OpsAction } from "../actions.js";
import { environmentRow, nameField } from "./shared.js";

/** Variables a platform gives an app by itself: not secrets anyone has to add. */
const PROVIDED = new Set([
  "NODE_ENV",
  "PORT",
  "HOST",
  "HOSTNAME",
  "PWD",
  "HOME",
  "PATH",
  "TZ",
  "CI",
]);

/** What the survey looks for beyond how the app builds. */
const SURVEY_SCRIPT = [
  'grep -rhoE "process\\.env\\.[A-Z_][A-Z0-9_]*|process\\.env\\[.[A-Z_][A-Z0-9_]*|import\\.meta\\.env\\.[A-Z_][A-Z0-9_]*|os\\.environ(\\.get)?[\\[(].[A-Z_][A-Z0-9_]*|os\\.getenv\\(.[A-Z_][A-Z0-9_]*|ENV\\[.[A-Z_][A-Z0-9_]*" . --include=*.js --include=*.mjs --include=*.cjs --include=*.ts --include=*.tsx --include=*.jsx --include=*.py --include=*.rb --include=*.go --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=.next 2>/dev/null | grep -oE "[A-Z_][A-Z0-9_]*$" | sort -u | sed "s/^/ENV /"',
  'for d in prisma/migrations migrations alembic drizzle db/migrate supabase/migrations; do [ -d "$d" ] && echo "MIGRATIONS $d"; done',
  'for f in worker.js worker.ts worker.py jobs queue Procfile; do [ -e "$f" ] && echo "WORKER $f"; done',
  'grep -rhoE "listen\\(\\s*[0-9]{2,5}|PORT\\s*(\\|\\||or|:?=)\\s*[0-9]{2,5}" . --include=*.js --include=*.ts --include=*.mjs --include=*.py --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | grep -oE "[0-9]{2,5}$" | sort -u | head -3 | sed "s/^/PORT /"',
  "",
].join("\n");

async function projectByName(ctx: ActionContext, name: string) {
  const projects = await ctx.services.store.projects.listForTeams([ctx.teamId], 500);
  const found = projects.find(
    (project) => project.name.toLowerCase() === name.trim().toLowerCase(),
  );
  if (!found) throw new Error(`There is no app called ${name} in this team.`);
  return found;
}

interface Survey {
  app: string;
  kind: string;
  start: string | null;
  ownDockerfile: boolean;
  ports: number[];
  variables: string[];
  migrations: string[];
  workers: string[];
  scripts: Record<string, string>;
  database: string | null;
  problem: string | null;
}

async function survey(ctx: ActionContext, name: string): Promise<Survey> {
  const project = await projectByName(ctx, name);
  const inspected = await ctx.services.runtime.exec(project.id, {
    command: inspectScript(),
    timeoutMs: 60_000,
    maxOutputBytes: 2_000_000,
  });
  const files = readInspection(inspected.stdout);
  const extra = await ctx.services.runtime.exec(project.id, {
    command: SURVEY_SCRIPT,
    timeoutMs: 60_000,
    maxOutputBytes: 500_000,
  });
  const lines = extra.stdout.split("\n");
  const tagged = (tag: string) =>
    lines
      .filter((line) => line.startsWith(`${tag} `))
      .map((line) => line.slice(tag.length + 1).trim());
  const plan = files ? planBuild(files, 3000, null) : null;
  let scripts: Record<string, string> = {};
  let dependencies: string[] = [];
  try {
    const pkg = JSON.parse(files?.contents["package.json"] ?? "{}") as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    scripts = pkg.scripts ?? {};
    dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  } catch {
    // not a Node app
  }
  const requirements = files?.contents["requirements.txt"] ?? "";
  const usesPostgres =
    dependencies.some((dependency) =>
      [
        "pg",
        "postgres",
        "@prisma/client",
        "drizzle-orm",
        "pg-promise",
        "knex",
        "sequelize",
        "typeorm",
        "@neondatabase/serverless",
      ].includes(dependency),
    ) || /psycopg|asyncpg|sqlalchemy|django/i.test(requirements);
  const variables = tagged("ENV");
  return {
    app: project.name,
    kind: files === null ? "its own Dockerfile" : plan?.ok ? plan.kind : "unknown",
    start: plan?.ok ? plan.start : null,
    ownDockerfile: files === null,
    ports: tagged("PORT")
      .map(Number)
      .filter((port) => port > 0),
    variables,
    migrations: tagged("MIGRATIONS"),
    workers: tagged("WORKER"),
    scripts,
    database: usesPostgres || variables.includes("DATABASE_URL") ? "postgres" : null,
    problem: plan && !plan.ok ? plan.error : null,
  };
}

const surveyInput = z.object({ app: nameField("app") }).strict();
const surveyApp: OpsAction<z.infer<typeof surveyInput>> = {
  name: "survey_app",
  description:
    "Look at an app before planning: what kind it is, how it starts, its port, the variables it reads, its database and how it is updated, workers, scripts.",
  input: surveyInput,
  risk: "read",
  words: (inputs) => `Look at the app ${inputs.app}`,
  async run(ctx, inputs) {
    const found = await survey(ctx, inputs.app);
    return {
      ok: true,
      summary: `${found.app}: ${found.kind}${found.start ? `, starts with ${found.start}` : ""}${found.database ? `, uses ${found.database}` : ""}; reads ${found.variables.length} variables.`,
      data: found,
    };
  },
};

const listSecretNames: OpsAction<Record<string, never>> = {
  name: "list_secret_names",
  description: "The names in the team's Vault. Never their values: nobody's tools can read those.",
  input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  risk: "read",
  words: () => "Look at the names in the team's Vault",
  async run(ctx) {
    const entries = await ctx.services.vault.list(ctx.user, { kind: "team", teamId: ctx.teamId });
    const names = entries.map((entry) => entry.name).sort();
    return { ok: true, summary: `${names.length} secrets in Vault.`, data: names };
  },
};

const neededInput = z
  .object({ app: nameField("app"), environment: nameField("environment") })
  .strict();
const neededSecrets: OpsAction<z.infer<typeof neededInput>> = {
  name: "needed_secrets",
  description:
    "The variables an app reads that an environment does not give it yet, and which of them are already in Vault.",
  input: neededInput,
  risk: "read",
  words: (inputs) => `Find what ${inputs.app} needs on ${inputs.environment}`,
  async run(ctx, inputs) {
    const found = await survey(ctx, inputs.app);
    const environment = await environmentRow(ctx, inputs.environment);
    const given = new Set(
      Object.keys(JSON.parse(environment.variables) as Record<string, unknown>),
    );
    const inVault = new Set(
      (await ctx.services.vault.list(ctx.user, { kind: "team", teamId: ctx.teamId })).map(
        (entry) => entry.name,
      ),
    );
    const missing = found.variables.filter(
      (name) =>
        !given.has(name) && !PROVIDED.has(name) && !(name === "DATABASE_URL" && found.database),
    );
    return {
      ok: true,
      summary: missing.length
        ? `${inputs.environment} does not give ${inputs.app}: ${missing.join(", ")}.`
        : `${inputs.environment} gives ${inputs.app} every variable it reads.`,
      data: missing.map((name) => ({ name, inVault: inVault.has(name) })),
    };
  },
};

const requestInput = z
  .object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, "A variable name, like STRIPE_KEY."),
    why: z.string().trim().min(1).max(500),
  })
  .strict();
const requestSecret: OpsAction<z.infer<typeof requestInput>> = {
  name: "request_secret",
  description:
    "Ask the person to put a secret in the team's Vault (Ops never sees or types a secret). Use secret_present to see when it is there.",
  input: requestInput,
  risk: "read",
  words: (inputs) => `Ask you to add ${inputs.name} to Vault`,
  async run(ctx, inputs) {
    await ctx.say(
      `I need a secret from you: please add **${inputs.name}** to the team's Vault (Vault → New secret). ${inputs.why} I never see its value.`,
    );
    return { ok: true, summary: `Asked for ${inputs.name}.` };
  },
};

const presentInput = z.object({ name: z.string().min(1).max(128) }).strict();
const secretPresent: OpsAction<z.infer<typeof presentInput>> = {
  name: "secret_present",
  description: "Whether a secret of this name is in the team's Vault now.",
  input: presentInput,
  risk: "read",
  words: (inputs) => `Check whether ${inputs.name} is in Vault`,
  async run(ctx, inputs) {
    const present = (
      await ctx.services.vault.list(ctx.user, { kind: "team", teamId: ctx.teamId })
    ).some((entry) => entry.name === inputs.name);
    return {
      ok: present,
      summary: present ? `${inputs.name} is in Vault.` : `${inputs.name} is not in Vault yet.`,
    };
  },
};

const journalInput = z.object({ limit: z.number().int().min(1).max(50).optional() }).strict();
const journal: OpsAction<z.infer<typeof journalInput>> = {
  name: "journal",
  description: "What Ops did before in this team: its recent jobs, what was asked, how each ended.",
  input: journalInput,
  risk: "read",
  words: () => "Read the journal",
  async run(ctx, inputs) {
    const jobs = await ctx.services.store.ops.jobs.listForTeam(ctx.teamId, inputs.limit ?? 15);
    return {
      ok: true,
      summary: `${jobs.length} recent jobs.`,
      data: jobs.map((job) => ({
        request: job.request,
        kind: job.kind,
        stage: job.stage,
        outcome: job.outcome,
        at: job.createdAt,
      })),
    };
  },
};

export const UNDERSTANDING_ACTIONS = [
  surveyApp,
  listSecretNames,
  neededSecrets,
  requestSecret,
  secretPresent,
  journal,
] as unknown as OpsAction[];

import { parseDocument } from "yaml";
import { z } from "zod";

/**
 * Pipelines — the work after the code is written, run the same way every time.
 *
 * A pipeline is a YAML file: stages run in order, steps inside a stage run in
 * order, and a step is either `checkout` (get the source) or `run` (commands).
 * Everything else — npm, docker, kubectl — is a command inside `run`.
 *
 * This module is imported by the browser as well as the server, so the editor
 * validates with exactly the rules the server enforces.
 */

// ---------------------------------------------------------------------------
// Durations: "90s", "30m", "1h", "1h30m", or a number of seconds
// ---------------------------------------------------------------------------

const MAX_DURATION_SECONDS = 24 * 60 * 60;

/** Seconds for a duration, or null when it cannot be read. */
export function parseDuration(value: string | number): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  const text = value.trim();
  if (!/^(\d+d)?(\d+h)?(\d+m)?(\d+s)?$/.test(text) || text === "") return null;
  const part = (unit: string) => Number(new RegExp(`(\\d+)${unit}`).exec(text)?.[1] ?? 0);
  const seconds = part("d") * 86400 + part("h") * 3600 + part("m") * 60 + part("s");
  return seconds > 0 ? seconds : null;
}

const durationSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const seconds = parseDuration(value);
  if (seconds === null || seconds > MAX_DURATION_SECONDS) {
    ctx.addIssue({
      code: "custom",
      message: "Use a duration like 90s, 30m or 1h (at most 24h).",
    });
    return z.NEVER;
  }
  return seconds;
});

// ---------------------------------------------------------------------------
// Values and secrets
// ---------------------------------------------------------------------------

/** `vault://NAME` — a secret from the team's Vault, filled in when the step runs. */
export const VAULT_REFERENCE = /^vault:\/\/([A-Za-z][A-Za-z0-9_.-]{0,127})$/;

export function vaultReferenceName(value: string): string | null {
  return VAULT_REFERENCE.exec(value.trim())?.[1] ?? null;
}

const envNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, "Use letters, digits and underscores (STRIPE_KEY).");
const envValueSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .transform((value) => String(value))
  .refine((value) => !value.startsWith("vault://") || vaultReferenceName(value) !== null, {
    message: "A Vault reference is vault://NAME, with the secret's name.",
  });
const envSchema = z.record(envNameSchema, envValueSchema);

// ---------------------------------------------------------------------------
// The pipeline file
// ---------------------------------------------------------------------------

export const PIPELINE_SHELLS = ["bash", "sh", "zsh", "pwsh", "powershell"] as const;
export type PipelineShell = (typeof PIPELINE_SHELLS)[number];

/** When a step or stage runs, relative to what happened before it. */
export const PIPELINE_CONDITIONS = ["success()", "failure()", "always()"] as const;
export type PipelineCondition = (typeof PIPELINE_CONDITIONS)[number];
const conditionSchema = z.enum(PIPELINE_CONDITIONS, {
  message: "Use success(), failure() or always().",
});

const relativePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (path) =>
      !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.split(/[\\/]/).includes(".."),
    {
      message: "Use a path inside the run's folder, like dist or build/output.",
    },
  );

// ---------------------------------------------------------------------------
// Built-in steps (see docs/pipeline-steps-plan.md)
// ---------------------------------------------------------------------------

/** Languages `setup` can put on a machine. */
export const PIPELINE_TOOLS = ["node", "python", "java", "go"] as const;
export type PipelineTool = (typeof PIPELINE_TOOLS)[number];
const TOOL_NAMES: Record<PipelineTool, string> = {
  node: "Node",
  python: "Python",
  java: "Java",
  go: "Go",
};

const toolVersionSchema = z
  .string()
  .trim()
  .regex(/^(lts|\d+(\.\d+){0,2})$/, "Use a version like 22, 22.11, 22.11.0 or lts.");

/** `setup: node@22`, `setup: node`, or `setup: {tool: node, version: "22"}`. */
const setupSchema = z
  .union([
    z.string().trim(),
    z
      .object({ tool: z.string().trim(), version: z.union([z.string(), z.number()]).optional() })
      .strict(),
  ])
  .transform((value, ctx) => {
    const [tool, version] =
      typeof value === "string"
        ? (value.split("@") as [string, string | undefined])
        : [value.tool, value.version === undefined ? undefined : String(value.version)];
    if (!(PIPELINE_TOOLS as readonly string[]).includes(tool)) {
      ctx.addIssue({ code: "custom", message: `setup knows ${PIPELINE_TOOLS.join(", ")}.` });
      return z.NEVER;
    }
    if (version !== undefined && !toolVersionSchema.safeParse(version).success) {
      ctx.addIssue({ code: "custom", message: "Use a version like 22, 22.11, 22.11.0 or lts." });
      return z.NEVER;
    }
    if (version === "lts" && tool !== "node") {
      ctx.addIssue({
        code: "custom",
        message: "lts is a Node version; give a number for other tools.",
      });
      return z.NEVER;
    }
    return { tool: tool as PipelineTool, version: version ?? null };
  });

const cachePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !/^[A-Za-z]:/.test(path) &&
      !path.split(/[\\/]/).includes("..") &&
      path !== "~",
    {
      message: "Use a folder inside the run's folder (node_modules) or in the home folder (~/.m2).",
    },
  );

/** `cache: node_modules` or `cache: {path: …, key: …}`. */
const cacheSchema = z
  .union([
    cachePathSchema,
    z
      .object({
        path: cachePathSchema,
        key: z.union([relativePathSchema, z.array(relativePathSchema).min(1).max(20)]).optional(),
      })
      .strict(),
  ])
  .transform((value) =>
    typeof value === "string"
      ? { path: value, key: null as string[] | null }
      : { path: value.path, key: value.key === undefined ? null : [value.key].flat() },
  );

const imageSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9]+([._-][a-z0-9]+)*(:[0-9]+)?(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/,
    "Use an image name without a tag, like registry.example.com/team/shop.",
  );
const tagSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_.${}-]{1,128}$/,
    "A tag is letters, digits, '.', '_' or '-' (or $ZELYQ_RUN_NUMBER).",
  );

const dockerSchema = z
  .object({
    image: imageSchema,
    tags: z.array(tagSchema).min(1).max(20).default(["latest"]),
    file: relativePathSchema.optional(),
    context: relativePathSchema.optional(),
    "build-args": z
      .record(
        envNameSchema,
        envValueSchema.refine((value) => vaultReferenceName(value) === null, {
          message: "A build argument ends up inside the image: never put a Vault secret in one.",
        }),
      )
      .optional(),
    push: z.boolean().default(false),
    login: z
      .object({
        registry: z.string().trim().min(1).max(253).optional(),
        username: z.string().trim().min(1).max(200),
        password: envValueSchema.refine((value) => vaultReferenceName(value) !== null, {
          message: "A registry password must come from Vault: vault://NAME.",
        }),
      })
      .strict()
      .optional(),
  })
  .strict();

export const APPROVERS = ["admins", "editors"] as const;
export type Approvers = (typeof APPROVERS)[number];
const MAX_APPROVAL_SECONDS = 7 * 24 * 60 * 60;

/** `approval: Deploy?` or `approval: {message, approvers, timeout, allow-self}`. */
const approvalSchema = z
  .preprocess(
    // The short form is just the question.
    (value) => (typeof value === "string" ? { message: value } : value),
    z
      .object({
        message: z.string().trim().min(1, "Say what is being approved.").max(500),
        approvers: z.enum(APPROVERS, { message: "Use admins or editors." }).optional(),
        timeout: z
          .union([z.string(), z.number()])
          .transform((value, ctx) => {
            const seconds = parseDuration(value);
            if (seconds === null || seconds > MAX_APPROVAL_SECONDS) {
              ctx.addIssue({
                code: "custom",
                message: "Use a duration like 4h or 2d, at most 7d.",
              });
              return z.NEVER;
            }
            return seconds;
          })
          .optional(),
        "allow-self": z.boolean().optional(),
      })
      .strict(),
  )
  .transform((form) => ({
    message: form.message,
    approvers: form.approvers ?? ("admins" as Approvers),
    timeout: form.timeout ?? 24 * 60 * 60,
    allowSelf: form["allow-self"] ?? true,
  }));

/** Environment names: staging, production, eu-1 … */
export const environmentNameSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, "Use lower-case letters, digits and '-' (staging, production).");

/** `deploy: {to: production, port: 3000, …}` — see docs/deploy-plan.md. */
const deploySchema = z
  .object({
    to: environmentNameSchema,
    app: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use lower-case letters, digits and '-' (shop).")
      .optional(),
    port: z.number().int().min(1).max(65535),
    "host-port": z.number().int().min(1).max(65535).optional(),
    health: z
      .string()
      .trim()
      .regex(/^\/[^\s]*$/, "A path on the app, like / or /health.")
      .default("/"),
    "health-timeout": durationSchema.optional(),
    url: z.string().url("Use the full address, like https://shop.example.com.").optional(),
  })
  .strict();

/** `pipeline: {run: Shop deploy, wait: true, with: {…}}` — start a downstream pipeline. */
const pipelineStepSchema = z
  .object({
    run: z.string().trim().min(1).max(100),
    wait: z.boolean().default(true),
    with: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String))
      .default({}),
  })
  .strict();

/** `download: {artifact: dist, from: upstream}` — files another run kept. */
const downloadSchema = z
  .object({
    artifact: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,100}$/, "Use the artifact's name, like dist."),
    from: z.string().trim().min(1).max(100).default("upstream"),
    path: relativePathSchema.optional(),
  })
  .strict();

export const STEP_KINDS = [
  "run",
  "checkout",
  "setup",
  "cache",
  "docker",
  "approval",
  "deploy",
  "pipeline",
  "download",
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

const stepSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    run: z.string().min(1).max(100_000).optional(),
    checkout: z.literal(true).optional(),
    setup: setupSchema.optional(),
    cache: cacheSchema.optional(),
    docker: dockerSchema.optional(),
    approval: approvalSchema.optional(),
    deploy: deploySchema.optional(),
    pipeline: pipelineStepSchema.optional(),
    download: downloadSchema.optional(),
    retry: z.number().int().min(0).max(5).optional(),
    shell: z
      .enum(PIPELINE_SHELLS, { message: `Use one of: ${PIPELINE_SHELLS.join(", ")}.` })
      .optional(),
    timeout: durationSchema.optional(),
    "continue-on-error": z.boolean().optional(),
    "working-directory": relativePathSchema.optional(),
    env: envSchema.optional(),
    if: conditionSchema.optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    if (
      step.retry !== undefined &&
      (step.deploy || step.approval || step.pipeline || step.download)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["retry"],
        message: "retry is for run, checkout, setup and docker steps.",
      });
    }
    const kinds = STEP_KINDS.filter((kind) => step[kind] !== undefined);
    if (kinds.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message:
          kinds.length === 0
            ? `A step needs one of: ${STEP_KINDS.join(", ")}.`
            : `A step is one thing; this one has ${kinds.join(" and ")}. Make them separate steps.`,
      });
    }
  });

/** Which kind a (valid) step is. */
export function stepKind(step: { [K in StepKind]?: unknown }): StepKind {
  return STEP_KINDS.find((kind) => step[kind] !== undefined) ?? "run";
}

/** What a step is called in the run's list, when the file does not name it. */
export function stepLabel(step: PipelineStep): string {
  if (step.name) return step.name;
  switch (stepKind(step)) {
    case "checkout":
      return "Checkout";
    case "setup":
      return `Set up ${TOOL_NAMES[step.setup?.tool ?? "node"]}${step.setup?.version ? ` ${step.setup.version}` : ""}`;
    case "cache":
      return `Cache ${step.cache?.path ?? ""}`;
    case "docker":
      return `Docker: ${step.docker?.image.split("/").pop() ?? ""}${step.docker?.push ? " (push)" : ""}`;
    case "approval":
      return "Approval";
    case "deploy":
      return `Deploy to ${step.deploy?.to ?? ""}`;
    case "pipeline":
      return `Run ${step.pipeline?.run ?? ""}`;
    case "download":
      return `Download ${step.download?.artifact ?? ""}`;
    default: {
      const first = (step.run ?? "").trim().split("\n")[0] ?? "";
      return first.length > 60 ? `${first.slice(0, 57)}…` : first || "Run";
    }
  }
}

const stageSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    if: conditionSchema.optional(),
    steps: z.array(stepSchema).min(1, "A stage needs at least one step.").max(100),
  })
  .strict();

const sourceSchema = z
  .object({
    app: z.string().trim().min(1).max(200).optional(),
    repo: z.string().url("Use the repository's https:// address.").optional(),
    ref: z.string().trim().min(1).max(200).optional(),
    token: envValueSchema.optional(),
  })
  .strict()
  .superRefine((source, ctx) => {
    if ((source.app === undefined) === (source.repo === undefined)) {
      ctx.addIssue({ code: "custom", message: "A source is either app: or repo: — one of them." });
    }
    if (source.repo && !source.repo.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["repo"],
        message: "Use the repository's https:// address.",
      });
    }
    if (source.token !== undefined && vaultReferenceName(source.token) === null) {
      ctx.addIssue({
        code: "custom",
        path: ["token"],
        message: "A token must come from Vault: vault://NAME, never typed into the file.",
      });
    }
  });

const runsOnSchema = z.union([
  z.string().trim().min(1).max(100),
  z.array(z.string().trim().min(1).max(50)).min(1).max(20),
]);

const artifactSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,100}$/, "Use letters, digits, '.', '_' or '-'."),
    path: relativePathSchema,
  })
  .strict();

const notifySchema = z
  .object({
    webhook: envValueSchema.refine((value) => vaultReferenceName(value) !== null, {
      message: "A notification address must come from Vault: vault://NAME.",
    }),
    on: z
      .array(z.enum(["passed", "failed", "cancelled", "timed_out", "waiting"]))
      .min(1)
      .optional(),
  })
  .strict();

export const CONCURRENCY_MODES = ["one-at-a-time", "newest-wins"] as const;
export type ConcurrencyMode = (typeof CONCURRENCY_MODES)[number];

const inputNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "Use letters, digits and underscores (environment).");
const inputSchema = z
  .object({
    description: z.string().trim().max(300).optional(),
    choices: z
      .array(z.union([z.string(), z.number()]).transform(String))
      .min(1)
      .max(50)
      .optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).transform(String).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.choices && input.default !== undefined && !input.choices.includes(input.default)) {
      ctx.addIssue({
        code: "custom",
        path: ["default"],
        message: "The default must be one of the choices.",
      });
    }
  });
export type PipelineInput = z.output<typeof inputSchema>;

export const pipelineFileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    "runs-on": runsOnSchema,
    source: sourceSchema.optional(),
    env: envSchema.optional(),
    timeout: durationSchema.optional(),
    stages: z.array(stageSchema).min(1, "A pipeline needs at least one stage.").max(50),
    artifacts: z.array(artifactSchema).max(20).optional(),
    notify: notifySchema.optional(),
    inputs: z.record(inputNameSchema, inputSchema).optional(),
    concurrency: z
      .enum(CONCURRENCY_MODES, { message: "Use one-at-a-time or newest-wins." })
      .optional(),
    keep: z
      .object({
        runs: z.number().int().min(1).max(10_000).optional(),
        artifacts: z
          .union([z.string(), z.number()])
          .transform((value, ctx) => {
            const seconds = parseDuration(value);
            if (seconds === null || seconds > 3650 * 86_400) {
              ctx.addIssue({ code: "custom", message: "Use a duration like 14d." });
              return z.NEVER;
            }
            return seconds;
          })
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((file, ctx) => {
    const names = new Set<string>();
    file.stages.forEach((stage, index) => {
      if (names.has(stage.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["stages", index, "name"],
          message: `Two stages are called "${stage.name}".`,
        });
      }
      names.add(stage.name);
    });
    const checkouts = file.stages.flatMap((stage) => stage.steps).filter((step) => step.checkout);
    if (checkouts.length > 0 && !file.source) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message: "checkout: true needs a source: (an app or a repo).",
      });
    }
  });

export type PipelineFile = z.output<typeof pipelineFileSchema>;
export type PipelineStage = PipelineFile["stages"][number];
export type PipelineStep = PipelineStage["steps"][number];

export interface PipelineFileIssue {
  /** Where, as YAML keys: "stages.1.steps.0.run". Empty for the whole file. */
  path: string;
  /** 1-based line in the file, when it can be found. */
  line: number | null;
  message: string;
}

export type ParsedPipelineFile =
  | { ok: true; file: PipelineFile; issues: [] }
  | { ok: false; file: null; issues: PipelineFileIssue[] };

/**
 * Reads a pipeline file and says, in plain words and with a line number, what
 * is wrong with it. The same function runs in the editor and on the server.
 */
export function parsePipelineFile(
  text: string,
  /** The values a run was started with; without them, defaults (or a stand-in) are used. */
  inputs?: Record<string, string>,
): ParsedPipelineFile {
  if (text.length > 200_000) {
    return {
      ok: false,
      file: null,
      issues: [{ path: "", line: null, message: "The file is too large (200 KB at most)." }],
    };
  }
  const document = parseDocument(text, { prettyErrors: false, uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      ok: false,
      file: null,
      issues: document.errors.map((error) => ({
        path: "",
        line: error.linePos?.[0]?.line ?? lineOf(text.split("\n"), error.pos[0]),
        message: `Not valid YAML: ${error.message.split("\n")[0]}`,
      })),
    };
  }
  const raw = document.toJS() as unknown;
  const unknown: string[] = [];
  const values = inputValues(raw, inputs);
  const filled = fillInputs(raw, values, unknown);
  if (unknown.length > 0) {
    return {
      ok: false,
      file: null,
      issues: [...new Set(unknown)].map((name) => ({
        path: "inputs",
        line: null,
        message: `\${{ inputs.${name} }} is used, but there is no input called ${name} under inputs:.`,
      })),
    };
  }
  const parsed = pipelineFileSchema.safeParse(filled);
  if (parsed.success) return { ok: true, file: parsed.data, issues: [] };
  const lineCounter = text.split("\n");
  return {
    ok: false,
    file: null,
    issues: parsed.error.issues.map((issue) => {
      const path = issue.path.map(String);
      const node = path.length > 0 ? document.getIn(issue.path as (string | number)[], true) : null;
      const offset = (node as { range?: [number, number] } | null)?.range?.[0];
      return {
        path: path.join("."),
        line: offset === undefined ? null : lineOf(lineCounter, offset),
        message: issue.message,
      };
    }),
  };
}

function lineOf(lines: string[], offset: number): number {
  let total = 0;
  for (let index = 0; index < lines.length; index++) {
    total += (lines[index]?.length ?? 0) + 1;
    if (offset < total) return index + 1;
  }
  return lines.length;
}

/** Every `vault://NAME` a pipeline file uses, once each. */
export function pipelineVaultNames(file: PipelineFile): string[] {
  const names = new Set<string>();
  const add = (value: string | undefined) => {
    const name = value === undefined ? null : vaultReferenceName(value);
    if (name) names.add(name);
  };
  for (const value of Object.values(file.env ?? {})) add(value);
  add(file.source?.token);
  add(file.notify?.webhook);
  for (const stage of file.stages) {
    for (const step of stage.steps) {
      for (const value of Object.values(step.env ?? {})) add(value);
      add(step.docker?.login?.password);
    }
  }
  return [...names].sort();
}

/** The labels a pipeline asks for, or the one runner it names, or the local runner. */
export function pipelineTarget(
  file: PipelineFile,
): { kind: "local" } | { kind: "name"; name: string } | { kind: "labels"; labels: string[] } {
  const target = file["runs-on"];
  if (Array.isArray(target)) return { kind: "labels", labels: target };
  return target === "local" ? { kind: "local" } : { kind: "name", name: target };
}

export const PIPELINE_TEMPLATES: { id: string; label: string; source: string }[] = [
  {
    id: "node",
    label: "Node app",
    source: `name: Node app
runs-on: local
source:
  app: My app
stages:
  - name: Get
    steps:
      - checkout: true
      - setup: node@22
      - cache: node_modules
  - name: Check
    steps:
      - run: npm ci
      - run: npm test
  - name: Build
    steps:
      - run: npm run build
`,
  },
  {
    id: "python",
    label: "Python app",
    source: `name: Python app
runs-on: local
source:
  app: My app
stages:
  - name: Get
    steps:
      - checkout: true
      - setup: python@3.12
      - cache: .venv
  - name: Check
    steps:
      - run: |
          python -m venv .venv
          . .venv/bin/activate
          pip install -r requirements.txt
          python -m pytest
`,
  },
  {
    id: "docker",
    label: "Docker image",
    source: `name: Docker image
runs-on: [linux, docker]
source:
  repo: https://github.com/you/your-app
  token: vault://GITHUB_TOKEN
stages:
  - name: Get
    steps:
      - checkout: true
  - name: Build and push
    steps:
      - docker:
          image: registry.example.com/you/app
          tags: [latest, "$ZELYQ_RUN_NUMBER"]
          push: true
          login:
            username: you
            password: vault://REGISTRY_PASSWORD
`,
  },
  {
    id: "deploy",
    label: "Deploy an app",
    source: `name: Deploy
runs-on: local
source:
  app: My app
stages:
  - name: Test
    steps:
      - checkout: true
      - setup: node@22
      - run: npm ci && npm test
  - name: Staging
    steps:
      - deploy:
          to: staging
          port: 3000
          host-port: 8080
  - name: Production
    steps:
      - deploy:
          to: production
          port: 3000
          host-port: 80
  - name: Tell someone
    if: failure()
    steps:
      - run: echo "The deploy did not go through."
`,
  },
  {
    id: "empty",
    label: "Empty",
    source: `name: My pipeline
runs-on: local
stages:
  - name: Hello
    steps:
      - run: echo "Hello from Zelyq"
`,
  },
];

// ---------------------------------------------------------------------------
// What the API returns
// ---------------------------------------------------------------------------

export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "passed",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const STEP_STATUSES = [
  "pending",
  "running",
  "waiting",
  "passed",
  "failed",
  "skipped",
  "cancelled",
  "timed_out",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export type RunTrigger = "manual" | "rerun" | "push" | "schedule" | "api" | "app" | "pipeline";

export interface PipelineActor {
  id: string;
  name: string;
}

export interface PipelineSummary {
  id: string;
  teamId: string;
  name: string;
  /** What the file asks for, for the list ("build-01", "linux, docker", "local"). */
  runsOn: string;
  lastRun: {
    id: string;
    number: number;
    status: RunStatus;
    createdAt: string;
    stages: RunStageSummary[];
  } | null;
  updatedAt: string;
  updatedBy: PipelineActor | null;
}

export interface PipelineDetail extends PipelineSummary {
  source: string;
  createdAt: string;
  createdBy: PipelineActor | null;
}

export interface RunStep {
  id: string;
  stageIndex: number;
  stepIndex: number;
  stage: string;
  name: string;
  kind: StepKind;
  /** Which attempt this is (above 1 after a retry). */
  attempt: number;
  /** For a `pipeline` step: the run it started. */
  child: { id: string; pipelineId: string; number: number } | null;
  status: StepStatus;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunLogLine {
  seq: number;
  stepId: string | null;
  stream: "out" | "err" | "system";
  text: string;
  at: string;
}

export interface PipelineRunSummary {
  id: string;
  pipelineId: string;
  pipelineName: string;
  number: number;
  status: RunStatus;
  trigger: RunTrigger;
  triggeredBy: PipelineActor | null;
  runner: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** One entry per stage, in order: what the stage picture shows. */
  stages: RunStageSummary[];
  /** The values it was started with. */
  inputs: Record<string, string>;
  /** The run that started it, if another pipeline did. */
  upstream: { id: string; pipelineId: string; pipelineName: string; number: number } | null;
}

/** A stage of a run, worked out from its steps. */
export interface RunStageSummary {
  index: number;
  name: string;
  status: StepStatus;
  /** Steps that have finished (passed, failed, skipped…) out of all of them. */
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * A stage's status from its steps: running while any step runs; failed,
 * timed out or cancelled if any step was; skipped when every step was;
 * passed when the rest passed.
 */
export function summariseStages(
  steps: Pick<RunStep, "stageIndex" | "stage" | "status" | "startedAt" | "finishedAt">[],
): RunStageSummary[] {
  const byStage = new Map<number, typeof steps>();
  for (const step of steps)
    byStage.set(step.stageIndex, [...(byStage.get(step.stageIndex) ?? []), step]);
  return [...byStage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, list]) => {
      const has = (status: StepStatus) => list.some((step) => step.status === status);
      const finished = list.filter(
        (step) => step.status !== "pending" && step.status !== "running",
      );
      const status: StepStatus = has("waiting")
        ? "waiting"
        : has("running")
          ? "running"
          : has("timed_out")
            ? "timed_out"
            : has("failed")
              ? "failed"
              : has("cancelled")
                ? "cancelled"
                : list.every((step) => step.status === "skipped")
                  ? "skipped"
                  : list.every((step) => step.status === "pending")
                    ? "pending"
                    : finished.length < list.length
                      ? "running"
                      : "passed";
      const starts = list
        .map((step) => step.startedAt)
        .filter((at): at is string => Boolean(at))
        .sort();
      const ends = list
        .map((step) => step.finishedAt)
        .filter((at): at is string => Boolean(at))
        .sort();
      return {
        index,
        name: list[0]?.stage ?? "",
        status,
        done: finished.length,
        total: list.length,
        startedAt: starts[0] ?? null,
        finishedAt: finished.length === list.length ? (ends[ends.length - 1] ?? null) : null,
      };
    });
}

export interface PipelineRunDetail extends PipelineRunSummary {
  steps: RunStep[];
  /** The pipeline file exactly as it was when this run started. */
  source: string;
  artifacts: { id: string; name: string; sizeBytes: number }[];
  approvals: RunApproval[];
}

/** An approval step's question, and its answer once there is one. */
export interface RunApproval {
  id: string;
  stepId: string;
  message: string;
  approvers: Approvers;
  allowSelf: boolean;
  deadline: string;
  decision: "approved" | "rejected" | "timed_out" | null;
  decidedBy: PipelineActor | null;
  comment: string | null;
  decidedAt: string | null;
  /** Whether the person asking may answer it now. */
  canDecide: boolean;
}

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    comment: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

export const RUNNER_OS = ["linux", "macos", "windows"] as const;
export type RunnerOs = (typeof RUNNER_OS)[number];

const labelSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,49}$/, "Labels are lower-case letters, digits, '.', '_' or '-'.");

export const sshRunnerInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/,
        "Use letters, digits, '.', '_' or '-' (build-01).",
      ),
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[A-Za-z0-9.:[\]-]+$/, "Use a host name or an IP address."),
    port: z.number().int().min(1).max(65535).default(22),
    username: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._\\-]{1,64}$/, "Use the SSH user name on that machine."),
    labels: z.array(labelSchema).max(20).default([]),
    description: z.string().trim().max(500).nullable().optional(),
    maxConcurrent: z.number().int().min(1).max(20).default(1),
  })
  .strict();
export type SshRunnerInput = z.input<typeof sshRunnerInputSchema>;

export const sshRunnerUpdateSchema = sshRunnerInputSchema
  .partial()
  .extend({ enabled: z.boolean().optional() })
  .strict();
export type SshRunnerUpdate = z.input<typeof sshRunnerUpdateSchema>;

export interface RunnerSummary {
  id: string;
  teamId: string;
  kind: "ssh";
  name: string;
  host: string;
  port: number;
  username: string;
  labels: string[];
  description: string | null;
  enabled: boolean;
  maxConcurrent: number;
  os: RunnerOs | null;
  shells: string[];
  tools: string[];
  /** "SHA256:…" — pinned once confirmed. */
  hostKeyFingerprint: string | null;
  lastTest: { at: string; ok: boolean; latencyMs: number | null; message: string | null } | null;
  /** Fingerprint of the team key this runner last accepted. */
  acceptedKeyFingerprint: string | null;
  busyRuns: number;
  createdAt: string;
}

export interface RunnerTestResult {
  ok: boolean;
  /** Present when the machine answered: what it says its key is. */
  hostKeyFingerprint: string | null;
  /** True when that differs from the pinned one, or none is pinned yet. */
  needsConfirmation: boolean;
  latencyMs: number | null;
  os: RunnerOs | null;
  shells: string[];
  tools: string[];
  message: string;
}

/** What Zelyq keeps on a runner, and how much room is left. */
export interface RunnerDisk {
  toolsBytes: number;
  cacheBytes: number;
  /** Free space where the runner's home folder is; null when not known. */
  freeBytes: number | null;
  totalBytes: number | null;
}

export interface TeamSshKeySummary {
  id: string;
  algorithm: "ed25519" | "rsa";
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  /** When set, this older key still works until then (rotation grace period). */
  retiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export const triggerInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("push"),
      branches: z.array(z.string().trim().min(1).max(200)).min(1).max(20).default(["main"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("schedule"),
      cron: z
        .string()
        .trim()
        .refine((value) => parseCron(value) !== null, {
          message: "Use five fields: minute hour day month weekday (0 3 * * * is 03:00 every day).",
        }),
    })
    .strict(),
  // When the agent changes the pipeline's source app.
  z.object({ kind: z.literal("app") }).strict(),
  // After another pipeline of the team ends (by default: when it passes).
  z
    .object({
      kind: z.literal("pipeline"),
      pipelineId: z.string().min(1),
      on: z
        .array(z.enum(["passed", "failed"]))
        .min(1)
        .default(["passed"]),
    })
    .strict(),
]);
export type TriggerInput = z.input<typeof triggerInputSchema>;

export interface PipelineTriggerSummary {
  id: string;
  kind: "push" | "schedule" | "app" | "pipeline";
  /** After another pipeline: which one, and on which endings. */
  upstream: { id: string; name: string; on: ("passed" | "failed")[] } | null;
  branches: string[] | null;
  cron: string | null;
  enabled: boolean;
  lastFiredAt: string | null;
  /** Push only: the address to give GitHub or GitLab. */
  webhookUrl: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Cron (five fields, UTC) — small enough not to need a dependency
// ---------------------------------------------------------------------------

export interface CronSchedule {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** Cron's rule: when both day fields are restricted, either may match. */
  dayOrWeekday: boolean;
}

export function parseCron(expression: string): CronSchedule | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  const sets: Set<number>[] = [];
  for (const [index, field] of fields.entries()) {
    const [min, max] = ranges[index] as [number, number];
    const set = parseCronField(field as string, min, max);
    if (!set) return null;
    sets.push(set);
  }
  const weekdays = sets[4] as Set<number>;
  if (weekdays.has(7)) weekdays.add(0);
  weekdays.delete(7);
  return {
    minutes: sets[0] as Set<number>,
    hours: sets[1] as Set<number>,
    days: sets[2] as Set<number>,
    months: sets[3] as Set<number>,
    weekdays,
    dayOrWeekday: fields[2] !== "*" && fields[4] !== "*",
  };
}

function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) return null;
    const [, range, stepText] = match;
    const step = stepText ? Number(stepText) : 1;
    if (step < 1) return null;
    let from = min;
    let to = max;
    if (range !== "*") {
      const [a, b] = (range as string).split("-").map(Number);
      from = a as number;
      to = b ?? (stepText ? max : (a as number));
    }
    if (from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

/** Whether a schedule fires in the UTC minute that `date` falls in. */
export function cronMatches(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.minutes.has(date.getUTCMinutes()) || !schedule.hours.has(date.getUTCHours()))
    return false;
  if (!schedule.months.has(date.getUTCMonth() + 1)) return false;
  const day = schedule.days.has(date.getUTCDate());
  const weekday = schedule.weekdays.has(date.getUTCDay());
  return schedule.dayOrWeekday ? day || weekday : day && weekday;
}

// ---------------------------------------------------------------------------
// Setting up a machine as a runner
// ---------------------------------------------------------------------------

/** A user name every one of Linux, macOS and Windows accepts. */
export const RUNNER_USER = /^[a-z_][a-z0-9_-]{0,30}$/;

/**
 * The one command an admin pastes on a machine to make it a runner: it
 * creates the runner's user (or reuses it), lets the team's key in with the
 * permissions SSH insists on, joins the docker group when there is one, and —
 * only when asked — gives the user admin rights. Running it twice is safe.
 */
export function runnerSetupScript(input: {
  os: RunnerOs;
  user: string;
  publicKey: string;
  admin: boolean;
}): string {
  if (!RUNNER_USER.test(input.user)) {
    throw new Error("Use lower-case letters, digits, '_' or '-' for the user (zelyq).");
  }
  const key = input.publicKey.trim();
  if (!/^[A-Za-z0-9@._+/=: -]+$/.test(key)) throw new Error("That is not an SSH public key.");
  const { user, admin } = input;

  if (input.os === "windows") {
    return [
      "# In PowerShell, opened with Run as administrator.",
      `$U = '${user}'`,
      `$Key = '${key}'`,
      "$ErrorActionPreference = 'Stop'",
      "if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {",
      "  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null",
      "}",
      "Start-Service sshd; Set-Service sshd -StartupType Automatic",
      "# A long random password nobody needs: the runner signs in with the key.",
      "$Pw = ConvertTo-SecureString ((-join ((33..126) | Get-Random -Count 24 | ForEach-Object { [char]$_ })) + 'Aa1!') -AsPlainText -Force",
      "if (Get-LocalUser -Name $U -ErrorAction SilentlyContinue) { Set-LocalUser -Name $U -Password $Pw }",
      "else { New-LocalUser -Name $U -Password $Pw -PasswordNeverExpires -AccountNeverExpires -Description 'Zelyq pipeline runner' | Out-Null }",
      "Add-LocalGroupMember -Group 'Users' -Member $U -ErrorAction SilentlyContinue",
      "Add-LocalGroupMember -Group 'docker-users' -Member $U -ErrorAction SilentlyContinue",
      "# Windows makes a user's folder at their first sign-in: sign in once now.",
      '$Cred = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\\$U", $Pw)',
      "Start-Process -FilePath cmd.exe -ArgumentList '/c', 'exit' -Credential $Cred -LoadUserProfile -WindowStyle Hidden -Wait",
      ...(admin
        ? [
            "Add-LocalGroupMember -Group 'Administrators' -Member $U -ErrorAction SilentlyContinue",
            "# For administrators, Windows reads keys from this one shared file.",
            "$File = 'C:\\ProgramData\\ssh\\administrators_authorized_keys'",
            "if (-not (Test-Path $File) -or -not (Select-String -Path $File -SimpleMatch $Key -Quiet)) { Add-Content -Path $File -Value $Key -Encoding ascii }",
            "icacls $File /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null",
          ]
        : [
            "$Sid = (Get-LocalUser -Name $U).SID.Value",
            "$UserHome = (Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $Sid }).LocalPath",
            'New-Item -ItemType Directory -Force -Path "$UserHome\\.ssh" | Out-Null',
            '$File = "$UserHome\\.ssh\\authorized_keys"',
            "if (-not (Test-Path $File) -or -not (Select-String -Path $File -SimpleMatch $Key -Quiet)) { Add-Content -Path $File -Value $Key -Encoding ascii }",
            "icacls $File /inheritance:r /grant \"${U}:F\" /grant 'SYSTEM:F' /grant 'Administrators:F' | Out-Null",
          ]),
      'Write-Host "Done. In Zelyq, add a runner with SSH user: $U"',
      "",
    ].join("\n");
  }

  const sshDir = [
    'mkdir -p "$H/.ssh"',
    'touch "$H/.ssh/authorized_keys"',
    'grep -qxF "$KEY" "$H/.ssh/authorized_keys" || echo "$KEY" >> "$H/.ssh/authorized_keys"',
    'chown -R "$U:$(id -gn "$U")" "$H/.ssh"',
    'chmod 700 "$H/.ssh"',
    'chmod 600 "$H/.ssh/authorized_keys"',
  ];
  const sudoers = [
    `echo "$U ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/zelyq-$U"`,
    `chmod 440 "/etc/sudoers.d/zelyq-$U"`,
  ];

  if (input.os === "macos") {
    return [
      "sudo sh -s <<'ZELYQ'",
      "set -e",
      `U='${user}'`,
      `KEY='${key}'`,
      'if ! id "$U" >/dev/null 2>&1; then',
      '  sysadminctl -addUser "$U" -fullName "Zelyq runner" -shell /bin/zsh -home "/Users/$U" -password "$(openssl rand -base64 24)"',
      '  createhomedir -c -u "$U" >/dev/null',
      "fi",
      `H=$(dscl . -read "/Users/$U" NFSHomeDirectory | awk '{print $2}')`,
      ...sshDir,
      "# When Remote Login is limited to some users, add this one.",
      'if dseditgroup -o read com.apple.access_ssh >/dev/null 2>&1; then dseditgroup -o edit -a "$U" -t user com.apple.access_ssh; fi',
      'if dseditgroup -o read docker >/dev/null 2>&1; then dseditgroup -o edit -a "$U" -t user docker; fi',
      ...(admin ? ['dseditgroup -o edit -a "$U" -t user admin', ...sudoers] : []),
      'systemsetup -getremotelogin 2>/dev/null | grep -q On || echo "Now turn on System Settings > General > Sharing > Remote Login."',
      'echo "Done. In Zelyq, add a runner with SSH user: $U"',
      "ZELYQ",
      "",
    ].join("\n");
  }

  return [
    "sudo sh -s <<'ZELYQ'",
    "set -e",
    `U='${user}'`,
    `KEY='${key}'`,
    'if ! id "$U" >/dev/null 2>&1; then',
    '  if command -v useradd >/dev/null 2>&1; then useradd -m -s /bin/bash "$U" 2>/dev/null || useradd -m "$U"',
    '  else adduser -D "$U"; fi',
    "fi",
    "# A locked password makes some SSH servers refuse the user even with the key.",
    `usermod -p '*' "$U" 2>/dev/null || echo "$U:*" | chpasswd -e 2>/dev/null || true`,
    'H=$(eval echo "~$U")',
    ...sshDir,
    'if grep -q \'^docker:\' /etc/group; then usermod -aG docker "$U" 2>/dev/null || addgroup "$U" docker; fi',
    ...(admin ? ["mkdir -p /etc/sudoers.d", ...sudoers] : []),
    "if command -v sshd >/dev/null 2>&1 && sshd -T 2>/dev/null | grep -qiE '^(allowusers|allowgroups) '; then",
    '  echo "Note: this SSH server only lets in listed users (AllowUsers/AllowGroups in sshd_config). Add $U there."',
    "fi",
    'echo "Done. In Zelyq, add a runner with SSH user: $U"',
    "ZELYQ",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Deploy (see docs/deploy-plan.md)
// ---------------------------------------------------------------------------

const variableValueSchema = z
  .string()
  .max(10_000)
  .refine((value) => !value.startsWith("vault://") || vaultReferenceName(value) !== null, {
    message: "A Vault reference is vault://NAME, with the secret's name.",
  });

export const environmentInputSchema = z
  .object({
    name: environmentNameSchema,
    runnerId: z.string().min(1),
    address: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.:[\]-]{1,253}$/, "Use the machine's address: an IP or a host name.")
      .nullable()
      .optional(),
    protected: z.boolean().default(false),
    variables: z
      .record(
        z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, "Use letters, digits and underscores."),
        variableValueSchema,
      )
      .default({}),
  })
  .strict();
export type EnvironmentInput = z.input<typeof environmentInputSchema>;
export const environmentUpdateSchema = environmentInputSchema
  .partial()
  .extend({
    frozen: z.boolean().optional(),
    frozenReason: z.string().trim().max(300).nullable().optional(),
  })
  .strict();
export type EnvironmentUpdate = z.input<typeof environmentUpdateSchema>;

export const DEPLOYMENT_STATUSES = [
  "deploying",
  "live",
  "failed",
  "rolled_back",
  "replaced",
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export interface DeploymentSummary {
  id: string;
  environmentId: string;
  app: string;
  number: number;
  status: DeploymentStatus;
  kind: "deploy" | "rollback";
  url: string | null;
  /** The pipeline run it came from, if any. */
  run: { id: string; pipelineId: string; number: number; ref: string | null } | null;
  /** For a roll back: the deploy it went back to. */
  rolledBackTo: number | null;
  by: PipelineActor | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Whether its image is still on the machine, so it can be rolled back to. */
  canRollBackTo: boolean;
}

/** One deploy with what happened, line by line. */
export interface DeploymentDetail extends DeploymentSummary {
  log: { stream: "out" | "err" | "system"; text: string }[];
}

export interface EnvironmentSummary {
  id: string;
  name: string;
  runner: { id: string; name: string; host: string } | null;
  address: string | null;
  protected: boolean;
  frozen: boolean;
  frozenReason: string | null;
  /** Names only; values never leave the server. */
  variables: { name: string; fromVault: boolean }[];
  /** The live deploy of each app here. */
  live: DeploymentSummary[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Inputs: ${{ inputs.NAME }}
// ---------------------------------------------------------------------------

const INPUT_REFERENCE = /\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** The value for each input: what the run was given, else its default, else a stand-in to check the file. */
function inputValues(
  raw: unknown,
  given: Record<string, string> | undefined,
): Record<string, string> {
  const declared =
    raw &&
    typeof raw === "object" &&
    "inputs" in raw &&
    typeof (raw as { inputs: unknown }).inputs === "object"
      ? ((raw as { inputs: Record<string, { default?: unknown; choices?: unknown[] }> | null })
          .inputs ?? {})
      : {};
  const values: Record<string, string> = {};
  for (const [name, input] of Object.entries(declared)) {
    const fallback =
      input?.default !== undefined
        ? String(input.default)
        : Array.isArray(input?.choices) && input.choices.length > 0
          ? String(input.choices[0])
          : "value";
    values[name] = given?.[name] ?? fallback;
  }
  return values;
}

/** Puts input values into every text of the file (never into keys). */
function fillInputs(value: unknown, values: Record<string, string>, unknown: string[]): unknown {
  if (typeof value === "string") {
    return value.replaceAll(INPUT_REFERENCE, (_match, name: string) => {
      if (!(name in values)) {
        unknown.push(name);
        return "";
      }
      return values[name] ?? "";
    });
  }
  if (Array.isArray(value)) return value.map((item) => fillInputs(item, values, unknown));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "inputs" ? item : fillInputs(item, values, unknown),
      ]),
    );
  }
  return value;
}

/**
 * Checks the values a run is started with against the file's inputs: every
 * required one given, choices respected, no unknown names. Returns the full
 * set (defaults filled in), or what is wrong.
 */
export function resolveRunInputs(
  file: PipelineFile,
  given: Record<string, string>,
): { values: Record<string, string> } | { error: string } {
  const declared = file.inputs ?? {};
  for (const name of Object.keys(given)) {
    if (!(name in declared)) return { error: `This pipeline has no input called ${name}.` };
  }
  const values: Record<string, string> = {};
  for (const [name, input] of Object.entries(declared)) {
    const value = given[name] ?? input.default;
    if (value === undefined) return { error: `${name} is needed to start this pipeline.` };
    if (input.choices && !input.choices.includes(value)) {
      return { error: `${name} must be one of: ${input.choices.join(", ")}.` };
    }
    values[name] = value;
  }
  return { values };
}

export const runStartSchema = z
  .object({
    ref: z.string().trim().min(1).max(200).nullable().optional(),
    inputs: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String))
      .optional(),
  })
  .strict();

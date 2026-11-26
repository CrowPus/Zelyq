import { z } from "zod";
import { defineTool, stripAnsi, type ToolContext, type ToolResult, truncate } from "./types.js";

/**
 * Zelyq's own pipelines and deploys, for the app the agent is building.
 *
 * They ride the preview bridge: the same per-session grant for one project and
 * one person that starts the preview. The server checks the person's current
 * role on every call, so a viewer can look but not save or run, and nothing
 * here can approve a protected deploy, change an environment, roll back or
 * promote. Those stay with people.
 */

export const PLATFORM_TOOL_NAMES = [
  "zelyq_platform",
  "save_pipeline",
  "run_pipeline",
  "pipeline_run",
  "deployed_app",
] as const;

class BridgeError extends Error {}

async function call<T>(context: ToolContext, path: string, body?: unknown): Promise<T> {
  const bridge = context.previewBridge;
  if (!bridge) throw new BridgeError("Zelyq's pipelines are not reachable from this session.");
  const response = await fetch(`${bridge.url}/api/internal/platform/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-zelyq-preview-bridge": bridge.token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: context.signal,
  });
  const json = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new BridgeError(json.error?.message ?? `Zelyq answered ${response.status}.`);
  }
  return json;
}

function failure(error: unknown): ToolResult {
  return { output: error instanceof Error ? error.message : String(error), isError: true };
}

interface Overview {
  app: { name: string; id: string };
  role: string;
  localRunner: { available: boolean; busy: number; places: number };
  runners: { name: string; os: string | null; labels: string[]; online: boolean | null }[];
  environments: {
    name: string;
    protected: boolean;
    frozen: boolean;
    frozenReason: string | null;
    machine: string | null;
    domain: string | null;
    address: string | null;
    variables: string[];
    thisApp: { url: string | null; number: number; status: string; at: string } | null;
    otherApps: number;
  }[];
  pipelines: {
    name: string;
    base: string;
    source: string;
    runsOn: string;
    deploysTo: string[];
    keptInRepository: string | null;
    triggers: { kind: string; enabled: boolean }[];
    lastRun: { number: number; status: string; at: string } | null;
  }[];
}

/** How to write one, sent with the overview so the prompt does not carry it. */
export const PIPELINE_REFERENCE = `How a pipeline file is written (the full guide is docs/pipelines.md and docs/deploy.md):
name: <App> CI                 # unique in the team
runs-on: local                 # or a machine's name, or [label, label]
source: {app: <exact app name>}
stages:
  - name: Test
    steps:
      - checkout: true         # copies the app's files as they are now (no node_modules, .git, .env)
      - setup: node@22         # or python@3.12, go@1.23
      - run: npm ci            # npm ci needs package-lock.json; else npm install
      - run: npm test
      - run: npm run build
  - name: Staging
    needs: Test
    steps:
      - checkout: true
      - deploy:
          to: staging          # an environment that exists
          port: 3000           # what the app listens on inside its container (it gets PORT); a static site is served there too
          health: /            # a path that answers 2xx/3xx once it is up
          # host-port: 8080    # only when the environment has no domain; differs per app on a machine
          # database: postgres # a database beside it; the app gets DATABASE_URL
          # migrate: npm run migrate
          # start: node server.js   # only when Zelyq cannot tell how it starts
The deploy step builds the app's image itself from its files (its Dockerfile, or one Zelyq writes), so a stage before it only needs to test; do not build twice.
Other steps: cache, approval, docker (needs a machine with Docker; local has none). A stage may have if: failure() or always(). Secrets come from Vault as vault://NAME in env:, never typed in. A static Vite/React build is served by Caddy with no start command; a Node server needs a start script.`;

export function describeOverview(o: Overview): string {
  const lines: string[] = [];
  lines.push(`App: ${o.app.name}. Your role in its team: ${o.role}.`);
  if (o.role === "viewer") {
    lines.push("A viewer can look but not save or run pipelines; an editor or admin can.");
  }
  lines.push("", "Machines a pipeline can run on (`runs-on:`):");
  lines.push(
    o.localRunner.available
      ? `- local — this Zelyq server, a fresh container per run (${o.localRunner.busy}/${o.localRunner.places} busy). No Docker inside it.`
      : "- local — switched off on this Zelyq.",
  );
  for (const runner of o.runners) {
    lines.push(
      `- ${runner.name}${runner.os ? ` (${runner.os})` : ""}${runner.labels.length ? ` labels: ${runner.labels.join(", ")}` : ""}${runner.online === false ? " — offline now" : ""}`,
    );
  }
  lines.push("", "Environments (where a `deploy` step puts the app):");
  if (o.environments.length === 0) {
    lines.push(
      "- none. A team admin adds one under Ship → Deployments → New environment (a machine with Docker). Until then, a pipeline can test and build but not deploy.",
    );
  }
  for (const environment of o.environments) {
    const flags = [
      environment.protected ? "protected: every deploy waits for an admin to approve it" : "",
      environment.frozen
        ? `FROZEN (${environment.frozenReason ?? "no reason given"}): deploys fail`
        : "",
    ].filter(Boolean);
    lines.push(
      `- ${environment.name} on ${environment.machine ?? "no machine"}${environment.domain ? `, apps at <app>.${environment.domain}` : environment.address ? `, at ${environment.address}` : ""}${flags.length ? ` — ${flags.join("; ")}` : ""}`,
    );
    if (environment.variables.length) {
      lines.push(`  gives apps: ${environment.variables.join(", ")}`);
    }
    lines.push(
      environment.thisApp
        ? `  this app is live: deploy #${environment.thisApp.number} (${environment.thisApp.status}) ${environment.thisApp.url ?? "no link recorded"}`
        : "  this app is not deployed here",
    );
    if (environment.otherApps) lines.push(`  ${environment.otherApps} other app(s) run here`);
  }
  lines.push("", "This app's pipelines (`source: {app: ...}` is this app):");
  if (o.pipelines.length === 0) lines.push("- none yet.");
  for (const pipeline of o.pipelines) {
    const triggers = pipeline.triggers.filter((trigger) => trigger.enabled).map((t) => t.kind);
    lines.push(
      `- ${pipeline.name} — runs on ${pipeline.runsOn || "?"}${pipeline.deploysTo.length ? `, deploys to ${pipeline.deploysTo.join(" and ")}` : ""}; ${pipeline.lastRun ? `last run #${pipeline.lastRun.number} ${pipeline.lastRun.status}` : "never run"}${triggers.length ? `; starts by itself on: ${triggers.join(", ")}` : ""}${pipeline.keptInRepository ? `; its file is kept in the git repository at ${pipeline.keptInRepository} (change it there, not here)` : ""}`,
    );
    lines.push(`  base: ${pipeline.base}`);
    lines.push(
      `  file:\n${truncate(pipeline.source, 6000)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n")}`,
    );
  }
  lines.push("", PIPELINE_REFERENCE);
  return lines.join("\n");
}

export const zelyqPlatformTool = defineTool({
  name: "zelyq_platform",
  description:
    "What this Zelyq team has for testing and shipping this app: the machines pipelines run on, the " +
    "environments a deploy goes to (protected, frozen, what is live there and its link), and this " +
    "app's pipelines with their files, triggers and last run. Call it before writing any CI, " +
    "pipeline or deploy setup, and before saying anything about where the app is deployed.",
  schema: z.object({}),
  async run(context): Promise<ToolResult> {
    try {
      return { output: describeOverview(await call<Overview>(context, "overview")) };
    } catch (error) {
      return failure(error);
    }
  },
});

export const savePipelineTool = defineTool({
  name: "save_pipeline",
  description:
    "Check, then save, a Zelyq pipeline file you wrote in this project (keep it at " +
    ".zelyq/pipelines/<name>.yml). Its `source:` must be this app (`source: {app: <app name>}`). " +
    "With check_only it only reports problems, by line. Saving a pipeline that already exists " +
    "needs the `base` zelyq_platform showed for it; if someone changed it since, the save is " +
    "refused. Saving does not run it: run_pipeline does.",
  schema: z.object({
    path: z
      .string()
      .min(1)
      .describe("The pipeline file in the project, e.g. .zelyq/pipelines/shop.yml"),
    check_only: z.boolean().optional().describe("Only check the file; save nothing"),
    base: z
      .string()
      .optional()
      .describe("For a pipeline that already exists: its base from zelyq_platform"),
  }),
  async run(context, input): Promise<ToolResult> {
    let source: string;
    try {
      source = (await context.runtime.readFile(context.projectId, input.path)).content;
    } catch {
      return { output: `Could not read ${input.path}.`, isError: true };
    }
    try {
      const result = await call<{
        ok: boolean;
        issues: { line?: number; message: string }[];
        warnings: string[];
        saved: null | { name: string; created: boolean; base: string; deploysTo: string[] };
      }>(context, "pipelines/save", {
        source,
        save: !input.check_only,
        ...(input.base ? { base: input.base } : {}),
      });
      const issues = result.issues.map(
        (issue) => `- ${issue.line ? `line ${issue.line}: ` : ""}${issue.message}`,
      );
      const warnings = result.warnings.map((warning) => `- ${warning}`);
      if (!result.ok) {
        return {
          output: `${input.path} is not ${input.check_only ? "valid" : "saved"}:\n${issues.join("\n")}${warnings.length ? `\nAlso:\n${warnings.join("\n")}` : ""}`,
          isError: true,
        };
      }
      const head = result.saved
        ? `${result.saved.created ? "Saved the new pipeline" : "Saved a new version of"} ${result.saved.name} in Zelyq (base now ${result.saved.base})${result.saved.deploysTo.length ? `; it deploys to ${result.saved.deploysTo.join(" and ")}` : ""}. It has not run: run_pipeline starts it.`
        : `${input.path} is valid.`;
      return {
        output: `${head}${warnings.length ? `\nIt will not run until these are fixed (they are outside the file: tell the user):\n${warnings.join("\n")}` : ""}`,
      };
    } catch (error) {
      return failure(error);
    }
  },
});

interface Run {
  pipeline: string;
  number: number;
  runId: string;
  status: string;
  error: string | null;
  stages: { name: string; status: string }[];
  failedStep: { stage: string; name: string; exitCode: number | null } | null;
  logTail: string[];
  waitingFor: { message: string }[];
  queue: string | null;
  deployed: {
    environment: string;
    app: string;
    status: string;
    url: string | null;
    error: string | null;
  }[];
  ended: boolean;
}

export function describeRun(run: Run): string {
  const lines = [
    `${run.pipeline} #${run.number}: ${run.status}${run.error ? ` — ${run.error.replace(/\.+$/, "")}` : ""}.`,
    `Stages: ${run.stages.map((stage) => `${stage.name} ${stage.status}`).join(" → ")}`,
  ];
  if (run.queue) lines.push(run.queue);
  for (const waiting of run.waitingFor) {
    lines.push(
      `Waiting for a person: "${waiting.message}". You cannot answer it; tell the user an admin approves it on the run's page (Pipelines → ${run.pipeline} → #${run.number}).`,
    );
  }
  for (const deployment of run.deployed) {
    lines.push(
      `Deployed to ${deployment.environment} as ${deployment.app}: ${deployment.status}${deployment.url ? ` at ${deployment.url}` : ""}${deployment.error ? ` — ${deployment.error}` : ""}`,
    );
  }
  if (run.failedStep) {
    lines.push(
      `Failed at ${run.failedStep.stage} › ${run.failedStep.name}${run.failedStep.exitCode === null ? "" : ` (exit ${run.failedStep.exitCode})`}.`,
    );
  }
  if (run.logTail.length) {
    lines.push("Last lines of its output:", truncate(stripAnsi(run.logTail.join("\n")), 8000));
  }
  return lines.join("\n");
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

export const runPipelineTool = defineTool({
  name: "run_pipeline",
  description:
    "Start one of this app's pipelines in Zelyq and wait for it (up to wait_minutes, default 10). " +
    "It runs the app's files as they are now. Returns how it ended, the failing step's last output " +
    "lines, and the link of anything it deployed. A deploy to a protected environment stops and " +
    "waits for an admin: you cannot approve it. Run what the user asked for; deploying to " +
    "production is the user's call, never yours alone.",
  schema: z.object({
    pipeline: z.string().min(1).describe("The pipeline's name, from zelyq_platform"),
    wait_minutes: z.number().int().min(0).max(25).optional(),
  }),
  async run(context, input): Promise<ToolResult> {
    try {
      let run = await call<Run>(context, "pipelines/run", { pipeline: input.pipeline });
      context.log(`Started ${run.pipeline} #${run.number}`);
      const deadline = Date.now() + (input.wait_minutes ?? 10) * 60_000;
      let lastStatus = run.status;
      while (!run.ended && run.waitingFor.length === 0 && Date.now() < deadline) {
        await sleep(4000, context.signal);
        if (context.signal.aborted) break;
        run = await call<Run>(context, "runs/status", { runId: run.runId });
        const stage = run.stages.find((entry) => entry.status === "running");
        const now = `${run.status}${stage ? ` — ${stage.name}` : ""}`;
        if (now !== lastStatus) context.log(`${run.pipeline} #${run.number}: ${now}`);
        lastStatus = now;
      }
      const still =
        !run.ended && run.waitingFor.length === 0
          ? `\nStill going when the wait ended. pipeline_run with pipeline "${run.pipeline}" and number ${run.number} checks it again.`
          : "";
      return {
        output: `${describeRun(run)}${still}`,
        isError: run.ended && run.status !== "passed",
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const pipelineRunTool = defineTool({
  name: "pipeline_run",
  description:
    "How a run of one of this app's pipelines is going or ended: its stages, the failing step's " +
    "last output lines, approvals it waits for, and what it deployed. Without `number`, the latest run.",
  schema: z.object({
    pipeline: z.string().min(1),
    number: z.number().int().positive().optional(),
  }),
  async run(context, input): Promise<ToolResult> {
    try {
      const run = await call<Run>(context, "runs/status", {
        pipeline: input.pipeline,
        ...(input.number ? { number: input.number } : {}),
      });
      return { output: describeRun(run) };
    } catch (error) {
      return failure(error);
    }
  },
});

export const deployedAppTool = defineTool({
  name: "deployed_app",
  description:
    "This app as it runs on one of the team's environments now: running or not, restarts, CPU and " +
    "memory, its link, and its latest output lines. Use it when the user says the deployed app is " +
    "broken, before changing code.",
  schema: z.object({ environment: z.string().min(1).describe("e.g. staging") }),
  async run(context, input): Promise<ToolResult> {
    try {
      const status = await call<
        | { live: false; environment: string }
        | {
            live: true;
            environment: string;
            app: string;
            url: string | null;
            number: number;
            state: string;
            restarts: number;
            startedAt: string | null;
            cpuPercent: number | null;
            memoryBytes: number | null;
            logs: string[];
          }
      >(context, "apps/status", { environment: input.environment });
      if (!status.live) {
        return { output: `This app is not deployed on ${status.environment}.` };
      }
      const memory =
        status.memoryBytes === null
          ? ""
          : `, memory ${Math.round(status.memoryBytes / 1048576)} MB`;
      return {
        output: [
          `${status.app} on ${status.environment}: deploy #${status.number}, ${status.state}${status.restarts ? `, restarted ${status.restarts} time(s)` : ""}${status.cpuPercent === null ? "" : `, CPU ${status.cpuPercent}%`}${memory}${status.url ? ` — ${status.url}` : ""}.`,
          status.logs.length
            ? `Latest output:\n${truncate(stripAnsi(status.logs.join("\n")), 8000)}`
            : "No output yet.",
        ].join("\n"),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const PLATFORM_TOOLS = [
  zelyqPlatformTool,
  savePipelineTool,
  runPipelineTool,
  pipelineRunTool,
  deployedAppTool,
];

import { createHash } from "node:crypto";
import type { OpsRisk } from "@zelyq/core";
import { z } from "zod";
import type { ActionContext, OpsAction, OpsEnvironmentRef } from "../actions.js";
import { environmentByName } from "../actions.js";
import { BLOCKS_GUIDE, checkBlocks } from "../blocks.js";
import { nameField, waitUntil } from "./shared.js";

const none = z.object({}).strict() as unknown as z.ZodType<Record<string, never>>;

/** What `base` is: the file a change was written against. */
export function sourceHash(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

/** The most careful of the environments a pipeline deploys to: what its changes are judged by. */
async function strictestTarget(
  ctx: ActionContext,
  source: string,
): Promise<OpsEnvironmentRef | null> {
  let chosen: OpsEnvironmentRef | null = null;
  for (const name of checkBlocks(source).deploysTo) {
    const environment = await environmentByName(ctx, name);
    if (!environment) continue;
    if (
      !chosen ||
      (environment.protected && !chosen.protected) ||
      environment.frozen ||
      environment.trust === "advise"
    ) {
      chosen = environment;
    }
  }
  return chosen;
}

async function pipelineByName(ctx: ActionContext, name: string) {
  const row = await ctx.services.store.pipelines.pipelines.findByName(ctx.teamId, name);
  if (!row) throw new Error(`There is no pipeline called ${name}. list_pipelines shows them.`);
  return row;
}

/** A pipeline with commands Ops wrote itself is confirmed by a person on its own. */
function pipelineRisk(source: string): OpsRisk {
  return checkBlocks(source).free.length > 0 ? "always-ask" : "change";
}

function freeWords(source: string): string {
  const { free } = checkBlocks(source);
  return free.length > 0
    ? `. It runs commands Ops wrote itself, which you confirm: ${free.map((command) => `\`${command}\``).join(", ")}`
    : "";
}

const pipelineBlocks: OpsAction<Record<string, never>> = {
  name: "pipeline_blocks",
  description:
    "How to write a pipeline from building blocks, so it needs no extra confirmation. Read before writing one.",
  input: none,
  risk: "read",
  words: () => "Read the pipeline building blocks",
  async run() {
    return { ok: true, summary: "The building blocks.", data: BLOCKS_GUIDE };
  },
};

const listPipelines: OpsAction<Record<string, never>> = {
  name: "list_pipelines",
  description:
    "The team's pipelines: name, where they deploy, whether Ops wrote them, their last run.",
  input: none,
  risk: "read",
  words: () => "Look at the team's pipelines",
  async run(ctx) {
    const rows = await ctx.services.store.pipelines.pipelines.listForTeam(ctx.teamId);
    const last = await ctx.services.store.pipelines.runs.lastForPipelines(
      rows.map((row) => row.id),
    );
    const pipelines = rows.map((row) => ({
      name: row.name,
      deploysTo: checkBlocks(row.source).deploysTo,
      writtenByOps: row.createdBy === ctx.user.id,
      keptInRepository: row.repoPath,
      lastRun: last.get(row.id)
        ? { number: last.get(row.id)?.number, status: last.get(row.id)?.status }
        : null,
    }));
    return { ok: true, summary: `${pipelines.length} pipelines.`, data: pipelines };
  },
};

const getInput = z.object({ pipeline: nameField("pipeline") }).strict();
const getPipeline: OpsAction<z.infer<typeof getInput>> = {
  name: "get_pipeline",
  description: "A pipeline's file, its triggers, and `base` (needed to change it).",
  input: getInput,
  risk: "read",
  words: (inputs) => `Read the pipeline ${inputs.pipeline}`,
  async run(ctx, inputs) {
    const row = await pipelineByName(ctx, inputs.pipeline);
    const triggers = await ctx.services.store.pipelines.triggers.list(row.id);
    return {
      ok: true,
      summary: `${row.name}: ${row.source.split("\n").length} lines.`,
      data: {
        source: row.source,
        base: sourceHash(row.source),
        triggers: triggers.map((trigger) => ({ kind: trigger.kind, enabled: trigger.enabled })),
        commandsOfItsOwn: checkBlocks(row.source).free,
      },
    };
  },
};

/**
 * A pipeline file that Zelyq accepts, checked when the plan is checked: a
 * person is never asked to approve a pipeline that cannot be saved.
 */
const pipelineSource = z
  .string()
  .min(1)
  .max(100_000)
  .superRefine((source, ctx) => {
    const check = checkBlocks(source);
    if (!check.ok)
      ctx.addIssue({ code: "custom", message: `Not a valid pipeline: ${check.error}` });
  });

const createInput = z.object({ source: pipelineSource }).strict();
const createPipeline: OpsAction<z.infer<typeof createInput>> = {
  name: "create_pipeline",
  description:
    "Save a new pipeline. Build it from blocks (pipeline_blocks); any command of your own makes it a step a person confirms word for word.",
  input: createInput,
  risk: (inputs) => pipelineRisk(inputs.source),
  environment: (ctx, inputs) => strictestTarget(ctx, inputs.source),
  words: (inputs) => {
    const name = /^name:\s*(.+)$/m.exec(inputs.source)?.[1]?.trim() ?? "a pipeline";
    const { deploysTo } = checkBlocks(inputs.source);
    return `Save the pipeline ${name}${deploysTo.length ? `, which deploys to ${deploysTo.join(" and ")}` : ""}${freeWords(inputs.source)}`;
  },
  undo: () => "Delete the pipeline",
  async run(ctx, inputs) {
    const check = checkBlocks(inputs.source);
    if (!check.ok) return { ok: false, summary: `Not a valid pipeline: ${check.error}` };
    const created = await ctx.services.pipelines.create(ctx.user, ctx.teamId, inputs.source, {
      note: "Written by Ops",
    });
    return {
      ok: true,
      summary: `Saved the pipeline ${created.name}.`,
      data: { name: created.name },
    };
  },
  async prove(ctx, inputs, outcome) {
    const name = (outcome.data as { name?: string } | undefined)?.name ?? "";
    const row = await ctx.services.store.pipelines.pipelines.findByName(ctx.teamId, name);
    return {
      kind: "pipeline_saved",
      target: name,
      ok: row?.source === inputs.source,
      detail: row ? "Saved exactly as written." : "Not found after saving.",
    };
  },
};

const updateInput = z
  .object({
    pipeline: nameField("pipeline"),
    source: pipelineSource,
    /** get_pipeline's base: the change is refused if the file changed since. */
    base: z.string().min(1),
  })
  .strict();
const updatePipeline: OpsAction<z.infer<typeof updateInput>> = {
  name: "update_pipeline",
  description:
    "Change a pipeline's file. Give `base` from get_pipeline; if someone changed it since, the change is refused. Only pipelines without triggers switched on, unless Ops wrote them.",
  input: updateInput,
  risk: (inputs) => pipelineRisk(inputs.source),
  environment: (ctx, inputs) => strictestTarget(ctx, inputs.source),
  words: (inputs) => `Change the pipeline ${inputs.pipeline}${freeWords(inputs.source)}`,
  undo: (inputs) => `Restore ${inputs.pipeline}'s previous version from its History`,
  async run(ctx, inputs) {
    const row = await pipelineByName(ctx, inputs.pipeline);
    if (sourceHash(row.source) !== inputs.base) {
      return {
        ok: false,
        summary: `${row.name} changed since you read it. Read it again with get_pipeline.`,
      };
    }
    const triggers = await ctx.services.store.pipelines.triggers.list(row.id);
    if (row.createdBy !== ctx.user.id && triggers.some((trigger) => trigger.enabled)) {
      return {
        ok: false,
        summary: `${row.name} has triggers switched on and was written by a person, so only a person changes it.`,
      };
    }
    const check = checkBlocks(inputs.source);
    if (!check.ok) return { ok: false, summary: `Not a valid pipeline: ${check.error}` };
    await ctx.services.pipelines.update(ctx.user, ctx.teamId, row.id, inputs.source, {
      note: "Changed by Ops",
    });
    return { ok: true, summary: `Changed ${row.name}.` };
  },
  async prove(ctx, inputs) {
    const row = await ctx.services.store.pipelines.pipelines.findByName(
      ctx.teamId,
      inputs.pipeline,
    );
    return {
      kind: "pipeline_saved",
      target: inputs.pipeline,
      ok: row?.source === inputs.source,
      detail:
        row?.source === inputs.source ? "Saved exactly as written." : "The saved file differs.",
    };
  },
};

const runInput = z
  .object({
    pipeline: nameField("pipeline"),
    inputs: z.record(z.string(), z.string()).optional(),
  })
  .strict();
const runPipeline: OpsAction<z.infer<typeof runInput>> = {
  name: "run_pipeline",
  description:
    "Run a pipeline and wait for it to end (up to 30 minutes). As a step of an approved plan, its deploy to a protected environment is not asked about a second time.",
  input: runInput,
  risk: "change",
  environment: async (ctx, inputs) => {
    const row = await ctx.services.store.pipelines.pipelines.findByName(
      ctx.teamId,
      inputs.pipeline,
    );
    return row ? strictestTarget(ctx, row.source) : null;
  },
  words: (inputs) => `Run the pipeline ${inputs.pipeline}`,
  undo: () => "Roll back what it deployed (each deploy can be rolled back)",
  async run(ctx, inputs) {
    const row = await pipelineByName(ctx, inputs.pipeline);
    // Protected environments this run may deploy to without a second question: only as an approved step.
    const granted: { id: string; name: string }[] = [];
    if (ctx.approval) {
      for (const name of checkBlocks(row.source).deploysTo) {
        const environment = await environmentByName(ctx, name);
        if (environment?.protected) granted.push({ id: environment.id, name: environment.name });
      }
    }
    const started = await ctx.services.pipelines.startRun(ctx.user, ctx.teamId, row.id, {
      ...(inputs.inputs ? { inputs: inputs.inputs } : {}),
    });
    for (const environment of granted) await ctx.grantRun(started.id, environment.id);

    const ended = await waitUntil(
      async () => {
        const detail = await ctx.services.pipelines.getRun(ctx.user, ctx.teamId, started.id);
        if (detail.status === "waiting") {
          // The engine may have asked before the grant was saved: answer only its own deploy question.
          for (const approval of detail.approvals) {
            const step = detail.steps.find((candidate) => candidate.id === approval.stepId);
            const environment = granted.find(
              (env) => approval.message === `Deploy to ${env.name}?`,
            );
            if (!approval.decision && step?.kind === "deploy" && environment) {
              await ctx.services.pipelines.decide(
                ctx.user,
                ctx.teamId,
                started.id,
                approval.id,
                "approved",
                "Approved in an Ops plan.",
              );
            }
          }
          return null;
        }
        return ["passed", "failed", "cancelled", "timed_out"].includes(detail.status)
          ? detail
          : null;
      },
      30 * 60_000,
      3000,
    );
    if (!ended) {
      return {
        ok: false,
        summary: `${row.name} #${started.number} is still going after 30 minutes.`,
        data: { run: started.number },
      };
    }
    if (ended.status === "passed") {
      return {
        ok: true,
        summary: `${row.name} #${ended.number} passed.`,
        data: { run: ended.number, runId: ended.id },
      };
    }
    const logs = await ctx.services.pipelines.logs(ctx.user, ctx.teamId, ended.id, 0);
    const tail = logs.lines
      .slice(-30)
      .map((line) => line.text)
      .join("\n");
    const failedAt = ended.steps.find(
      (step) => step.status === "failed" || step.status === "timed_out",
    );
    return {
      ok: false,
      summary: `${row.name} #${ended.number} ${ended.status}${failedAt ? ` at ${failedAt.stage} › ${failedAt.name}` : ""}.`,
      data: { run: ended.number, lastLines: tail },
    };
  },
  async prove(ctx, inputs, outcome) {
    const runId = (outcome.data as { runId?: string } | undefined)?.runId;
    if (!runId)
      return { kind: "pipeline_run", target: inputs.pipeline, ok: false, detail: "No run." };
    const run = await ctx.services.store.pipelines.runs.findById(runId);
    return {
      kind: "pipeline_run",
      target: `${inputs.pipeline} #${run?.number ?? "?"}`,
      ok: run?.status === "passed",
      detail: run ? `The run ${run.status}.` : "Run not found.",
    };
  },
};

const triggerInput = z
  .object({
    pipeline: nameField("pipeline"),
    kind: z.enum(["app", "schedule"]),
    /** For a schedule: five fields, UTC, like "0 3 * * *". */
    cron: z.string().trim().max(100).optional(),
  })
  .strict();
const setTrigger: OpsAction<z.infer<typeof triggerInput>> = {
  name: "set_trigger",
  description:
    "Make a pipeline Ops wrote start by itself: when the app changes, or on a schedule (cron, UTC). Never on a pipeline a person wrote.",
  input: triggerInput,
  risk: "change",
  environment: async (ctx, inputs) => {
    const row = await ctx.services.store.pipelines.pipelines.findByName(
      ctx.teamId,
      inputs.pipeline,
    );
    return row ? strictestTarget(ctx, row.source) : null;
  },
  words: (inputs) =>
    inputs.kind === "app"
      ? `Run ${inputs.pipeline} by itself whenever the app changes`
      : `Run ${inputs.pipeline} by itself on the schedule ${inputs.cron} (UTC)`,
  undo: (inputs) => `Switch the trigger off on ${inputs.pipeline}`,
  async run(ctx, inputs) {
    const row = await pipelineByName(ctx, inputs.pipeline);
    if (row.createdBy !== ctx.user.id) {
      return {
        ok: false,
        summary: `${row.name} was written by a person: only a person adds triggers to it.`,
      };
    }
    await ctx.services.triggers.add(
      ctx.user,
      ctx.teamId,
      row.id,
      inputs.kind === "app" ? { kind: "app" } : { kind: "schedule", cron: inputs.cron ?? "" },
    );
    return { ok: true, summary: `${row.name} now runs by itself (${inputs.kind}).` };
  },
  async prove(ctx, inputs) {
    const row = await ctx.services.store.pipelines.pipelines.findByName(
      ctx.teamId,
      inputs.pipeline,
    );
    const triggers = row ? await ctx.services.store.pipelines.triggers.list(row.id) : [];
    return {
      kind: "trigger_on",
      target: inputs.pipeline,
      ok: triggers.some((trigger) => trigger.kind === inputs.kind && trigger.enabled),
      detail: `Triggers: ${triggers.map((trigger) => `${trigger.kind}${trigger.enabled ? "" : " (off)"}`).join(", ") || "none"}.`,
    };
  },
};

export const PIPELINE_ACTIONS = [
  pipelineBlocks,
  listPipelines,
  getPipeline,
  createPipeline,
  updatePipeline,
  runPipeline,
  setTrigger,
] as unknown as OpsAction[];

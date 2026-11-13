import { z } from "zod";
import { environmentByName, environmentRef, type OpsAction } from "./actions.js";

/**
 * The actions Ops has. Step 1 starts with two, enough to run the gate end to
 * end against real services; Step 3 of the build note adds the rest.
 */

const listEnvironments: OpsAction<Record<string, never>> = {
  name: "list_environments",
  description:
    "The team's environments: name, machine, address, whether protected or frozen, and how much Ops may do there alone.",
  input: z.object({}).strict() as z.ZodType<Record<string, never>>,
  risk: "read",
  words: () => "Look at the team's environments",
  async run(ctx) {
    const rows = await ctx.services.store.deploy.environments.listForTeam(ctx.teamId);
    const environments = rows.map((row) => ({
      ...environmentRef(row),
      address: row.address,
      domain: row.domain,
    }));
    return {
      ok: true,
      summary: `${environments.length} environment${environments.length === 1 ? "" : "s"}.`,
      data: environments,
    };
  },
};

const restartInput = z
  .object({
    environment: z.string().trim().min(1).max(100),
    app: z.string().trim().min(1).max(100),
  })
  .strict();

const restartApp: OpsAction<z.infer<typeof restartInput>> = {
  name: "restart_app",
  description:
    "Restart one app in an environment (its containers start again with the same version). Proven by the app being up afterwards.",
  input: restartInput,
  risk: "change",
  environment: (ctx, inputs) => environmentByName(ctx, inputs.environment),
  words: (inputs) => `Restart ${inputs.app} on ${inputs.environment}`,
  undo: () => null,
  async run(ctx, inputs) {
    const environment = await environmentByName(ctx, inputs.environment);
    if (!environment)
      return { ok: false, summary: `There is no environment called ${inputs.environment}.` };
    await ctx.services.deploys.appAction(
      ctx.user,
      ctx.teamId,
      environment.id,
      inputs.app,
      "restart",
    );
    return { ok: true, summary: `Restarted ${inputs.app} on ${inputs.environment}.` };
  },
  async prove(ctx, inputs) {
    const environment = await environmentByName(ctx, inputs.environment);
    const target = `${inputs.app} on ${inputs.environment}`;
    if (!environment)
      return { kind: "app_running", target, ok: false, detail: "No such environment." };
    const status = await ctx.services.deploys.appStatus(
      ctx.user,
      ctx.teamId,
      environment.id,
      inputs.app,
      null,
    );
    return {
      kind: "app_running",
      target,
      ok: status.state === "running",
      detail: `State: ${status.state}`,
    };
  },
};

export const OPS_ACTIONS: OpsAction[] = [
  listEnvironments as unknown as OpsAction,
  restartApp as unknown as OpsAction,
];

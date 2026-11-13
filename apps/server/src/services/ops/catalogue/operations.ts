import { z } from "zod";
import { environmentByName, type OpsAction } from "../actions.js";
import { environmentRow, liveDeployment, nameField, proveDeployment, waitUntil } from "./shared.js";

const appField = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "The app's name on the machine, like shop.");

const appInput = z.object({ environment: nameField("environment"), app: appField }).strict();

const appStatus: OpsAction<z.infer<typeof appInput>> = {
  name: "app_status",
  description:
    "An app in an environment now: running or not, restarts, CPU and memory, the live version, its last log lines.",
  input: appInput,
  risk: "read",
  words: (inputs) => `Look at ${inputs.app} on ${inputs.environment}`,
  async run(ctx, inputs) {
    const environment = await environmentRow(ctx, inputs.environment);
    const status = await ctx.services.deploys.appStatus(
      ctx.user,
      ctx.teamId,
      environment.id,
      inputs.app,
      null,
    );
    return {
      ok: true,
      summary: `${inputs.app} on ${environment.name} is ${status.state}${status.deployment ? `, #${status.deployment.number} live` : ""}.`,
      data: status,
    };
  },
};

const historyInput = z
  .object({ environment: nameField("environment"), app: appField.optional() })
  .strict();
const deploymentHistory: OpsAction<z.infer<typeof historyInput>> = {
  name: "deployment_history",
  description:
    "The deploys of an environment (or one app there): number, status, when, whether it changed the database.",
  input: historyInput,
  risk: "read",
  words: (inputs) =>
    `Look at the deploy history of ${inputs.app ?? "every app"} on ${inputs.environment}`,
  async run(ctx, inputs) {
    const environment = await environmentRow(ctx, inputs.environment);
    const rows = await ctx.services.store.deploy.deployments.listFor(
      environment.id,
      inputs.app ?? null,
      30,
    );
    return {
      ok: true,
      summary: `${rows.length} deploys.`,
      data: rows.map((row) => ({
        app: row.app,
        number: row.number,
        status: row.status,
        kind: row.kind,
        changedDatabase: row.changedDatabase,
        error: row.error,
        at: row.createdAt,
      })),
    };
  },
};

const restartApp: OpsAction<z.infer<typeof appInput>> = {
  name: "restart_app",
  description:
    "Restart an app (the same version starts again). Proven by the app answering afterwards.",
  input: appInput,
  risk: "change",
  environment: (ctx, inputs) => environmentByName(ctx, inputs.environment),
  words: (inputs) => `Restart ${inputs.app} on ${inputs.environment}`,
  undo: () => null,
  async run(ctx, inputs) {
    const environment = await environmentRow(ctx, inputs.environment);
    await ctx.services.deploys.appAction(
      ctx.user,
      ctx.teamId,
      environment.id,
      inputs.app,
      "restart",
    );
    return { ok: true, summary: `Restarted ${inputs.app} on ${environment.name}.` };
  },
  prove: (ctx, inputs) => proveDeployment(ctx, inputs.environment, inputs.app),
};

/** Waits for a deploy started in the background to end; its row, or null after the time. */
async function deployEnded(
  ctx: Parameters<OpsAction["run"]>[0],
  deploymentId: string,
  timeoutMs = 15 * 60_000,
) {
  return waitUntil(async () => {
    const row = await ctx.services.store.deploy.deployments.findById(deploymentId);
    return row && row.status !== "deploying" ? row : null;
  }, timeoutMs);
}

const rollbackInput = z
  .object({
    environment: nameField("environment"),
    app: appField,
    /** The deploy number to go back to; default the one before the live one. */
    to: z.number().int().min(1).optional(),
  })
  .strict();
const rollback: OpsAction<z.infer<typeof rollbackInput>> = {
  name: "rollback",
  description:
    "Put an earlier version of an app back (the last three are kept on the machine). A database update is not undone: check deployment_history for changedDatabase first.",
  input: rollbackInput,
  risk: "change",
  environment: (ctx, inputs) => environmentByName(ctx, inputs.environment),
  words: (inputs) =>
    `Roll ${inputs.app} on ${inputs.environment} back to ${inputs.to ? `#${inputs.to}` : "the version before"}`,
  undo: () => "Roll forward again to the version that was live",
  async run(ctx, inputs) {
    const environment = await environmentRow(ctx, inputs.environment);
    const rows = await ctx.services.store.deploy.deployments.listFor(
      environment.id,
      inputs.app,
      30,
    );
    const live = rows.find((row) => row.status === "live");
    const target = inputs.to
      ? rows.find((row) => row.number === inputs.to)
      : rows.find(
          (row) =>
            row.number < (live?.number ?? Number.POSITIVE_INFINITY) &&
            ["replaced", "rolled_back"].includes(row.status),
        );
    if (!target) return { ok: false, summary: "There is no earlier version to go back to." };
    const changed = rows.filter((row) => row.number > target.number && row.changedDatabase);
    const started = await ctx.services.deploys.rollBack(ctx.user, ctx.teamId, target.id);
    const ended = await deployEnded(ctx, started.id);
    const note = changed.length
      ? ` Note: ${changed.map((row) => `#${row.number}`).join(", ")} changed the database after #${target.number}.`
      : "";
    if (!ended)
      return {
        ok: false,
        summary: `The roll back to #${target.number} is still going after 15 minutes.`,
      };
    return {
      ok: ended.status === "live",
      summary:
        ended.status === "live"
          ? `${inputs.app} on ${environment.name} is back on #${target.number}.${note}`
          : `The roll back failed: ${ended.error ?? ended.status}.${note}`,
    };
  },
  prove: (ctx, inputs) => proveDeployment(ctx, inputs.environment, inputs.app),
};

const promoteInput = z
  .object({ from: nameField("environment"), to: nameField("environment"), app: appField })
  .strict();
const promote: OpsAction<z.infer<typeof promoteInput>> = {
  name: "promote",
  description:
    "Ship the exact image live in one environment (tested on staging) to another (production). Nothing is built again.",
  input: promoteInput,
  risk: "change",
  environment: (ctx, inputs) => environmentByName(ctx, inputs.to),
  words: (inputs) => `Ship ${inputs.app} from ${inputs.from} to ${inputs.to}, the same image`,
  undo: (inputs) => `Roll ${inputs.app} on ${inputs.to} back to its previous version`,
  async run(ctx, inputs) {
    const from = await environmentRow(ctx, inputs.from);
    const to = await environmentRow(ctx, inputs.to);
    const live = await liveDeployment(ctx, from, inputs.app);
    if (!live) return { ok: false, summary: `${inputs.app} is not live on ${from.name}.` };
    const started = await ctx.services.deploys.promote(ctx.user, ctx.teamId, live.id, to.id);
    const ended = await deployEnded(ctx, started.id);
    if (!ended) return { ok: false, summary: "The promote is still going after 15 minutes." };
    return {
      ok: ended.status === "live",
      summary:
        ended.status === "live"
          ? `${inputs.app} #${live.number} from ${from.name} is live on ${to.name} as #${ended.number}.`
          : `The promote failed: ${ended.error ?? ended.status}.`,
    };
  },
  prove: (ctx, inputs) => proveDeployment(ctx, inputs.to, inputs.app),
};

const addressInput = z
  .object({
    environment: nameField("environment"),
    app: appField,
    domain: z.string().trim().min(3).max(253).nullable(),
    www: z.boolean().optional(),
  })
  .strict();
const setAppAddress: OpsAction<z.infer<typeof addressInput>> = {
  name: "set_app_address",
  description:
    "Give a live app its own address (shop.example.com), with HTTPS from Zelyq's proxy. The person adds the DNS record; check_dns shows when it is in place.",
  input: addressInput,
  risk: "change",
  environment: (ctx, inputs) => environmentByName(ctx, inputs.environment),
  words: (inputs) =>
    inputs.domain
      ? `Put ${inputs.app} on ${inputs.environment} at ${inputs.domain}${inputs.www ? " (and www)" : ""}`
      : `Put ${inputs.app} on ${inputs.environment} back on its usual address`,
  undo: (inputs) => `Put ${inputs.app} back on the address it had`,
  async run(ctx, inputs) {
    const environment = await environmentRow(ctx, inputs.environment);
    const result = await ctx.services.deploys.setAddress(
      ctx.user,
      ctx.teamId,
      environment.id,
      inputs.app,
      {
        domain: inputs.domain,
        www: inputs.www ?? false,
      },
    );
    return {
      ok: true,
      summary: result.applied
        ? `${inputs.app} answers at ${inputs.domain ?? "its usual address"} now.`
        : `Saved; it takes effect on ${inputs.app}'s next deploy.`,
    };
  },
  prove: (ctx, inputs) => proveDeployment(ctx, inputs.environment, inputs.app),
};

export const OPERATION_ACTIONS = [
  appStatus,
  deploymentHistory,
  restartApp,
  rollback,
  promote,
  setAppAddress,
] as unknown as OpsAction[];

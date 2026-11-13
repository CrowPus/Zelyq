import type { DeployEnvironmentRow, RunnerRow } from "@zelyq/db";
import { z } from "zod";
import { guardedRequest } from "../../net-guard.js";
import type { ActionContext, ProofResult } from "../actions.js";

export const nameField = (what: string) => z.string().trim().min(1, `Name the ${what}.`).max(100);

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A team's machine (SSH runner) by name. */
export async function machineByName(ctx: ActionContext, name: string): Promise<RunnerRow> {
  const row = await ctx.services.store.pipelines.runners.findByName(ctx.teamId, name);
  if (!row)
    throw new Error(`There is no machine called ${name}. list_machines shows the team's machines.`);
  return row;
}

/** A team's environment by name, or a plain error the engineer can act on. */
export async function environmentRow(
  ctx: ActionContext,
  name: string,
): Promise<DeployEnvironmentRow> {
  const row = await ctx.services.store.deploy.environments.findByName(ctx.teamId, name);
  if (!row) {
    throw new Error(`There is no environment called ${name}. list_environments shows them.`);
  }
  return row;
}

/** The app's live deployment in an environment, or null. */
export async function liveDeployment(
  ctx: ActionContext,
  environment: DeployEnvironmentRow,
  app: string,
) {
  return (
    (await ctx.services.store.deploy.deployments.live([environment.id])).find(
      (row) => row.app === app,
    ) ?? null
  );
}

/**
 * The server's own proof that an app is up: its live deployment, its
 * container running, and its address answering its health path. The target
 * comes from the deployment itself, never from the engineer. Only the status
 * is kept, never what the page said.
 */
export async function proveDeployment(
  ctx: ActionContext,
  environmentName: string,
  app: string,
): Promise<ProofResult> {
  const target = `${app} on ${environmentName}`;
  const environment = await ctx.services.store.deploy.environments.findByName(
    ctx.teamId,
    environmentName,
  );
  if (!environment)
    return { kind: "app_answers", target, ok: false, detail: "No such environment." };
  const live = await liveDeployment(ctx, environment, app);
  if (!live) return { kind: "app_answers", target, ok: false, detail: "Nothing is live there." };
  const status = await ctx.services.deploys
    .appStatus(ctx.user, ctx.teamId, environment.id, app, null)
    .catch(() => null);
  if (status && status.state !== "running") {
    return { kind: "app_answers", target, ok: false, detail: `The app is ${status.state}.` };
  }
  if (!live.url) {
    return {
      kind: "app_running",
      target,
      ok: status?.state === "running",
      detail: `#${live.number} is running (no address to open).`,
    };
  }
  const address = new URL(live.healthPath || "/", live.url).toString();
  try {
    const answer = await guardedRequest(address, {
      level: "deployment",
      timeoutMs: 15_000,
      maxBytes: 0,
    });
    const ok = answer.status >= 200 && answer.status < 400;
    return {
      kind: "app_answers",
      target: address,
      ok,
      detail: `#${live.number} answered ${answer.status} in ${answer.ms} ms.`,
    };
  } catch (error) {
    return { kind: "app_answers", target: address, ok: false, detail: (error as Error).message };
  }
}

/** Waits until a check says done, or time runs out. */
export async function waitUntil<T>(
  check: () => Promise<T | null>,
  timeoutMs: number,
  everyMs = 2000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== null) return value;
    if (Date.now() > deadline) return null;
    await sleep(everyMs);
  }
}

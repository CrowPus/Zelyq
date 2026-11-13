import { createHash } from "node:crypto";
import type { OpsRisk, OpsTrust, User } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { z } from "zod";
import type { DeployService } from "../deploy.js";
import type { RunnerService } from "../pipelines/runners.js";
import type { PipelineService } from "../pipelines/service.js";
import type { PipelineTriggerService } from "../pipelines/triggers.js";
import type { VaultService } from "../vault.js";
import type { OpsMemory } from "./memory.js";

/**
 * The one set of hands (072 §2.1). Every thing Ops can do is an action here:
 * a name, an input shape, how risky it is, the plain words a person reads in
 * a plan, and how the server proves it worked. Ops never holds a service
 * directly; it only ever has this list, and every call goes through the gate.
 *
 * What is NOT here is the point: no action reads a secret value, opens a shell
 * on a machine, or changes what Ops itself may do.
 */

/** An environment as the gate sees it. */
export interface OpsEnvironmentRef {
  id: string;
  name: string;
  frozen: boolean;
  frozenReason: string | null;
  protected: boolean;
  trust: OpsTrust;
}

/** What an action may use. Grows as actions are added; never a raw shell. */
export interface OpsServices {
  store: Store;
  deploys: DeployService;
  pipelines: PipelineService;
  triggers: PipelineTriggerService;
  runners: RunnerService;
  vault: VaultService;
  runtime: RuntimeDriver;
  memory: OpsMemory;
}

export interface ActionContext {
  teamId: string;
  /** Who it is done as: the team's Ops account, or the person carrying out an approved request. */
  user: User;
  jobId: string | null;
  services: OpsServices;
  /** When this runs as a step of a plan a person approved: that step, and who approved it. */
  approval: { stepId: string; approvedBy: string | null } | null;
  /** Records that a pipeline run belongs to the approved step, so its protected deploy is not asked twice. */
  grantRun(runId: string, environmentId: string): Promise<void>;
  /** Tells the person in this job something (a secret to add, a DNS record to make). */
  say(text: string): Promise<void>;
}

export interface ActionOutcome {
  ok: boolean;
  /** One line a person can read. */
  summary: string;
  data?: unknown;
}

/** The server's own check that a change worked: never chosen by the model. */
export interface ProofResult {
  kind: string;
  target: string;
  ok: boolean;
  detail: string | null;
}

export interface OpsAction<I extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  /** For the engineer and for outside agents. */
  description: string;
  input: z.ZodType<I>;
  risk: OpsRisk | ((inputs: I) => OpsRisk);
  /** The environment it touches, for trust and freeze; null when none. */
  environment?: (ctx: ActionContext, inputs: I) => Promise<OpsEnvironmentRef | null>;
  /**
   * A change that touches no environment (writing a note, a pipeline from
   * building blocks) may run without a plan. Default: it needs an approved plan.
   */
  freeUse?: boolean;
  /** What a person reads in a plan, from the exact inputs. */
  words: (inputs: I) => string;
  /** How to undo it, in plain words; null when there is nothing to undo. */
  undo?: (inputs: I) => string | null;
  run: (ctx: ActionContext, inputs: I) => Promise<ActionOutcome>;
  /** Every change should have one; without it a step can only be "not verified". */
  prove?: (ctx: ActionContext, inputs: I, outcome: ActionOutcome) => Promise<ProofResult>;
}

export function riskOf<I extends Record<string, unknown>>(
  action: OpsAction<I>,
  inputs: I,
): OpsRisk {
  return typeof action.risk === "function" ? action.risk(inputs) : action.risk;
}

/** The same inputs always give the same hash, whatever order their keys were written in. */
export function inputsHash(action: string, inputs: unknown): string {
  return createHash("sha256")
    .update(`${action}\n${stableJson(inputs)}`)
    .digest("hex")
    .slice(0, 32);
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The environment of a team, by name, as the gate sees it; null when there is none. */
export async function environmentByName(
  ctx: ActionContext,
  name: unknown,
): Promise<OpsEnvironmentRef | null> {
  if (typeof name !== "string" || !name) return null;
  const row = await ctx.services.store.deploy.environments.findByName(ctx.teamId, name);
  return row ? environmentRef(row) : null;
}

export function environmentRef(row: {
  id: string;
  name: string;
  frozen: boolean;
  frozenReason: string | null;
  protected: boolean;
  opsTrust: string;
}): OpsEnvironmentRef {
  return {
    id: row.id,
    name: row.name,
    frozen: row.frozen,
    frozenReason: row.frozenReason,
    protected: row.protected,
    trust: (["advise", "ask", "trusted", "oncall"].includes(row.opsTrust)
      ? row.opsTrust
      : "ask") as OpsTrust,
  };
}

/** The list Ops works with, by name. */
export class ActionList {
  private readonly byName = new Map<string, OpsAction>();

  constructor(actions: OpsAction[]) {
    for (const action of actions) {
      if (this.byName.has(action.name))
        throw new Error(`Two Ops actions are called ${action.name}.`);
      this.byName.set(action.name, action);
    }
  }

  get(name: string): OpsAction | null {
    return this.byName.get(name) ?? null;
  }

  all(): OpsAction[] {
    return [...this.byName.values()];
  }
}

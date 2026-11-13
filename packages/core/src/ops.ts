import { z } from "zod";

/**
 * Ops: the team's DevOps engineer. These are the shapes the server, the
 * engineer's own session and the Ops page share. The rules about what Ops may
 * do live in the server (`services/ops/`), never here: a type cannot enforce
 * anything.
 */

/** How much Ops may do on an environment without a person. */
export const OPS_TRUST_LEVELS = ["advise", "ask", "trusted", "oncall"] as const;
export type OpsTrust = (typeof OPS_TRUST_LEVELS)[number];

export const OPS_TRUST_WORDS: Record<OpsTrust, { label: string; description: string }> = {
  advise: {
    label: "Advise only",
    description: "Ops plans and explains; a person does everything.",
  },
  ask: {
    label: "Ask first",
    description: "Ops works alone on unprotected environments and asks before protected ones.",
  },
  trusted: {
    label: "Trusted",
    description: "Ops ships tested changes alone, here too. Risky actions still ask.",
  },
  oncall: {
    label: "On call",
    description: "Trusted, and Ops may restore service alone during an incident.",
  },
};

/**
 * The fixed stages of every job, the habits of a senior engineer. Only the
 * server moves a job forward.
 */
export const OPS_STAGES = [
  "survey",
  "plan",
  "approve",
  "act",
  "record",
  "done",
  "failed",
  "stopped",
] as const;
export type OpsStage = (typeof OPS_STAGES)[number];

export const OPS_JOB_KINDS = [
  "question",
  "launch",
  "ship",
  "domain",
  "secrets",
  "incident",
  "other",
] as const;
export type OpsJobKind = (typeof OPS_JOB_KINDS)[number];

/**
 * How dangerous an action is.
 * - read: looks only.
 * - change: changes something; trust level and the plan decide.
 * - always-ask: cannot be undone (delete data, remove a machine, point a domain,
 *   rotate a secret, pay for a server): a person confirms each one.
 * - own-limits: changes what Ops itself may do: only a person, ever.
 */
export type OpsRisk = "read" | "change" | "always-ask" | "own-limits";

export type OpsStepStatus =
  | "planned"
  | "running"
  | "done"
  | "failed"
  | "skipped"
  | "not_verified"
  /** Failed or unproven, then a later plan took its place: kept in the record, no longer owed. */
  | "replaced";

export interface OpsEngineer {
  teamId: string;
  name: string;
  paused: boolean;
  pausedAt: string | null;
  monthlyTokenCap: number | null;
  tokensThisMonth: number;
  timeZone: string;
}

export interface OpsPlanStep {
  id: string;
  position: number;
  action: string;
  /** What a person reads: written by the server from the action and its inputs. */
  words: string;
  risk: OpsRisk;
  undo: string | null;
  /** Whether this step waits for a person's yes before it can run. */
  needsApproval: boolean;
  status: OpsStepStatus;
  result: string | null;
  proof: OpsProof | null;
}

export interface OpsProof {
  kind: string;
  target: string;
  ok: boolean;
  detail: string | null;
  at: string;
}

export interface OpsMessage {
  id: string;
  role: "person" | "ops" | "system";
  author: string | null;
  text: string;
  at: string;
}

export interface OpsJobSummary {
  id: string;
  kind: OpsJobKind;
  request: string;
  stage: OpsStage;
  source: string;
  askedBy: string | null;
  outcome: string | null;
  createdAt: string;
  finishedAt: string | null;
  tokens: number;
}

export interface OpsJobDetail extends OpsJobSummary {
  steps: OpsPlanStep[];
  /** Changes when the plan changes: what an approval is bound to. */
  planHash: string | null;
  planApprovedBy: string | null;
  planApprovedAt: string | null;
  /** Whether the person reading may approve this plan now, and if not why. */
  canApprove: boolean;
  approveBlockedBy: string | null;
  messages: OpsMessage[];
  /** Ops is thinking or acting on this job right now. */
  working: boolean;
  /** What it has been doing in this turn, newest last: "Looked at the app Shop". */
  activity: string[];
}

/** Talking to Ops: a new job, or more in an existing one. */
export const opsTalkSchema = z
  .object({
    text: z.string().trim().min(1, "Say something.").max(4000),
    jobId: z.string().min(1).optional(),
    /** Said aloud rather than typed: shown the same, kept as text. */
    spoken: z.boolean().optional(),
  })
  .strict();
export type OpsTalkInput = z.input<typeof opsTalkSchema>;

export const opsJobInputSchema = z
  .object({
    request: z.string().trim().min(1, "Say what you need.").max(4000),
    kind: z.enum(OPS_JOB_KINDS).optional(),
  })
  .strict();
export type OpsJobInput = z.input<typeof opsJobInputSchema>;

export const opsPlanDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    /** The plan the person saw: approval is refused if it changed since. */
    planHash: z.string().min(1),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();

/** One step as the engineer proposes it: an action and its exact inputs. */
export const opsPlanStepInputSchema = z
  .object({
    action: z.string().min(1).max(100),
    inputs: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const opsPlanInputSchema = z
  .object({ steps: z.array(opsPlanStepInputSchema).min(1).max(40) })
  .strict();
export type OpsPlanInput = z.input<typeof opsPlanInputSchema>;

export const opsEngineerUpdateSchema = z
  .object({
    paused: z.boolean().optional(),
    monthlyTokenCap: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    timeZone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

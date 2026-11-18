import { z } from "zod";
import { PLAN_LIMIT_KEYS, type PlanLimitKey } from "./plan-limits.js";

/**
 * Plans: what a team may use. A plan is a set of limits; every team is on one.
 * A server that sets no plans has one, "Unlimited", so a self-hosted install
 * works with nothing to set up. A public server (the cloud) defines its own,
 * and a subscription later just moves a team to another plan.
 */

/** A limit left out, or null, is no limit. */
export const planLimitsSchema = z
  .object(
    Object.fromEntries(
      PLAN_LIMIT_KEYS.map((key) => [
        key,
        z.number().int().min(0).max(10_000_000).nullable().optional(),
      ]),
    ) as Record<PlanLimitKey, z.ZodOptional<z.ZodNullable<z.ZodNumber>>>,
  )
  .strict();
export type PlanLimits = Partial<Record<PlanLimitKey, number | null>>;

export const planSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{0,39}$/, "A short id: lower-case letters, digits and '-' (pro)."),
    name: z.string().trim().min(1).max(60),
    limits: planLimitsSchema,
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;

export const UNLIMITED_PLAN: Plan = { id: "unlimited", name: "Unlimited", limits: {} };

export const plansSettingsSchema = z
  .object({
    plans: z.array(planSchema).max(20),
    /** The plan a new team starts on. */
    defaultPlan: z.string().min(1),
  })
  .strict();
export type PlansSettings = z.infer<typeof plansSettingsSchema>;

/** One limit as a team sees it. */
export interface UsageLine {
  key: PlanLimitKey;
  label: string;
  unit: string;
  description: string;
  used: number;
  /** null: no limit. */
  limit: number | null;
}

export interface TeamUsage {
  plan: { id: string; name: string };
  /**
   * Whether plans mean anything on this server. A self-hosted server where every
   * team is Unlimited shows usage only, no plan; a managed one always shows it.
   */
  plansVisible: boolean;
  lines: UsageLine[];
  /** What the storage total is made of, in MB. */
  storage: {
    apps: number;
    undoPoints: number;
    studio: number;
    attachments: number;
    pipelines: number;
  };
  /** When the files were last measured. */
  measuredAt: string | null;
  /** Each app, biggest first: what it uses, in MB, and how many undo points it keeps. */
  apps: AppUsage[];
}

export interface AppUsage {
  id: string;
  name: string;
  files: number;
  undoPoints: number;
  undoCount: number;
  attachments: number;
}

/** What freeing space in one app did, or would do (look). */
export interface FreeSpaceResult {
  look: boolean;
  freedMb: number;
  undoPointsRemoved: number;
  attachmentsRemoved: boolean;
}

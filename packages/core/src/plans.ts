import { z } from "zod";

/**
 * Plans: what a team may use. A plan is a set of limits; every team is on one.
 * A server that sets no plans has one, "Unlimited", so a self-hosted install
 * works with nothing to set up. A public server (the cloud) defines its own,
 * and a subscription later just moves a team to another plan.
 */

export const PLAN_LIMITS = {
  storageMb: {
    label: "Storage",
    unit: "MB",
    description:
      "What the team made and could not get back: its apps' own files and history, undo points, Studio's images and videos, chat attachments and pipeline files. Installed packages and build output are not counted: Zelyq can always reinstall them.",
  },
  apps: { one: "app", label: "Apps", unit: "", description: "Apps in the team." },
  pipelines: {
    one: "pipeline",
    label: "Pipelines",
    unit: "",
    description: "Pipelines in the team.",
  },
  triggers: {
    one: "webhook or schedule",
    label: "Webhooks and schedules",
    unit: "",
    description: "What starts the team's pipelines by itself: webhooks, schedules, app changes.",
  },
  environments: {
    one: "environment",
    label: "Environments",
    unit: "",
    description: "Places the team deploys to.",
  },
  machines: {
    one: "machine",
    label: "Machines",
    unit: "",
    description: "The team's own servers (runners).",
  },
  members: {
    label: "Members",
    unit: "",
    description: "People in the team, with invitations still waiting.",
  },
  previews: {
    one: "preview at once",
    label: "Previews at once",
    unit: "",
    description: "Apps the team runs in Zelyq's preview at the same time.",
  },
  runnerMinutes: {
    label: "Runner minutes a month",
    unit: "min",
    description:
      "Pipeline time on this server's own runner, this month. Runs on the team's own machines are free.",
  },
} as const;

export type PlanLimitKey = keyof typeof PLAN_LIMITS;
export const PLAN_LIMIT_KEYS = Object.keys(PLAN_LIMITS) as PlanLimitKey[];

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

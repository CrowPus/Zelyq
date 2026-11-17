import { z } from "zod";

/**
 * The admin API (`/api/admin/v1`): how an outside system (an account service,
 * monitoring, analytics, support tools) runs this server. A caller is a key,
 * never a person's session, and each key reaches only its scopes.
 */
export const ADMIN_KEY_PREFIX = "zlq_admin_";

export const ADMIN_SCOPES = {
  accounts: "Create, change, sign out, suspend and delete people",
  teams: "Create teams, change their plan and status, delete them",
  plans: "Read and set the plans and their limits",
  usage: "Read what each team uses, and when it was last active",
  events: "Read what happened here (sign-ups, new teams, limits reached)",
  analytics: "Read product numbers: active people, funnel, retention, feature use",
  health: "Check every part of the server",
  errors: "Read server errors and failed builds",
  metrics: "Read performance numbers for monitoring",
  support: "Look at a team's facts and logs to help it",
  notify: "Send announcements and notifications to people",
  features: "Turn features on or off for everyone, a plan, a team or a person",
  audit: "Read the audit log",
} as const;

export type AdminScope = keyof typeof ADMIN_SCOPES;
export const adminScopeSchema = z.enum(Object.keys(ADMIN_SCOPES) as [AdminScope, ...AdminScope[]]);
export const ALL_ADMIN_SCOPES = adminScopeSchema.options;

export const createAdminKeySchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    scopes: z.array(adminScopeSchema).min(1),
  })
  .strict();
export type CreateAdminKeyInput = z.infer<typeof createAdminKeySchema>;

/** A key as the server's administrator sees it: never the key itself. */
export interface AdminKeySummary {
  id: string;
  name: string;
  scopes: AdminScope[];
  /** The first characters, to tell keys apart: `zlq_admin_Ab12Cd…`. */
  prefix: string;
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
}

/** Answer to making a key: the key appears here once, and never again. */
export interface CreatedAdminKey {
  key: string;
  summary: AdminKeySummary;
}

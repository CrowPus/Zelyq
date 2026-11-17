import { z } from "zod";

/**
 * Product activity: what people do with this server, for its own
 * administrators (sign-ups, active people, the activation funnel, feature
 * use). It stays on the server that recorded it; nothing is ever sent
 * anywhere unless the server's administrator gives a key to read it.
 *
 * Only the facts below are kept for each event, and only short plain values:
 * never message text, code, file contents, names of secrets, or keys.
 */
export const PRODUCT_EVENTS = {
  "account.created": { detail: ["via"] },
  "account.signed_in": { detail: ["method"] },
  "team.created": { detail: ["via"] },
  "member.invited": { detail: [] },
  "member.joined": { detail: ["role"] },
  "app.created": { detail: ["template", "from"] },
  "app.deleted": { detail: [] },
  "agent.message": { detail: ["mode"] },
  "agent.build_finished": { detail: ["ok", "seconds", "provider", "mode"] },
  "preview.started": { detail: [] },
  "preview.failed": { detail: ["reason"] },
  "pipeline.run_finished": { detail: ["ok", "status", "seconds", "trigger"] },
  "deploy.finished": { detail: ["ok", "kind"] },
  "limit.reached": { detail: ["limit", "plan"] },
  "feature.used": { detail: ["feature"] },
} as const satisfies Record<string, { detail: readonly string[] }>;

export type ProductEventName = keyof typeof PRODUCT_EVENTS;
export const productEventNameSchema = z.enum(
  Object.keys(PRODUCT_EVENTS) as [ProductEventName, ...ProductEventName[]],
);

/** The features `feature.used` counts. */
export const PRODUCT_FEATURES = [
  "studio_image",
  "studio_video",
  "voice",
  "vault",
  "pipelines",
  "deploy_environments",
  "outside_agents",
  "ops",
  "git",
  "supabase",
  "figma",
] as const;
export type ProductFeature = (typeof PRODUCT_FEATURES)[number];

export type ProductEventDetail = Record<string, string | number | boolean>;

export interface ProductEvent {
  id: string;
  name: ProductEventName;
  userId: string | null;
  teamId: string | null;
  projectId: string | null;
  detail: ProductEventDetail;
  createdAt: string;
}

/**
 * Keeps only the facts an event may carry, as short plain values. Anything
 * else is dropped, not stored: a mistake at a call site cannot leak content.
 */
export function cleanProductDetail(
  name: ProductEventName,
  detail: Record<string, unknown> | undefined,
): ProductEventDetail {
  const allowed: readonly string[] = PRODUCT_EVENTS[name].detail;
  const clean: ProductEventDetail = {};
  for (const key of allowed) {
    const value = detail?.[key];
    if (typeof value === "boolean") clean[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) clean[key] = Math.round(value);
    else if (typeof value === "string" && /^[\w.:/@ -]{1,60}$/.test(value)) clean[key] = value;
  }
  return clean;
}

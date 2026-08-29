import { ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SupabaseBridge } from "../services/supabase-bridge.js";
import type { SupabaseConnectionService } from "../services/supabase-connections.js";

/**
 * The endpoints the build agent calls through the Supabase bridge.
 * Authenticated ONLY by the bridge token (`x-zelyq-supabase-bridge`
 * header), never a user cookie. Each call resolves to one project + the
 * connecting user; the Management credential stays inside
 * `SupabaseConnectionService`.
 */

const applySchema = z.object({
  name: z.string().min(1).max(200),
  sql: z.string().min(1).max(200_000),
});

const deployFunctionSchema = z.object({
  slug: z.string().min(1).max(60),
  source: z.string().min(1).max(500_000),
  verifyJwt: z.boolean().optional(),
});

export function registerSupabaseBridgeRoutes(
  app: FastifyInstance,
  deps: { bridge: SupabaseBridge; supabase: SupabaseConnectionService; store: Store },
): void {
  const { bridge, supabase, store } = deps;

  async function context(request: { headers: Record<string, unknown> }) {
    const token = request.headers["x-zelyq-supabase-bridge"];
    const grant = typeof token === "string" ? bridge.resolve(token) : null;
    if (!grant) throw new ZelyqError("unauthorized", "Invalid or expired Supabase bridge token.");
    const user = await store.users.findById(grant.userId);
    if (!user) throw new ZelyqError("unauthorized", "The bridge's user no longer exists.");
    return { user, projectId: grant.projectId };
  }

  app.post<{ Body: unknown }>("/api/internal/supabase/apply-migration", async (request) => {
    const { user, projectId } = await context(request);
    const input = applySchema.parse(request.body);
    const result = await supabase.applyMigration(user, projectId, input);
    return result;
  });

  app.post("/api/internal/supabase/verify", async (request) => {
    const { user, projectId } = await context(request);
    return supabase.backendVerification(user, projectId);
  });

  app.post<{ Body: unknown }>("/api/internal/supabase/deploy-function", async (request) => {
    const { user, projectId } = await context(request);
    const input = deployFunctionSchema.parse(request.body);
    return supabase.deployEdgeFunction(user, projectId, input);
  });
}

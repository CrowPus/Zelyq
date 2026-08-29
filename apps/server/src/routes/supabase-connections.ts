import type { RuntimeDriver } from "@zelyq/runtime";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { SupabaseConnectionService } from "../services/supabase-connections.js";

/**
 * Proposal 058 · Phase A routes.
 *
 * The Supabase connection is **instance-wide**, managed from Settings next to
 * the model API keys — so connect / list / link-resource / provision / delete
 * require the **instance administrator**. The per-project link routes are
 * scoped to the project (editor), since linking a resource that already exists
 * to one project is not an instance-config change.
 */

const patSchema = z.object({ pat: z.string().min(10).max(400) });
const linkExistingSchema = z.object({
  projectRef: z.string().min(6).max(60),
  environment: z.enum(["development", "staging", "production"]).optional(),
});
const provisionSchema = z.object({
  organizationId: z.string().min(1),
  region: z.string().min(1),
  name: z.string().min(1).max(80),
  confirmed: z.literal(true),
});
const linkProjectSchema = z.object({ resourceId: z.string().min(6) });
const confirmedSchema = z.object({ confirmed: z.literal(true) });

export function registerSupabaseConnectionRoutes(
  app: FastifyInstance,
  deps: { supabase: SupabaseConnectionService; access: AccessControl; runtime: RuntimeDriver },
): void {
  const { supabase, access, runtime } = deps;

  // — capability probe (any signed-in user; the UI shows/hides the OAuth button) —
  app.get("/api/integrations/supabase/config", async (request) => {
    access.requireUser(request);
    return { oauthConfigured: supabase.oauthConfigured };
  });

  // — instance-wide connection management (instance administrator) —

  app.get("/api/integrations/supabase/connections", async (request) => {
    access.requireInstanceAdmin(request);
    return { connections: await supabase.listConnections() };
  });

  app.post<{ Body: unknown }>(
    "/api/integrations/supabase/connections/pat",
    async (request, reply) => {
      const user = access.requireInstanceAdmin(request);
      const { pat } = patSchema.parse(request.body);
      const connection = await supabase.connectWithPat(user, pat);
      reply.status(201);
      return { connection };
    },
  );

  app.post("/api/integrations/supabase/connections/oauth/start", async (request) => {
    const user = access.requireInstanceAdmin(request);
    return { url: supabase.beginOAuth(user).url };
  });

  // The provider redirects the browser here. `state` carries the pending auth.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/integrations/supabase/oauth/callback",
    async (request, reply) => {
      access.requireUser(request);
      const { code, state, error } = request.query;
      if (error || !code || !state) {
        reply.redirect("/settings?supabase=error");
        return;
      }
      await supabase.completeOAuth(state, code);
      reply.redirect("/settings?supabase=connected");
    },
  );

  app.delete<{ Params: { connectionId: string } }>(
    "/api/integrations/supabase/connections/:connectionId",
    async (request) => {
      const user = access.requireInstanceAdmin(request);
      await supabase.revoke(user, request.params.connectionId);
      return { ok: true };
    },
  );

  // — resources —

  app.get<{ Params: { connectionId: string } }>(
    "/api/integrations/supabase/connections/:connectionId/resources",
    async (request) => {
      access.requireInstanceAdmin(request);
      return { resources: await supabase.listResources(request.params.connectionId) };
    },
  );

  app.get<{ Params: { connectionId: string } }>(
    "/api/integrations/supabase/connections/:connectionId/org-projects",
    async (request) => {
      access.requireInstanceAdmin(request);
      return { projects: await supabase.listOrgProjects(request.params.connectionId) };
    },
  );

  app.post<{ Params: { connectionId: string }; Body: unknown }>(
    "/api/integrations/supabase/connections/:connectionId/resources/link",
    async (request, reply) => {
      const user = access.requireInstanceAdmin(request);
      const input = linkExistingSchema.parse(request.body);
      const resource = await supabase.linkExistingResource(
        user,
        request.params.connectionId,
        input,
      );
      reply.status(201);
      return { resource };
    },
  );

  app.post<{ Params: { connectionId: string }; Body: unknown }>(
    "/api/integrations/supabase/connections/:connectionId/resources/provision",
    async (request, reply) => {
      const user = access.requireInstanceAdmin(request);
      const input = provisionSchema.parse(request.body);
      const resource = await supabase.provisionProject(user, request.params.connectionId, input);
      reply.status(201);
      return { resource };
    },
  );

  app.delete<{ Params: { resourceId: string }; Body: unknown }>(
    "/api/integrations/supabase/resources/:resourceId",
    async (request) => {
      const user = access.requireInstanceAdmin(request);
      const input = confirmedSchema.parse(request.body ?? {});
      await supabase.deleteResource(user, request.params.resourceId, input);
      return { ok: true };
    },
  );

  // — per-project link (scoped to the project's own team) —

  app.get<{ Params: { id: string } }>("/api/projects/:id/supabase-link", async (request) => {
    const user = access.requireUser(request);
    await access.requireProject(user, request.params.id, "viewer");
    return { resource: await supabase.getLinkedResource(request.params.id) };
  });

  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/supabase-link",
    async (request) => {
      const user = access.requireUser(request);
      const { project } = await access.requireProject(user, request.params.id, "editor");
      const { resourceId } = linkProjectSchema.parse(request.body);
      await supabase.linkProjectToResource(user, request.params.id, project.teamId, resourceId);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/projects/:id/supabase-link", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    await supabase.unlinkProject(user, request.params.id, project.teamId);
    return { ok: true };
  });

  // Apply the project's `supabase/migrations/*.sql` to its linked development
  // resource, then run the backend verification checks. Explicit user action —
  // the "applying a mutation" consent point from 058 rev 2 §3.
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/supabase/apply-and-verify",
    async (request) => {
      const user = access.requireUser(request);
      await access.requireProject(user, request.params.id, "editor");

      let files: Array<{ path: string }> = [];
      try {
        files = (
          await runtime.listFiles(request.params.id, { path: "supabase/migrations" })
        ).filter((entry) => entry.path.endsWith(".sql"));
      } catch {
        files = [];
      }
      files.sort((a, b) => a.path.localeCompare(b.path));

      if (files.length === 0) {
        return {
          migrations: [],
          verification: {
            verified: false,
            summary:
              "This project has no Supabase backend yet. Design one with the Architect (tell it the app needs accounts or saved data), build it, then apply.",
            checks: [],
          },
        };
      }

      const migrations: Array<{ name: string; status: string }> = [];
      let allApplied = true;
      for (const file of files) {
        const name =
          file.path
            .split("/")
            .pop()
            ?.replace(/\.sql$/, "") ?? file.path;
        try {
          const sql = (await runtime.readFile(request.params.id, file.path)).content;
          const result = await supabase.applyMigration(user, request.params.id, { name, sql });
          migrations.push({ name, status: result.alreadyApplied ? "already applied" : "applied" });
        } catch (error) {
          allApplied = false;
          migrations.push({
            name,
            status: `failed — ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }

      if (!allApplied) {
        return {
          migrations,
          verification: {
            verified: false,
            summary: "A migration failed to apply. Fix the SQL and try again.",
            checks: [],
          },
        };
      }

      const verification = await supabase.backendVerification(user, request.params.id);
      return { migrations, verification };
    },
  );
}

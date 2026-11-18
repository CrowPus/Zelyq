import { type User, vaultNameSchema } from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { SupabaseConnectionService } from "../services/supabase-connections.js";
import type { VaultService } from "../services/vault.js";

/**
 * Supabase connection routes.
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
  deps: {
    supabase: SupabaseConnectionService;
    access: AccessControl;
    runtime: RuntimeDriver;
    vault: VaultService;
  },
): void {
  const { supabase, access, runtime, vault } = deps;

  // — capability probe (any signed-in user; the UI shows/hides the OAuth button) —
  app.get("/api/integrations/supabase/config", async (request) => {
    access.requireUser(request);
    return { oauthConfigured: supabase.oauthConfigured };
  });

  // — connection management: the server's own (instance administrator, Server
  // settings) and a team's own (its admins, Team settings → Integrations). The
  // same actions in both places; each only ever sees its own connections. —

  type Owner = { user: User; teamId: string | null };
  const places: Array<{ prefix: string; owner: (request: FastifyRequest) => Promise<Owner> }> = [
    {
      prefix: "/api/integrations/supabase",
      owner: async (request) => ({ user: access.requireInstanceAdmin(request), teamId: null }),
    },
    {
      prefix: "/api/teams/:teamId/integrations/supabase",
      owner: async (request) => {
        const user = access.requireUser(request);
        const { teamId } = request.params as { teamId: string };
        await access.requireTeamRole(user, teamId, "admin");
        return { user, teamId };
      },
    },
  ];

  for (const { prefix, owner } of places) {
    app.get(`${prefix}/connections`, async (request) => {
      const { teamId } = await owner(request);
      return { connections: await supabase.listConnections(teamId) };
    });

    app.post(`${prefix}/connections/pat`, async (request, reply) => {
      const { user, teamId } = await owner(request);
      const { pat } = patSchema.parse(request.body);
      const connection = await supabase.connectWithPat(user, pat, teamId);
      reply.status(201);
      return { connection };
    });

    // The token from the Vault (the team's, or the server's): only its name is kept.
    app.post(`${prefix}/connections/vault`, async (request, reply) => {
      const { user, teamId } = await owner(request);
      const { vaultName } = z.object({ vaultName: vaultNameSchema }).strict().parse(request.body);
      await vault.requireUse(
        user,
        teamId ? { kind: "team", teamId } : { kind: "instance" },
        vaultName,
      );
      const connection = await supabase.connectWithVault(user, vaultName, teamId);
      reply.status(201);
      return { connection };
    });

    app.post(`${prefix}/connections/oauth/start`, async (request) => {
      const { user, teamId } = await owner(request);
      return { url: supabase.beginOAuth(user, teamId).url };
    });

    app.delete(`${prefix}/connections/:connectionId`, async (request) => {
      const { user, teamId } = await owner(request);
      const { connectionId } = request.params as { connectionId: string };
      await supabase.revoke(user, connectionId, teamId);
      return { ok: true };
    });

    // — resources —

    app.get(`${prefix}/connections/:connectionId/resources`, async (request) => {
      const { teamId } = await owner(request);
      const { connectionId } = request.params as { connectionId: string };
      return { resources: await supabase.listResources(connectionId, teamId) };
    });

    app.get(`${prefix}/connections/:connectionId/org-projects`, async (request) => {
      const { teamId } = await owner(request);
      const { connectionId } = request.params as { connectionId: string };
      return { projects: await supabase.listOrgProjects(connectionId, teamId) };
    });

    app.post(`${prefix}/connections/:connectionId/resources/link`, async (request, reply) => {
      const { user, teamId } = await owner(request);
      const { connectionId } = request.params as { connectionId: string };
      const input = linkExistingSchema.parse(request.body);
      const resource = await supabase.linkExistingResource(user, connectionId, input, teamId);
      reply.status(201);
      return { resource };
    });

    app.post(`${prefix}/connections/:connectionId/resources/provision`, async (request, reply) => {
      const { user, teamId } = await owner(request);
      const { connectionId } = request.params as { connectionId: string };
      const input = provisionSchema.parse(request.body);
      const resource = await supabase.provisionProject(user, connectionId, input, teamId);
      reply.status(201);
      return { resource };
    });

    app.delete(`${prefix}/resources/:resourceId`, async (request) => {
      const { user, teamId } = await owner(request);
      const { resourceId } = request.params as { resourceId: string };
      const input = confirmedSchema.parse(request.body ?? {});
      await supabase.deleteResource(user, resourceId, input, teamId);
      return { ok: true };
    });
  }

  // The provider sends the browser back here; `state` carries the pending auth
  // and which team (or the server) it was for.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/integrations/supabase/oauth/callback",
    async (request, reply) => {
      access.requireUser(request);
      const { code, state, error } = request.query;
      if (error || !code || !state) {
        reply.redirect("/settings?supabase=error");
        return;
      }
      const connection = await supabase.completeOAuth(state, code);
      reply.redirect(
        connection.teamId
          ? `/teams/${connection.teamId}/settings?supabase=connected#integrations`
          : "/settings?supabase=connected",
      );
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
  // the "applying a mutation" consent point.
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

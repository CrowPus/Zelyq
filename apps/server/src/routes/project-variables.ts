import {
  projectVariableCreateSchema,
  projectVariableUpdateSchema,
  vaultImportSchema,
  vaultRollbackSchema,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { FunctionSecretSync } from "../services/function-secrets.js";
import type { ProjectVariableService } from "../services/project-variables.js";

/** A coding project's variables — each typed, or taken from the team Vault. */
export function registerProjectVariableRoutes(
  app: FastifyInstance,
  deps: {
    variables: ProjectVariableService;
    functionSecrets: FunctionSecretSync;
    access: AccessControl;
    store: Store;
    /** The preview grant an agent session holds — see `ProjectBackendService.mint`. */
    previewGrants: { resolve(token: string): { projectId: string; userId: string } | null };
  },
): void {
  const { variables, access } = deps;
  type Project = { Params: { id: string } };
  type Variable = { Params: { id: string; variableId: string } };

  app.get<Project>("/api/projects/:id/variables", async (request) => ({
    variables: await variables.list(access.requireUser(request), request.params.id),
  }));

  app.post<Project>("/api/projects/:id/variables", async (request, reply) => {
    const variable = await variables.create(
      access.requireUser(request),
      request.params.id,
      projectVariableCreateSchema.parse(request.body),
    );
    reply.code(201);
    return { variable };
  });

  app.post<Project>("/api/projects/:id/variables/import", async (request) => ({
    result: await variables.import(
      access.requireUser(request),
      request.params.id,
      vaultImportSchema.parse(request.body),
    ),
  }));

  app.patch<Variable>("/api/projects/:id/variables/:variableId", async (request) => ({
    variable: await variables.update(
      access.requireUser(request),
      request.params.id,
      request.params.variableId,
      projectVariableUpdateSchema.parse(request.body),
    ),
  }));

  app.delete<Variable>("/api/projects/:id/variables/:variableId", async (request) => {
    await variables.remove(
      access.requireUser(request),
      request.params.id,
      request.params.variableId,
    );
    return { ok: true };
  });

  app.post<Variable>("/api/projects/:id/variables/:variableId/reveal", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return variables.reveal(
      access.requireUser(request),
      request.params.id,
      request.params.variableId,
    );
  });

  app.get<Variable>("/api/projects/:id/variables/:variableId/versions", async (request) => ({
    versions: await variables.versions(
      access.requireUser(request),
      request.params.id,
      request.params.variableId,
    ),
  }));

  app.post<Variable>("/api/projects/:id/variables/:variableId/rollback", async (request) => ({
    variable: await variables.rollback(
      access.requireUser(request),
      request.params.id,
      request.params.variableId,
      vaultRollbackSchema.parse(request.body).version,
    ),
  }));

  /** Whether the linked Supabase project's function secrets match — names only. */
  app.get<Project>("/api/projects/:id/variables/functions", async (request) => ({
    status: await deps.functionSecrets.status(access.requireUser(request), request.params.id),
  }));

  app.post<Project>("/api/projects/:id/variables/functions/sync", async (request) => ({
    status: await deps.functionSecrets.syncNow(access.requireUser(request), request.params.id),
  }));

  /**
   * The agent's view: the names of the variables its app is given, and whether
   * each will actually arrive. No value is in this response to withhold.
   * Membership is checked now, not when the grant was minted: someone removed
   * from the team mid-session loses this too.
   */
  app.get("/api/internal/project-variables/names", async (request) => {
    const raw = request.headers["x-zelyq-preview-bridge"];
    const grant = typeof raw === "string" ? deps.previewGrants.resolve(raw) : null;
    if (!grant) throw new ZelyqError("unauthorized", "Invalid capability");
    const user = await deps.store.users.findById(grant.userId);
    if (!user) throw new ZelyqError("unauthorized", "That user no longer exists");
    await access.requireProject(user, grant.projectId, "viewer");
    return { variables: await variables.namesFor(grant.projectId) };
  });
}

import {
  vaultEnvironmentSchema,
  vaultImportSchema,
  vaultRollbackSchema,
  vaultSecretCreateSchema,
  vaultSecretUpdateSchema,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { VaultService } from "../services/vault.js";

/**
 * Project secrets. No response here carries a value except `reveal`, which is
 * a POST so nothing caches, prefetches or replays it as a plain link.
 */
export function registerVaultRoutes(
  app: FastifyInstance,
  deps: {
    vault: VaultService;
    access: AccessControl;
    store: Store;
    /** The preview grant an agent session holds — see `ProjectBackendService.mint`. */
    previewGrants: { resolve(token: string): { projectId: string; userId: string } | null };
  },
): void {
  const { vault, access } = deps;
  type Project = { Params: { id: string } };
  type Secret = { Params: { id: string; secretId: string } };

  app.get<Project & { Querystring: { environment?: string } }>(
    "/api/projects/:id/vault",
    async (request) => {
      const environment = request.query.environment
        ? vaultEnvironmentSchema.parse(request.query.environment)
        : undefined;
      return {
        secrets: await vault.list(access.requireUser(request), request.params.id, environment),
      };
    },
  );

  app.post<Project>("/api/projects/:id/vault", async (request, reply) => {
    const secret = await vault.create(
      access.requireUser(request),
      request.params.id,
      vaultSecretCreateSchema.parse(request.body),
    );
    reply.code(201);
    return { secret };
  });

  app.post<Project>("/api/projects/:id/vault/import", async (request) => ({
    result: await vault.import(
      access.requireUser(request),
      request.params.id,
      vaultImportSchema.parse(request.body),
    ),
  }));

  app.patch<Secret>("/api/projects/:id/vault/:secretId", async (request) => ({
    secret: await vault.update(
      access.requireUser(request),
      request.params.id,
      request.params.secretId,
      vaultSecretUpdateSchema.parse(request.body),
    ),
  }));

  app.delete<Secret>("/api/projects/:id/vault/:secretId", async (request) => {
    await vault.remove(access.requireUser(request), request.params.id, request.params.secretId);
    return { ok: true };
  });

  app.post<Secret>("/api/projects/:id/vault/:secretId/reveal", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return vault.reveal(access.requireUser(request), request.params.id, request.params.secretId);
  });

  app.get<Secret>("/api/projects/:id/vault/:secretId/versions", async (request) => ({
    versions: await vault.versions(
      access.requireUser(request),
      request.params.id,
      request.params.secretId,
    ),
  }));

  app.post<Secret>("/api/projects/:id/vault/:secretId/rollback", async (request) => ({
    secret: await vault.rollback(
      access.requireUser(request),
      request.params.id,
      request.params.secretId,
      vaultRollbackSchema.parse(request.body).version,
    ),
  }));

  /**
   * The agent's view: names and environments, for the project its session
   * belongs to, as the person it acts for. There is no value in this
   * response to withhold — `namesFor` never reads one.
   */
  app.get("/api/internal/vault/names", async (request) => {
    const raw = request.headers["x-zelyq-preview-bridge"];
    const grant = typeof raw === "string" ? deps.previewGrants.resolve(raw) : null;
    if (!grant) throw new ZelyqError("unauthorized", "Invalid Vault capability");
    const user = await deps.store.users.findById(grant.userId);
    if (!user) throw new ZelyqError("unauthorized", "That user no longer exists");
    // Membership is checked now, not when the grant was minted: someone
    // removed from the team mid-session loses this too.
    await access.requireProject(user, grant.projectId, "viewer");
    return { secrets: await vault.namesFor(grant.projectId) };
  });
}

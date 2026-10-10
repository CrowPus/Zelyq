import {
  type VaultScope,
  vaultEntryCreateSchema,
  vaultEntryUpdateSchema,
  vaultImportSchema,
  vaultRollbackSchema,
} from "@zelyq/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { VaultService } from "../services/vault.js";

/**
 * Vault, as a module of its own: a team's Vault at /api/teams/:teamId/vault
 * and the instance's at /api/instance/vault, with the same shape. No response
 * here carries a value except `reveal`, which is a POST so nothing caches,
 * prefetches or replays it as a plain link.
 */
export function registerVaultRoutes(
  app: FastifyInstance,
  deps: { vault: VaultService; access: AccessControl },
): void {
  const { vault, access } = deps;
  for (const [prefix, scopeOf] of [
    [
      "/api/teams/:teamId/vault",
      (request: FastifyRequest): VaultScope => ({
        kind: "team",
        teamId: (request.params as { teamId: string }).teamId,
      }),
    ],
    ["/api/instance/vault", (): VaultScope => ({ kind: "instance" })],
  ] as const) {
    type Entry = { Params: { entryId: string } };

    app.get(prefix, async (request) => ({
      secrets: await vault.list(access.requireUser(request), scopeOf(request)),
    }));

    app.post(prefix, async (request, reply) => {
      const secret = await vault.create(
        access.requireUser(request),
        scopeOf(request),
        vaultEntryCreateSchema.parse(request.body),
      );
      reply.code(201);
      return { secret };
    });

    app.get(`${prefix}/choices`, async (request) => ({
      choices: await vault.choices(access.requireUser(request), scopeOf(request)),
    }));

    app.get(`${prefix}/activity`, async (request) => ({
      entries: await vault.activity(access.requireUser(request), scopeOf(request)),
    }));

    app.post(`${prefix}/import`, async (request) => ({
      result: await vault.import(
        access.requireUser(request),
        scopeOf(request),
        vaultImportSchema.parse(request.body),
      ),
    }));

    app.patch<Entry>(`${prefix}/:entryId`, async (request) => ({
      secret: await vault.update(
        access.requireUser(request),
        scopeOf(request),
        request.params.entryId,
        vaultEntryUpdateSchema.parse(request.body),
      ),
    }));

    app.delete<Entry>(`${prefix}/:entryId`, async (request) => {
      await vault.remove(access.requireUser(request), scopeOf(request), request.params.entryId);
      return { ok: true };
    });

    app.post<Entry>(`${prefix}/:entryId/reveal`, async (request, reply) => {
      reply.header("cache-control", "no-store");
      return vault.reveal(access.requireUser(request), scopeOf(request), request.params.entryId);
    });

    app.get<Entry>(`${prefix}/:entryId/versions`, async (request) => ({
      versions: await vault.versions(
        access.requireUser(request),
        scopeOf(request),
        request.params.entryId,
      ),
    }));

    app.post<Entry>(`${prefix}/:entryId/rollback`, async (request) => ({
      secret: await vault.rollback(
        access.requireUser(request),
        scopeOf(request),
        request.params.entryId,
        vaultRollbackSchema.parse(request.body).version,
      ),
    }));
  }
}

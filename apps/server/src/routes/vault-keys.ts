import { createHash } from "node:crypto";
import { VAULT_VALUE_MAX_LENGTH, vaultNameSchema, vaultServiceKeyCreateSchema } from "@zelyq/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { VaultKeyService } from "../services/vault-keys.js";

/** Per key, not per address: a CI fleet behind one NAT must not share a budget
 * with a stranger, and one key must not get more by spreading its calls. */
const perKey = {
  rateLimit: {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (request: FastifyRequest) =>
      createHash("sha256")
        .update(String(request.headers.authorization ?? request.ip))
        .digest("hex"),
  },
};

const writeBody = z
  .object({
    value: z.string().min(1).max(VAULT_VALUE_MAX_LENGTH),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

/**
 * Service keys (managed by a team's admins) and the API outside systems call
 * with one. The outside API answers only to a key — a browser session gets
 * nothing here — and every value it hands out is in the team's Activity.
 */
export function registerVaultKeyRoutes(
  app: FastifyInstance,
  deps: { keys: VaultKeyService; access: AccessControl },
): void {
  const { keys, access } = deps;
  type Team = { Params: { teamId: string } };
  type Key = { Params: { teamId: string; keyId: string } };

  app.get<Team>("/api/teams/:teamId/vault-keys", async (request) => ({
    keys: await keys.list(access.requireUser(request), request.params.teamId),
  }));

  app.post<Team>("/api/teams/:teamId/vault-keys", async (request, reply) => {
    reply.header("cache-control", "no-store");
    reply.code(201);
    return keys.create(
      access.requireUser(request),
      request.params.teamId,
      vaultServiceKeyCreateSchema.parse(request.body),
    );
  });

  app.post<Key>("/api/teams/:teamId/vault-keys/:keyId/rotate", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return keys.rotate(access.requireUser(request), request.params.teamId, request.params.keyId);
  });

  app.post<Key>("/api/teams/:teamId/vault-keys/:keyId/revoke", async (request) => ({
    key: await keys.revoke(
      access.requireUser(request),
      request.params.teamId,
      request.params.keyId,
    ),
  }));

  // ------------------------------------------------------------ outside API

  app.get<{ Querystring: { names?: string } }>("/api/v1/vault/secrets", {
    config: perKey,
    handler: async (request, reply) => {
      reply.header("cache-control", "no-store");
      const context = await keys.authenticate(request.headers.authorization, request.ip);
      if (request.query.names === undefined) return { secrets: await keys.names(context) };
      const names = [
        ...new Set(
          request.query.names
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean),
        ),
      ];
      if (names.length === 0 || names.length > 100) {
        return reply.code(400).send({
          error: { code: "bad_request", message: "Give between 1 and 100 names, comma-separated." },
        });
      }
      for (const name of names) vaultNameSchema.parse(name);
      return keys.read(context, names);
    },
  });

  app.get<{ Params: { name: string } }>("/api/v1/vault/secrets/:name", {
    config: perKey,
    handler: async (request, reply) => {
      reply.header("cache-control", "no-store");
      const context = await keys.authenticate(request.headers.authorization, request.ip);
      const name = vaultNameSchema.parse(request.params.name);
      const { secrets } = await keys.read(context, [name]);
      const secret = secrets[0];
      if (!secret) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: `${name} is not in this Vault.` } });
      }
      return secret;
    },
  });

  app.put<{ Params: { name: string } }>("/api/v1/vault/secrets/:name", {
    config: perKey,
    handler: async (request) => {
      const context = await keys.authenticate(request.headers.authorization, request.ip);
      const name = vaultNameSchema.parse(request.params.name);
      const body = writeBody.parse(request.body);
      return keys.write(context, name, body.value, body.description);
    },
  });
}

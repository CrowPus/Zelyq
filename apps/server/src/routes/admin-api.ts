import { type AdminScope, ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HTTPMethods,
  RouteHandlerMethod,
} from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { AdminDirectory } from "../services/admin-directory.js";
import { type AdminCaller, type AdminKeyService, requestHash } from "../services/admin-keys.js";
import type { ProductActivity } from "../services/product-activity.js";
import type { UsageService } from "../services/usage.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set on `/api/admin/v1` only: the key making the call. */
    adminCaller?: AdminCaller;
    /** A change sent with an Idempotency-Key, whose answer is kept. */
    adminIdempotency?: { key: string; hash: string };
  }
}

export const ADMIN_API_PREFIX = "/api/admin/v1";

/** Per key: plenty for a daily run over every team, not enough to hurt the server. */
const CALLS_PER_MINUTE = 600;

/**
 * The admin API: how an outside system (an account service, monitoring,
 * analytics, support) runs this server with a key. Generic on purpose: the
 * same calls serve any self-hoster's own tools.
 *
 * - Only a key is accepted (`Authorization: Bearer zlq_admin_…`); a signed-in
 *   session is ignored here, so a browser can never be tricked into a call.
 * - Each route names the scope it needs; a key without it is refused.
 * - A change sent with `Idempotency-Key` happens once: the same request again
 *   gets the first answer; the same key with another request is refused.
 * - Every change is in the audit log under the key's name.
 */
export function registerAdminApi(
  app: FastifyInstance,
  deps: {
    adminKeys: AdminKeyService;
    usage: UsageService;
    store: Store;
    access: AccessControl;
    directory: AdminDirectory;
    activity: ProductActivity;
  },
): void {
  const { adminKeys, usage, store, directory, activity } = deps;

  // ------------------------------------------------- the keys themselves (a person)

  app.get("/api/admin-keys", async (request) => {
    deps.access.requireInstanceAdmin(request);
    return { keys: await adminKeys.list() };
  });

  app.post(
    "/api/admin-keys",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const user = deps.access.requireInstanceAdmin(request);
      const created = await adminKeys.create(user, request.body);
      reply.status(201);
      return created;
    },
  );

  app.delete<{ Params: { id: string } }>("/api/admin-keys/:id", async (request) => {
    const user = deps.access.requireInstanceAdmin(request);
    return { key: await adminKeys.revoke(user, request.params.id) };
  });

  // ------------------------------------------------- the API (a key)

  app.register(
    async (admin) => {
      admin.addHook("onRequest", async (request) => {
        // Only the key counts here, whatever cookie the request carries.
        request.zelyqUser = undefined;
        request.adminCaller = await adminKeys.authenticate(
          request.headers.authorization,
          request.ip,
        );
      });

      // A change: replay a retried one, or remember the answer for a retry.
      admin.addHook("preHandler", async (request, reply) => {
        if (request.method === "GET" || request.method === "HEAD") return;
        const header = request.headers["idempotency-key"];
        if (header === undefined) return;
        const key = Array.isArray(header) ? header[0] : header;
        if (!key || key.length > 200) {
          throw ZelyqError.badRequest("Idempotency-Key must be 1 to 200 characters.");
        }
        const caller = request.adminCaller!;
        const hash = requestHash(request.method, request.url, request.body);
        const found = await adminKeys.findAnswer(caller, key, hash);
        if (found.kind === "clash") {
          throw new ZelyqError(
            "conflict",
            "This Idempotency-Key was already used for a different request.",
          );
        }
        if (found.kind === "same") {
          reply.header("idempotent-replayed", "true");
          reply.header("content-type", "application/json; charset=utf-8");
          reply.status(found.status);
          return reply.send(found.body);
        }
        request.adminIdempotency = { key, hash };
      });

      // Before the answer leaves: a caller told "done" can rely on the change
      // being recorded, and on a retry being answered the same way.
      admin.addHook("onSend", async (request, reply, payload) => {
        const caller = request.adminCaller;
        if (!caller || request.method === "GET" || request.method === "HEAD") return payload;
        if (reply.getHeader("idempotent-replayed")) return payload;

        const kept = request.adminIdempotency;
        // Failures of our own (5xx) are not kept: a retry should really retry.
        if (kept && reply.statusCode < 500 && typeof payload === "string") {
          await adminKeys.saveAnswer(caller, kept.key, kept.hash, reply.statusCode, payload);
        }
        if (reply.statusCode < 400) {
          await adminKeys.recordCall(caller, {
            method: request.method,
            path: request.routeOptions.url ?? request.url,
            status: reply.statusCode,
            target: (request.params as { id?: string } | undefined)?.id ?? null,
          });
        }
        return payload;
      });

      /** A route that needs `scope`, rate limited per key. */
      const route = (
        method: HTTPMethods,
        url: string,
        scope: AdminScope | null,
        handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
      ) => {
        admin.route({
          method,
          url,
          config: {
            rateLimit: {
              max: CALLS_PER_MINUTE,
              timeWindow: "1 minute",
              keyGenerator: (request: FastifyRequest) => request.adminCaller?.id ?? request.ip,
            },
          },
          handler: (async (request, reply) => {
            if (scope && !request.adminCaller?.scopes.has(scope)) {
              throw new ZelyqError(
                "forbidden",
                `This key may not reach "${scope}". Make a key with that scope in Server settings → API keys.`,
              );
            }
            return await handler(request, reply);
          }) as RouteHandlerMethod,
        });
      };

      /** Which key this is and what it may reach: the first call a new integration makes. */
      route("GET", "/whoami", null, async (request) => {
        const caller = request.adminCaller!;
        return {
          key: { id: caller.id, name: caller.name, prefix: caller.prefix },
          scopes: [...caller.scopes].sort(),
          mode: deps.usage.managed ? "managed" : "self_hosted",
        };
      });

      // Plans: the account service pushes them; this server enforces them.
      route("GET", "/plans", "plans", async () => ({
        ...(await usage.plans()),
        all: await usage.allPlans(),
      }));
      route("PUT", "/plans", "plans", async (request) => {
        await usage.savePlans(request.body);
        return { ...(await usage.plans()), all: await usage.allPlans() };
      });

      route("GET", "/teams/:id/usage", "usage", async (request) => {
        const { id } = request.params as { id: string };
        if (!(await store.teams.findById(id))) throw ZelyqError.notFound("Team", id);
        return await usage.usage(id);
      });

      route("PUT", "/teams/:id/plan", "teams", async (request) => {
        const { id } = request.params as { id: string };
        const { plan } = z
          .object({ plan: z.string().min(1) })
          .strict()
          .parse(request.body);
        if (!(await store.teams.findById(id))) throw ZelyqError.notFound("Team", id);
        await usage.setPlan(id, plan);
        return await usage.usage(id);
      });

      // ------------------------------------------- people

      type Id = { id: string };
      const idOf = (request: FastifyRequest) => (request.params as Id).id;
      const look = (request: FastifyRequest) => (request.query as { look?: string }).look === "1";

      route("POST", "/accounts", "accounts", async (request, reply) => {
        const result = await directory.ensureAccount(request.body);
        reply.status(result.created ? 201 : 200);
        return result;
      });
      route("GET", "/accounts", "accounts", async (request) =>
        directory.findAccount(
          request.query as { email?: string; externalId?: string; issuer?: string },
        ),
      );
      route("GET", "/accounts/:id", "accounts", async (request) =>
        directory.account(idOf(request)),
      );
      route("PATCH", "/accounts/:id", "accounts", async (request) =>
        directory.updateAccount(idOf(request), request.body),
      );
      route("POST", "/accounts/:id/sign-out", "accounts", async (request) =>
        directory.signOut(idOf(request)),
      );
      route("PUT", "/accounts/:id/status", "accounts", async (request) =>
        directory.setAccountStatus(idOf(request), request.body),
      );
      route("DELETE", "/accounts/:id", "accounts", async (request) =>
        directory.deleteAccount(idOf(request), look(request)),
      );

      // ------------------------------------------- teams

      route("POST", "/teams", "teams", async (request, reply) => {
        reply.status(201);
        return await directory.createTeam(request.body);
      });
      route("GET", "/teams", "teams", async (request) =>
        directory.listTeams(request.query as { cursor?: string; limit?: string; plan?: string }),
      );
      route("GET", "/teams/:id", "teams", async (request) => directory.teamDetail(idOf(request)));

      route("GET", "/usage", "usage", async (request) =>
        directory.listUsage(request.query as { cursor?: string; limit?: string }),
      );

      // ------------------------------------------- product activity

      type Range = { from?: string; to?: string };
      route("GET", "/product-events", "analytics", async (request) =>
        activity.events(
          request.query as Range & {
            name?: string;
            team?: string;
            user?: string;
            cursor?: string;
            limit?: string;
          },
        ),
      );
      route("GET", "/metrics/overview", "analytics", async (request) =>
        activity.overview(request.query as Range),
      );
      route("GET", "/metrics/funnel", "analytics", async (request) =>
        activity.funnel(request.query as Range),
      );
      route("GET", "/metrics/retention", "analytics", async (request) =>
        activity.retention(request.query as { weeks?: string }),
      );
      route("GET", "/metrics/features", "analytics", async (request) =>
        activity.features(request.query as Range),
      );
      route("GET", "/metrics/plans", "analytics", async (request) =>
        activity.plans(request.query as Range),
      );

      // Anything else under the prefix is an unknown call, answered in the API's own shape.
      admin.setNotFoundHandler(async (request) => {
        throw ZelyqError.notFound("Admin API call", `${request.method} ${request.url}`);
      });
    },
    { prefix: ADMIN_API_PREFIX },
  );
}

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
import type { EventsOut } from "../services/events-out.js";
import type { MessagesToPeople } from "../services/messages-to-people.js";
import type { ErrorTracker, RequestStats } from "../services/observability.js";
import type { ProductActivity } from "../services/product-activity.js";
import type { SupportService } from "../services/support.js";
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
    eventsOut: EventsOut;
    messages: MessagesToPeople;
    support: SupportService;
    usage: UsageService;
    store: Store;
    access: AccessControl;
    directory: AdminDirectory;
    activity: ProductActivity;
    errors: ErrorTracker;
    requestStats: RequestStats;
    /** Every part of the server, checked now. */
    health: () => Promise<{ status: string }>;
  },
): void {
  const { adminKeys, usage, store, directory, activity, errors, requestStats } = deps;

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
      route("GET", "/accounts", "accounts", async (request) => {
        const query = request.query as {
          email?: string;
          externalId?: string;
          issuer?: string;
          cursor?: string;
          limit?: string;
          q?: string;
          status?: string;
        };
        // One person by email or the service's id; otherwise everyone, a page at a time.
        if (query.email || query.externalId) return directory.findAccount(query);
        return directory.listAccounts(query);
      });
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
      type TeamQuery = {
        cursor?: string;
        limit?: string;
        plan?: string;
        status?: string;
        inactiveSince?: string;
      };
      route("GET", "/teams", "teams", async (request) =>
        directory.listTeams(request.query as TeamQuery),
      );
      route("PUT", "/teams/:id/status", "teams", async (request) =>
        directory.setTeamStatus(idOf(request), request.body),
      );
      route("DELETE", "/teams/:id", "teams", async (request) =>
        directory.deleteTeam(idOf(request), look(request)),
      );
      route("GET", "/teams/:id", "teams", async (request) => directory.teamDetail(idOf(request)));

      route("GET", "/usage", "usage", async (request) =>
        directory.listUsage(request.query as TeamQuery),
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

      // ------------------------------------------- health, errors, performance

      route("GET", "/health/deep", "health", async (_request, reply) => {
        const report = await deps.health();
        // A monitor can alert on the status code alone.
        if (report.status === "down") reply.status(503);
        return report;
      });
      route("GET", "/errors", "errors", async (request) =>
        errors.list(
          request.query as { from?: string; to?: string; status?: string; limit?: string },
        ),
      );
      route("GET", "/errors/:id", "errors", async (request) => errors.detail(idOf(request)));
      route("PATCH", "/errors/:id", "errors", async (request) =>
        errors.setStatus(idOf(request), request.body),
      );
      route("GET", "/failures/agent", "errors", async (request) =>
        activity.agentFailures(request.query as Range),
      );
      route("GET", "/failures/builds", "errors", async (request) =>
        activity.buildFailures(request.query as Range),
      );
      route("GET", "/performance", "metrics", async (request) => ({
        uptimeSeconds: Math.round((Date.now() - requestStats.startedAt) / 1000),
        eventLoopDelayMs: requestStats.loopDelayMs(),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        routes: requestStats.routesReport(),
        work: await activity.timings(request.query as Range),
      }));
      /** For Prometheus, Grafana or Google Cloud Monitoring: send the key as a bearer token. */
      route("GET", "/prometheus", "metrics", async (_request, reply) => {
        reply.type("text/plain; version=0.0.4; charset=utf-8");
        return requestStats.prometheus();
      });

      // ------------------------------------------- events

      /** What happened, after the last event already read: for catching up, or instead of a URL. */
      route("GET", "/events", "events", async (request) =>
        deps.eventsOut.list(request.query as { after?: string; limit?: string; type?: string }),
      );

      // ------------------------------------------- talking to people

      const sender = (request: FastifyRequest) => `admin key "${request.adminCaller!.name}"`;
      route("POST", "/announcements", "notify", async (request, reply) => {
        reply.status(201);
        return await deps.messages.createAnnouncement(sender(request), request.body);
      });
      route("GET", "/announcements", "notify", async () => deps.messages.listAnnouncements());
      route("PATCH", "/announcements/:id", "notify", async (request) =>
        deps.messages.updateAnnouncement(idOf(request), request.body),
      );
      route("DELETE", "/announcements/:id", "notify", async (request) =>
        deps.messages.removeAnnouncement(idOf(request)),
      );
      route("POST", "/notifications", "notify", async (request, reply) => {
        reply.status(201);
        return await deps.messages.notify(sender(request), request.body);
      });
      route("GET", "/maintenance", "notify", async () => ({
        maintenance: await deps.messages.currentMaintenance(),
      }));
      route("PUT", "/maintenance", "notify", async (request) => ({
        maintenance: await deps.messages.setMaintenance(request.body),
      }));
      route("DELETE", "/maintenance", "notify", async () => deps.messages.clearMaintenance());

      // ------------------------------------------- support

      type AppParams = { id: string; appId: string };
      route("GET", "/support/teams/:id", "support", async (request) =>
        deps.support.teamFacts(idOf(request)),
      );
      route("GET", "/support/teams/:id/apps/:appId/logs", "support", async (request) => {
        const params = request.params as AppParams;
        const lines = Number.parseInt((request.query as { lines?: string }).lines ?? "300", 10);
        return await deps.support.previewLogs(params.id, params.appId, lines || 300);
      });
      route("GET", "/support/teams/:id/apps/:appId/files", "support", async (request) => {
        const params = request.params as AppParams;
        return await deps.support.files(
          request.adminCaller!.name,
          params.id,
          params.appId,
          (request.query as { path?: string }).path,
        );
      });
      route("GET", "/support/teams/:id/apps/:appId/file", "support", async (request) => {
        const params = request.params as AppParams;
        return await deps.support.file(
          request.adminCaller!.name,
          params.id,
          params.appId,
          (request.query as { path?: string }).path ?? "",
        );
      });
      route("POST", "/support/accounts/:id/end-sessions", "support", async (request) =>
        directory.signOut(idOf(request)),
      );

      // ------------------------------------------- feature switches

      route("GET", "/features", "features", async () => deps.support.listFeatures());
      route("PUT", "/features/:id", "features", async (request) =>
        deps.support.setFeature(idOf(request), request.body),
      );
      route("DELETE", "/features/:id", "features", async (request) =>
        deps.support.resetFeature(idOf(request)),
      );

      // ------------------------------------------- audit

      route("GET", "/audit", "audit", async (request) => {
        const query = request.query as {
          team?: string;
          action?: string;
          since?: string;
          limit?: string;
        };
        const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "200", 10) || 200, 1), 1000);
        if (query.team) return { entries: await store.auditLog.listForTeam(query.team, limit) };
        if (query.action) {
          return {
            entries: await store.auditLog.listByAction(query.action as never, limit),
          };
        }
        return { entries: await store.auditLog.listRecent(limit, query.since) };
      });

      // Anything else under the prefix is an unknown call, answered in the API's own shape.
      admin.setNotFoundHandler(async (request) => {
        throw ZelyqError.notFound("Admin API call", `${request.method} ${request.url}`);
      });
    },
    { prefix: ADMIN_API_PREFIX },
  );
}

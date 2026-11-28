import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { GitHubAppService } from "../services/github-app.js";

/**
 * GitHub, connected instead of a pasted token.
 *
 * - The app itself: a server admin (Server settings → GitHub). When the environment gives it,
 *   it is only shown.
 * - A team's accounts: its admins connect and disconnect; its editors list and create
 *   repositories (to import one, or push an app to a new one).
 * - GitHub's webhook: checked against the app's own secret (`onWebhook`).
 */

const manifestSchema = z
  .object({
    organization: z.string().trim().max(39).nullable().optional(),
    public: z.boolean().default(false),
  })
  .strict();
const createRepositorySchema = z
  .object({
    connectionId: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    private: z.boolean().default(true),
    description: z.string().max(350).optional(),
  })
  .strict();

export function registerGitHubRoutes(
  app: FastifyInstance,
  deps: {
    github: GitHubAppService;
    access: AccessControl;
    /** GitHub's webhook for a push or pull request, after its signature is checked. */
    onWebhook: (
      event: string,
      payload: Record<string, unknown>,
      headers: Record<string, string | string[] | undefined>,
      body: Buffer,
    ) => Promise<{ status: number; message: string }>;
  },
): void {
  const { github, access } = deps;

  // Anyone signed in: whether "Connect GitHub" can be offered.
  app.get("/api/integrations/github/status", async (request) => {
    access.requireUser(request);
    return { status: await github.status() };
  });

  // ------------------------------------------------------------ the server's app

  app.post("/api/integrations/github/app/manifest", async (request) => {
    const user = access.requireInstanceAdmin(request);
    const input = manifestSchema.parse(request.body ?? {});
    return github.manifest(user, {
      organization: input.organization ?? null,
      public: input.public,
    });
  });

  // GitHub sends the admin back here once the app exists.
  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/api/integrations/github/app/created",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = access.requireInstanceAdmin(request);
      const { code, state } = request.query;
      if (!code || !state) return reply.redirect("/admin?github=error#github");
      try {
        await github.completeManifest(user, state, code);
        await access.recordChange(user, {
          teamId: null,
          action: "settings.github_app_created",
          detail: { slug: (await github.status()).slug },
        });
        return reply.redirect("/admin?github=created#github");
      } catch {
        return reply.redirect("/admin?github=error#github");
      }
    },
  );

  app.delete("/api/integrations/github/app", async (request) => {
    const user = access.requireInstanceAdmin(request);
    await github.removeApp();
    await access.recordChange(user, {
      teamId: null,
      action: "settings.github_app_removed",
      detail: {},
    });
    return { status: await github.status() };
  });

  // ------------------------------------------------------------ a team's accounts

  const teamPrefix = "/api/teams/:teamId/integrations/github";
  type TeamParams = { Params: { teamId: string } };

  app.get<TeamParams>(`${teamPrefix}`, async (request) => {
    const user = access.requireUser(request);
    await access.requireTeamRole(user, request.params.teamId, "viewer");
    return {
      status: await github.status(),
      connections: await github.connections(request.params.teamId),
    };
  });

  app.post<TeamParams>(`${teamPrefix}/connect`, {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async (request) => {
      const user = access.requireUser(request);
      await access.requireTeamRole(user, request.params.teamId, "admin");
      return github.beginConnect(user, request.params.teamId);
    },
  });

  app.delete<{ Params: { teamId: string; connectionId: string } }>(
    `${teamPrefix}/:connectionId`,
    async (request) => {
      const user = access.requireUser(request);
      const { teamId, connectionId } = request.params;
      await access.requireTeamRole(user, teamId, "admin");
      await github.disconnect(teamId, connectionId);
      await access.recordChange(user, {
        teamId,
        action: "team.github_disconnected",
        detail: { connectionId },
      });
      return { connections: await github.connections(teamId) };
    },
  );

  app.get<TeamParams>(`${teamPrefix}/repositories`, async (request) => {
    const user = access.requireUser(request);
    await access.requireTeamRole(user, request.params.teamId, "editor");
    return { repositories: await github.repositories(request.params.teamId) };
  });

  app.post<TeamParams>(`${teamPrefix}/repositories`, {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      const user = access.requireUser(request);
      const { teamId } = request.params;
      await access.requireTeamRole(user, teamId, "editor");
      const input = createRepositorySchema.parse(request.body);
      const repository = await github.createRepository(teamId, input);
      await access.recordChange(user, {
        teamId,
        action: "team.github_repository_created",
        detail: { repository: repository.fullName, private: repository.private },
      });
      reply.status(201);
      return { repository };
    },
  });

  // GitHub sends the person back here after installing the app or authorizing it.
  app.get<{ Querystring: { code?: string; installation_id?: string; error?: string } }>(
    "/api/integrations/github/callback",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = access.requireUser(request);
      const { code, installation_id: installation, error } = request.query;
      if (error || !code) return reply.redirect("/?github=error");
      try {
        const id = installation && /^\d+$/.test(installation) ? Number(installation) : null;
        const { teamId, linked } = await github.completeConnect(user, code, id);
        await access.recordChange(user, {
          teamId,
          action: "team.github_connected",
          detail: { installations: linked },
        });
        return reply.redirect(`/teams/${teamId}/settings?github=connected#integrations`);
      } catch {
        return reply.redirect("/?github=error");
      }
    },
  );

  // ------------------------------------------------------------------ the webhook

  // Its own scope: the signature is over the bytes GitHub sent.
  void app.register(async (hooks) => {
    hooks.removeAllContentTypeParsers();
    hooks.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 },
      (_request, body, done) => done(null, body),
    );
    hooks.post("/api/integrations/github/webhook", {
      config: { rateLimit: { max: 300, timeWindow: "1 minute" } },
      handler: async (request, reply) => {
        const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        if (!(await github.verifyWebhook(request.headers, body))) {
          return reply.code(401).send({ message: "Wrong signature." });
        }
        const event = request.headers["x-github-event"];
        if (event === "ping") return reply.send({ message: "pong" });
        if (event !== "push" && event !== "pull_request") {
          return reply.code(202).send({ message: "Nothing to do for this event." });
        }
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
        } catch {
          return reply.code(400).send({ message: "The body is not JSON." });
        }
        const result = await deps.onWebhook(event, payload, request.headers, body);
        return reply.code(result.status).send({ message: result.message });
      },
    });
  });
}

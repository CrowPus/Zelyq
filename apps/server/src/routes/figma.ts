import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { FigmaConnectionService } from "../services/figma-connections.js";

/**
 * Figma connection routes (proposal 068).
 *
 * The connection is **per user** — each person connects their own Figma — so
 * these need only a signed-in user, not an instance admin (unlike the
 * instance-wide Supabase connection). No route ever returns the token; the
 * service holds it. Extraction is not a route — the gateway calls
 * `FigmaExtractService` directly before a `/figma` turn.
 */
export function registerFigmaRoutes(
  app: FastifyInstance,
  deps: { figma: FigmaConnectionService; access: AccessControl },
): void {
  const { figma, access } = deps;

  // Capability probe — the composer shows/hides `/figma`.
  app.get("/api/integrations/figma/config", async (request) => {
    access.requireUser(request);
    return { configured: figma.configured };
  });

  // This user's connection, or null.
  app.get("/api/integrations/figma/connection", async (request) => {
    const user = access.requireUser(request);
    return { connection: await figma.connectionForUser(user.id) };
  });

  app.post("/api/integrations/figma/oauth/start", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    handler: async (request) => {
      const user = access.requireUser(request);
      return { url: figma.beginOAuth(user).url };
    },
  });

  // Figma redirects the browser here after consent.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/integrations/figma/oauth/callback",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      access.requireUser(request);
      const { code, state, error } = request.query;
      if (error || !code || !state) {
        reply.redirect("/settings?figma=error");
        return;
      }
      try {
        await figma.completeOAuth(state, code);
        reply.redirect("/settings?figma=connected");
      } catch {
        reply.redirect("/settings?figma=error");
      }
    },
  );

  app.delete("/api/integrations/figma/connection", async (request) => {
    const user = access.requireUser(request);
    await figma.disconnect(user);
    return { ok: true };
  });
}

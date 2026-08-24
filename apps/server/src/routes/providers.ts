import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { AgentClient } from "../services/agent-client.js";

/**
 * What the chat's model picker needs — see `033`. Unlike `/api/settings`,
 * open to anyone signed in: which providers have a usable key is not
 * sensitive on its own, and gating it to instance admins would mean only an
 * admin could ever see the picker's options.
 */
export function registerProviderRoutes(
  app: FastifyInstance,
  deps: { agent: AgentClient; access: AccessControl },
): void {
  app.get("/api/providers", async (request) => {
    deps.access.requireUser(request);
    return await deps.agent.listProviders();
  });
}

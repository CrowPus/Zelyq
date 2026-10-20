import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { agentDecisionSchema } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { AgentGateway } from "../services/agent-gateway.js";
import type { AgentService } from "../services/agents.js";

type Team = { Params: { teamId: string } };
type OneAgent = { Params: { teamId: string; agentId: string } };

export function registerAgentRoutes(
  app: FastifyInstance,
  deps: { agents: AgentService; gateway: AgentGateway; access: AccessControl },
): void {
  const { access, agents } = deps;

  // --- Managing a team's agents (admins) -------------------------------------

  app.get<Team>("/api/teams/:teamId/agents", async (request) => ({
    agents: await agents.list(access.requireUser(request), request.params.teamId),
  }));

  app.post<Team>("/api/teams/:teamId/agents", async (request, reply) => {
    reply.code(201);
    return agents.create(access.requireUser(request), request.params.teamId, request.body as never);
  });

  app.patch<OneAgent>("/api/teams/:teamId/agents/:agentId", async (request) => ({
    agent: await agents.update(
      access.requireUser(request),
      request.params.teamId,
      request.params.agentId,
      request.body as never,
    ),
  }));

  app.post<OneAgent>("/api/teams/:teamId/agents/:agentId/rotate", async (request) =>
    agents.rotate(access.requireUser(request), request.params.teamId, request.params.agentId),
  );

  app.post<OneAgent>("/api/teams/:teamId/agents/:agentId/revoke", async (request) => ({
    agent: await agents.revoke(
      access.requireUser(request),
      request.params.teamId,
      request.params.agentId,
    ),
  }));

  app.delete<OneAgent>("/api/teams/:teamId/agents/:agentId", async (request, reply) => {
    await agents.remove(access.requireUser(request), request.params.teamId, request.params.agentId);
    reply.code(204);
  });

  // --- What agents asked to be approved --------------------------------------

  app.get<Team & { Querystring: { status?: string } }>(
    "/api/teams/:teamId/agent-requests",
    async (request) => ({
      requests: await agents.listProposals(
        access.requireUser(request),
        request.params.teamId,
        request.query.status,
      ),
    }),
  );

  app.post<{ Params: { teamId: string; requestId: string } }>(
    "/api/teams/:teamId/agent-requests/:requestId",
    async (request) => ({
      request: await agents.decide(
        access.requireUser(request),
        request.params.teamId,
        request.params.requestId,
        agentDecisionSchema.parse(request.body).decision,
      ),
    }),
  );

  // --- The gateway: MCP over HTTP, for outside agents ------------------------

  /**
   * Stateless Streamable HTTP: each POST carries the agent's key and gets its
   * own MCP server. The key is checked before anything else, so an invalid
   * one gets an ordinary 401 and never reaches MCP.
   */
  app.post(
    "/agent-gateway/mcp",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const context = await agents.authenticate(request.headers.authorization, request.ip);
      const server = deps.gateway.serverFor(context);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      reply.hijack();
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    },
  );

  // No server-initiated stream and no sessions to end: say so the way MCP expects.
  const notAllowed = async (_request: unknown, reply: import("fastify").FastifyReply) => {
    reply.code(405).header("allow", "POST");
    return {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed: this gateway is stateless; use POST." },
      id: null,
    };
  };
  app.get("/agent-gateway/mcp", notAllowed);
  app.delete("/agent-gateway/mcp", notAllowed);
}

import { newId } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type AgentOAuthService,
  type AuthorizeQuery,
  OAuthError,
} from "../services/agent-oauth.js";

const QUERY_FIELDS = [
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "response_type",
] as const;

const html = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function pick(source: Record<string, unknown>): AuthorizeQuery {
  return Object.fromEntries(
    QUERY_FIELDS.map((field) => [field, String(source[field] ?? "")]),
  ) as unknown as AuthorizeQuery;
}

/** A small page of its own: no scripts, no frames, posts only to itself. */
function page(reply: FastifyReply, title: string, body: string, status = 200): string {
  reply
    .code(status)
    .type("text/html; charset=utf-8")
    .header(
      "content-security-policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    )
    .header("cache-control", "no-store")
    .header("referrer-policy", "no-referrer");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><style>
:root{color-scheme:light dark}body{font:15px/1.55 system-ui,-apple-system,sans-serif;margin:0;padding:24px;background:#f6f6f5;color:#1a1a19}
main{max-width:440px;margin:8vh auto;background:#fff;border:1px solid #e4e4e1;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 10px}p{margin:0 0 12px}.muted{color:#55554f;font-size:14px}.err{color:#c2372c}
input{width:100%;box-sizing:border-box;font:14px ui-monospace,monospace;padding:11px;border:1px solid #d3d3cf;border-radius:8px;background:inherit;color:inherit}
button{margin-top:14px;width:100%;padding:11px;font:600 15px system-ui;color:#fbfbfa;background:#1a1a19;border:0;border-radius:8px;cursor:pointer}
code{font-size:13px}a{color:inherit}
@media (prefers-color-scheme:dark){body{background:#0e0e0e;color:#ededec}main{background:#161616;border-color:#2a2a28}.muted{color:#a1a19c}input{border-color:#3a3a37}button{background:#ededec;color:#0e0e0e}}
</style></head><body><main>${body}</main></body></html>`;
}

function form(client: string, query: AuthorizeQuery, error = ""): string {
  const hidden = QUERY_FIELDS.map(
    (field) => `<input type="hidden" name="${field}" value="${html(query[field])}">`,
  ).join("");
  const safeError = html(error);
  return `<h1>Connect ${html(client)} to Zelyq</h1>
<p class="muted">This signs ${html(client)} in as one of your team's agents. Paste the agent's key — it starts with <code>zlq_agent_</code> and is shown once when the agent is created on the Agents page. The connection can do only what that agent is allowed to, and what needs approval still waits for you.</p>
${error ? `<p class="err">${html(error)}</p>` : ""}
<form method="post">${hidden}<input name="key" type="password" autocomplete="off" required placeholder="zlq_agent_…" aria-label="Agent key"><button type="submit">Connect</button></form>`;
}

/**
 * OAuth 2.1 for connectors that cannot send an agent's key in a header
 * (Claude.ai, ChatGPT): discovery, self-registration, Zelyq's own sign-in
 * page where a person pastes the agent's key, and tokens.
 */
export function registerAgentOAuthRoutes(
  app: FastifyInstance,
  deps: { oauth: AgentOAuthService; store: Store; publicUrl?: string },
): void {
  const base = (request: FastifyRequest) =>
    (deps.publicUrl ?? `${request.protocol}://${request.host}`).replace(/\/+$/, "");

  const protectedResource = async (request: FastifyRequest) => ({
    resource: `${base(request)}/agent-gateway/mcp`,
    authorization_servers: [base(request)],
    bearer_methods_supported: ["header"],
    resource_name: "Zelyq agent gateway",
  });
  app.get("/.well-known/oauth-protected-resource", protectedResource);
  app.get("/.well-known/oauth-protected-resource/agent-gateway/mcp", protectedResource);

  const authorizationServer = async (request: FastifyRequest) => ({
    issuer: base(request),
    authorization_endpoint: `${base(request)}/agent-gateway/oauth/authorize`,
    token_endpoint: `${base(request)}/agent-gateway/oauth/token`,
    registration_endpoint: `${base(request)}/agent-gateway/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
  app.get("/.well-known/oauth-authorization-server", authorizationServer);
  app.get("/.well-known/oauth-authorization-server/agent-gateway/mcp", authorizationServer);

  const oauthError = (reply: FastifyReply, error: unknown) => {
    if (!(error instanceof OAuthError)) throw error;
    reply.code(error.status).header("cache-control", "no-store");
    return { error: error.code, error_description: error.message };
  };

  app.post(
    "/agent-gateway/oauth/register",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      try {
        const client = await deps.oauth.register(request.body);
        reply.code(201);
        return client;
      } catch (error) {
        return oauthError(reply, error);
      }
    },
  );

  app.get<{ Querystring: Record<string, string> }>(
    "/agent-gateway/oauth/authorize",
    async (request, reply) => {
      const query = pick(request.query);
      try {
        const client = await deps.oauth.client(query);
        return page(reply, "Connect to Zelyq", form(client.name, query));
      } catch (error) {
        if (!(error instanceof OAuthError)) throw error;
        return page(
          reply,
          "This sign-in cannot continue",
          `<h1>This sign-in cannot continue</h1><p class="muted">${html(error.message)}</p>`,
          400,
        );
      }
    },
  );

  // The form and the token request arrive as form fields, which Fastify does
  // not read by default: a scope of their own reads them.
  void app.register(async (forms) => {
    forms.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 64 * 1024 },
      (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );

    forms.post<{ Body: Record<string, string> }>(
      "/agent-gateway/oauth/authorize",
      { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const body = request.body ?? {};
        const query = pick(body);
        let clientName = "the connector";
        try {
          clientName = (await deps.oauth.client(query)).name;
          const { agent, redirect } = await deps.oauth.authorize(
            query,
            String(body.key ?? "").trim(),
          );
          await deps.store.auditLog.record({
            id: newId("audit"),
            teamId: agent.teamId,
            projectId: null,
            userId: null,
            actorName: `${agent.name} (agent)`,
            actorEmail: `agent:${agent.id}`,
            action: "agent.connector_signed_in",
            detail: { connector: clientName, agentId: agent.id },
            createdAt: new Date().toISOString(),
          });
          // A link and a refresh, not a redirect from the form: the page's own
          // policy lets forms post only to itself.
          reply.header("refresh", `0;url=${redirect}`);
          return page(
            reply,
            "Connected",
            `<h1>Connected</h1><p class="muted">${html(clientName)} is signed in as ${html(agent.name)}. Returning to it…</p><p><a href="${html(redirect)}">Continue</a></p>`,
          );
        } catch (error) {
          if (!(error instanceof OAuthError)) throw error;
          if (error.code === "invalid_request" || error.code === "invalid_client") {
            return page(
              reply,
              "This sign-in cannot continue",
              `<h1>This sign-in cannot continue</h1><p class="muted">${html(error.message)}</p>`,
              400,
            );
          }
          return page(
            reply,
            "Connect to Zelyq",
            form(clientName, query, "Sign-in failed. Check the agent key and try again."),
            error.status,
          );
        }
      },
    );

    forms.post(
      "/agent-gateway/oauth/token",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const raw = (request.body ?? {}) as Record<string, unknown>;
        const body = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
        try {
          const tokens = await deps.oauth.token(body);
          reply.header("cache-control", "no-store");
          return tokens;
        } catch (error) {
          return oauthError(reply, error);
        }
      },
    );
  });
}

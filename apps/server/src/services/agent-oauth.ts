import { createHash, randomBytes } from "node:crypto";
import { newId, ZelyqError } from "@zelyq/core";
import type { AgentRow, Store } from "@zelyq/db";

const CODE_MINUTES = 10;
const ACCESS_MINUTES = 60;
const REFRESH_DAYS = 30;
/** Connectors register themselves (the standard says so), so the table is capped. */
const MAX_CLIENTS = 500;

export const ACCESS_PREFIX = "zlq_oat_";
const REFRESH_PREFIX = "zlq_ort_";
const KEY_PREFIX = "zlq_agent_";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const token = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

/** The query a connector starts a sign-in with, carried through the form. */
export interface AuthorizeQuery {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  response_type: string;
}

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * OAuth 2.1 with PKCE for connectors that cannot send an agent's key in a
 * header — Claude.ai, ChatGPT. The connector registers itself, a person signs
 * in on Zelyq's page by pasting the agent's key, and the connector gets
 * short-lived tokens that act as exactly that agent.
 *
 * Every grant carries the fingerprint of the agent's key at sign-in, so
 * replacing or revoking the key ends every connection made with it — a key
 * is the agent's identity, whichever way it was used.
 */
export class AgentOAuthService {
  constructor(private readonly store: Store) {}

  /** The redirect addresses a connector may use: https, or http on this machine. */
  private redirectOk(uri: string): boolean {
    try {
      const url = new URL(uri);
      return (
        url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }

  async register(body: unknown): Promise<Record<string, unknown>> {
    const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const uris = Array.isArray(input.redirect_uris)
      ? input.redirect_uris.filter((uri): uri is string => typeof uri === "string")
      : [];
    if (uris.length === 0 || uris.length > 10 || !uris.every((uri) => this.redirectOk(uri))) {
      throw new OAuthError(
        "invalid_redirect_uri",
        "https redirect addresses (or http on localhost) are needed.",
      );
    }
    if ((await this.store.agents.oauth.countClients()) >= MAX_CLIENTS) {
      throw new OAuthError("temporarily_unavailable", "Too many registered connectors.", 429);
    }
    const clientId = token("zlq_client_");
    const name = String(input.client_name ?? "A connector").slice(0, 120);
    await this.store.agents.oauth.createClient({
      clientId,
      name,
      redirectUris: JSON.stringify(uris),
      createdAt: new Date().toISOString(),
    });
    return {
      client_id: clientId,
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }

  /** The connector, if the sign-in it started is one Zelyq can continue. */
  async client(query: AuthorizeQuery): Promise<{ name: string }> {
    if (
      query.response_type !== "code" ||
      query.code_challenge_method !== "S256" ||
      !query.code_challenge
    ) {
      throw new OAuthError(
        "invalid_request",
        "The connector must use the code flow with PKCE (S256).",
      );
    }
    const client = await this.store.agents.oauth.findClient(query.client_id);
    if (!client || !(JSON.parse(client.redirectUris) as string[]).includes(query.redirect_uri)) {
      throw new OAuthError(
        "invalid_client",
        "This connector is not registered, or its return address does not match.",
      );
    }
    return { name: client.name };
  }

  /**
   * The person pasted a key: if it is an active agent's, a one-time code for
   * the connector, and where to send the browser with it.
   */
  async authorize(
    query: AuthorizeQuery,
    key: string,
  ): Promise<{ agent: AgentRow; redirect: string }> {
    await this.client(query);
    if (!key.startsWith(KEY_PREFIX)) {
      throw new OAuthError("access_denied", "Paste the agent's key (it starts with zlq_agent_).");
    }
    const agent = await this.store.agents.findByHash(hash(key));
    if (!agent || agent.revokedAt) {
      throw new OAuthError(
        "access_denied",
        "That key is not valid, or the agent was revoked.",
        401,
      );
    }
    const code = token("zlq_code_");
    await this.store.agents.oauth.createGrant({
      id: newId("agentOauthGrant"),
      agentId: agent.id,
      clientId: query.client_id,
      kind: "code",
      tokenHash: hash(code),
      keyHash: agent.keyHash,
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
      expiresAt: minutesFromNow(CODE_MINUTES),
      usedAt: null,
      createdAt: new Date().toISOString(),
    });
    const redirect = new URL(query.redirect_uri);
    redirect.searchParams.set("code", code);
    if (query.state) redirect.searchParams.set("state", query.state);
    return { agent, redirect: redirect.href };
  }

  async token(body: Record<string, string>): Promise<Record<string, unknown>> {
    const now = new Date().toISOString();
    if (body.grant_type === "authorization_code") {
      const grant = await this.store.agents.oauth.findGrant(hash(body.code ?? ""), "code");
      if (
        !grant ||
        grant.usedAt ||
        grant.expiresAt < now ||
        grant.clientId !== body.client_id ||
        grant.redirectUri !== body.redirect_uri
      ) {
        throw new OAuthError(
          "invalid_grant",
          "The code is unknown, used, expired or for another connector.",
        );
      }
      const verifier = body.code_verifier ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (!verifier || challenge !== grant.codeChallenge) {
        throw new OAuthError("invalid_grant", "The code verifier does not match.");
      }
      if (!(await this.store.agents.oauth.useCode(grant.id, now))) {
        throw new OAuthError("invalid_grant", "The code was already used.");
      }
      const agent = await this.activeAgent(grant.agentId, grant.keyHash);
      return this.issue(agent, grant.clientId);
    }
    if (body.grant_type === "refresh_token") {
      const grant = await this.store.agents.oauth.findGrant(
        hash(body.refresh_token ?? ""),
        "refresh",
      );
      if (
        !grant ||
        grant.expiresAt < now ||
        (body.client_id && grant.clientId !== body.client_id)
      ) {
        throw new OAuthError("invalid_grant", "The refresh token is unknown or expired.");
      }
      // Used once: a second use of the same refresh token finds nothing.
      if (!(await this.store.agents.oauth.removeGrant(grant.id))) {
        throw new OAuthError("invalid_grant", "The refresh token was already used.");
      }
      const agent = await this.activeAgent(grant.agentId, grant.keyHash);
      return this.issue(agent, grant.clientId);
    }
    throw new OAuthError("unsupported_grant_type", "authorization_code or refresh_token.");
  }

  /**
   * The agent an access token acts as — only while its key is the one it was
   * signed in with and the agent is not revoked.
   */
  async agentFor(accessToken: string): Promise<AgentRow> {
    const grant = await this.store.agents.oauth.findGrant(hash(accessToken), "access");
    if (!grant || grant.expiresAt < new Date().toISOString()) {
      throw new ZelyqError("unauthorized", "That sign-in has expired. Sign in again.");
    }
    try {
      return await this.activeAgent(grant.agentId, grant.keyHash);
    } catch {
      throw new ZelyqError(
        "unauthorized",
        "This agent's key was replaced or revoked. Sign in again with its current key.",
      );
    }
  }

  /** Sign-ins made with this agent: how many connectors, and when. */
  async connections(agentId: string) {
    const now = new Date().toISOString();
    const clients = new Map<string, { name: string; since: string }>();
    for (const grant of await this.store.agents.oauth.listForAgent(agentId)) {
      if (grant.kind !== "refresh" || grant.expiresAt < now) continue;
      if (clients.has(grant.clientId)) continue;
      const client = await this.store.agents.oauth.findClient(grant.clientId);
      clients.set(grant.clientId, { name: client?.name ?? "A connector", since: grant.createdAt });
    }
    return [...clients.values()];
  }

  async disconnectAll(agentId: string): Promise<void> {
    await this.store.agents.oauth.removeForAgent(agentId);
  }

  private async activeAgent(agentId: string, keyHash: string): Promise<AgentRow> {
    const agent = await this.store.agents.findById(agentId);
    if (!agent || agent.revokedAt || agent.keyHash !== keyHash) {
      throw new OAuthError("invalid_grant", "The agent is not active, or its key was replaced.");
    }
    return agent;
  }

  private async issue(agent: AgentRow, clientId: string): Promise<Record<string, unknown>> {
    const access = token(ACCESS_PREFIX);
    const refresh = token(REFRESH_PREFIX);
    const now = new Date().toISOString();
    for (const [kind, value, expiresAt] of [
      ["access", access, minutesFromNow(ACCESS_MINUTES)],
      ["refresh", refresh, minutesFromNow(REFRESH_DAYS * 24 * 60)],
    ] as const) {
      await this.store.agents.oauth.createGrant({
        id: newId("agentOauthGrant"),
        agentId: agent.id,
        clientId,
        kind,
        tokenHash: hash(value),
        keyHash: agent.keyHash,
        redirectUri: null,
        codeChallenge: null,
        expiresAt,
        usedAt: null,
        createdAt: now,
      });
    }
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_MINUTES * 60,
      refresh_token: refresh,
    };
  }
}

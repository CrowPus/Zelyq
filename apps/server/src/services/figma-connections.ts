import { randomBytes } from "node:crypto";
import { newId, type User, ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { SecretBox } from "./secrets.js";

/**
 * The one trusted place a Figma OAuth token is decrypted and used (proposal
 * 068).
 *
 * Invariants — the whole security case for `/figma`:
 *   - The token never leaves this class. Callers get a `ConnectionSummary` or a
 *     `withAccessToken(userId, fn)` callback that is handed the bearer string
 *     for the duration of one `fn` and nothing else.
 *   - Every Figma API call is an in-process `fetch` from here (or from
 *     `figma-extract.ts`, which only ever gets the token through
 *     `withAccessToken`). It is never put in an env var, a shell, a plugin, the
 *     runtime, or the agent.
 *   - Read-only scopes only. Nothing here writes to Figma.
 *   - Connect / disconnect write an audit row.
 *
 * Structurally a trimmed `SupabaseConnectionService` — same `SecretBox`
 * storage, same `provider_connections` table (row `provider: "figma"`), minus
 * every write/provision path.
 */

export const FIGMA_API = "https://api.figma.com";
const FIGMA_OAUTH_AUTHORIZE = "https://www.figma.com/oauth";
const FIGMA_OAUTH_TOKEN = "https://api.figma.com/v1/oauth/token";
const FIGMA_OAUTH_REFRESH = "https://api.figma.com/v1/oauth/refresh";

/** Minimal read scopes. `file_variables:read` is Enterprise-only and requested
 * opportunistically — extraction degrades gracefully when it isn't granted. */
const OAUTH_SCOPES = [
  "file_content:read",
  "file_dev_resources:read",
  "library_content:read",
] as const;

const REFRESH_SKEW_MS = 60_000;
const OAUTH_STATE_TTL_MS = 10 * 60_000;

export interface FigmaOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

export interface FigmaConnectionSummary {
  id: string;
  status: string;
  grantedScopes: string[];
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type Blob = { kind: "oauth"; accessToken: string; refreshToken: string };

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

export class FigmaConnectionExpiredError extends ZelyqError {
  constructor() {
    super("conflict", "This Figma connection has expired. Reconnect it in Settings to continue.");
    this.name = "FigmaConnectionExpiredError";
  }
}

export class FigmaConnectionService {
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private readonly oauth?: FigmaOAuthConfig;
  private readonly oauthStates = new Map<string, { userId: string; at: number }>();

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    options: { oauth?: FigmaOAuthConfig; fetch?: FetchLike; now?: () => number } = {},
  ) {
    this.oauth = options.oauth;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => Date.now());
  }

  get configured(): boolean {
    return Boolean(this.oauth);
  }

  // — OAuth —

  beginOAuth(actor: User): { url: string } {
    if (!this.oauth) {
      throw new ZelyqError("bad_request", "Figma is not configured on this instance.");
    }
    this.sweepStates();
    const state = base64url(randomBytes(24));
    this.oauthStates.set(state, { userId: actor.id, at: this.now() });

    const url = new URL(FIGMA_OAUTH_AUTHORIZE);
    url.searchParams.set("client_id", this.oauth.clientId);
    url.searchParams.set("redirect_uri", this.oauth.redirectUrl);
    url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    return { url: url.toString() };
  }

  async completeOAuth(state: string, code: string): Promise<FigmaConnectionSummary> {
    const pending = this.oauthStates.get(state);
    this.oauthStates.delete(state);
    if (!pending || this.now() - pending.at > OAUTH_STATE_TTL_MS || !this.oauth) {
      throw new ZelyqError("bad_request", "This Figma authorization has expired. Try again.");
    }

    const token = await this.tokenRequest(FIGMA_OAUTH_TOKEN, {
      redirect_uri: this.oauth.redirectUrl,
      code,
      grant_type: "authorization_code",
    });

    // One connection per user: revoke any prior active one.
    for (const prior of await this.store.providerConnections.listConnectionsCreatedBy(
      pending.userId,
    )) {
      if (prior.provider === "figma" && prior.status === "active") {
        await this.store.providerConnections.setConnectionStatus(prior.id, "revoked");
      }
    }

    const id = newId("providerConnection");
    await this.store.providerConnections.createConnection({
      id,
      provider: "figma",
      credentialType: "oauth",
      encryptedBlob: this.seal({
        kind: "oauth",
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
      }),
      grantedScopes: token.scope ?? OAUTH_SCOPES.join(" "),
      expiresAt: this.expiryFrom(token.expires_in),
      createdBy: pending.userId,
    });
    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: id,
      action: "connect",
      outcome: "ok",
      detail: { provider: "figma" },
      actorUserId: pending.userId,
    });
    return this.summarise(id);
  }

  async disconnect(actor: User): Promise<void> {
    const conn = await this.activeForUser(actor.id);
    if (!conn) return;
    await this.store.providerConnections.setConnectionStatus(conn.id, "revoked");
    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: conn.id,
      action: "delete",
      outcome: "ok",
      detail: { provider: "figma" },
      actorUserId: actor.id,
    });
  }

  async connectionForUser(userId: string): Promise<FigmaConnectionSummary | null> {
    const conn = await this.activeForUser(userId);
    return conn ? this.summarise(conn.id) : null;
  }

  /**
   * Runs `fn` with a valid bearer token for `userId`, refreshing first if it is
   * within the skew window. The token is in scope only for the `await fn(...)`.
   * Throws `FigmaConnectionExpiredError` if there is no usable connection.
   */
  async withAccessToken<T>(userId: string, fn: (token: string) => Promise<T>): Promise<T> {
    const conn = await this.activeForUser(userId);
    if (!conn) throw new FigmaConnectionExpiredError();

    let blob = this.unseal(conn.encryptedBlob);
    if (!blob) {
      await this.store.providerConnections.setConnectionStatus(conn.id, "expired");
      throw new FigmaConnectionExpiredError();
    }

    const expiresAt = conn.expiresAt ? Date.parse(conn.expiresAt) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(expiresAt) && this.now() > expiresAt - REFRESH_SKEW_MS) {
      blob = await this.refresh(conn.id, blob.refreshToken);
    }
    await this.store.providerConnections.markConnectionUsed(conn.id);
    return fn(blob.accessToken);
  }

  // — internals —

  private async activeForUser(userId: string) {
    const rows = await this.store.providerConnections.listConnectionsCreatedBy(userId);
    return (
      rows
        .filter((row) => row.provider === "figma" && row.status === "active")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  private async refresh(connectionId: string, refreshToken: string): Promise<Blob> {
    if (!this.oauth) throw new FigmaConnectionExpiredError();
    let token: TokenResponse;
    try {
      token = await this.tokenRequest(FIGMA_OAUTH_REFRESH, {
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
    } catch {
      await this.store.providerConnections.setConnectionStatus(connectionId, "expired");
      throw new FigmaConnectionExpiredError();
    }
    const blob: Blob = {
      kind: "oauth",
      accessToken: token.access_token,
      refreshToken: token.refresh_token || refreshToken,
    };
    await this.store.providerConnections.updateConnectionCredential(connectionId, {
      encryptedBlob: this.seal(blob),
      expiresAt: this.expiryFrom(token.expires_in),
    });
    return blob;
  }

  private async tokenRequest(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<TokenResponse> {
    if (!this.oauth) throw new ZelyqError("bad_request", "Figma is not configured.");
    // Figma's api.figma.com/v1/oauth/{token,refresh} authenticate the client
    // with HTTP Basic (base64 client_id:client_secret), not body params.
    const basic = Buffer.from(`${this.oauth.clientId}:${this.oauth.clientSecret}`).toString(
      "base64",
    );
    const res = await this.fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ZelyqError(
        "bad_request",
        `Figma OAuth request failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }
    return (await res.json()) as TokenResponse;
  }

  private async summarise(id: string): Promise<FigmaConnectionSummary> {
    const row = await this.store.providerConnections.getConnection(id);
    if (!row) throw new ZelyqError("not_found", "Figma connection not found.");
    return {
      id: row.id,
      status: row.status,
      grantedScopes: row.grantedScopes ? row.grantedScopes.split(/\s+/).filter(Boolean) : [],
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    };
  }

  private seal(blob: Blob): string {
    return this.secrets.encrypt(JSON.stringify(blob));
  }

  private unseal(encrypted: string): Blob | null {
    const plain = this.secrets.decrypt(encrypted);
    if (!plain) return null;
    try {
      const parsed = JSON.parse(plain) as Blob;
      return parsed.kind === "oauth" && parsed.accessToken ? parsed : null;
    } catch {
      return null;
    }
  }

  private expiryFrom(expiresIn: number | undefined): string | null {
    if (!expiresIn || !Number.isFinite(expiresIn)) return null;
    return new Date(this.now() + expiresIn * 1000).toISOString();
  }

  private sweepStates(): void {
    const cutoff = this.now() - OAUTH_STATE_TTL_MS;
    for (const [key, value] of this.oauthStates) {
      if (value.at < cutoff) this.oauthStates.delete(key);
    }
  }
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

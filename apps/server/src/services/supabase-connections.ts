import { createHash, randomBytes } from "node:crypto";
import { newId, type User, ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { AccessControl } from "./access.js";
import type { SecretBox } from "./secrets.js";

/**
 * The one trusted place a Supabase **Management** credential is decrypted and
 * used.
 *
 * Invariants enforced here:
 *   - The PAT / OAuth token never leaves this class. Callers get bounded
 *     summaries — ids, `projectRef`, `projectUrl`, the public `publishableKey`,
 *     `environment`, `status` — never the credential, never a raw API body.
 *   - Every Management API call is an in-process `fetch` from here. It is never
 *     handed to `RuntimeDriver.exec`, `startPreview`, a shell, or the agent.
 *   - A provider *secret* key is never fetched or stored.
 *   - Every state change writes a `provider_operations` row (metadata only) and
 *     an `auditLog` entry.
 *   - `provisionProject` / `deleteResource` require `confirmed: true`.
 */

const SUPABASE_API = "https://api.supabase.com";

/** Scopes requested on the OAuth authorize URL — operation-specific consent. */
const OAUTH_SCOPES = ["projects:read", "projects:write", "database:write"] as const;

/** Refresh an OAuth token this many ms before it actually expires. */
const REFRESH_SKEW_MS = 60_000;
/** An unused OAuth `state` is dropped after this long. */
const OAUTH_STATE_TTL_MS = 10 * 60_000;

export interface SupabaseOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

export interface ConnectionSummary {
  id: string;
  credentialType: "oauth" | "pat";
  status: string;
  grantedScopes: string[];
  createdBy: string;
  createdAt: string;
}

export interface ResourceSummary {
  id: string;
  connectionId: string;
  projectRef: string;
  projectUrl: string;
  publishableKey: string;
  environment: "development" | "staging" | "production";
  region: string | null;
  displayName: string;
  provisionedByZelyq: boolean;
}

export interface OrgProject {
  ref: string;
  name: string;
  organizationId: string;
  region: string | null;
}

export interface BackendCheck {
  name: string;
  /** `info` is neutral context (auth flow) and never fails the run. */
  status: "pass" | "fail" | "info";
  detail: string;
}

export interface BackendVerification {
  verified: boolean;
  summary: string;
  checks: BackendCheck[];
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Stored credential shapes (encrypted as JSON in `encryptedBlob`). */
type Blob =
  | { kind: "pat"; token: string }
  | { kind: "oauth"; accessToken: string; refreshToken: string };

/**
 * The connection's OAuth token could not be refreshed. Surfaces as a 409 so the
 * client knows to send the user back through "Connect".
 */
export class ConnectionExpiredError extends ZelyqError {
  constructor() {
    super("conflict", "This Supabase connection has expired. Reconnect it to continue.");
    this.name = "ConnectionExpiredError";
  }
}

export class SupabaseConnectionService {
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private readonly oauth?: SupabaseOAuthConfig;
  /** Domain for the synthetic verification signup — must have real MX records,
   * or Supabase's newer email validator rejects it as `email_address_invalid`. */
  private readonly verifyEmailDomain: string;
  private readonly oauthStates = new Map<
    string,
    { userId: string; verifier: string; at: number }
  >();

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    private readonly access: AccessControl,
    options: {
      oauth?: SupabaseOAuthConfig;
      fetch?: FetchLike;
      now?: () => number;
      verifyEmailDomain?: string;
    } = {},
  ) {
    this.oauth = options.oauth;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => Date.now());
    this.verifyEmailDomain = options.verifyEmailDomain?.trim() || "example.com";
  }

  get oauthConfigured(): boolean {
    return Boolean(this.oauth);
  }

  // ─────────────────────────── credential lifecycle ───────────────────────────

  /** Validate a pasted PAT against Supabase, then store it encrypted. */
  async connectWithPat(actor: User, pat: string): Promise<ConnectionSummary> {
    const trimmed = pat.trim();
    if (!trimmed) throw new ZelyqError("bad_request", "Paste a Supabase access token.");

    // The lightest authenticated call — proves the token works, reveals nothing
    // we keep.
    const res = await this.fetch(`${SUPABASE_API}/v1/organizations`, {
      headers: { Authorization: `Bearer ${trimmed}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new ZelyqError("bad_request", "Supabase rejected that access token.");
    }
    if (!res.ok) {
      throw new ZelyqError("bad_request", `Supabase returned ${res.status} validating the token.`);
    }

    const id = newId("providerConnection");
    await this.store.providerConnections.createConnection({
      id,
      provider: "supabase",
      credentialType: "pat",
      encryptedBlob: this.seal({ kind: "pat", token: trimmed }),
      createdBy: actor.id,
    });
    await this.audit(actor, "connect", { connectionId: id, credentialType: "pat" });
    return this.summariseConnection(id);
  }

  /** Build the Supabase OAuth authorize URL and remember the PKCE verifier. */
  beginOAuth(actor: User): { url: string; state: string } {
    if (!this.oauth) {
      throw new ZelyqError(
        "bad_request",
        "Supabase OAuth is not configured on this instance. Use a Personal Access Token.",
      );
    }
    this.sweepOAuthStates();
    const state = base64url(randomBytes(24));
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    this.oauthStates.set(state, { userId: actor.id, verifier, at: this.now() });

    const url = new URL(`${SUPABASE_API}/v1/oauth/authorize`);
    url.searchParams.set("client_id", this.oauth.clientId);
    url.searchParams.set("redirect_uri", this.oauth.redirectUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
    return { url: url.toString(), state };
  }

  /** Exchange the authorization code and store the token pair encrypted. */
  async completeOAuth(state: string, code: string): Promise<ConnectionSummary> {
    const pending = this.oauthStates.get(state);
    this.oauthStates.delete(state);
    if (!pending || this.now() - pending.at > OAUTH_STATE_TTL_MS || !this.oauth) {
      throw new ZelyqError("bad_request", "This Supabase authorization has expired. Try again.");
    }

    const token = await this.oauthTokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.oauth.redirectUrl,
      code_verifier: pending.verifier,
    });

    const id = newId("providerConnection");
    await this.store.providerConnections.createConnection({
      id,
      provider: "supabase",
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
    const actor = await this.userById(pending.userId);
    await this.audit(actor, "connect", { connectionId: id, credentialType: "oauth" });
    return this.summariseConnection(id);
  }

  /** Mark a connection revoked. The row stays for history; resources cascade. */
  async revoke(actor: User, connectionId: string): Promise<void> {
    const conn = await this.requireConnection(connectionId);
    await this.store.providerConnections.setConnectionStatus(conn.id, "revoked");
    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: conn.id,
      action: "delete",
      outcome: "ok",
      detail: { what: "connection" },
      actorUserId: actor.id,
    });
    await this.access.recordChange(actor, {
      teamId: null,
      action: "provider.disconnected",
      detail: { connectionId: conn.id },
    });
  }

  /** The leaving-user flow: any connection this user created becomes orphaned. */
  async orphanConnectionsCreatedBy(userId: string): Promise<void> {
    const conns = await this.store.providerConnections.listConnectionsCreatedBy(userId);
    for (const conn of conns) {
      if (conn.status === "active") {
        await this.store.providerConnections.setConnectionStatus(conn.id, "orphaned");
      }
    }
  }

  // ─────────────────────────────── resources ────────────────────────────────

  async listConnections(): Promise<ConnectionSummary[]> {
    const rows = await this.store.providerConnections.listConnections();
    return rows.map((row) => this.rowToConnectionSummary(row));
  }

  async listResources(connectionId: string): Promise<ResourceSummary[]> {
    await this.requireConnection(connectionId);
    const rows = await this.store.providerConnections.listResourcesForConnection(connectionId);
    return rows.map(rowToResourceSummary);
  }

  /** Projects visible to the connection's Supabase account. Metadata only. */
  async listOrgProjects(connectionId: string): Promise<OrgProject[]> {
    const conn = await this.requireConnection(connectionId);
    const body = await this.management<
      Array<{ id: string; name: string; organization_id: string; region: string }>
    >(conn.id, "GET", "/v1/projects");
    return body.map((p) => ({
      ref: p.id,
      name: p.name,
      organizationId: p.organization_id,
      region: p.region ?? null,
    }));
  }

  /** Register an existing Supabase project as a resource of this connection. */
  async linkExistingResource(
    actor: User,
    connectionId: string,
    input: { projectRef: string; environment?: ResourceSummary["environment"] },
  ): Promise<ResourceSummary> {
    const conn = await this.requireConnection(connectionId);
    const project = await this.management<{
      id: string;
      name: string;
      region: string;
      organization_id: string;
    }>(conn.id, "GET", `/v1/projects/${encodeURIComponent(input.projectRef)}`);
    const publishableKey = await this.fetchPublishableKey(conn.id, input.projectRef);

    const id = newId("providerResource");
    await this.store.providerConnections.createResource({
      id,
      connectionId: conn.id,
      orgId: project.organization_id,
      projectRef: project.id,
      projectUrl: `https://${project.id}.supabase.co`,
      publishableKey,
      environment: input.environment ?? "development",
      region: project.region ?? null,
      displayName: project.name,
      provisionedByZelyq: false,
    });
    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: conn.id,
      action: "link",
      outcome: "ok",
      detail: { projectRef: project.id, provisioned: false },
      actorUserId: actor.id,
    });
    const created = await this.store.providerConnections.getResource(id);
    return rowToResourceSummary(created!);
  }

  /** Provision a brand-new Supabase project. Explicit consent required. */
  async provisionProject(
    actor: User,
    connectionId: string,
    input: { organizationId: string; region: string; name: string; confirmed: boolean },
  ): Promise<ResourceSummary> {
    if (!input.confirmed) {
      throw new ZelyqError(
        "bad_request",
        "Provisioning a Supabase project needs explicit confirmation.",
      );
    }
    const conn = await this.requireConnection(connectionId);
    const dbPass = base64url(randomBytes(24));
    const created = await this.management<{ id: string; name: string; region: string }>(
      conn.id,
      "POST",
      "/v1/projects",
      {
        organization_id: input.organizationId,
        name: input.name,
        region: input.region,
        db_pass: dbPass,
      },
    );

    const publishableKey = await this.fetchPublishableKey(conn.id, created.id, { retries: 6 });
    const id = newId("providerResource");
    await this.store.providerConnections.createResource({
      id,
      connectionId: conn.id,
      orgId: input.organizationId,
      projectRef: created.id,
      projectUrl: `https://${created.id}.supabase.co`,
      publishableKey,
      environment: "development",
      region: created.region ?? input.region,
      displayName: created.name ?? input.name,
      provisionedByZelyq: true,
    });
    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: conn.id,
      action: "provision",
      outcome: "ok",
      detail: { projectRef: created.id, region: input.region },
      actorUserId: actor.id,
    });
    await this.access.recordChange(actor, {
      teamId: null,
      action: "provider.resource_provisioned",
      detail: { projectRef: created.id },
    });
    const row = await this.store.providerConnections.getResource(id);
    return rowToResourceSummary(row!);
  }

  async deleteResource(
    actor: User,
    resourceId: string,
    input: { confirmed: boolean },
  ): Promise<void> {
    if (!input.confirmed) {
      throw new ZelyqError(
        "bad_request",
        "Deleting a Supabase resource needs explicit confirmation.",
      );
    }
    const resource = await this.store.providerConnections.getResource(resourceId);
    if (!resource) throw ZelyqError.notFound("Provider resource", resourceId);
    const conn = await this.requireConnection(resource.connectionId);

    if (resource.provisionedByZelyq) {
      await this.management(
        conn.id,
        "DELETE",
        `/v1/projects/${encodeURIComponent(resource.projectRef)}`,
      );
    }
    await this.store.providerConnections.deleteResource(resourceId);
    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: conn.id,
      action: "delete",
      outcome: "ok",
      detail: {
        what: "resource",
        projectRef: resource.projectRef,
        calledProvider: Boolean(resource.provisionedByZelyq),
      },
      actorUserId: actor.id,
    });
    await this.access.recordChange(actor, {
      teamId: null,
      action: "provider.resource_deleted",
      detail: { projectRef: resource.projectRef },
    });
  }

  // ──────────────────────────── project links ─────────────────────────────

  async linkProjectToResource(
    actor: User,
    zelyqProjectId: string,
    teamId: string,
    resourceId: string,
  ): Promise<void> {
    const resource = await this.store.providerConnections.getResource(resourceId);
    if (!resource) throw ZelyqError.notFound("Provider resource", resourceId);
    await this.requireConnection(resource.connectionId);
    await this.store.providerConnections.linkProject({
      zelyqProjectId,
      providerResourceId: resourceId,
      linkedBy: actor.id,
    });
    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: resource.connectionId,
      zelyqProjectId,
      action: "link",
      outcome: "ok",
      detail: { resourceId },
      actorUserId: actor.id,
    });
    await this.access.recordChange(actor, {
      teamId,
      projectId: zelyqProjectId,
      action: "provider.resource_linked",
      detail: { resourceId, projectRef: resource.projectRef },
    });
  }

  async unlinkProject(actor: User, zelyqProjectId: string, teamId: string): Promise<void> {
    const link = await this.store.providerConnections.getLinkForProject(zelyqProjectId);
    await this.store.providerConnections.unlinkProject(zelyqProjectId);
    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: link?.connectionId ?? null,
      zelyqProjectId,
      action: "unlink",
      outcome: "ok",
      detail: {},
      actorUserId: actor.id,
    });
    await this.access.recordChange(actor, {
      teamId,
      projectId: zelyqProjectId,
      action: "provider.resource_unlinked",
      detail: {},
    });
  }

  /**
   * The linked resource for a Zelyq project — **public fields only**. This is
   * what `resolvePreviewEnv` reads. Returns null when nothing is linked, or the
   * connection is not usable.
   */
  async getLinkedResource(zelyqProjectId: string): Promise<ResourceSummary | null> {
    const link = await this.store.providerConnections.getLinkForProject(zelyqProjectId);
    if (!link) return null;
    if (link.connectionStatus === "revoked") return null;
    return rowToResourceSummary(link.resource);
  }

  // ──────────────────────── migrations + verification (build-agent bridge) ──

  /**
   * Apply one migration to the linked `development` resource. Refuses anything
   * else: a non-development environment, a destructive statement, or a name
   * already applied with different content (drift). Uses the tracked
   * migrations endpoint; records name + checksum only, never the SQL body.
   */
  async applyMigration(
    actor: User,
    zelyqProjectId: string,
    input: { name: string; sql: string },
  ): Promise<{ name: string; checksum: string; alreadyApplied: boolean }> {
    const link = await this.store.providerConnections.getLinkForProject(zelyqProjectId);
    if (!link) throw new ZelyqError("bad_request", "This project has no linked Supabase resource.");
    if (link.resource.environment !== "development") {
      throw new ZelyqError(
        "forbidden",
        `Migrations are applied to a development resource only. This one is "${link.resource.environment}".`,
      );
    }
    const destructive = findDestructiveStatements(input.sql);
    if (destructive.length > 0) {
      throw new ZelyqError(
        "bad_request",
        `Refusing this migration — it contains ${destructive.join(", ")}. A fresh development schema needs none.`,
      );
    }

    const checksum = createHash("sha256").update(input.sql).digest("hex").slice(0, 16);
    const prior = await this.store.providerConnections.listOperationsForConnection(
      link.connectionId,
      500,
    );
    const same = prior.find(
      (op) => op.action === "migrate" && (op.detail as { name?: string }).name === input.name,
    );
    if (same) {
      if ((same.detail as { checksum?: string }).checksum === checksum) {
        return { name: input.name, checksum, alreadyApplied: true };
      }
      throw new ZelyqError(
        "conflict",
        `Migration "${input.name}" was already applied with different content — resolve the drift before re-applying.`,
      );
    }

    const ref = encodeURIComponent(link.resource.projectRef);
    try {
      // The tracked endpoint (Supabase records the migration under `name`).
      await this.management(link.connectionId, "POST", `/v1/projects/${ref}/database/migrations`, {
        name: input.name,
        query: input.sql,
      });
    } catch (error) {
      // Older Management surfaces lack that route — fall back to a plain
      // query. Drift tracking still works: Zelyq records name + checksum
      // itself in `provider_operations` regardless.
      if (error instanceof ZelyqError && /\(404\)/.test(error.message)) {
        await this.management(link.connectionId, "POST", `/v1/projects/${ref}/database/query`, {
          query: input.sql,
        });
      } else {
        throw error;
      }
    }

    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: link.connectionId,
      zelyqProjectId,
      action: "migrate",
      outcome: "ok",
      detail: { name: input.name, checksum, projectRef: link.resource.projectRef },
      actorUserId: actor.id,
    });
    await this.access.recordChange(actor, {
      teamId: link.teamId,
      projectId: zelyqProjectId,
      action: "provider.migration_applied",
      detail: { name: input.name, checksum },
    });
    return { name: input.name, checksum, alreadyApplied: false };
  }

  /**
   * Deploy one single-file Edge Function to the linked development
   * project through the Management API, so an AI build has no manual
   * `supabase functions deploy` step. Creates the function if it is new,
   * updates it if it exists. On any Management-API failure the caller is told
   * to run the deploy by hand — the same graceful fallback the migration flow
   * uses. The function source is passed through; no secret is ever in it (the
   * key is read at runtime from `ai_credentials`).
   */
  async deployEdgeFunction(
    actor: User,
    zelyqProjectId: string,
    input: { slug: string; source: string; verifyJwt?: boolean },
  ): Promise<{ slug: string; created: boolean }> {
    const link = await this.store.providerConnections.getLinkForProject(zelyqProjectId);
    if (!link) throw new ZelyqError("bad_request", "This project has no linked Supabase resource.");
    if (link.resource.environment !== "development") {
      throw new ZelyqError(
        "forbidden",
        `Functions deploy to a development resource only. This one is "${link.resource.environment}".`,
      );
    }
    if (!/^[a-z0-9](?:[a-z0-9_-]{0,58}[a-z0-9])?$/.test(input.slug)) {
      throw new ZelyqError(
        "bad_request",
        `"${input.slug}" is not a valid function slug (lower-case letters, digits, - and _).`,
      );
    }
    if (/sb_secret_|service_role|SUPABASE_SERVICE_ROLE_KEY\s*=/.test(input.source)) {
      throw new ZelyqError(
        "bad_request",
        "Refusing to deploy — the source hard-codes a secret key. Read it from Deno.env at runtime.",
      );
    }

    const ref = encodeURIComponent(link.resource.projectRef);
    const verifyJwt = input.verifyJwt ?? true;
    let created = false;
    try {
      // Does it already exist?
      let exists = true;
      try {
        await this.management(
          link.connectionId,
          "GET",
          `/v1/projects/${ref}/functions/${encodeURIComponent(input.slug)}`,
        );
      } catch (error) {
        if (error instanceof ZelyqError && /\(404\)/.test(error.message)) exists = false;
        else throw error;
      }
      if (exists) {
        await this.management(
          link.connectionId,
          "PATCH",
          `/v1/projects/${ref}/functions/${encodeURIComponent(input.slug)}`,
          { body: input.source, verify_jwt: verifyJwt },
        );
      } else {
        await this.management(link.connectionId, "POST", `/v1/projects/${ref}/functions`, {
          slug: input.slug,
          name: input.slug,
          body: input.source,
          verify_jwt: verifyJwt,
        });
        created = true;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ZelyqError(
        "bad_request",
        `Automatic deploy of "${input.slug}" failed (${detail}). Deploy it by hand: from the ` +
          `project directory run \`supabase functions deploy ${input.slug}\` (Supabase CLI, ` +
          "logged in and linked). The function file is already written; nothing else changed.",
      );
    }

    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: link.connectionId,
      zelyqProjectId,
      action: "deploy_function",
      outcome: "ok",
      detail: { slug: input.slug, created, projectRef: link.resource.projectRef },
      actorUserId: actor.id,
    });
    await this.access.recordChange(actor, {
      teamId: link.teamId,
      projectId: zelyqProjectId,
      action: "provider.function_deployed",
      detail: { slug: input.slug, created },
    });
    return { slug: input.slug, created };
  }

  /**
   * Read-only checks that the applied schema is sound: row-level security is on
   * every table, each has policies, and the public roles are not over-granted.
   * A best-effort auth-flow line is reported as information only — it depends
   * on the project's email settings and rate limits, so it never fails the
   * verification. Never returns rows or SQL.
   */
  async backendVerification(_actor: User, zelyqProjectId: string): Promise<BackendVerification> {
    const link = await this.store.providerConnections.getLinkForProject(zelyqProjectId);
    if (!link) throw new ZelyqError("bad_request", "This project has no linked Supabase resource.");
    const { projectRef, projectUrl, publishableKey } = link.resource;
    const checks: BackendCheck[] = [];

    const query = async (sql: string): Promise<Array<Record<string, unknown>>> =>
      this.management(
        link.connectionId,
        "POST",
        `/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
        { query: sql },
      );

    // — Schema: the checks that actually determine "verified" —
    try {
      const tables = await query(
        "select tablename, rowsecurity from pg_tables where schemaname = 'public'",
      );

      if (tables.length === 0) {
        return {
          verified: false,
          summary:
            "The applied migration created no tables in the public schema. Check the migration SQL.",
          checks: [
            {
              name: "Schema",
              status: "fail",
              detail: "no tables in the public schema after applying the migration",
            },
          ],
        };
      }

      const unprotected = tables
        .filter((row) => row.rowsecurity !== true)
        .map((row) => String(row.tablename));
      checks.push({
        name: "Row-level security",
        status: unprotected.length === 0 ? "pass" : "fail",
        detail:
          unprotected.length === 0
            ? `enabled on all ${tables.length} table(s)`
            : `not enabled on: ${unprotected.join(", ")}`,
      });

      const policies = await query("select tablename from pg_policies where schemaname = 'public'");
      const withPolicy = new Set(policies.map((row) => String(row.tablename)));
      const missing = tables
        .map((row) => String(row.tablename))
        .filter((name) => !withPolicy.has(name));
      checks.push({
        name: "Access policies",
        status: missing.length === 0 ? "pass" : "fail",
        detail:
          missing.length === 0
            ? "every table has at least one policy"
            : `no policy on: ${missing.join(", ")}`,
      });

      // A correct RLS design DOES grant `authenticated` INSERT/UPDATE/DELETE —
      // row-level security is what constrains which rows, not the table grant.
      // So the real holes are: `anon` (unauthenticated) with any write, or
      // `authenticated` with a write on a table that has RLS turned off. A
      // write grant to `authenticated` on an RLS-protected table is fine.
      const rlsOff = new Set(
        tables.filter((row) => row.rowsecurity !== true).map((row) => String(row.tablename)),
      );
      const writeGrants = await query(
        "select grantee, table_name from information_schema.role_table_grants " +
          "where table_schema = 'public' and grantee in ('anon','authenticated') " +
          "and privilege_type in ('INSERT','UPDATE','DELETE') group by grantee, table_name",
      );
      const anonWrites = [
        ...new Set(
          writeGrants.filter((g) => String(g.grantee) === "anon").map((g) => String(g.table_name)),
        ),
      ];
      const authWritesRlsOff = [
        ...new Set(
          writeGrants
            .filter(
              (g) => String(g.grantee) === "authenticated" && rlsOff.has(String(g.table_name)),
            )
            .map((g) => String(g.table_name)),
        ),
      ];
      const grantProblems: string[] = [];
      if (anonWrites.length > 0) {
        grantProblems.push(`anon (unauthenticated) can write to: ${anonWrites.join(", ")}`);
      }
      if (authWritesRlsOff.length > 0) {
        grantProblems.push(
          `authenticated can write with no row-level security to: ${authWritesRlsOff.join(", ")}`,
        );
      }
      checks.push({
        name: "Public role grants",
        status: grantProblems.length === 0 ? "pass" : "fail",
        detail:
          grantProblems.length === 0
            ? "anon has no write access; authenticated writes are constrained by row-level security"
            : grantProblems.join("; "),
      });
    } catch (error) {
      return {
        verified: false,
        summary: "Could not read the schema from Supabase.",
        checks: [
          {
            name: "Schema",
            status: "fail",
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }

    // — Auth: informational only, never fails the run —
    // Read the project's auth config first so a signup that hangs on sending a
    // confirmation email is reported as the fixable setting it is, not an
    // opaque HTTP 504.
    let autoconfirm: boolean | null = null;
    try {
      const res = await this.fetch(`${projectUrl}/auth/v1/settings`, {
        headers: { apikey: publishableKey },
      });
      if (res.ok) {
        const s = (await res.json()) as {
          mailer_autoconfirm?: boolean;
          disable_signup?: boolean;
        };
        autoconfirm = typeof s.mailer_autoconfirm === "boolean" ? s.mailer_autoconfirm : null;
        if (s.disable_signup) {
          checks.push({
            name: "Auth signups",
            status: "info",
            detail:
              "sign-ups are turned off for this project — no new users can register " +
              "(Supabase dashboard → Authentication → Providers → Email)",
          });
        }
        if (autoconfirm === false) {
          checks.push({
            name: "Email confirmation",
            status: "info",
            detail:
              "ON — every signup blocks while Supabase sends a confirmation email, which times " +
              "out (HTTP 504) unless SMTP is configured. If the design specifies no verification, " +
              "turn off dashboard → Authentication → Providers → Email → 'Confirm email'; otherwise " +
              "set a real SMTP provider under Authentication → Emails.",
          });
        }
      }
    } catch {
      // Settings endpoint unreachable — checkSignupFlow still runs its probe.
    }
    checks.push(await this.checkSignupFlow(projectUrl, publishableKey, autoconfirm));

    const failed = checks.filter((c) => c.status === "fail");
    const verified = failed.length === 0;
    return {
      verified,
      summary: verified
        ? "Schema verified: row-level security, policies, and grants are all correct."
        : `Not verified — ${failed.map((c) => c.name.toLowerCase()).join(", ")}.`,
      checks,
    };
  }

  /**
   * One best-effort signup against the project's public auth endpoint. The
   * result is context, not a pass/fail gate: it depends on the project's email
   * confirmation setting, rate limits, and email-domain validation, none of
   * which are the schema's problem.
   */
  private async checkSignupFlow(
    projectUrl: string,
    publishableKey: string,
    autoconfirm: boolean | null,
  ): Promise<BackendCheck> {
    // Confirm-email ON with no SMTP is the #1 cause of a signup 504. Don't fire
    // a probe that will just hang — report the setting and how to fix it.
    if (autoconfirm === false) {
      return {
        name: "Auth signup",
        status: "info",
        detail:
          "not probed — email confirmation is ON, so a real signup blocks on the confirmation " +
          "email (HTTP 504 without SMTP). See the 'Email confirmation' note above.",
      };
    }
    const email = `zelyq-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${this.verifyEmailDomain}`;
    try {
      const res = await this.fetch(`${projectUrl}/auth/v1/signup`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${publishableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password: `Zelyq-verify-${Math.random().toString(36).slice(2, 12)}`,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        error_code?: string;
        code?: string;
        msg?: string;
      };
      if (res.ok) {
        return {
          name: "Auth signup",
          status: "pass",
          detail: body.access_token
            ? "a test user signed up and received a session"
            : "signup accepted (email confirmation is on, so no session was issued)",
        };
      }
      const reason = body.error_code ?? body.code ?? body.msg ?? `HTTP ${res.status}`;
      const explain: Record<string, string> = {
        over_email_send_rate_limit:
          "the project's signup rate limit was hit — try again in a minute",
        email_address_invalid: `the test email domain (${this.verifyEmailDomain}) was rejected — set ZELYQ_SUPABASE_VERIFY_EMAIL_DOMAIN to a domain with MX records`,
        signup_disabled: "email sign-ups are turned off for this project",
        email_provider_disabled: "the email provider is disabled for this project",
      };
      const gatewayTimeout =
        res.status === 504 || res.status === 502 || res.status === 408
          ? "the auth endpoint timed out — usually email confirmation is ON with no working SMTP " +
            "(turn off dashboard → Authentication → Providers → Email → 'Confirm email', or set SMTP), " +
            "or the project is paused and cold-starting"
          : null;
      return {
        name: "Auth signup",
        status: "info",
        detail: explain[reason] ?? gatewayTimeout ?? `not checked (${reason})`,
      };
    } catch (error) {
      return {
        name: "Auth signup",
        status: "info",
        detail: `not checked (${error instanceof Error ? error.message : String(error)})`,
      };
    }
  }

  // ─────────────────────────────── internals ───────────────────────────────

  private seal(blob: Blob): string {
    return this.secrets.encrypt(JSON.stringify(blob));
  }

  private open(encrypted: string): Blob {
    const plain = this.secrets.decrypt(encrypted);
    if (!plain) {
      throw new ZelyqError("internal", "A stored Supabase credential could not be decrypted.");
    }
    return JSON.parse(plain) as Blob;
  }

  /** A decrypted Management bearer token for `connectionId`, refreshing first. */
  private async bearerFor(connectionId: string): Promise<string> {
    const conn = await this.store.providerConnections.getConnection(connectionId);
    if (!conn) throw ZelyqError.notFound("Provider connection", connectionId);
    if (conn.status === "revoked") {
      throw new ZelyqError("forbidden", "This Supabase connection has been revoked.");
    }
    let blob = this.open(conn.encryptedBlob);

    if (blob.kind === "oauth") {
      const expiresAt = conn.expiresAt ? Date.parse(conn.expiresAt) : 0;
      if (!expiresAt || expiresAt - this.now() < REFRESH_SKEW_MS) {
        blob = await this.refresh(conn.id, blob.refreshToken);
      }
    }
    await this.store.providerConnections.markConnectionUsed(conn.id);
    return blob.kind === "pat" ? blob.token : blob.accessToken;
  }

  private async refresh(connectionId: string, refreshToken: string): Promise<Blob> {
    if (!this.oauth) throw new ConnectionExpiredError();
    let token: OAuthTokenResponse;
    try {
      token = await this.oauthTokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
    } catch {
      await this.store.providerConnections.setConnectionStatus(connectionId, "expired");
      throw new ConnectionExpiredError();
    }
    const next: Blob = {
      kind: "oauth",
      accessToken: token.access_token,
      refreshToken: token.refresh_token || refreshToken,
    };
    await this.store.providerConnections.updateConnectionCredential(connectionId, {
      encryptedBlob: this.seal(next),
      expiresAt: this.expiryFrom(token.expires_in),
      ...(token.scope ? { grantedScopes: token.scope } : {}),
    });
    return next;
  }

  private async oauthTokenRequest(params: Record<string, string>): Promise<OAuthTokenResponse> {
    if (!this.oauth) throw new ZelyqError("bad_request", "Supabase OAuth is not configured.");
    const basic = Buffer.from(`${this.oauth.clientId}:${this.oauth.clientSecret}`).toString(
      "base64",
    );
    const res = await this.fetch(`${SUPABASE_API}/v1/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ client_id: this.oauth.clientId, ...params }).toString(),
    });
    if (!res.ok) {
      throw new ZelyqError("bad_request", `Supabase OAuth token exchange failed (${res.status}).`);
    }
    return (await res.json()) as OAuthTokenResponse;
  }

  /** The single Management-API call site. In-process fetch, decrypted token local. */
  private async management<T = unknown>(
    connectionId: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const bearer = await this.bearerFor(connectionId);
    const res = await this.fetch(`${SUPABASE_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401) {
      await this.store.providerConnections.setConnectionStatus(connectionId, "expired");
      throw new ConnectionExpiredError();
    }
    if (!res.ok) {
      // The provider's error body may echo request data — do not surface it.
      throw new ZelyqError("bad_request", `Supabase API ${method} ${path} failed (${res.status}).`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** The publishable (public, anon-equivalent) key. A secret key is never read. */
  private async fetchPublishableKey(
    connectionId: string,
    projectRef: string,
    opts: { retries?: number } = {},
  ): Promise<string> {
    const retries = opts.retries ?? 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const keys = await this.management<
          Array<{ name?: string; type?: string; api_key?: string; id?: string }>
        >(connectionId, "GET", `/v1/projects/${encodeURIComponent(projectRef)}/api-keys`);
        const publishable =
          keys.find((k) => k.type === "publishable" || k.name === "anon") ?? keys[0];
        if (publishable?.api_key) return publishable.api_key;
        throw new ZelyqError(
          "bad_request",
          "Supabase returned no publishable key for that project.",
        );
      } catch (error) {
        if (attempt >= retries) throw error;
        await delay(10_000);
      }
    }
  }

  private async requireConnection(connectionId: string) {
    const conn = await this.store.providerConnections.getConnection(connectionId);
    if (conn?.provider !== "supabase") {
      throw ZelyqError.notFound("Provider connection", connectionId);
    }
    return conn;
  }

  private async summariseConnection(id: string): Promise<ConnectionSummary> {
    const row = await this.store.providerConnections.getConnection(id);
    if (!row) throw ZelyqError.notFound("Provider connection", id);
    return this.rowToConnectionSummary(row);
  }

  private rowToConnectionSummary(row: {
    id: string;
    credentialType: string;
    status: string;
    grantedScopes: string;
    createdBy: string;
    createdAt: string;
  }): ConnectionSummary {
    return {
      id: row.id,
      credentialType: row.credentialType as "oauth" | "pat",
      status: row.status,
      grantedScopes: row.grantedScopes ? row.grantedScopes.split(" ").filter(Boolean) : [],
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  private async userById(userId: string): Promise<User> {
    const user = await this.store.users.findById(userId);
    if (!user) throw ZelyqError.notFound("User", userId);
    return user;
  }

  private expiryFrom(expiresInSeconds: number | undefined): string | null {
    if (!expiresInSeconds) return null;
    return new Date(this.now() + expiresInSeconds * 1000).toISOString();
  }

  private async audit(
    actor: User,
    action: "connect" | "provision" | "configure-auth" | "delete" | "link" | "unlink",
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: (detail.connectionId as string | undefined) ?? null,
      action,
      outcome: "ok",
      detail,
      actorUserId: actor.id,
    });
    if (action === "connect") {
      await this.access.recordChange(actor, {
        teamId: null,
        action: "provider.connected",
        detail: { credentialType: detail.credentialType },
      });
    }
  }

  private sweepOAuthStates(): void {
    const cutoff = this.now() - OAUTH_STATE_TTL_MS;
    for (const [key, value] of this.oauthStates) {
      if (value.at < cutoff) this.oauthStates.delete(key);
    }
  }
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  scope?: string;
}

function rowToResourceSummary(row: {
  id: string;
  connectionId: string;
  projectRef: string;
  projectUrl: string;
  publishableKey: string;
  environment: string;
  region: string | null;
  displayName: string;
  provisionedByZelyq: number;
}): ResourceSummary {
  return {
    id: row.id,
    connectionId: row.connectionId,
    projectRef: row.projectRef,
    projectUrl: row.projectUrl,
    publishableKey: row.publishableKey,
    environment: row.environment as ResourceSummary["environment"],
    region: row.region,
    displayName: row.displayName,
    provisionedByZelyq: row.provisionedByZelyq === 1,
  };
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Names the destructive / irreversible statements in a migration. v1 refuses
 * all of them — a fresh development schema is only ever additive. Comments are
 * stripped first so a mention in prose does not trip it.
 */
function findDestructiveStatements(sql: string): string[] {
  const stripped = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .toLowerCase();
  const found = new Set<string>();
  if (/\bdrop\s+(table|schema|database|column|policy|function|view|type)\b/.test(stripped)) {
    found.add("DROP");
  }
  if (/\btruncate\b/.test(stripped)) found.add("TRUNCATE");
  if (/\balter\s+table\s+[^;]*\bdrop\b/.test(stripped)) found.add("ALTER … DROP");
  for (const stmt of stripped.split(";")) {
    if (/\bdelete\s+from\b/.test(stmt) && !/\bwhere\b/.test(stmt)) found.add("unqualified DELETE");
    if (/\bupdate\s+\w/.test(stmt) && /\bset\b/.test(stmt) && !/\bwhere\b/.test(stmt)) {
      found.add("unqualified UPDATE");
    }
  }
  return [...found];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

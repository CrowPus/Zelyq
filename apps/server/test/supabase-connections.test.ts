import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId } from "@zelyq/core";
import { createStore, runMigrations, type Store } from "@zelyq/db";
import { AccessControl } from "../src/services/access.js";
import { makePreviewEnvResolver } from "../src/services/preview-env.js";
import { SecretBox } from "../src/services/secrets.js";
import {
  ConnectionExpiredError,
  SupabaseConnectionService,
} from "../src/services/supabase-connections.js";

/**
 * These tests are the load-bearing ones: the Management
 * credential must never leave the service — not in a preview env, not in an
 * audit row, not in a summary — and consent gates must hold.
 */

const tmp = path.join(os.tmpdir(), `zelyq-supabase-conn-${Date.now()}`);
const dbUrl = `file:${path.join(tmp, "conn.db")}`;
let store: Store;

// Not a real token shape on purpose — a well-formed `sbp_<40 hex>` string
// trips GitHub push protection even in a test fixture.
const PAT = `sbp_TEST_${"z".repeat(40)}`;
const OAUTH_ACCESS = "sbat_access_tok_AAAAAAAAAAAAAAAAAAAA";
const OAUTH_REFRESH = "sbrt_refresh_tok_BBBBBBBBBBBBBBBBBBBB";

const secrets = new SecretBox(randomBytes(32));
const oauthConfig = {
  clientId: "zelyq-test-client",
  clientSecret: "zelyq-test-secret",
  redirectUrl: "http://localhost/api/integrations/supabase/oauth/callback",
};

/** A programmable fetch: match on (method, url substring) → Response. */
function stubFetch(
  routes: Array<{ match: RegExp; method?: string; status?: number; json?: unknown }>,
) {
  const calls: Array<{ url: string; method: string }> = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
    if (!route) return new Response("no stub", { status: 599 });
    const status = route.status ?? 200;
    const body = route.json === undefined ? "" : JSON.stringify(route.json);
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  };
  return Object.assign(fn, { calls });
}

async function makeUserTeamProject(suffix: string) {
  const user = await store.users.create({
    id: newId("user"),
    email: `owner-${suffix}@example.com`,
    name: "Owner",
    passwordHash: "x",
  });
  const team = await store.teams.create({
    id: newId("team"),
    name: `Team ${suffix}`,
    slug: `team-${suffix}`,
  });
  await store.teams.addMember(team.id, user.id, "owner");
  const project = await store.projects.create({
    id: newId("project"),
    teamId: team.id,
    name: `Project ${suffix}`,
    slug: `project-${suffix}`,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
  });
  return { user, team, project };
}

function service(fetchImpl: typeof fetch, now?: () => number) {
  return new SupabaseConnectionService(store, secrets, new AccessControl(store), {
    oauth: oauthConfig,
    fetch: fetchImpl as never,
    now,
  });
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(dbUrl);
  store = createStore(dbUrl);
});

after(async () => {
  await store.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("connectWithPat validates the token and stores it encrypted, never in the clear", async () => {
  const { user } = await makeUserTeamProject("pat-ok");
  const fetchStub = stubFetch([{ match: /\/v1\/organizations$/, json: [{ id: "org_1" }] }]);
  const svc = service(fetchStub as never);

  const summary = await svc.connectWithPat(user, PAT);
  assert.equal(summary.credentialType, "pat");
  assert.equal(summary.status, "active");

  const row = await store.providerConnections.getConnection(summary.id);
  assert.ok(row, "connection row written");
  assert.notEqual(row.encryptedBlob, PAT);
  assert.ok(!row.encryptedBlob.includes(PAT), "raw token must not appear in the stored blob");
  // The stored blob really is our token once decrypted.
  assert.ok(secrets.decrypt(row.encryptedBlob)?.includes(PAT));
});

test("connectWithPat rejects a token Supabase refuses, and writes no connection", async () => {
  const { user } = await makeUserTeamProject("pat-401");
  const fetchStub = stubFetch([{ match: /\/v1\/organizations$/, status: 401 }]);
  const svc = service(fetchStub as never);

  const before = (await store.providerConnections.listConnections()).length;
  await assert.rejects(() => svc.connectWithPat(user, PAT), /rejected that access token/);
  assert.equal((await store.providerConnections.listConnections()).length, before, "no new row");
});

test("resolvePreviewEnv yields only the two public values, and never the credential", async () => {
  const { user, team, project } = await makeUserTeamProject("preview-env");
  const fetchStub = stubFetch([
    { match: /\/v1\/organizations$/, json: [{ id: "org_1" }] },
    {
      match: /\/v1\/projects\/ref_pe$/,
      json: { id: "ref_pe", name: "PE", region: "us-east-1", organization_id: "org_1" },
    },
    {
      match: /\/v1\/projects\/ref_pe\/api-keys$/,
      json: [{ type: "publishable", api_key: "sb_publishable_PEPEPEPE" }],
    },
  ]);
  const svc = service(fetchStub as never);
  const conn = await svc.connectWithPat(user, PAT);
  const resource = await svc.linkExistingResource(user, conn.id, { projectRef: "ref_pe" });
  await svc.linkProjectToResource(user, project.id, team.id, resource.id);

  const resolve = makePreviewEnvResolver({ supabaseConnections: svc });
  const env = await resolve(project.id);

  assert.deepEqual(Object.keys(env).sort(), ["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL"]);
  assert.equal(env.VITE_SUPABASE_URL, "https://ref_pe.supabase.co");
  assert.equal(env.VITE_SUPABASE_PUBLISHABLE_KEY, "sb_publishable_PEPEPEPE");
  for (const value of Object.values(env)) {
    assert.ok(!value.includes(PAT), "the PAT must never appear in a preview env value");
  }

  // An unlinked project resolves to nothing.
  const other = await makeUserTeamProject("preview-env-unlinked");
  assert.deepEqual(await resolve(other.project.id), {});
});

test("no provider_operations or audit-log detail ever contains the raw credential", async () => {
  const { user, team, project } = await makeUserTeamProject("no-leak");
  const fetchStub = stubFetch([
    { match: /\/v1\/organizations$/, json: [{ id: "org_1" }] },
    {
      match: /\/v1\/projects\/ref_nl$/,
      json: { id: "ref_nl", name: "NL", region: "eu-west-1", organization_id: "org_1" },
    },
    {
      match: /\/v1\/projects\/ref_nl\/api-keys$/,
      json: [{ type: "publishable", api_key: "sb_publishable_NLNLNL" }],
    },
  ]);
  const svc = service(fetchStub as never);
  const conn = await svc.connectWithPat(user, PAT);
  const resource = await svc.linkExistingResource(user, conn.id, { projectRef: "ref_nl" });
  await svc.linkProjectToResource(user, project.id, team.id, resource.id);

  const ops = await store.providerConnections.listOperationsForConnection(conn.id);
  assert.ok(ops.length >= 2);
  for (const op of ops) {
    assert.ok(!JSON.stringify(op.detail).includes(PAT), `op ${op.action} detail leaked the token`);
  }
  const audit = await store.auditLog.listForTeam(team.id);
  for (const entry of audit) {
    assert.ok(!JSON.stringify(entry.detail).includes(PAT), "audit detail leaked the token");
  }
});

test("OAuth: authorize URL is PKCE, the token pair is stored encrypted with an expiry", async () => {
  const { user } = await makeUserTeamProject("oauth");
  const fetchStub = stubFetch([
    {
      match: /\/v1\/oauth\/token$/,
      method: "POST",
      json: {
        access_token: OAUTH_ACCESS,
        refresh_token: OAUTH_REFRESH,
        expires_in: 3600,
        scope: "projects:read projects:write",
      },
    },
  ]);
  const svc = service(fetchStub as never);

  const { url, state } = svc.beginOAuth(user);
  assert.match(url, /code_challenge=/);
  assert.match(url, /code_challenge_method=S256/);
  assert.match(url, new RegExp(`state=${state}`));

  const summary = await svc.completeOAuth(state, "auth-code-123");
  assert.equal(summary.credentialType, "oauth");

  const row = (await store.providerConnections.getConnection(summary.id))!;
  assert.ok(row.expiresAt && Date.parse(row.expiresAt) > Date.now(), "expiry recorded");
  assert.ok(!row.encryptedBlob.includes(OAUTH_ACCESS), "access token not stored in the clear");
  assert.ok(!row.encryptedBlob.includes(OAUTH_REFRESH), "refresh token not stored in the clear");
  const opened = JSON.parse(secrets.decrypt(row.encryptedBlob) ?? "{}");
  assert.equal(opened.kind, "oauth");
  assert.equal(opened.accessToken, OAUTH_ACCESS);
});

test("OAuth: an expired access token is refreshed before a Management call", async () => {
  const { user } = await makeUserTeamProject("oauth-refresh");
  let clock = Date.now();
  const fetchStub = stubFetch([
    {
      match: /\/v1\/oauth\/token$/,
      method: "POST",
      json: { access_token: OAUTH_ACCESS, refresh_token: OAUTH_REFRESH, expires_in: 3600 },
    },
    { match: /\/v1\/projects$/, method: "GET", json: [] },
  ]);
  const svc = service(fetchStub as never, () => clock);

  const { url: _u, state } = svc.beginOAuth(user);
  const created = await svc.completeOAuth(state, "code");
  const before = (await store.providerConnections.getConnection(created.id))!;

  // Jump past the token's lifetime, then make a Management call.
  clock += 3600_000 + 5_000;
  const refreshStub = stubFetch([
    {
      match: /\/v1\/oauth\/token$/,
      method: "POST",
      json: {
        access_token: "sbat_rotated_CCCCCCCC",
        refresh_token: OAUTH_REFRESH,
        expires_in: 3600,
      },
    },
    { match: /\/v1\/projects$/, method: "GET", json: [] },
  ]);
  const svc2 = service(refreshStub as never, () => clock);
  await svc2.listOrgProjects(before.id);

  const after = (await store.providerConnections.getConnection(before.id))!;
  assert.notEqual(after.encryptedBlob, before.encryptedBlob, "credential rotated");
  const opened = JSON.parse(secrets.decrypt(after.encryptedBlob) ?? "{}");
  assert.equal(opened.accessToken, "sbat_rotated_CCCCCCCC");
});

test("OAuth: a failed refresh marks the connection expired and raises a 409", async () => {
  const { user } = await makeUserTeamProject("oauth-dead");
  let clock = Date.now();
  const setup = stubFetch([
    {
      match: /\/v1\/oauth\/token$/,
      method: "POST",
      json: { access_token: OAUTH_ACCESS, refresh_token: OAUTH_REFRESH, expires_in: 3600 },
    },
  ]);
  const svc = service(setup as never, () => clock);
  const { state } = svc.beginOAuth(user);
  const conn = await svc.completeOAuth(state, "code");

  clock += 3600_000 + 5_000;
  const dead = service(
    stubFetch([{ match: /\/v1\/oauth\/token$/, method: "POST", status: 400 }]) as never,
    () => clock,
  );
  await assert.rejects(
    () => dead.listOrgProjects(conn.id),
    (err) => err instanceof ConnectionExpiredError && err.status === 409,
  );
  const reloaded = await store.providerConnections.getConnection(conn.id);
  assert.equal(reloaded?.status, "expired");
});

test("provisionProject and deleteResource refuse without explicit confirmation, before any network call", async () => {
  const { user } = await makeUserTeamProject("consent");
  const fetchStub = stubFetch([{ match: /\/v1\/organizations$/, json: [{ id: "org_1" }] }]);
  const svc = service(fetchStub as never);
  const conn = await svc.connectWithPat(user, PAT);
  const callsBefore = fetchStub.calls.length;

  await assert.rejects(
    () =>
      svc.provisionProject(user, conn.id, {
        organizationId: "org_1",
        region: "us-east-1",
        name: "x",
        confirmed: false as unknown as true,
      }),
    /explicit confirmation/,
  );
  await assert.rejects(
    () =>
      svc.deleteResource(user, "prs_whatever", {
        confirmed: false as unknown as true,
      }),
    /explicit confirmation/,
  );
  assert.equal(fetchStub.calls.length, callsBefore, "no network call was made");
});

test("getLinkedResource returns nothing once the connection is revoked", async () => {
  const { user, team, project } = await makeUserTeamProject("revoke");
  const fetchStub = stubFetch([
    { match: /\/v1\/organizations$/, json: [{ id: "org_1" }] },
    {
      match: /\/v1\/projects\/ref_rv$/,
      json: { id: "ref_rv", name: "RV", region: "us-east-1", organization_id: "org_1" },
    },
    {
      match: /\/v1\/projects\/ref_rv\/api-keys$/,
      json: [{ type: "publishable", api_key: "sb_publishable_RVRVRV" }],
    },
  ]);
  const svc = service(fetchStub as never);
  const conn = await svc.connectWithPat(user, PAT);
  const resource = await svc.linkExistingResource(user, conn.id, { projectRef: "ref_rv" });
  await svc.linkProjectToResource(user, project.id, team.id, resource.id);

  assert.ok(await svc.getLinkedResource(project.id));
  await svc.revoke(user, conn.id);
  assert.equal(await svc.getLinkedResource(project.id), null);
});

// ──────────────────────── applyMigration (build-agent bridge) ────────────────

async function linkedProject(
  suffix: string,
  environment: "development" | "staging" | "production",
) {
  const { user, team, project } = await makeUserTeamProject(suffix);
  const ref = `ref_${suffix}`.replace(/[^a-z0-9_]/g, "");
  const fetchStub = stubFetch([
    { match: /\/v1\/organizations$/, json: [{ id: "org_1" }] },
    {
      match: new RegExp(`/v1/projects/${ref}$`),
      json: { id: ref, name: suffix, region: "us-east-1", organization_id: "org_1" },
    },
    {
      match: new RegExp(`/v1/projects/${ref}/api-keys$`),
      json: [{ type: "publishable", api_key: `sb_pub_${ref}` }],
    },
    { match: new RegExp(`/v1/projects/${ref}/database/migrations$`), method: "POST", json: {} },
  ]);
  const svc = service(fetchStub as never);
  const conn = await svc.connectWithPat(user, PAT);
  const resource = await svc.linkExistingResource(user, conn.id, {
    projectRef: ref,
    environment,
  });
  await svc.linkProjectToResource(user, project.id, team.id, resource.id);
  return { user, team, project, conn, svc, fetchStub };
}

test("applyMigration refuses a non-development resource", async () => {
  const { user, project, svc } = await linkedProject("mig-prod", "production");
  await assert.rejects(
    () =>
      svc.applyMigration(user, project.id, { name: "0001_init", sql: "create table t (id uuid);" }),
    /development resource only/,
  );
});

test("applyMigration refuses a destructive statement", async () => {
  const { user, project, svc } = await linkedProject("mig-drop", "development");
  await assert.rejects(
    () =>
      svc.applyMigration(user, project.id, {
        name: "0001_init",
        sql: "create table t (id uuid);\ndrop table users;",
      }),
    /DROP/,
  );
});

test("applyMigration applies once, records name+checksum only, and is idempotent by content", async () => {
  const { user, team, project, conn, svc, fetchStub } = await linkedProject(
    "mig-ok",
    "development",
  );
  const sql =
    "create table notes (id uuid primary key, owner uuid not null);\n" +
    "alter table notes enable row level security;";

  const first = await svc.applyMigration(user, project.id, { name: "0001_init", sql });
  assert.equal(first.alreadyApplied, false);
  const applyCalls = () =>
    fetchStub.calls.filter((c) => c.url.endsWith("/database/migrations") && c.method === "POST")
      .length;
  assert.equal(applyCalls(), 1);

  // Same name + same content → no-op, no second endpoint call.
  const again = await svc.applyMigration(user, project.id, { name: "0001_init", sql });
  assert.equal(again.alreadyApplied, true);
  assert.equal(applyCalls(), 1);

  // The operation row carries name + checksum and NOT the SQL.
  const ops = await store.providerConnections.listOperationsForConnection(conn.id);
  const migrate = ops.find((op) => op.action === "migrate");
  assert.ok(migrate, "a migrate operation was recorded");
  assert.equal((migrate.detail as { name?: string }).name, "0001_init");
  assert.ok((migrate.detail as { checksum?: string }).checksum);
  assert.ok(
    !JSON.stringify(migrate.detail).includes("create table"),
    "SQL body must not be stored",
  );

  const audit = await store.auditLog.listForTeam(team.id);
  assert.ok(audit.some((e) => e.action === "provider.migration_applied"));
});

test("applyMigration refuses the same name with changed content (drift)", async () => {
  const { user, project, svc } = await linkedProject("mig-drift", "development");
  await svc.applyMigration(user, project.id, {
    name: "0001_init",
    sql: "create table a (id uuid);",
  });
  await assert.rejects(
    () =>
      svc.applyMigration(user, project.id, { name: "0001_init", sql: "create table b (id uuid);" }),
    /drift/,
  );
});

// ──────────────────────── backendVerification (build-agent bridge) ───────────

/**
 * The verification does, in order: three `/database/query` POSTs (pg_tables,
 * pg_policies, role_table_grants), then `GET /auth/v1/settings`, then (unless
 * confirm-email is on) `POST /auth/v1/signup`. This stub drives that sequence.
 */
function verifyFetch(opts: {
  tables?: Array<{ tablename: string; rowsecurity: boolean }>;
  policies?: Array<{ tablename: string }>;
  grants?: Array<{ grantee: string; table_name: string }>;
  settings?: Record<string, unknown> | null;
  signup?: () => Response;
}) {
  const tables = opts.tables ?? [{ tablename: "notes", rowsecurity: true }];
  const bodies = [
    tables,
    opts.policies ?? [{ tablename: "notes" }],
    opts.grants ?? [{ grantee: "authenticated", table_name: "notes" }],
  ];
  let call = 0;
  return Object.assign(
    async (url: string): Promise<Response> => {
      if (/\/auth\/v1\/settings$/.test(url)) {
        return opts.settings === null
          ? new Response("{}", { status: 401 })
          : new Response(JSON.stringify(opts.settings ?? { mailer_autoconfirm: true }), {
              status: 200,
            });
      }
      if (/\/auth\/v1\/signup$/.test(url)) {
        return opts.signup ? opts.signup() : new Response("{}", { status: 200 });
      }
      call += 1;
      return new Response(JSON.stringify(bodies[call - 1] ?? []), { status: 200 });
    },
    { calls: [] as unknown[] },
  );
}

test("backendVerification: a healthy schema verifies; the auth line is informational", async () => {
  const { user, project } = await linkedProject("verify-ok", "development");
  const ordered = verifyFetch({
    // authenticated has write on an RLS-protected table — the correct design.
    grants: [{ grantee: "authenticated", table_name: "notes" }],
    signup: () =>
      new Response(JSON.stringify({ error_code: "over_email_send_rate_limit" }), { status: 429 }),
  });
  const vsvc = service(ordered as never);
  const { verified, checks, summary } = await vsvc.backendVerification(user, project.id);
  assert.equal(verified, true, summary);
  assert.equal(checks.find((c) => c.name === "Row-level security")?.status, "pass");
  assert.equal(checks.find((c) => c.name === "Access policies")?.status, "pass");
  assert.equal(checks.find((c) => c.name === "Public role grants")?.status, "pass");
  // The rate-limited signup is info, and does not fail the run.
  const auth = checks.find((c) => c.name === "Auth signup");
  assert.equal(auth?.status, "info");
  assert.match(auth?.detail ?? "", /rate limit/);
});

test("backendVerification: authenticated write + RLS on passes; anon write fails", async () => {
  const { user, project } = await linkedProject("verify-grants", "development");
  // anon can write to `notes` — a real hole regardless of RLS.
  const ordered = verifyFetch({
    grants: [
      { grantee: "authenticated", table_name: "notes" },
      { grantee: "anon", table_name: "notes" },
    ],
  });
  const vsvc = service(ordered as never);
  const { verified, checks } = await vsvc.backendVerification(user, project.id);
  assert.equal(verified, false);
  const grantsCheck = checks.find((c) => c.name === "Public role grants");
  assert.equal(grantsCheck?.status, "fail");
  assert.match(grantsCheck?.detail ?? "", /anon .*can write to: notes/i);
});

test("backendVerification: confirm-email ON is reported as a fixable setting, not an opaque 504", async () => {
  const { user, project } = await linkedProject("verify-confirm-email", "development");
  const ordered = verifyFetch({
    settings: { mailer_autoconfirm: false },
    // signup would 504 here — but with autoconfirm=false the probe is skipped.
    signup: () => new Response("", { status: 504 }),
  });
  const vsvc = service(ordered as never);
  const { verified, checks } = await vsvc.backendVerification(user, project.id);
  // Email config never fails the run.
  assert.equal(verified, true);
  const confirm = checks.find((c) => c.name === "Email confirmation");
  assert.equal(confirm?.status, "info");
  assert.match(confirm?.detail ?? "", /Confirm email|SMTP/);
  const auth = checks.find((c) => c.name === "Auth signup");
  assert.match(auth?.detail ?? "", /not probed|email confirmation is ON/i);
});

test("backendVerification: an unprotected table fails the run", async () => {
  const { user, project } = await linkedProject("verify-rls-off", "development");
  const ordered = verifyFetch({
    tables: [{ tablename: "notes", rowsecurity: false }],
    policies: [],
    grants: [],
  });
  const vsvc = service(ordered as never);
  const { verified, checks } = await vsvc.backendVerification(user, project.id);
  assert.equal(verified, false);
  assert.equal(checks.find((c) => c.name === "Row-level security")?.status, "fail");
});

test("backendVerification: no tables after a migration is a FAIL with a clear summary", async () => {
  const { user, project } = await linkedProject("verify-empty", "development");
  const ordered = Object.assign(
    async (url: string): Promise<Response> => {
      if (/\/auth\/v1\/signup$/.test(url)) return new Response("{}", { status: 200 });
      return new Response("[]", { status: 200 });
    },
    { calls: [] as unknown[] },
  );
  const vsvc = service(ordered as never);
  const { verified, summary } = await vsvc.backendVerification(user, project.id);
  assert.equal(verified, false);
  assert.match(summary, /no tables/i);
});

// ──────────────────────── deployEdgeFunction (060) ──────────────────────────

test("deployEdgeFunction creates a new function via the Management API", async () => {
  const { user, project } = await linkedProject("deploy-new", "development");
  let created = null;
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (/\/functions\/save-credential$/.test(url) && method === "GET") {
      return new Response("not found", { status: 404 });
    }
    if (/\/functions$/.test(url) && method === "POST") {
      created = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ slug: "save-credential" }), { status: 201 });
    }
    return new Response("no stub", { status: 599 });
  };
  const svc = service(Object.assign(fn, { calls: [] }) as never);
  const r = await svc.deployEdgeFunction(user, project.id, {
    slug: "save-credential",
    source: "Deno.serve(() => new Response('ok'));",
  });
  assert.deepEqual(r, { slug: "save-credential", created: true });
  assert.equal(created.slug, "save-credential");
  assert.equal(created.verify_jwt, true);
});

test("deployEdgeFunction updates an existing function with PATCH", async () => {
  const { user, project } = await linkedProject("deploy-upd", "development");
  let patched = false;
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (/\/functions\/chat$/.test(url) && method === "GET") {
      return new Response(JSON.stringify({ slug: "chat" }), { status: 200 });
    }
    if (/\/functions\/chat$/.test(url) && method === "PATCH") {
      patched = true;
      return new Response(JSON.stringify({ slug: "chat" }), { status: 200 });
    }
    return new Response("no stub", { status: 599 });
  };
  const svc = service(Object.assign(fn, { calls: [] }) as never);
  const r = await svc.deployEdgeFunction(user, project.id, { slug: "chat", source: "code" });
  assert.equal(r.created, false);
  assert.ok(patched);
});

test("deployEdgeFunction refuses a non-development resource", async () => {
  const { user, project } = await linkedProject("deploy-prod", "production");
  const svc = service(Object.assign(async () => new Response("{}"), { calls: [] }) as never);
  await assert.rejects(
    svc.deployEdgeFunction(user, project.id, { slug: "chat", source: "code" }),
    /development resource only/,
  );
});

test("deployEdgeFunction refuses source that hard-codes a service_role key", async () => {
  const { user, project } = await linkedProject("deploy-secret", "development");
  const svc = service(Object.assign(async () => new Response("{}"), { calls: [] }) as never);
  await assert.rejects(
    svc.deployEdgeFunction(user, project.id, {
      slug: "chat",
      source: 'const k = "sb_secret_abc123"; Deno.serve(() => new Response(k));',
    }),
    /hard-codes a secret/,
  );
});

test("deployEdgeFunction wraps a Management-API failure in a manual-deploy instruction", async () => {
  const { user, project } = await linkedProject("deploy-fail", "development");
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") return new Response("not found", { status: 404 });
    return new Response("bad request", { status: 400 });
  };
  const svc = service(Object.assign(fn, { calls: [] }) as never);
  await assert.rejects(
    svc.deployEdgeFunction(user, project.id, { slug: "chat", source: "code" }),
    /supabase functions deploy chat/,
  );
});

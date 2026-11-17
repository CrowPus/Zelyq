import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { adminKeyCommand } from "../src/admin-key-cli.js";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * The admin API (`/api/admin/v1`): keys only, scopes enforced, retried
 * changes happen once, every change audited, revoked keys stop at once.
 */

const tmp = path.join(os.tmpdir(), `zelyq-admin-api-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const databaseUrl = `file:${path.join(tmp, "zelyq.db")}`;

const config = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl,
  agentUrl: "http://127.0.0.1:59999",
  serverInternalUrl: "http://127.0.0.1:59998",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: randomBytes(32).toString("base64"),
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4990, 4993],
    previewHost: "127.0.0.1",
  },
} as ServerConfig;

let server: ZelyqServer;
let adminCookie = "";
let memberCookie = "";
let teamId = "";

async function register(email: string): Promise<{ cookie: string; teamId: string }> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: email.split("@")[0], password: "a-long-password-1" },
  });
  assert.equal(response.statusCode, 201, response.body);
  const session = response.cookies.find((c) => c.name === "zelyq_session")!;
  return { cookie: `zelyq_session=${session.value}`, teamId: response.json().teams[0].id };
}

async function makeKey(name: string, scopes: string[]): Promise<{ key: string; id: string }> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/admin-keys",
    headers: { cookie: adminCookie },
    payload: { name, scopes },
  });
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  return { key: body.key, id: body.summary.id };
}

const call = (
  key: string | null,
  method: "GET" | "PUT" | "POST",
  url: string,
  options: { payload?: unknown; headers?: Record<string, string> } = {},
) =>
  server.app.inject({
    method,
    url: `/api/admin/v1${url}`,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...options.headers },
    ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
  });

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(databaseUrl);
  server = await buildServer(config);
  adminCookie = (await register("admin@example.com")).cookie;
  const member = await register("member@example.com");
  memberCookie = member.cookie;
  teamId = member.teamId;
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("the server's administrator makes a key; it is shown once, never listed", async () => {
  const { key } = await makeKey("Account service", ["plans", "teams"]);
  assert.match(key, /^zlq_admin_[\w-]{40,}$/);
  const list = await server.app.inject({
    method: "GET",
    url: "/api/admin-keys",
    headers: { cookie: adminCookie },
  });
  const keys = list.json().keys;
  assert.equal(keys.length, 1);
  assert.deepEqual(keys[0].scopes, ["plans", "teams"]);
  assert.ok(!JSON.stringify(keys).includes(key), "the key must never come back");
  assert.ok(!JSON.stringify(keys).includes("Hash"), "nor its hash");
});

test("nobody else can make or see keys", async () => {
  const made = await server.app.inject({
    method: "POST",
    url: "/api/admin-keys",
    headers: { cookie: memberCookie },
    payload: { name: "mine", scopes: ["accounts"] },
  });
  assert.equal(made.statusCode, 403);
  const listed = await server.app.inject({
    method: "GET",
    url: "/api/admin-keys",
    headers: { cookie: memberCookie },
  });
  assert.equal(listed.statusCode, 403);
});

test("a key needs a name and at least one known scope", async () => {
  for (const payload of [
    { name: "", scopes: ["plans"] },
    { name: "x", scopes: [] },
    { name: "x", scopes: ["everything"] },
  ]) {
    const response = await server.app.inject({
      method: "POST",
      url: "/api/admin-keys",
      headers: { cookie: adminCookie },
      payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
});

test("only a key gets in: no key, a wrong key, or the administrator's own session are refused", async () => {
  assert.equal((await call(null, "GET", "/whoami")).statusCode, 401);
  assert.equal((await call("zlq_admin_not-a-real-key", "GET", "/whoami")).statusCode, 401);
  const withSession = await call(null, "GET", "/whoami", { headers: { cookie: adminCookie } });
  assert.equal(withSession.statusCode, 401);
  assert.match(withSession.json().error.message, /takes a key/);
  // Not an agent key either.
  assert.equal((await call("zlq_agent_abc", "GET", "/whoami")).statusCode, 401);
});

test("whoami says which key and what it may reach", async () => {
  const { key, id } = await makeKey("Monitoring", ["health", "errors"]);
  const response = await call(key, "GET", "/whoami");
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.key.id, id);
  assert.equal(body.key.name, "Monitoring");
  assert.deepEqual(body.scopes, ["errors", "health"]);
  assert.equal(body.mode, "self_hosted");
});

test("a key reaches only its scopes", async () => {
  const { key } = await makeKey("Analytics", ["analytics"]);
  const refused = await call(key, "GET", "/plans");
  assert.equal(refused.statusCode, 403);
  assert.match(refused.json().error.message, /"plans"/);

  const plansKey = await makeKey("Plans", ["plans"]);
  const allowed = await call(plansKey.key, "GET", "/plans");
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.ok(Array.isArray(allowed.json().all));
});

test("a retried change happens once; the same Idempotency-Key with another change is refused", async () => {
  const { key } = await makeKey("Retries", ["plans"]);
  const payload = {
    plans: [{ id: "free", name: "Free", limits: { apps: 3 } }],
    defaultPlan: "free",
  };
  const headers = { "idempotency-key": "push-plans-1" };

  const first = await call(key, "PUT", "/plans", { payload, headers });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.headers["idempotent-replayed"], undefined);

  const again = await call(key, "PUT", "/plans", { payload, headers });
  assert.equal(again.statusCode, 200);
  assert.equal(again.headers["idempotent-replayed"], "true");
  assert.deepEqual(again.json(), first.json());

  const other = await call(key, "PUT", "/plans", {
    payload: { ...payload, defaultPlan: "unlimited" },
    headers,
  });
  assert.equal(other.statusCode, 409);
});

test("every change by a key is in the audit log under its name, once", async () => {
  const { key } = await makeKey("Billing", ["teams", "plans"]);
  await call(key, "PUT", "/plans", {
    payload: { plans: [{ id: "pro", name: "Pro", limits: { apps: 30 } }], defaultPlan: "pro" },
  });
  const headers = { "idempotency-key": "move-1" };
  const moved = await call(key, "PUT", `/teams/${teamId}/plan`, {
    payload: { plan: "pro" },
    headers,
  });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(moved.json().plan.id, "pro");
  await call(key, "PUT", `/teams/${teamId}/plan`, { payload: { plan: "pro" }, headers });

  const entries = (await server.store.auditLog.listForTeam(teamId)).filter(
    (entry) => entry.action === "admin_api.call",
  );
  assert.equal(entries.length, 1, "the replayed retry is not a second change");
  assert.equal(entries[0]!.actorName, 'Admin key "Billing"');
  assert.equal(entries[0]!.userId, null);
  assert.deepEqual(entries[0]!.detail, {
    method: "PUT",
    path: "/api/admin/v1/teams/:id/plan",
    status: 200,
    key: "Billing",
  });
});

test("an unknown team or call is a clear 404", async () => {
  const { key } = await makeKey("Lookups", ["usage"]);
  assert.equal((await call(key, "GET", "/teams/tem_nope/usage")).statusCode, 404);
  const unknown = await call(key, "GET", "/no-such-call");
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, "not_found");
  // Without a key, even an unknown call says nothing but "bring a key".
  assert.equal((await call(null, "GET", "/no-such-call")).statusCode, 401);
});

test("a revoked key stops at once", async () => {
  const { key, id } = await makeKey("Short-lived", ["usage"]);
  assert.equal((await call(key, "GET", `/teams/${teamId}/usage`)).statusCode, 200);
  const revoked = await server.app.inject({
    method: "DELETE",
    url: `/api/admin-keys/${id}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(revoked.statusCode, 200);
  assert.ok(revoked.json().key.revokedAt);
  const after = await call(key, "GET", `/teams/${teamId}/usage`);
  assert.equal(after.statusCode, 401);
  assert.match(after.json().error.message, /revoked/);
});

test("use is recorded: when and from where", async () => {
  const { key, id } = await makeKey("Seen", ["usage"]);
  await call(key, "GET", `/teams/${teamId}/usage`);
  const row = await server.store.adminKeys.findById(id);
  assert.ok(row?.lastUsedAt);
  assert.ok(row?.lastUsedIp);
});

test("the server's command line makes a key before anyone has signed in", async () => {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  console.log = (line: string) => lines.push(line);
  console.error = () => undefined;
  try {
    assert.equal(await adminKeyCommand(["create", "--name", "Cloud", "--scopes", "all"]), 0);
  } finally {
    console.log = log;
    console.error = error;
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
  const key = lines.at(-1)!;
  assert.match(key, /^zlq_admin_/);
  const whoami = await call(key, "GET", "/whoami");
  assert.equal(whoami.statusCode, 200, whoami.body);
  assert.equal(whoami.json().scopes.length, 13);
  assert.ok(whoami.json().scopes.includes("accounts"));
});

test("a key is rate limited on its own, not with everyone else", async () => {
  const busy = await makeKey("Busy", ["usage"]);
  const calm = await makeKey("Calm", ["usage"]);
  let limited = 0;
  for (let i = 0; i < 605; i++) {
    const response = await call(busy.key, "GET", `/teams/${teamId}/usage`);
    if (response.statusCode === 429) limited++;
  }
  assert.ok(limited >= 5, `expected the busy key to be limited, got ${limited}`);
  assert.equal((await call(calm.key, "GET", `/teams/${teamId}/usage`)).statusCode, 200);
});

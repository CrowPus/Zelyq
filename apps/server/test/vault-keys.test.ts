import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const tmp = path.join(os.tmpdir(), `zelyq-vault-keys-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "keys.db")}`,
  agentUrl: "http://127.0.0.1:59999",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: undefined,
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4976, 4979],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let owner: string;
let editor: string;
let teamId: string;

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

const asUser = (cookie: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });

/** What an outside system does: a key, an address, nothing else. */
const outside = (
  key: string | null,
  method: "GET" | "PUT",
  url: string,
  options: { payload?: unknown; ip?: string } = {},
) =>
  server.app.inject({
    method,
    url,
    remoteAddress: options.ip ?? "203.0.113.9",
    headers: key ? { authorization: `Bearer ${key}` } : {},
    ...(options.payload ? { payload: options.payload as Record<string, unknown> } : {}),
  });

async function newKey(input: Record<string, unknown>) {
  const response = await asUser(owner, "POST", `/api/teams/${teamId}/vault-keys`, {
    name: "CI",
    ...input,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { key: { id: string; keyPrefix: string }; secret: string };
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  owner = await register("owner@example.com", "Owner");
  editor = await register("editor@example.com", "Editor");
  teamId = (await asUser(owner, "GET", "/api/teams")).json().teams[0].id;
  await asUser(owner, "POST", `/api/teams/${teamId}/members`, {
    email: "editor@example.com",
    role: "editor",
  });
  for (const [name, value, isProtected] of [
    ["STRIPE_KEY_TEST", "sk_test_1", false],
    ["STRIPE_KEY_LIVE", "sk_live_1", true],
    ["DB_PASSWORD", "hunter2", false],
  ] as const) {
    const created = await asUser(owner, "POST", `/api/teams/${teamId}/vault`, {
      name,
      value,
      protected: isProtected,
    });
    assert.equal(created.statusCode, 201, created.body);
  }
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("only admins and owners manage keys; the key is shown once and never stored", async () => {
  assert.equal(
    (
      await asUser(editor, "POST", `/api/teams/${teamId}/vault-keys`, {
        name: "x",
        scopes: ["read"],
      })
    ).statusCode,
    403,
  );
  const { key, secret } = await newKey({ scopes: ["read"] });
  assert.match(secret, /^zvk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
  assert.ok(secret.startsWith(key.keyPrefix));
  const listed = await asUser(owner, "GET", `/api/teams/${teamId}/vault-keys`);
  assert.ok(!listed.body.includes(secret), "the key itself must never be listed");
  const row = await server.store.vault.keys.findById(key.id);
  assert.ok(row && !JSON.stringify(row).includes(secret), "the key itself must never be stored");
});

test("a key reads what its scopes and patterns allow, and nothing else", async () => {
  const { secret } = await newKey({ scopes: ["list", "read"], namePatterns: ["STRIPE_*"] });

  const names = await outside(secret, "GET", "/api/v1/vault/secrets");
  assert.equal(names.statusCode, 200, names.body);
  assert.deepEqual(
    names
      .json()
      .secrets.map((s: { name: string }) => s.name)
      .sort(),
    ["STRIPE_KEY_LIVE", "STRIPE_KEY_TEST"],
  );
  assert.ok(!names.body.includes("sk_"), "listing names must not carry values");

  const one = await outside(secret, "GET", "/api/v1/vault/secrets/STRIPE_KEY_TEST");
  assert.deepEqual(one.json(), { name: "STRIPE_KEY_TEST", value: "sk_test_1" });
  assert.equal(one.headers["cache-control"], "no-store");

  // A Protected secret is readable by a key an admin made to read it.
  assert.equal(
    (await outside(secret, "GET", "/api/v1/vault/secrets/STRIPE_KEY_LIVE")).json().value,
    "sk_live_1",
  );

  const outsidePattern = await outside(secret, "GET", "/api/v1/vault/secrets/DB_PASSWORD");
  assert.equal(outsidePattern.statusCode, 403);
  assert.ok(!outsidePattern.body.includes("hunter2"));

  const missing = await outside(secret, "GET", "/api/v1/vault/secrets/STRIPE_NOPE");
  assert.equal(missing.statusCode, 404);

  const batch = await outside(
    secret,
    "GET",
    "/api/v1/vault/secrets?names=STRIPE_KEY_TEST,STRIPE_NOPE",
  );
  assert.deepEqual(batch.json(), {
    secrets: [{ name: "STRIPE_KEY_TEST", value: "sk_test_1" }],
    missing: ["STRIPE_NOPE"],
  });
});

test("a missing scope is refused with the reason", async () => {
  const { secret } = await newKey({ scopes: ["list"] });
  const response = await outside(secret, "GET", "/api/v1/vault/secrets/STRIPE_KEY_TEST");
  assert.equal(response.statusCode, 403);
  assert.match(response.json().error.message, /'read' scope/);
});

test("no key, a wrong key, and a browser session all get nothing", async () => {
  assert.equal((await outside(null, "GET", "/api/v1/vault/secrets")).statusCode, 401);
  assert.equal(
    (
      await outside(
        "zvk_00000000_notarealkeyatallnotarealkeyatallnotarealk",
        "GET",
        "/api/v1/vault/secrets",
      )
    ).statusCode,
    401,
  );
  const session = await server.app.inject({
    method: "GET",
    url: "/api/v1/vault/secrets",
    headers: { cookie: owner },
  });
  assert.equal(session.statusCode, 401, "a signed-in browser is not a service key");
});

test("revoking stops a key at once; rotating replaces it", async () => {
  const first = await newKey({ scopes: ["read"] });
  const rotated = await asUser(
    owner,
    "POST",
    `/api/teams/${teamId}/vault-keys/${first.key.id}/rotate`,
  );
  const second = rotated.json() as { key: { id: string }; secret: string };
  assert.equal(
    (await outside(first.secret, "GET", "/api/v1/vault/secrets/STRIPE_KEY_TEST")).statusCode,
    401,
  );
  assert.equal(
    (await outside(second.secret, "GET", "/api/v1/vault/secrets/STRIPE_KEY_TEST")).statusCode,
    200,
  );

  await asUser(owner, "POST", `/api/teams/${teamId}/vault-keys/${second.key.id}/revoke`);
  const after = await outside(second.secret, "GET", "/api/v1/vault/secrets/STRIPE_KEY_TEST");
  assert.equal(after.statusCode, 401);
  assert.match(after.json().error.message, /revoked/);
});

test("an expired key is refused", async () => {
  const { key, secret } = await newKey({
    scopes: ["read"],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(
    (await outside(secret, "GET", "/api/v1/vault/secrets/STRIPE_KEY_TEST")).statusCode,
    200,
  );
  await server.store.exec(
    `UPDATE vault_service_keys SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '${key.id}'`,
  );
  const response = await outside(secret, "GET", "/api/v1/vault/secrets/STRIPE_KEY_TEST");
  assert.equal(response.statusCode, 401);
  assert.match(response.json().error.message, /expired/);
});

test("an IP allowlist is enforced, IPv4 written either way", async () => {
  const { secret } = await newKey({ scopes: ["read"], allowedIps: ["198.51.100.0/24"] });
  const url = "/api/v1/vault/secrets/STRIPE_KEY_TEST";
  assert.equal((await outside(secret, "GET", url, { ip: "198.51.100.20" })).statusCode, 200);
  assert.equal((await outside(secret, "GET", url, { ip: "::ffff:198.51.100.20" })).statusCode, 200);
  const refused = await outside(secret, "GET", url, { ip: "203.0.113.9" });
  assert.equal(refused.statusCode, 403);
  assert.match(refused.json().error.message, /203\.0\.113\.9/);
  assert.equal(
    (
      await asUser(owner, "POST", `/api/teams/${teamId}/vault-keys`, {
        name: "bad",
        scopes: ["read"],
        allowedIps: ["not-an-ip"],
      })
    ).statusCode,
    400,
  );
});

test("a write key sets a value, but never a Protected one", async () => {
  const { secret } = await newKey({ scopes: ["read", "write"] });
  const created = await outside(secret, "PUT", "/api/v1/vault/secrets/PIPELINE_TOKEN", {
    payload: { value: "tok-1" },
  });
  assert.deepEqual(created.json(), { name: "PIPELINE_TOKEN", version: 1, created: true });
  const updated = await outside(secret, "PUT", "/api/v1/vault/secrets/PIPELINE_TOKEN", {
    payload: { value: "tok-2" },
  });
  assert.deepEqual(updated.json(), { name: "PIPELINE_TOKEN", version: 2, created: false });
  assert.equal(
    (await outside(secret, "GET", "/api/v1/vault/secrets/PIPELINE_TOKEN")).json().value,
    "tok-2",
  );
  const live = await outside(secret, "PUT", "/api/v1/vault/secrets/STRIPE_KEY_LIVE", {
    payload: { value: "overwrite" },
  });
  assert.equal(live.statusCode, 403);

  const readOnly = await newKey({ scopes: ["read"] });
  assert.equal(
    (await outside(readOnly.secret, "PUT", "/api/v1/vault/secrets/X", { payload: { value: "y" } }))
      .statusCode,
    403,
  );
});

test("every fetch is in the team's Activity: which key, which secret, from where — never the value", async () => {
  const { key, secret } = await newKey({ name: "Nightly deploy", scopes: ["read"] });
  await outside(secret, "GET", "/api/v1/vault/secrets/DB_PASSWORD", { ip: "198.51.100.77" });
  const activity = (await asUser(owner, "GET", `/api/teams/${teamId}/vault/activity`)).json()
    .entries as { action: string; actorName: string; detail: Record<string, unknown> }[];
  const fetched = activity.find(
    (e) => e.action === "vault.secret.fetched" && e.detail.key === key.keyPrefix,
  );
  assert.ok(fetched, "the fetch is not in Activity");
  assert.equal(fetched.detail.name, "DB_PASSWORD");
  assert.equal(fetched.detail.ip, "198.51.100.77");
  assert.match(fetched.actorName, /Nightly deploy/);
  assert.ok(!JSON.stringify(activity).includes("hunter2"));
  assert.ok(!JSON.stringify(activity).includes(secret));
});

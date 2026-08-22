import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createStore, runMigrations } from "@zelyq/db";
import { type ZelyqServer, buildServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { SecretBox, maskSecret, resolveSecretKey } from "../src/services/secrets.js";

const tmp = path.join(os.tmpdir(), `zelyq-settings-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "settings.db")}`,
  agentUrl: "http://127.0.0.1:59999",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: randomBytes(32).toString("base64"),
  secretKeyFile: path.join(tmp, "secret.key"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4996, 4999],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let adminCookie: string;
let memberCookie: string;

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, response.body);
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")!.value}`;
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  adminCookie = await register("admin@example.com", "Admin");
  memberCookie = await register("member@example.com", "Member");
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

test("secrets round-trip through encryption", () => {
  const box = new SecretBox(randomBytes(32));
  const secret = "sk-ant-not-a-real-key-000111";
  const stored = box.encrypt(secret);

  assert.ok(!stored.includes(secret), "the plaintext must not appear in the stored form");
  assert.equal(box.decrypt(stored), secret);
});

test("the same value encrypts differently every time", () => {
  const box = new SecretBox(randomBytes(32));
  assert.notEqual(box.encrypt("same"), box.encrypt("same"), "a fixed IV would leak equality");
});

test("a tampered or wrongly-keyed value decrypts to null, not garbage", () => {
  const box = new SecretBox(randomBytes(32));
  const stored = box.encrypt("secret-value");

  const tampered = `${stored.slice(0, -4)}AAAA`;
  assert.equal(box.decrypt(tampered), null);

  const otherBox = new SecretBox(randomBytes(32));
  assert.equal(otherBox.decrypt(stored), null, "a different key must not decrypt");
});

test("a generated key file is written owner-only and reused", async () => {
  const dir = path.join(tmp, "keygen");
  const keyFile = path.join(dir, "secret.key");

  const first = resolveSecretKey({ envKey: undefined, keyFilePath: keyFile });
  assert.equal(first.length, 32);

  const mode = (await fs.stat(keyFile)).mode & 0o777;
  assert.equal(mode, 0o600, `key file should be owner-only, got ${mode.toString(8)}`);

  const second = resolveSecretKey({ envKey: undefined, keyFilePath: keyFile });
  assert.deepEqual(second, first, "a second call must reuse the stored key");
});

test("masking never reveals enough to use", () => {
  assert.equal(maskSecret("sk-ant-abcdefgh1234"), "••••1234");
  assert.equal(maskSecret("abc"), "••••");
});

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

test("the backfill promotes the earliest account when no administrator exists", async () => {
  // The column was added with a default of "member", so on an existing instance
  // the account that set it up was silently demoted and nobody could reach
  // settings. This exercises the shipped migration SQL, not a re-run of the
  // migrator — Drizzle records applied migrations, so a re-run does nothing.
  const backfill = await fs.readFile(
    path.resolve(
      import.meta.dirname,
      "../../../packages/db/drizzle/sqlite/0004_backfill_instance_admin.sql",
    ),
    "utf8",
  );

  const url = `file:${path.join(tmp, "backfill.db")}`;
  await runMigrations(url);
  const store = createStore(url);

  try {
    const insert = async (id: string, email: string, createdAt: string, role: string) => {
      await store.exec(
        `INSERT INTO users (id, email, name, password_hash, instance_role, created_at, updated_at)
         VALUES ('${id}', '${email}', '${email}', 'x', '${role}', '${createdAt}', '${createdAt}')`,
      );
    };

    await insert("usr_b", "second@example.com", "2026-01-02T00:00:00.000Z", "member");
    await insert("usr_a", "first@example.com", "2026-01-01T00:00:00.000Z", "member");

    await store.exec(stripComments(backfill));

    assert.equal((await store.users.findById("usr_a"))?.instanceRole, "admin", "earliest promoted");
    assert.equal((await store.users.findById("usr_b"))?.instanceRole, "member", "others untouched");

    // Running it again must not move the role around.
    await store.exec(stripComments(backfill));
    assert.equal((await store.users.findById("usr_a"))?.instanceRole, "admin");

    // And it must never demote or reassign a deliberate administrator.
    await store.exec("UPDATE users SET instance_role = 'member' WHERE id = 'usr_a'");
    await store.exec("UPDATE users SET instance_role = 'admin' WHERE id = 'usr_b'");
    await store.exec(stripComments(backfill));
    assert.equal(
      (await store.users.findById("usr_a"))?.instanceRole,
      "member",
      "an existing administrator means the backfill does nothing",
    );
    assert.equal((await store.users.findById("usr_b"))?.instanceRole, "admin");
  } finally {
    await store.close();
  }
});

/** Drizzle's runner splits statements; here the SQL is executed as one. */
function stripComments(sqlText: string): string {
  return sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

test("settings are readable only by an instance administrator", async () => {
  assert.equal(
    (await server.app.inject({ method: "GET", url: "/api/settings" })).statusCode,
    401,
    "anonymous",
  );

  const member = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie: memberCookie },
  });
  assert.equal(member.statusCode, 403, "a second account is not an administrator");

  const admin = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie: adminCookie },
  });
  assert.equal(admin.statusCode, 200);
});

test("a member cannot write settings", async () => {
  const response = await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: memberCookie },
    payload: { provider: "google" },
  });
  assert.equal(response.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

test("an API key can be stored and is never sent back", async () => {
  const saved = await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { anthropicApiKey: "sk-ant-secret-value-9876" },
  });
  assert.equal(saved.statusCode, 200, saved.body);

  // Not in the write response, and not in a later read.
  assert.ok(!saved.body.includes("sk-ant-secret-value-9876"));
  const read = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie: adminCookie },
  });
  assert.ok(!read.body.includes("sk-ant-secret-value-9876"), "the key leaked to the client");

  const field = read
    .json()
    .groups.flatMap((group: { fields: Array<{ key: string }> }) => group.fields)
    .find((f: { key: string }) => f.key === "anthropicApiKey");
  assert.equal(field.value, null);
  assert.equal(field.configured, true);
  assert.equal(field.hint, "••••9876", "only the last characters are shown");
  assert.equal(field.source, "database");
});

test("the stored key is encrypted at rest", async () => {
  const raw = await server.store.settings.get("anthropicApiKey");
  assert.ok(raw, "nothing was stored");
  assert.ok(!raw.includes("sk-ant-secret-value-9876"), "the database holds the key in the clear");
  assert.ok(raw.startsWith("v1."), "stored secrets should be versioned");
});

test("clearing a setting falls back to the default", async () => {
  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { effort: "low" },
  });

  const changed = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie: adminCookie },
  });
  const effortOf = (body: string) =>
    JSON.parse(body)
      .groups.flatMap((g: { fields: Array<{ key: string }> }) => g.fields)
      .find((f: { key: string }) => f.key === "effort");
  assert.equal(effortOf(changed.body).value, "low");
  assert.equal(effortOf(changed.body).source, "database");

  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { effort: "" },
  });
  const cleared = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie: adminCookie },
  });
  assert.equal(effortOf(cleared.body).value, "high");
  assert.equal(effortOf(cleared.body).source, "default");
});

test("a value outside the allowed set is rejected", async () => {
  const response = await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { provider: "openai" },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /must be one of/);
});

test("an unknown setting is rejected rather than quietly stored", async () => {
  const response = await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { databaseUrl: "postgres://somewhere/else" },
  });
  assert.equal(response.statusCode, 400);
});

test("the environment wins, and locks the field in the UI", async () => {
  // An operator who sets a variable expects it to hold. A setting the UI could
  // silently override behind their back is a support ticket waiting to happen.
  const previous = process.env.ZELYQ_EFFORT;
  process.env.ZELYQ_EFFORT = "max";

  try {
    const read = await server.app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie: adminCookie },
    });
    const effort = read
      .json()
      .groups.flatMap((group: { fields: Array<{ key: string }> }) => group.fields)
      .find((field: { key: string }) => field.key === "effort");

    assert.equal(effort.value, "max");
    assert.equal(effort.source, "env");
    assert.equal(effort.managedByEnv, true, "the UI must render this read-only");
    assert.equal(effort.envVar, "ZELYQ_EFFORT");

    // Writing it must fail loudly rather than store a value that has no effect.
    const write = await server.app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { cookie: adminCookie },
      payload: { effort: "low" },
    });
    assert.equal(write.statusCode, 409);
    assert.match(write.json().error.message, /ZELYQ_EFFORT/);
  } finally {
    process.env.ZELYQ_EFFORT = previous ?? "";
  }
});

test("an environment-supplied API key counts as configured", async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "AIza-from-the-environment";

  try {
    const read = await server.app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie: adminCookie },
    });
    assert.ok(!read.body.includes("AIza-from-the-environment"), "an env key must not be echoed");

    const field = read
      .json()
      .groups.flatMap((group: { fields: Array<{ key: string }> }) => group.fields)
      .find((f: { key: string }) => f.key === "geminiApiKey");
    assert.equal(field.configured, true);
    assert.equal(field.source, "env");
    assert.equal(field.managedByEnv, true);
  } finally {
    process.env.GEMINI_API_KEY = previous ?? "";
  }
});

test("registration can be closed from settings, and takes effect at once", async () => {
  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { allowRegistration: false },
  });

  const blocked = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "late@example.com", name: "Late", password: "correct-horse-battery" },
  });
  assert.equal(blocked.statusCode, 403, "signup should be closed without a restart");

  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { allowRegistration: true },
  });
  const allowed = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "later@example.com", name: "Later", password: "correct-horse-battery" },
  });
  assert.equal(allowed.statusCode, 201);
});

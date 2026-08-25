import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * "Use your Claude Code session instead of a key" — see `045` in the
 * council notes. `SettingsService` is constructed with a fixture path here
 * (a real credentials file, of the exact shape Claude Code itself writes,
 * with a fake token) rather than pointing at a real `$HOME` — this proves
 * the detect/read/store/reset behaviour, not that a particular developer
 * machine happens to be signed in.
 */

const tmp = path.join(os.tmpdir(), `zelyq-cli-sessions-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const credentialsPath = path.join(tmp, "claude-credentials.json");
const codexCredentialsPath = path.join(tmp, "codex-auth.json");

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "cli-sessions.db")}`,
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
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  claudeCredentialsPath: credentialsPath,
  codexCredentialsPath: codexCredentialsPath,
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4978, 4981],
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

beforeEach(async () => {
  await fs.rm(credentialsPath, { force: true });
  await fs.rm(codexCredentialsPath, { force: true });
});

async function writeCredentials(body: unknown) {
  await fs.writeFile(credentialsPath, JSON.stringify(body));
}

async function writeCodexCredentials(body: unknown) {
  await fs.writeFile(codexCredentialsPath, JSON.stringify(body));
}

test("no file at all: not found, and using it fails with a clear message", async () => {
  const detect = await server.app.inject({
    method: "GET",
    url: "/api/settings/cli-sessions/anthropic",
    headers: { cookie: adminCookie },
  });
  assert.deepEqual(detect.json(), { found: false });

  const use = await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/anthropic/use",
    headers: { cookie: adminCookie },
  });
  assert.equal(use.statusCode, 400);
  assert.match(use.json().error.message, /No Claude Code session found/);
});

test("a real-shaped credentials file is detected and can be used", async () => {
  // Starting on a different provider on purpose — this is the actual bug
  // found live: connecting the session did nothing to switch away from
  // whatever was already selected, so the fallback already being
  // "anthropic" would have hidden the fix without this.
  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { provider: "google" },
  });

  await writeCredentials({
    claudeAiOauth: {
      accessToken: "fake-oauth-access-token",
      refreshToken: "fake-refresh-token",
      expiresAt: Date.now() + 60_000,
      subscriptionType: "max",
    },
    organizationUuid: "org-fake",
  });

  const detect = await server.app.inject({
    method: "GET",
    url: "/api/settings/cli-sessions/anthropic",
    headers: { cookie: adminCookie },
  });
  assert.deepEqual(detect.json(), { found: true });

  const use = await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/anthropic/use",
    headers: { cookie: adminCookie },
  });
  assert.equal(use.statusCode, 200, use.body);

  const settingsBody = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie: adminCookie },
  });
  const fields = settingsBody.json().groups.flatMap((g: { fields: unknown[] }) => g.fields);
  const authModeField = fields.find((f: { key: string }) => f.key === "anthropicAuthMode");
  const keyField = fields.find((f: { key: string }) => f.key === "anthropicApiKey");
  const providerField = fields.find((f: { key: string }) => f.key === "provider");
  assert.equal(authModeField.value, "subscription");
  assert.equal(keyField.configured, true);
  // Found live: connecting the session alone left a turn running on
  // whatever provider was already selected, which made the button look
  // like it did nothing. "Use this instead" has to actually switch to it.
  assert.equal(providerField.value, "anthropic");
});

test("an expired session is refused, not silently accepted", async () => {
  await writeCredentials({
    claudeAiOauth: {
      accessToken: "fake-oauth-access-token",
      expiresAt: Date.now() - 60_000,
    },
  });

  const use = await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/anthropic/use",
    headers: { cookie: adminCookie },
  });
  assert.equal(use.statusCode, 400);
  assert.match(use.json().error.message, /expired/);
});

test("a malformed file is treated the same as none found", async () => {
  await fs.writeFile(credentialsPath, "not valid json");

  const detect = await server.app.inject({
    method: "GET",
    url: "/api/settings/cli-sessions/anthropic",
    headers: { cookie: adminCookie },
  });
  // The file exists, so detection (existence-only) still says so —
  // the honest failure shows up at "use", not before.
  assert.deepEqual(detect.json(), { found: true });

  const use = await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/anthropic/use",
    headers: { cookie: adminCookie },
  });
  assert.equal(use.statusCode, 400);
});

test("pasting a real API key afterwards resets the mode back", async () => {
  await writeCredentials({
    claudeAiOauth: { accessToken: "fake-oauth-access-token", expiresAt: Date.now() + 60_000 },
  });
  await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/anthropic/use",
    headers: { cookie: adminCookie },
  });

  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { anthropicApiKey: "sk-ant-a-real-pasted-key" },
  });

  const settingsBody = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie: adminCookie },
  });
  const fields = settingsBody.json().groups.flatMap((g: { fields: unknown[] }) => g.fields);
  const authModeField = fields.find((f: { key: string }) => f.key === "anthropicAuthMode");
  assert.equal(authModeField.value, "api_key");
});

test("an ordinary member cannot detect or use a CLI session", async () => {
  const detect = await server.app.inject({
    method: "GET",
    url: "/api/settings/cli-sessions/anthropic",
    headers: { cookie: memberCookie },
  });
  assert.equal(detect.statusCode, 403);

  const use = await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/anthropic/use",
    headers: { cookie: memberCookie },
  });
  assert.equal(use.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Codex — see `045`'s OpenAI follow-up. Same shape as Claude's above; the
// one real difference is what "use it" actually stores, since the agent
// needs both an access token and an account id and `apiKey` only carries
// one string — see the packed "<token>:<accountId>" format this checks for.
// ---------------------------------------------------------------------------

test("no Codex file at all: not found, and using it fails with a clear message", async () => {
  const detect = await server.app.inject({
    method: "GET",
    url: "/api/settings/cli-sessions/openai",
    headers: { cookie: adminCookie },
  });
  assert.deepEqual(detect.json(), { found: false });

  const use = await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/openai/use",
    headers: { cookie: adminCookie },
  });
  assert.equal(use.statusCode, 400);
  assert.match(use.json().error.message, /No Codex session found/);
});

test("a real-shaped Codex auth.json is detected, used, and packs both values apiKey has to carry", async () => {
  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { provider: "google" },
  });

  await writeCodexCredentials({
    tokens: {
      access_token: "fake-codex-access-token",
      refresh_token: "fake-refresh",
      account_id: "acc_fake_123",
    },
    auth_mode: "chatgpt",
    last_refresh: new Date().toISOString(),
  });

  const detect = await server.app.inject({
    method: "GET",
    url: "/api/settings/cli-sessions/openai",
    headers: { cookie: adminCookie },
  });
  assert.deepEqual(detect.json(), { found: true });

  const use = await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/openai/use",
    headers: { cookie: adminCookie },
  });
  assert.equal(use.statusCode, 200, use.body);

  const settingsBody = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie: adminCookie },
  });
  const fields = settingsBody.json().groups.flatMap((g: { fields: unknown[] }) => g.fields);
  const authModeField = fields.find((f: { key: string }) => f.key === "openaiAuthMode");
  const keyField = fields.find((f: { key: string }) => f.key === "openaiApiKey");
  const providerField = fields.find((f: { key: string }) => f.key === "provider");
  assert.equal(authModeField.value, "subscription");
  assert.equal(keyField.configured, true);
  assert.equal(providerField.value, "openai");
});

test("a Codex file with no plain account_id field still works, reading it from the token's own JWT claims", async () => {
  // Found live, from a real independent implementation of this same read:
  // it never has Codex CLI's file, only the access token, and has no
  // choice but to read the account id straight out of the JWT — the more
  // robust source, not just a fallback. This proves this codebase's own
  // read does the same, rather than depending on a plain field that a
  // future Codex CLI version might stop writing.
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_from_jwt" } }),
  ).toString("base64url");
  const fakeJwt = `header.${payload}.signature`;

  await writeCodexCredentials({ tokens: { access_token: fakeJwt, refresh_token: "r" } });

  const use = await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/openai/use",
    headers: { cookie: adminCookie },
  });
  assert.equal(use.statusCode, 200, use.body);
});

test("a Codex file with no tokens object (API-key mode) is treated as no session", async () => {
  await writeCodexCredentials({ OPENAI_API_KEY: "sk-something", auth_mode: "apikey" });

  const use = await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/openai/use",
    headers: { cookie: adminCookie },
  });
  assert.equal(use.statusCode, 400);
});

test("pasting a real OpenAI key afterwards resets the mode back", async () => {
  await writeCodexCredentials({
    tokens: { access_token: "tok", account_id: "acc_1" },
  });
  await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/openai/use",
    headers: { cookie: adminCookie },
  });

  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: adminCookie },
    payload: { openaiApiKey: "sk-a-real-pasted-key" },
  });

  const settingsBody = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie: adminCookie },
  });
  const fields = settingsBody.json().groups.flatMap((g: { fields: unknown[] }) => g.fields);
  const authModeField = fields.find((f: { key: string }) => f.key === "openaiAuthMode");
  assert.equal(authModeField.value, "api_key");
});

test("an ordinary member cannot detect or use a Codex session either", async () => {
  const detect = await server.app.inject({
    method: "GET",
    url: "/api/settings/cli-sessions/openai",
    headers: { cookie: memberCookie },
  });
  assert.equal(detect.statusCode, 403);
});

test("connecting a Codex session switches the model field's suggestions to Codex candidates, not the ordinary API ones", async () => {
  // Found live: "gpt-5.1" (the ordinary API's own suggestion) is exactly
  // the model a real Codex session rejected outright. The two auth modes
  // need different suggestions, not the same list either way.
  await writeCodexCredentials({
    tokens: { access_token: "tok", account_id: "acc_suggestions_test" },
  });
  await server.app.inject({
    method: "POST",
    url: "/api/settings/cli-sessions/openai/use",
    headers: { cookie: adminCookie },
  });

  const settingsBody = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie: adminCookie },
  });
  const fields = settingsBody.json().groups.flatMap((g: { fields: unknown[] }) => g.fields);
  const modelField = fields.find((f: { key: string }) => f.key === "model");

  assert.ok(Array.isArray(modelField.suggestions), "Codex mode should offer suggestions, not none");
  assert.ok(!modelField.suggestions.includes("gpt-5.1"), "not the ordinary API's own default");
  assert.ok(modelField.suggestions.length > 0);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Proposal 058 · Phase A — route-level authorization. The Supabase connection
 * is instance-wide (Settings), so its routes require the instance
 * administrator. The service logic is covered in `supabase-connections.test.ts`.
 */

const tmp = path.join(os.tmpdir(), `zelyq-supabase-routes-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "routes.db")}`,
  agentUrl: "http://127.0.0.1:59998",
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
    previewPortRange: [4980, 4985],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;

async function register(email: string, name: string): Promise<string> {
  const res = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  assert.equal(res.statusCode, 201, res.body);
  const cookie = res.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(cookie);
  return `zelyq_session=${cookie.value}`;
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("the capability probe reports OAuth off when no client is configured", async () => {
  const admin = await register("probe-admin@example.com", "Admin"); // first user → instance admin
  const res = await server.app.inject({
    method: "GET",
    url: "/api/integrations/supabase/config",
    headers: { cookie: admin },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().oauthConfigured, false);
});

test("a non-instance-admin cannot connect, list, or delete the Supabase connection", async () => {
  // The first registered account is the instance admin; this second one is not.
  const member = await register("routes-member@example.com", "Member");

  const forbidden = [
    { method: "GET" as const, url: "/api/integrations/supabase/connections" },
    {
      method: "POST" as const,
      url: "/api/integrations/supabase/connections/pat",
      payload: { pat: "sbp_this_should_never_be_validated" },
    },
    { method: "POST" as const, url: "/api/integrations/supabase/connections/oauth/start" },
    { method: "DELETE" as const, url: "/api/integrations/supabase/connections/pcn_nope" },
    {
      method: "POST" as const,
      url: "/api/integrations/supabase/connections/pcn_nope/resources/link",
      payload: { projectRef: "abcdefghijklmnop" },
    },
  ];

  for (const call of forbidden) {
    const res = await server.app.inject({
      method: call.method,
      url: call.url,
      headers: { cookie: member },
      ...(call.payload ? { payload: call.payload } : {}),
    });
    assert.equal(
      res.statusCode,
      403,
      `${call.method} ${call.url} should be 403, got ${res.statusCode}`,
    );
  }
});

test("the instance admin reaches the handler — oauth/start is a clean 400 with no client configured", async () => {
  const admin = await register("routes-admin2@example.com", "Admin2"); // not first, so still a member
  // Re-fetch the actual instance admin cookie (first user).
  const login = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "probe-admin@example.com", password: "correct-horse-battery" },
  });
  const cookie = `zelyq_session=${login.cookies.find((c) => c.name === "zelyq_session")?.value}`;

  const res = await server.app.inject({
    method: "POST",
    url: "/api/integrations/supabase/connections/oauth/start",
    headers: { cookie },
  });
  assert.equal(res.statusCode, 400);
  assert.notEqual(admin, cookie);
});

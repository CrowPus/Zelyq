import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const tmp = path.join(os.tmpdir(), `zelyq-accounts-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const PASSWORD = "correct-horse-battery";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "accounts.db")}`,
  agentUrl: "http://127.0.0.1:59998",
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
    previewPortRange: [4991, 4994],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;

function cookieOf(response: { cookies: Array<{ name: string; value: string }> }): string {
  const session = response.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(session, "expected a session cookie");
  return `zelyq_session=${session.value}`;
}

async function register(email: string): Promise<{ cookie: string; id: string }> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: email.split("@")[0], password: PASSWORD },
  });
  assert.equal(response.statusCode, 201, response.body);
  return { cookie: cookieOf(response), id: response.json().user.id };
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  // The first account owns the instance; everything below is a second user.
  await register("owner@example.com");
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("deleting your own account requires your password", async () => {
  const { cookie } = await register("needs-password@example.com");

  const wrong = await server.app.inject({
    method: "DELETE",
    url: "/api/auth/me",
    headers: { cookie },
    payload: { password: "not-the-password" },
  });
  assert.equal(wrong.statusCode, 401);

  const right = await server.app.inject({
    method: "DELETE",
    url: "/api/auth/me",
    headers: { cookie },
    payload: { password: PASSWORD },
  });
  assert.equal(right.statusCode, 204, right.body);

  // The session dies with the account: the row it pointed at is gone.
  const after = await server.app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie },
  });
  assert.equal(after.statusCode, 401);
});

test("deleting the last member of a team takes the team's projects and files with it", async () => {
  const { cookie } = await register("solo@example.com");

  const created = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "solo project", template: "vite-react" },
  });
  assert.equal(created.statusCode, 201, created.body);
  const projectId = created.json().project.id;
  const root = path.join(config.runtime.workspaceDir, projectId);
  assert.ok(
    await fs.access(root).then(
      () => true,
      () => false,
    ),
    "project directory should exist before the account is deleted",
  );

  const removed = await server.app.inject({
    method: "DELETE",
    url: "/api/auth/me",
    headers: { cookie },
    payload: { password: PASSWORD },
  });
  assert.equal(removed.statusCode, 204, removed.body);

  // Nobody could ever reach these again, so leaving them is a disk leak.
  assert.equal(
    await fs.access(root).then(
      () => true,
      () => false,
    ),
    false,
    "the project directory should be gone",
  );
});

test("the last owner of a shared team is refused rather than stranding it", async () => {
  const { cookie: ownerCookie } = await register("team-owner@example.com");
  await register("team-mate@example.com");

  const team = await server.app.inject({
    method: "POST",
    url: "/api/teams",
    headers: { cookie: ownerCookie },
    payload: { name: "Shared" },
  });
  assert.equal(team.statusCode, 201, team.body);
  const teamId = team.json().team.id;

  await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: { cookie: ownerCookie },
    payload: { email: "team-mate@example.com", role: "editor" },
  });

  const refused = await server.app.inject({
    method: "DELETE",
    url: "/api/auth/me",
    headers: { cookie: ownerCookie },
    payload: { password: PASSWORD },
  });
  assert.equal(refused.statusCode, 409, refused.body);
  assert.match(refused.json().error.message, /last owner/i);
});

test("only an instance administrator may delete somebody else", async () => {
  const { cookie: adminCookie } = await signInAsInstanceOwner();
  const { cookie: aCookie } = await register("victim@example.com");
  const { id: targetId } = await register("target@example.com");

  const byPeer = await server.app.inject({
    method: "DELETE",
    url: `/api/users/${targetId}`,
    headers: { cookie: aCookie },
  });
  assert.equal(byPeer.statusCode, 403, byPeer.body);

  const byAdmin = await server.app.inject({
    method: "DELETE",
    url: `/api/users/${targetId}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(byAdmin.statusCode, 204, byAdmin.body);
});

test("the last instance administrator cannot be deleted", async () => {
  const { cookie } = await signInAsInstanceOwner();
  const response = await server.app.inject({
    method: "DELETE",
    url: "/api/auth/me",
    headers: { cookie },
    payload: { password: PASSWORD },
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.match(response.json().error.message, /last instance administrator/i);
});

async function signInAsInstanceOwner(): Promise<{ cookie: string }> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.com", password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { cookie: cookieOf(response) };
}

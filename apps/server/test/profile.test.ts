import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const tmp = path.join(os.tmpdir(), `zelyq-profile-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const PASSWORD = "correct-horse-battery";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "profile.db")}`,
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
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4986, 4989],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;

function cookieOf(response: { cookies: Array<{ name: string; value: string }> }): string {
  const session = response.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(session, "expected a session cookie");
  return `zelyq_session=${session.value}`;
}

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: PASSWORD },
  });
  assert.equal(response.statusCode, 201, response.body);
  return cookieOf(response);
}

async function signIn(email: string, password: string) {
  return await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
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

test("the display name can be changed without a password", async () => {
  const cookie = await register("rename@example.com", "Old Name");

  const response = await server.app.inject({
    method: "PATCH",
    url: "/api/auth/profile",
    headers: { cookie },
    payload: { name: "New Name" },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().user.name, "New Name");
});

test("changing the email requires the current password", async () => {
  const cookie = await register("move@example.com", "Mover");

  const without = await server.app.inject({
    method: "PATCH",
    url: "/api/auth/profile",
    headers: { cookie },
    payload: { email: "moved@example.com" },
  });
  assert.equal(without.statusCode, 401, "an open session alone must not move the account");

  const wrong = await server.app.inject({
    method: "PATCH",
    url: "/api/auth/profile",
    headers: { cookie },
    payload: { email: "moved@example.com", currentPassword: "not-my-password" },
  });
  assert.equal(wrong.statusCode, 401);

  const right = await server.app.inject({
    method: "PATCH",
    url: "/api/auth/profile",
    headers: { cookie },
    payload: { email: "moved@example.com", currentPassword: PASSWORD },
  });
  assert.equal(right.statusCode, 200, right.body);
  assert.equal(right.json().user.email, "moved@example.com");

  // The new address is the one that signs in.
  assert.equal((await signIn("moved@example.com", PASSWORD)).statusCode, 200);
  assert.equal((await signIn("move@example.com", PASSWORD)).statusCode, 401);
});

test("an email already in use is refused", async () => {
  await register("taken@example.com", "Taken");
  const cookie = await register("other@example.com", "Other");

  const response = await server.app.inject({
    method: "PATCH",
    url: "/api/auth/profile",
    headers: { cookie },
    payload: { email: "taken@example.com", currentPassword: PASSWORD },
  });
  assert.equal(response.statusCode, 409);
  assert.match(response.json().error.message, /already uses that email/);
});

test("the password can be changed, and the old one stops working", async () => {
  const cookie = await register("rotate@example.com", "Rotator");

  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/password",
    headers: { cookie },
    payload: { currentPassword: PASSWORD, newPassword: "a-brand-new-secret" },
  });
  assert.equal(response.statusCode, 200, response.body);

  assert.equal((await signIn("rotate@example.com", PASSWORD)).statusCode, 401, "old password");
  assert.equal((await signIn("rotate@example.com", "a-brand-new-secret")).statusCode, 200, "new");
});

test("a wrong current password is refused", async () => {
  const cookie = await register("careful@example.com", "Careful");

  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/password",
    headers: { cookie },
    payload: { currentPassword: "guessing", newPassword: "some-other-secret" },
  });
  assert.equal(response.statusCode, 401);
  assert.match(response.json().error.message, /current password/);

  // The old password still works: nothing was changed.
  assert.equal((await signIn("careful@example.com", PASSWORD)).statusCode, 200);
});

test("a short password is refused", async () => {
  const cookie = await register("short@example.com", "Short");

  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/password",
    headers: { cookie },
    payload: { currentPassword: PASSWORD, newPassword: "tiny" },
  });
  assert.equal(response.statusCode, 400);
});

test("reusing the same password is refused", async () => {
  const cookie = await register("same@example.com", "Same");

  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/password",
    headers: { cookie },
    payload: { currentPassword: PASSWORD, newPassword: PASSWORD },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /different/);
});

test("changing the password signs out other devices but not this one", async () => {
  // The reason to change a password is usually that someone else knows it.
  // Leaving their session alive would defeat the act.
  const laptop = await register("devices@example.com", "Devices");
  const phone = cookieOf(await signIn("devices@example.com", PASSWORD));

  assert.equal(
    (await server.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: phone } }))
      .statusCode,
    200,
    "the second session should start out valid",
  );

  const changed = await server.app.inject({
    method: "POST",
    url: "/api/auth/password",
    headers: { cookie: laptop },
    payload: { currentPassword: PASSWORD, newPassword: "replacement-secret-value" },
  });
  assert.equal(changed.statusCode, 200);

  assert.equal(
    (await server.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: phone } }))
      .statusCode,
    401,
    "the other session must be revoked",
  );

  // The device that made the change keeps working, on its replacement cookie.
  const replacement = cookieOf(changed);
  assert.equal(
    (
      await server.app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: replacement },
      })
    ).statusCode,
    200,
    "the caller should not be signed out of the device they are using",
  );
});

test("profile endpoints reject anonymous callers", async () => {
  assert.equal(
    (await server.app.inject({ method: "PATCH", url: "/api/auth/profile", payload: { name: "x" } }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await server.app.inject({
        method: "POST",
        url: "/api/auth/password",
        payload: { currentPassword: "a", newPassword: "bbbbbbbbbbbb" },
      })
    ).statusCode,
    401,
  );
});

test("a password is never echoed back", async () => {
  const cookie = await register("echo@example.com", "Echo");
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/password",
    headers: { cookie },
    payload: { currentPassword: PASSWORD, newPassword: "yet-another-secret" },
  });
  assert.ok(!response.body.includes("yet-another-secret"));
  assert.ok(!response.body.includes(PASSWORD));
});

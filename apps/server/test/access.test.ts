import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const tmp = path.join(os.tmpdir(), `zelyq-access-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "access.db")}`,
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
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4990, 4995],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;

/** Signs up an account and returns the cookie its session is carried in. */
async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, `register ${email}: ${response.body}`);
  const cookie = response.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(cookie, "no session cookie was set");
  return `zelyq_session=${cookie.value}`;
}

const as = (cookie: string) => ({ cookie });

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("everything is closed to anonymous callers", async () => {
  for (const [method, url] of [
    ["GET", "/api/projects"],
    ["POST", "/api/projects"],
    ["GET", "/api/teams"],
    ["GET", "/api/projects/prj_x/files"],
    ["GET", "/api/projects/prj_x/preview"],
    ["GET", "/api/projects/prj_x/snapshots"],
  ] as const) {
    const response = await server.app.inject({ method, url, payload: {} });
    assert.equal(response.statusCode, 401, `${method} ${url} should require a session`);
  }
});

test("the first account becomes an owner with a team", async () => {
  const status = await server.app.inject({ method: "GET", url: "/api/auth/status" });
  assert.equal(status.json().firstRun, true);

  const cookie = await register("owner@example.com", "Ada");
  const me = await server.app.inject({ method: "GET", url: "/api/auth/me", headers: as(cookie) });
  const body = me.json();
  assert.equal(body.user.email, "owner@example.com");
  assert.equal(body.teams.length, 1);
  assert.equal(body.teams[0].role, "owner");

  const after = await server.app.inject({ method: "GET", url: "/api/auth/status" });
  assert.equal(after.json().firstRun, false, "first run should be over");
});

test("a password is never stored or returned in the clear", async () => {
  const me = await server.app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: as(await register("hash@example.com", "Grace")),
  });
  assert.ok(!me.body.includes("correct-horse-battery"));
  assert.ok(!me.body.toLowerCase().includes("passwordhash"));
});

test("sign-in rejects a wrong password and accepts the right one", async () => {
  await register("login@example.com", "Alan");

  const wrong = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "login@example.com", password: "not-the-password" },
  });
  assert.equal(wrong.statusCode, 401);
  // The message must not distinguish "no such account" from "wrong password".
  assert.match(wrong.json().error.message, /Incorrect email or password/);

  const right = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "login@example.com", password: "correct-horse-battery" },
  });
  assert.equal(right.statusCode, 200);
});

test("an unknown email fails exactly like a wrong password", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "nobody@example.com", password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 401);
  assert.match(response.json().error.message, /Incorrect email or password/);
});

test("signing out invalidates the session immediately", async () => {
  const cookie = await register("bye@example.com", "Edsger");
  assert.equal(
    (await server.app.inject({ method: "GET", url: "/api/auth/me", headers: as(cookie) }))
      .statusCode,
    200,
  );

  await server.app.inject({ method: "POST", url: "/api/auth/logout", headers: as(cookie) });

  assert.equal(
    (await server.app.inject({ method: "GET", url: "/api/auth/me", headers: as(cookie) }))
      .statusCode,
    401,
  );
});

test("a forged or stale cookie is not a session", async () => {
  const response = await server.app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: as("zelyq_session=made-up-token-value"),
  });
  assert.equal(response.statusCode, 401);
});

test("projects are visible only to members of their team", async () => {
  const alice = await register("alice@example.com", "Alice");
  const mallory = await register("mallory@example.com", "Mallory");

  const created = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: as(alice),
    payload: { name: "Alice's app" },
  });
  assert.equal(created.statusCode, 201);
  const projectId = created.json().project.id;

  const mine = await server.app.inject({ method: "GET", url: "/api/projects", headers: as(alice) });
  assert.ok(mine.json().projects.some((p: { id: string }) => p.id === projectId));

  const theirs = await server.app.inject({
    method: "GET",
    url: "/api/projects",
    headers: as(mallory),
  });
  assert.equal(
    theirs.json().projects.filter((p: { id: string }) => p.id === projectId).length,
    0,
    "another user's project must not be listed",
  );

  // Direct access reports "not found" rather than "forbidden": confirming the
  // project exists would itself be a leak.
  const direct = await server.app.inject({
    method: "GET",
    url: `/api/projects/${projectId}`,
    headers: as(mallory),
  });
  assert.equal(direct.statusCode, 404);

  for (const [method, url] of [
    ["GET", `/api/projects/${projectId}/files`],
    ["GET", `/api/projects/${projectId}/files/package.json`],
    ["PUT", `/api/projects/${projectId}/files/evil.txt`],
    ["POST", `/api/projects/${projectId}/preview/start`],
    ["POST", `/api/projects/${projectId}/snapshots`],
    ["DELETE", `/api/projects/${projectId}`],
  ] as const) {
    const response = await server.app.inject({
      method,
      url,
      headers: as(mallory),
      payload: { content: "x" },
    });
    assert.equal(response.statusCode, 404, `${method} ${url} leaked to a non-member`);
  }
});

test("a viewer can read but cannot change anything", async () => {
  const owner = await register("lead@example.com", "Lead");
  const viewer = await register("viewer@example.com", "Viewer");

  const teams = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: as(owner) })
  ).json().teams;
  const teamId = teams[0].id;

  const added = await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: as(owner),
    payload: { email: "viewer@example.com", role: "viewer" },
  });
  assert.equal(added.statusCode, 201);

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: as(owner),
      payload: { name: "Shared app", teamId },
    })
  ).json().project;

  // Reads succeed.
  assert.equal(
    (
      await server.app.inject({
        method: "GET",
        url: `/api/projects/${project.id}`,
        headers: as(viewer),
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await server.app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/files`,
        headers: as(viewer),
      })
    ).statusCode,
    200,
  );

  // Writes are refused, and say why.
  const write = await server.app.inject({
    method: "PUT",
    url: `/api/projects/${project.id}/files/notes.md`,
    headers: as(viewer),
    payload: { content: "nope" },
  });
  assert.equal(write.statusCode, 403);
  assert.equal(write.json().error.code, "forbidden");
  assert.match(write.json().error.message, /editor/);

  for (const [method, url] of [
    ["POST", `/api/projects/${project.id}/preview/start`],
    ["POST", `/api/projects/${project.id}/snapshots`],
    ["PATCH", `/api/projects/${project.id}`],
    ["DELETE", `/api/projects/${project.id}`],
  ] as const) {
    const response = await server.app.inject({ method, url, headers: as(viewer), payload: {} });
    assert.equal(response.statusCode, 403, `${method} ${url} should be refused for a viewer`);
  }
});

test("an editor can write but cannot manage members or delete the project", async () => {
  const owner = await register("boss@example.com", "Boss");
  await register("dev@example.com", "Dev");

  const teamId = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: as(owner) })
  ).json().teams[0].id;

  await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: as(owner),
    payload: { email: "dev@example.com", role: "editor" },
  });

  const dev = `zelyq_session=${
    (
      await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "dev@example.com", password: "correct-horse-battery" },
      })
    ).cookies.find((c) => c.name === "zelyq_session")!.value
  }`;

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: as(dev),
      payload: { name: "Editor app", teamId },
    })
  ).json().project;

  const write = await server.app.inject({
    method: "PUT",
    url: `/api/projects/${project.id}/files/notes.md`,
    headers: as(dev),
    payload: { content: "allowed" },
  });
  assert.equal(write.statusCode, 200);

  const addMember = await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: as(dev),
    payload: { email: "boss@example.com", role: "viewer" },
  });
  assert.equal(addMember.statusCode, 403);

  const remove = await server.app.inject({
    method: "DELETE",
    url: `/api/projects/${project.id}`,
    headers: as(dev),
  });
  assert.equal(remove.statusCode, 403);
});

test("nobody can grant a role above their own", async () => {
  const owner = await register("chief@example.com", "Chief");
  await register("admin@example.com", "Admin");
  await register("third@example.com", "Third");

  const teamId = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: as(owner) })
  ).json().teams[0].id;

  await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: as(owner),
    payload: { email: "admin@example.com", role: "admin" },
  });

  const admin = `zelyq_session=${
    (
      await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "admin@example.com", password: "correct-horse-battery" },
      })
    ).cookies.find((c) => c.name === "zelyq_session")!.value
  }`;

  const escalate = await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: as(admin),
    payload: { email: "third@example.com", role: "owner" },
  });
  assert.equal(escalate.statusCode, 403, "an admin must not be able to mint an owner");
});

test("the last owner cannot be demoted or removed", async () => {
  const owner = await register("solo@example.com", "Solo");
  const me = (
    await server.app.inject({ method: "GET", url: "/api/auth/me", headers: as(owner) })
  ).json();
  const teamId = me.teams[0].id;

  const demote = await server.app.inject({
    method: "PATCH",
    url: `/api/teams/${teamId}/members/${me.user.id}`,
    headers: as(owner),
    payload: { role: "viewer" },
  });
  assert.equal(demote.statusCode, 409);
  assert.match(demote.json().error.message, /last owner/);

  const remove = await server.app.inject({
    method: "DELETE",
    url: `/api/teams/${teamId}/members/${me.user.id}`,
    headers: as(owner),
  });
  assert.equal(remove.statusCode, 409);
});

test("team membership is not visible to outsiders", async () => {
  const inside = await register("inside@example.com", "Inside");
  const outside = await register("outside@example.com", "Outside");

  const teamId = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: as(inside) })
  ).json().teams[0].id;

  const response = await server.app.inject({
    method: "GET",
    url: `/api/teams/${teamId}/members`,
    headers: as(outside),
  });
  assert.equal(response.statusCode, 404);
});

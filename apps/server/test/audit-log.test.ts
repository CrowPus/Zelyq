import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const tmp = path.join(os.tmpdir(), `zelyq-audit-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "audit.db")}`,
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
    previewPortRange: [4996, 4999],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;

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

async function auditLog(teamId: string, cookie: string) {
  const response = await server.app.inject({
    method: "GET",
    url: `/api/teams/${teamId}/audit-log`,
    headers: as(cookie),
  });
  return response;
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

test("every audited action produces exactly one entry, with the right actor and detail", async () => {
  const owner = await register("lead@example.com", "Lead");
  const dev = await register("dev@example.com", "Dev");

  const teamId = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: as(owner) })
  ).json().teams[0].id;

  const addMember = await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: as(owner),
    payload: { email: "dev@example.com", role: "editor" },
  });
  assert.equal(addMember.statusCode, 201);

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: as(owner),
      payload: { name: "Shared app", teamId },
    })
  ).json().project;

  const write = await server.app.inject({
    method: "PUT",
    url: `/api/projects/${project.id}/files/notes.md`,
    headers: as(dev),
    payload: { content: "hello" },
  });
  assert.equal(write.statusCode, 200);

  const snapshot = (
    await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/snapshots`,
      headers: as(dev),
      payload: { label: "Checkpoint" },
    })
  ).json().snapshot;

  const restore = await server.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/snapshots/${snapshot.id}/restore`,
    headers: as(dev),
  });
  assert.equal(restore.statusCode, 200);

  const del = await server.app.inject({
    method: "DELETE",
    url: `/api/projects/${project.id}/files/notes.md`,
    headers: as(dev),
  });
  assert.equal(del.statusCode, 204);

  const update = await server.app.inject({
    method: "PATCH",
    url: `/api/projects/${project.id}`,
    headers: as(owner),
    payload: { name: "Renamed app" },
  });
  assert.equal(update.statusCode, 200);

  const roleChange = await server.app.inject({
    method: "PATCH",
    url: `/api/teams/${teamId}/members/${(await server.app.inject({ method: "GET", url: "/api/auth/me", headers: as(dev) })).json().user.id}`,
    headers: as(owner),
    payload: { role: "admin" },
  });
  assert.equal(roleChange.statusCode, 200);

  const entries = (await auditLog(teamId, owner)).json().entries;
  const actions = entries.map((entry: { action: string }) => entry.action).reverse();
  assert.deepEqual(actions, [
    "team.member_added",
    "project.created",
    "file.written",
    "snapshot.created",
    "snapshot.restored",
    "file.deleted",
    "project.updated",
    "team.member_role_changed",
  ]);

  const fileWritten = entries.find((entry: { action: string }) => entry.action === "file.written");
  assert.equal(fileWritten.actorEmail, "dev@example.com");
  assert.deepEqual(fileWritten.detail, { path: "notes.md" });
  assert.equal(fileWritten.projectId, project.id);
  assert.equal(fileWritten.teamId, teamId);
});

test("a rejected mutation produces no audit entry", async () => {
  const owner = await register("owner2@example.com", "Owner");
  const viewer = await register("viewer2@example.com", "Viewer");

  const teamId = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: as(owner) })
  ).json().teams[0].id;
  await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: as(owner),
    payload: { email: "viewer2@example.com", role: "viewer" },
  });

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: as(owner),
      payload: { name: "Locked down", teamId },
    })
  ).json().project;

  const before = (await auditLog(teamId, owner)).json().entries.length;

  const refused = await server.app.inject({
    method: "PUT",
    url: `/api/projects/${project.id}/files/notes.md`,
    headers: as(viewer),
    payload: { content: "nope" },
  });
  assert.equal(refused.statusCode, 403, "a viewer cannot write a file");

  const after = (await auditLog(teamId, owner)).json().entries.length;
  assert.equal(after, before, "a refused write must not produce an audit entry");
});

test("the audit log itself requires admin or higher", async () => {
  const owner = await register("owner3@example.com", "Owner");
  const editor = await register("editor3@example.com", "Editor");

  const teamId = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: as(owner) })
  ).json().teams[0].id;
  await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: as(owner),
    payload: { email: "editor3@example.com", role: "editor" },
  });

  assert.equal((await auditLog(teamId, editor)).statusCode, 403);
  assert.equal((await auditLog(teamId, owner)).statusCode, 200);
});

test("an entry survives after the project it names is deleted", async () => {
  const owner = await register("owner4@example.com", "Owner");
  const teamId = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: as(owner) })
  ).json().teams[0].id;

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: as(owner),
      payload: { name: "Temporary", teamId },
    })
  ).json().project;

  const deleted = await server.app.inject({
    method: "DELETE",
    url: `/api/projects/${project.id}`,
    headers: as(owner),
  });
  assert.equal(deleted.statusCode, 204);

  const entries = (await auditLog(teamId, owner)).json().entries;
  const deletion = entries.find(
    (entry: { action: string; projectId: string }) =>
      entry.action === "project.deleted" && entry.projectId === project.id,
  );
  assert.ok(deletion, "the project.deleted entry must exist and still name the deleted project");
});

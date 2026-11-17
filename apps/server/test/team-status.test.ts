import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * A team's status: paused (unused; its owner resumes it), read-only (nothing
 * new made or run), suspended (closed). What each stops, what still works,
 * last activity, and deleting a whole team through the admin API.
 */

const tmp = path.join(os.tmpdir(), `zelyq-team-status-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

let server: ZelyqServer;
let adminCookie = "";
let key = "";
const owner = { cookie: "", teamId: "", userId: "" };
const editor = { cookie: "", userId: "" };
let appId = "";
let agentKey = "";

function cookieOf(response: { cookies: Array<{ name: string; value: string }> }): string {
  const session = response.cookies.find((c) => c.name === "zelyq_session")!;
  return `zelyq_session=${session.value}`;
}

async function register(email: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: email.split("@")[0], password: "a-long-password-1" },
  });
  assert.equal(response.statusCode, 201, response.body);
  return { cookie: cookieOf(response), body: response.json() };
}

const as = (
  cookie: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const admin = (method: "GET" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url: `/api/admin/v1${url}`,
    headers: { authorization: `Bearer ${key}` },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

async function setStatus(teamId: string, body: Record<string, string>) {
  const response = await admin("PUT", `/teams/${teamId}/status`, body);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  const config = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "zelyq.db")}`,
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
      previewPortRange: [4979, 4981],
      previewHost: "127.0.0.1",
    },
  } as ServerConfig;
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  adminCookie = (await register("admin@example.com")).cookie;
  key = (
    await as(adminCookie, "POST", "/api/admin-keys", { name: "Cloud", scopes: ["teams"] })
  ).json().key;

  const ama = await register("ama@example.com");
  owner.cookie = ama.cookie;
  owner.teamId = ama.body.teams[0].id;
  owner.userId = ama.body.user.id;
  const kofi = await register("kofi@example.com");
  editor.cookie = kofi.cookie;
  editor.userId = kofi.body.user.id;
  const added = await as(owner.cookie, "POST", `/api/teams/${owner.teamId}/members`, {
    email: "kofi@example.com",
    role: "editor",
  });
  assert.ok(added.statusCode < 300, added.body);

  const app = await as(owner.cookie, "POST", "/api/projects", {
    name: "Shop",
    teamId: owner.teamId,
  });
  assert.equal(app.statusCode, 201, app.body);
  appId = app.json().project.id;

  const agent = await as(owner.cookie, "POST", `/api/teams/${owner.teamId}/agents`, {
    name: "Claude Code",
  });
  assert.equal(agent.statusCode, 201, agent.body);
  agentKey = agent.json().key;
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

test("a new team is active, and its last activity is known", async () => {
  const team = (await admin("GET", `/teams?limit=500`))
    .json()
    .teams.find((entry: { id: string }) => entry.id === owner.teamId);
  assert.equal(team.status, "active");
  assert.ok(team.lastActiveAt);
  const me = (await as(owner.cookie, "GET", "/api/auth/me")).json();
  assert.equal(me.teams[0].status, "active");
});

test("a person's call into the team marks it used, and the person seen", async () => {
  await server.store.teams.touch(owner.teamId, "2020-01-01T00:00:00.000Z");
  // A fresh process would write at once; this one wrote within ten minutes, so force a new write.
  await server.teamStatus.touch(owner.teamId, owner.userId, true);
  const state = await server.store.teams.stateOf(owner.teamId);
  assert.ok(state!.lastActiveAt! > "2026-01-01", state!.lastActiveAt!);
  assert.ok(await server.store.users.lastSeenOf(owner.userId));
});

test("paused: its members can look and clear, not make or run; the owner resumes it", async () => {
  const stopped: string[] = [];
  const realStop = server.teamStatus.stopPreview;
  server.teamStatus.stopPreview = async (projectId) => {
    stopped.push(projectId);
  };
  const paused = await setStatus(owner.teamId, { status: "paused", reason: "unused" });
  assert.equal(paused.status, "paused");
  assert.equal(paused.statusReason, "unused");
  assert.deepEqual(stopped, [appId], "its previews were stopped");
  server.teamStatus.stopPreview = realStop;

  const me = (await as(owner.cookie, "GET", "/api/auth/me")).json();
  assert.equal(me.teams[0].status, "paused");
  assert.equal(
    me.teams[0].statusMessage,
    null,
    "no message of its own: the screen says the plain one",
  );

  // Looking still works.
  assert.equal((await as(owner.cookie, "GET", `/api/projects/${appId}`)).statusCode, 200);
  assert.equal(
    (await as(editor.cookie, "GET", `/api/teams/${owner.teamId}/members`)).statusCode,
    200,
  );

  // Making and running do not.
  const made = await as(owner.cookie, "POST", "/api/projects", {
    name: "Another",
    teamId: owner.teamId,
  });
  assert.equal(made.statusCode, 403);
  assert.equal(made.json().error.details.reason, "team_paused");
  const preview = await as(owner.cookie, "POST", `/api/projects/${appId}/preview/start`);
  assert.equal(preview.statusCode, 403);
  const renamed = await as(owner.cookie, "PATCH", `/api/projects/${appId}`, { name: "Renamed" });
  assert.equal(renamed.statusCode, 403);

  // Clearing still works.
  const freed = await as(owner.cookie, "POST", `/api/projects/${appId}/free-space`, { look: true });
  assert.equal(freed.statusCode, 200, freed.body);

  // An outside agent is not let in.
  const outside = await server.app.inject({
    method: "POST",
    url: "/agent-gateway/mcp",
    headers: { authorization: `Bearer ${agentKey}`, "content-type": "application/json" },
    payload: "{}",
  });
  assert.equal(outside.statusCode, 403, outside.body);

  // Only the owner (or a team admin) resumes it.
  assert.equal(
    (await as(editor.cookie, "POST", `/api/teams/${owner.teamId}/resume`)).statusCode,
    403,
  );
  const resumed = await as(owner.cookie, "POST", `/api/teams/${owner.teamId}/resume`);
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.equal(resumed.json().status, "active");
  const log = await server.store.auditLog.listForTeam(owner.teamId);
  assert.ok(log.some((entry) => entry.action === "team.resumed" && entry.userId === owner.userId));

  const again = await as(owner.cookie, "PATCH", `/api/projects/${appId}`, { name: "Renamed" });
  assert.equal(again.statusCode, 200, again.body);
});

test("read-only: the same limits, but the owner cannot lift it", async () => {
  await setStatus(owner.teamId, {
    status: "read_only",
    reason: "cancelled",
    message: "Your plan ended. Choose a plan to build again.",
  });
  const made = await as(owner.cookie, "POST", "/api/projects", {
    name: "Another",
    teamId: owner.teamId,
  });
  assert.equal(made.statusCode, 403);
  assert.equal(made.json().error.message, "Your plan ended. Choose a plan to build again.");
  assert.equal((await as(owner.cookie, "GET", `/api/projects/${appId}`)).statusCode, 200);
  const resume = await as(owner.cookie, "POST", `/api/teams/${owner.teamId}/resume`);
  assert.equal(resume.statusCode, 403);
  assert.equal(resume.json().error.details.reason, "team_read_only");
});

test("suspended: closed to its members, even for looking; the server's admin still gets in", async () => {
  await setStatus(owner.teamId, {
    status: "suspended",
    reason: "abuse",
    message: "Suspended for crypto mining.",
  });
  const look = await as(owner.cookie, "GET", `/api/projects/${appId}`);
  assert.equal(look.statusCode, 403);
  assert.equal(look.json().error.message, "Suspended for crypto mining.");
  assert.equal(
    (await as(editor.cookie, "GET", `/api/teams/${owner.teamId}/members`)).statusCode,
    403,
  );
  // Their own account and other teams are not affected.
  assert.equal((await as(owner.cookie, "GET", "/api/auth/me")).statusCode, 200);
  // The server's administrator is not held by the status (support has to look),
  // once they are in the team at all: membership rules are unchanged.
  const adminUser = (await as(adminCookie, "GET", "/api/auth/me")).json().user;
  await server.store.teams.addMember(owner.teamId, adminUser.id, "viewer");
  assert.equal((await as(adminCookie, "GET", `/api/projects/${appId}`)).statusCode, 200);
  await server.store.teams.removeMember(owner.teamId, adminUser.id);

  await setStatus(owner.teamId, { status: "active" });
  assert.equal((await as(owner.cookie, "GET", `/api/projects/${appId}`)).statusCode, 200);
  const state = (await admin("GET", `/teams/${owner.teamId}`)).json();
  assert.equal(state.status, "active");
  assert.equal(state.statusReason, null);
  assert.equal(state.statusMessage, null);
});

test("teams can be found by status, and by how long nobody used them", async () => {
  const quiet = await register("quiet@example.com");
  const quietTeam = quiet.body.teams[0].id;
  await server.store.teams.touch(quietTeam, "2025-01-01T00:00:00.000Z");
  const unused = (await admin("GET", "/teams?inactiveSince=2025-06-01")).json().teams;
  assert.ok(unused.some((team: { id: string }) => team.id === quietTeam));
  assert.ok(!unused.some((team: { id: string }) => team.id === owner.teamId));

  await setStatus(quietTeam, { status: "paused", reason: "unused" });
  const paused = (await admin("GET", "/teams?status=paused")).json().teams;
  assert.deepEqual(
    paused.map((team: { id: string }) => team.id),
    [quietTeam],
  );
  assert.equal((await admin("GET", "/teams?status=sleeping")).statusCode, 400);
  // The usage call is filtered the same way, for the daily run.
  const usage = (
    await server.app.inject({
      method: "GET",
      url: "/api/admin/v1/usage?status=paused",
      headers: { authorization: `Bearer ${key}` },
    })
  ).statusCode;
  assert.equal(usage, 403, "this key has only the teams scope");
});

test("deleting a whole team: never while active; look first; then it and its apps are gone", async () => {
  const refused = await admin("DELETE", `/teams/${owner.teamId}`);
  assert.equal(refused.statusCode, 409);
  assert.ok(await server.store.projects.findById(appId), "nothing was touched");

  await setStatus(owner.teamId, { status: "paused", reason: "unused" });
  const looked = (await admin("DELETE", `/teams/${owner.teamId}?look=1`)).json();
  assert.equal(looked.deleted, false);
  assert.equal(looked.apps, 1);
  assert.equal(looked.members, 2);
  assert.ok(await server.store.teams.findById(owner.teamId));

  const deleted = await admin("DELETE", `/teams/${owner.teamId}`);
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(deleted.json().deleted, true);
  assert.equal(await server.store.teams.findById(owner.teamId), null);
  assert.equal(await server.store.projects.findById(appId), null);
  // The people stay; they were members, not the team.
  assert.ok(await server.store.users.findById(owner.userId));
});

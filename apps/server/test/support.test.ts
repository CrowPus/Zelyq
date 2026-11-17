import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Support (facts and logs; inside an app only with the team's permission,
 * and every look shown to the team), feature switches, and the audit log.
 */

const tmp = path.join(os.tmpdir(), `zelyq-support-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

let server: ZelyqServer;
let adminCookie = "";
let key = "";
const owner = { cookie: "", id: "", teamId: "" };
const editor = { cookie: "", id: "" };
const other = { cookie: "", id: "", teamId: "" };
let appId = "";
let otherAppId = "";

const as = (cookie: string, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const admin = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  withKey = key,
) =>
  server.app.inject({
    method,
    url: `/api/admin/v1${url}`,
    headers: { authorization: `Bearer ${withKey}` },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

async function register(email: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: email.split("@")[0], password: "a-long-password-1" },
  });
  assert.equal(response.statusCode, 201, response.body);
  const session = response.cookies.find((c) => c.name === "zelyq_session")!;
  return {
    cookie: `zelyq_session=${session.value}`,
    id: response.json().user.id as string,
    teamId: response.json().teams[0].id as string,
  };
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
      previewPortRange: [4988, 4989],
      previewHost: "127.0.0.1",
    },
  } as ServerConfig;
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  adminCookie = (await register("admin@example.com")).cookie;
  key = (
    await as(adminCookie, "POST", "/api/admin-keys", {
      name: "Help desk",
      scopes: ["support", "features", "audit", "plans", "teams"],
    })
  ).json().key;
  Object.assign(owner, await register("ama@example.com"));
  Object.assign(editor, await register("kofi@example.com"));
  Object.assign(other, await register("efua@example.com"));
  await as(owner.cookie, "POST", `/api/teams/${owner.teamId}/members`, {
    email: "kofi@example.com",
    role: "editor",
  });
  appId = (await as(owner.cookie, "POST", "/api/projects", { name: "Shop" })).json().project.id;
  otherAppId = (await as(other.cookie, "POST", "/api/projects", { name: "Other" })).json().project
    .id;
  await server.store.productEvents.record({
    id: newId("productEvent"),
    name: "preview.failed",
    userId: owner.id,
    teamId: owner.teamId,
    projectId: appId,
    detail: { reason: "runtime_unavailable" },
    createdAt: new Date().toISOString(),
  });
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

test("support sees a team's facts: members, apps, what failed lately", async () => {
  const response = await admin("GET", `/support/teams/${owner.teamId}`);
  assert.equal(response.statusCode, 200, response.body);
  const facts = response.json();
  assert.equal(facts.team.memberList.length, 2);
  assert.deepEqual(
    facts.apps.map((app: { name: string }) => app.name),
    ["Shop"],
  );
  assert.ok(
    facts.lastWeek.failures.some((failure: { what: string }) => failure.what === "preview.failed"),
  );
  assert.equal(facts.access, null);
  const logs = await admin("GET", `/support/teams/${owner.teamId}/apps/${appId}/logs`);
  assert.equal(logs.statusCode, 200, logs.body);
  assert.equal(typeof logs.json().logs, "string");
});

test("inside an app only with the team's permission, given by its admin, and every look is shown", async () => {
  const refused = await admin("GET", `/support/teams/${owner.teamId}/apps/${appId}/files`);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().error.details.reason, "no_support_access");

  assert.equal(
    (await as(editor.cookie, "POST", `/api/teams/${owner.teamId}/support-access`, {})).statusCode,
    403,
  );
  const given = await as(owner.cookie, "POST", `/api/teams/${owner.teamId}/support-access`, {
    hours: 48,
  });
  assert.equal(given.statusCode, 200, given.body);
  const until = Date.parse(given.json().access.until);
  assert.ok(until > Date.now() + 47 * 3_600_000 && until < Date.now() + 49 * 3_600_000);

  const files = await admin("GET", `/support/teams/${owner.teamId}/apps/${appId}/files`);
  assert.equal(files.statusCode, 200, files.body);
  assert.ok(files.json().entries.length > 0);
  const file = await admin(
    "GET",
    `/support/teams/${owner.teamId}/apps/${appId}/file?path=package.json`,
  );
  assert.equal(file.statusCode, 200, file.body);

  const log = await server.store.auditLog.listForTeam(owner.teamId);
  const looks = log.filter((entry) => entry.action === "support.looked");
  assert.equal(looks.length, 2);
  assert.equal(looks[0]!.actorName, 'Support (admin key "Help desk")');
  assert.ok(
    log.some((entry) => entry.action === "support.access_given" && entry.userId === owner.id),
  );

  // Another team's app is never reached through this one's permission.
  assert.equal(
    (await admin("GET", `/support/teams/${owner.teamId}/apps/${otherAppId}/files`)).statusCode,
    404,
  );

  await as(owner.cookie, "DELETE", `/api/teams/${owner.teamId}/support-access`);
  assert.equal(
    (await admin("GET", `/support/teams/${owner.teamId}/apps/${appId}/files`)).statusCode,
    403,
  );
});

test("a permission runs out by itself", async () => {
  await server.store.settings.set(
    `team:${owner.teamId}:support-access`,
    JSON.stringify({ until: new Date(Date.now() - 1000).toISOString(), by: "ama@example.com" }),
  );
  assert.equal(
    (await admin("GET", `/support/teams/${owner.teamId}/apps/${appId}/files`)).statusCode,
    403,
  );
});

test("a feature switched off is gone: refused, and hidden from the screens", async () => {
  const off = await admin("PUT", "/features/pipelines", { enabled: false });
  assert.equal(off.statusCode, 200, off.body);
  const list = await as(owner.cookie, "GET", `/api/teams/${owner.teamId}/pipelines`);
  assert.equal(list.statusCode, 403);
  assert.equal(list.json().error.details.reason, "feature_off");
  assert.match(list.json().error.message, /Pipelines is switched off/);
  const me = (await as(owner.cookie, "GET", "/api/auth/me")).json();
  assert.ok(me.teams[0].switchedOff.includes("pipelines"));

  await admin("DELETE", "/features/pipelines");
  assert.equal(
    (await as(owner.cookie, "GET", `/api/teams/${owner.teamId}/pipelines`)).statusCode,
    200,
  );
});

test("switched on for one plan, one team or one person: the most specific rule wins", async () => {
  await admin("PUT", "/plans", {
    plans: [
      { id: "free", name: "Free", limits: {} },
      { id: "pro", name: "Pro", limits: {} },
    ],
    defaultPlan: "free",
  });
  await admin("PUT", `/teams/${owner.teamId}/plan`, { plan: "pro" });
  await admin("PUT", "/features/ops", {
    enabled: false,
    plans: { pro: true },
    people: { [editor.id]: false },
  });
  const opsOf = (who: { cookie: string }, teamId: string) =>
    as(who.cookie, "GET", `/api/teams/${teamId}/ops/status`).then(
      (r) => r.json().error?.details?.reason,
    );
  assert.notEqual(await opsOf(owner, owner.teamId), "feature_off", "Pro team: on");
  assert.equal(await opsOf(editor, owner.teamId), "feature_off", "this person: off, even on Pro");
  assert.equal(await opsOf(other, other.teamId), "feature_off", "Free team: off");
  await admin("PUT", "/features/ops", { enabled: false, teams: { [other.teamId]: true } });
  assert.notEqual(await opsOf(other, other.teamId), "feature_off", "this team: on");
  assert.equal((await admin("PUT", "/features/teleport", { enabled: false })).statusCode, 404);
  const listed = (await admin("GET", "/features")).json().features;
  assert.ok(
    listed.some(
      (feature: { name: string; enabled: boolean }) => feature.name === "ops" && !feature.enabled,
    ),
  );
  await admin("DELETE", "/features/ops");
});

test("outside agents switched off let no agent in", async () => {
  const made = await as(owner.cookie, "POST", `/api/teams/${owner.teamId}/agents`, {
    name: "Codex",
  });
  assert.equal(made.statusCode, 201, made.body);
  await admin("PUT", "/features/outside_agents", { enabled: false });
  const call = await server.app.inject({
    method: "POST",
    url: "/agent-gateway/mcp",
    headers: { authorization: `Bearer ${made.json().key}`, "content-type": "application/json" },
    payload: "{}",
  });
  assert.equal(call.statusCode, 403, call.body);
  await admin("DELETE", "/features/outside_agents");
});

test("the audit log, by team, by kind, or everything lately", async () => {
  const byTeam = (await admin("GET", `/audit?team=${owner.teamId}`)).json().entries;
  assert.ok(byTeam.some((entry: { action: string }) => entry.action === "support.looked"));
  const byAction = (await admin("GET", "/audit?action=support.access_given")).json().entries;
  assert.ok(byAction.length >= 1);
  const recent = (await admin("GET", "/audit?limit=5")).json().entries;
  assert.equal(recent.length, 5);
});

test("each part needs its scope", async () => {
  const narrow = (
    await as(adminCookie, "POST", "/api/admin-keys", {
      name: "Numbers only",
      scopes: ["analytics"],
    })
  ).json().key;
  assert.equal(
    (await admin("GET", `/support/teams/${owner.teamId}`, undefined, narrow)).statusCode,
    403,
  );
  assert.equal((await admin("GET", "/features", undefined, narrow)).statusCode, 403);
  assert.equal((await admin("GET", "/audit", undefined, narrow)).statusCode, 403);
});

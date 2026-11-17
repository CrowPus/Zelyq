import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId } from "@zelyq/core";
import { createStore, runMigrations, type Store } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { AccessControl } from "../src/services/access.js";
import { MailService } from "../src/services/mail.js";
import { SecretBox } from "../src/services/secrets.js";
import { SettingsService } from "../src/services/settings.js";
import { SupabaseConnectionService } from "../src/services/supabase-connections.js";

/**
 * A team's own email and its own integrations (Team settings): on a server where
 * the operator provides neither, each team brings its own, and nothing of one
 * team's ever reaches another, or the server's.
 */

const tmp = path.join(os.tmpdir(), `zelyq-team-integrations-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const secrets = new SecretBox(randomBytes(32));
let store: Store;
let server: ZelyqServer;
const owner = { cookie: "", teamId: "" };
const editor = { cookie: "" };

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
    teamId: response.json().teams[0].id as string,
  };
}

const as = (
  cookie: string,
  method: "GET" | "PUT" | "POST" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

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
      previewPortRange: [4990, 4991],
      previewHost: "127.0.0.1",
    },
  } as ServerConfig;
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  await register("admin@example.com");
  Object.assign(owner, await register("ama@example.com"));
  Object.assign(editor, await register("kofi@example.com"));
  await as(owner.cookie, "POST", `/api/teams/${owner.teamId}/members`, {
    email: "kofi@example.com",
    role: "editor",
  });
  store = createStore(`file:${path.join(tmp, "zelyq.db")}`);
});

after(async () => {
  await store.close();
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

const MAIL = {
  host: "smtp.ama.example",
  port: 587,
  security: "starttls",
  username: "hello@ama.example",
  password: "ama-smtp-password",
  from: "Ama <hello@ama.example>",
};

test("a team's email: its admin sets it; members see it, never the password", async () => {
  assert.equal(
    (await as(owner.cookie, "GET", `/api/teams/${owner.teamId}/mail`)).json().mail,
    null,
  );
  assert.equal(
    (await as(editor.cookie, "PUT", `/api/teams/${owner.teamId}/mail`, MAIL)).statusCode,
    403,
  );

  const saved = await as(owner.cookie, "PUT", `/api/teams/${owner.teamId}/mail`, MAIL);
  assert.equal(saved.statusCode, 200, saved.body);
  const seen = (await as(editor.cookie, "GET", `/api/teams/${owner.teamId}/mail`)).json().mail;
  assert.equal(seen.host, "smtp.ama.example");
  assert.equal(seen.passwordSet, true);
  assert.ok(!JSON.stringify(seen).includes("ama-smtp-password"));
  // Stored encrypted.
  const raw = await store.settings.get(`team:${owner.teamId}:mail`);
  assert.ok(raw && !raw.includes("ama-smtp-password"));

  // Saving again without a password keeps the one stored.
  const { password: _p, ...withoutPassword } = MAIL;
  await as(owner.cookie, "PUT", `/api/teams/${owner.teamId}/mail`, {
    ...withoutPassword,
    port: 465,
    security: "tls",
  });
  const kept = (await as(owner.cookie, "GET", `/api/teams/${owner.teamId}/mail`)).json().mail;
  assert.equal(kept.port, 465);
  assert.equal(kept.passwordSet, true);

  for (const bad of [
    { ...MAIL, from: "nobody" },
    { ...MAIL, host: "smtp.example.com/../x" },
  ]) {
    assert.equal(
      (await as(owner.cookie, "PUT", `/api/teams/${owner.teamId}/mail`, bad)).statusCode,
      400,
    );
  }
});

test("mail for a team goes through its own server, all of it; never the server's password", async () => {
  const settings = new SettingsService(store, secrets, {});
  const used: Array<{ host: string; auth?: { user: string; pass: string } }> = [];
  const mail = new MailService(settings, (options) => {
    used.push({ host: options.host, ...(options.auth ? { auth: options.auth } : {}) });
    return { sendMail: async () => ({}), verify: async () => true };
  });
  // The server's own mail server, with its password.
  await settings.update({
    mailHost: "smtp.server.example",
    mailFrom: "Zelyq <ops@server.example>",
    mailUsername: "ops@server.example",
    mailPassword: "SERVER-PASSWORD",
  });

  const team = newId("team");
  // A team with a host and no password of its own.
  await settings.setTeamMail(team, {
    host: "smtp.team.example",
    from: "Team <a@team.example>",
    username: "a@team.example",
  });
  await mail.send({ to: ["x@example.com"], subject: "s", text: "t" }, team);
  assert.equal(used.at(-1)?.host, "smtp.team.example");
  assert.notEqual(
    used.at(-1)?.auth?.pass,
    "SERVER-PASSWORD",
    "the server's password never goes to a team's server",
  );

  // No team mail: the server's.
  await mail.send({ to: ["x@example.com"], subject: "s", text: "t" }, newId("team"));
  assert.equal(used.at(-1)?.host, "smtp.server.example");
  // The team removes its own: back to the server's.
  await settings.clearTeamMail(team);
  await mail.send({ to: ["x@example.com"], subject: "s", text: "t" }, team);
  assert.equal(used.at(-1)?.host, "smtp.server.example");
});

test("removing a team's email, and its test needs one saved", async () => {
  await as(owner.cookie, "DELETE", `/api/teams/${owner.teamId}/mail`);
  assert.equal(
    (await as(owner.cookie, "GET", `/api/teams/${owner.teamId}/mail`)).json().mail,
    null,
  );
  const test = await as(owner.cookie, "POST", `/api/teams/${owner.teamId}/mail/test`);
  assert.equal(test.statusCode, 400);
  assert.match(test.json().error.message, /Save the team's mail server first/);
});

// ---------------------------------------------------------------- Supabase

function stubFetch() {
  return (async (url: string) => {
    if (/\/v1\/organizations$/.test(url))
      return new Response(JSON.stringify([{ id: "org_1" }]), { status: 200 });
    return new Response("no stub", { status: 599 });
  }) as never;
}

async function teamWithApp(suffix: string) {
  const user = await store.users.create({
    id: newId("user"),
    email: `o-${suffix}@example.com`,
    name: "O",
    passwordHash: "x",
  });
  const team = await store.teams.create({
    id: newId("team"),
    name: `T ${suffix}`,
    slug: `t-${suffix}`,
  });
  await store.teams.addMember(team.id, user.id, "owner");
  const project = await store.projects.create({
    id: newId("project"),
    teamId: team.id,
    name: `P ${suffix}`,
    slug: `p-${suffix}`,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
  });
  return { user, team, project };
}

async function resourceFor(svc: SupabaseConnectionService, connectionId: string) {
  const id = newId("providerResource");
  await store.providerConnections.createResource({
    id,
    connectionId,
    orgId: "org_1",
    projectRef: `ref${id.slice(-6)}`,
    projectUrl: "https://x.supabase.co",
    publishableKey: "pk",
    displayName: "Test database",
    environment: "development",
    provisionedByZelyq: false,
  } as never);
  void svc;
  return id;
}

test("a team's Supabase connection is its own: other teams and the server never see or use it", async () => {
  const access = new AccessControl(store);
  const svc = new SupabaseConnectionService(store, secrets, access, { fetch: stubFetch() });
  const a = await teamWithApp("a");
  const b = await teamWithApp("b");
  const connA = await svc.connectWithPat(a.user, `sbp_TEST_${"a".repeat(40)}`, a.team.id);
  assert.equal(connA.teamId, a.team.id);

  assert.deepEqual(
    (await svc.listConnections(a.team.id)).map((c) => c.id),
    [connA.id],
  );
  assert.deepEqual(await svc.listConnections(b.team.id), []);
  assert.ok(!(await svc.listConnections(null)).some((c) => c.id === connA.id), "not the server's");
  await assert.rejects(svc.listResources(connA.id, b.team.id), /not found/i);
  await assert.rejects(svc.revoke(b.user, connA.id, b.team.id), /not found/i);

  // An app links only to its own team's databases.
  const resource = await resourceFor(svc, connA.id);
  await svc.linkProjectToResource(a.user, a.project.id, a.team.id, resource);
  await assert.rejects(
    svc.linkProjectToResource(b.user, b.project.id, b.team.id, resource),
    /not found/i,
  );
});

test("the server's own connection: usable by every team when self-hosted, by none when managed", async () => {
  const access = new AccessControl(store);
  const svc = new SupabaseConnectionService(store, secrets, access, { fetch: stubFetch() });
  const c = await teamWithApp("c");
  const serverConn = await svc.connectWithPat(c.user, `sbp_TEST_${"s".repeat(40)}`, null);
  const resource = await resourceFor(svc, serverConn.id);
  await svc.linkProjectToResource(c.user, c.project.id, c.team.id, resource);

  access.managed = "Example Cloud";
  const d = await teamWithApp("d");
  await assert.rejects(
    svc.linkProjectToResource(d.user, d.project.id, d.team.id, resource),
    /not found/i,
  );
});

test("Team settings → Integrations: only the team's admins manage its Supabase", async () => {
  const base = `/api/teams/${owner.teamId}/integrations/supabase`;
  assert.equal((await as(owner.cookie, "GET", `${base}/connections`)).statusCode, 200);
  assert.deepEqual((await as(owner.cookie, "GET", `${base}/connections`)).json().connections, []);
  assert.equal((await as(editor.cookie, "GET", `${base}/connections`)).statusCode, 403);
  const stranger = await register("efua@example.com");
  assert.notEqual((await as(stranger.cookie, "GET", `${base}/connections`)).statusCode, 200);
});

test("a team's mail server can't be this server or a cloud metadata address", async () => {
  for (const host of ["127.0.0.1", "169.254.169.254", "localhost"]) {
    const refused = await as(owner.cookie, "PUT", `/api/teams/${owner.teamId}/mail`, {
      ...MAIL,
      host,
    });
    assert.equal(refused.statusCode, 400, `${host}: ${refused.body}`);
    assert.match(refused.json().error.message, /can't be used/);
  }
});

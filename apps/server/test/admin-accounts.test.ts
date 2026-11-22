import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { AdminKeyService } from "../src/services/admin-keys.js";

/**
 * People and teams through the admin API, on a managed server: what an
 * account service does at sign-up, on a change of email, on abuse, and when a
 * customer leaves. Signing in through the (stand-in) service proves that a
 * person the API made is the same person who then arrives.
 */

const tmp = path.join(os.tmpdir(), `zelyq-admin-accounts-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

let nextClaims: Record<string, unknown> = {};
let idpBase = "";
const idp = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/.well-known/openid-configuration") {
    res.end(
      JSON.stringify({
        issuer: idpBase,
        authorization_endpoint: `${idpBase}/authorize`,
        token_endpoint: `${idpBase}/token`,
        userinfo_endpoint: `${idpBase}/userinfo`,
      }),
    );
    return;
  }
  if (url.pathname === "/token") return void res.end(JSON.stringify({ access_token: "t" }));
  if (url.pathname === "/userinfo") return void res.end(JSON.stringify(nextClaims));
  res.statusCode = 404;
  res.end();
});

let server: ZelyqServer;
let adminCookie = "";
let key = "";

function cookieOf(response: { cookies: Array<{ name: string; value: string }> }): string | null {
  const session = response.cookies.find((c) => c.name === "zelyq_session");
  return session ? `zelyq_session=${session.value}` : null;
}

const api = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

async function signInThroughService(claims: Record<string, unknown>) {
  nextClaims = claims;
  const started = await server.app.inject({ method: "GET", url: "/api/auth/oidc/start" });
  const state = new URL(started.headers.location as string).searchParams.get("state")!;
  const stateCookie = started.cookies.find((c) => c.name === "zelyq_oidc_state")!;
  return await server.app.inject({
    method: "GET",
    url: `/api/auth/oidc/callback?code=c&state=${encodeURIComponent(state)}`,
    headers: { cookie: `zelyq_oidc_state=${stateCookie.value}` },
  });
}

const me = (cookie: string) =>
  server.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  const address = idp.address();
  idpBase = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

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
    allowRegistration: false,
    sessionTtlDays: 30,
    oidc: {
      issuer: idpBase,
      clientId: "c",
      clientSecret: "s",
      redirectUri: "http://localhost/api/auth/oidc/callback",
    },
    accounts: { name: "Example Cloud", url: "https://accounts.example.com" },
    // The server's own administrator signs in here in these tests.
    localSignIn: true,
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
      previewPortRange: [4994, 4997],
      previewHost: "127.0.0.1",
    },
  } as ServerConfig;
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);

  const setup = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "admin@example.com", name: "Admin", password: "a-long-password-1" },
  });
  adminCookie = cookieOf(setup)!;
  // Managed: keys are made on the server (its command line), not from a session.
  key = (
    await new AdminKeyService(server.store).create(null, {
      name: "Example Cloud",
      scopes: ["accounts", "teams", "plans", "usage"],
    })
  ).key;
  const plans = await api("PUT", "/plans", {
    plans: [
      { id: "free", name: "Free", limits: { apps: 3 } },
      { id: "pro", name: "Pro", limits: { apps: 30 } },
    ],
    defaultPlan: "free",
  });
  assert.equal(plans.statusCode, 200, plans.body);
});

after(async () => {
  await server.close();
  await new Promise<void>((resolve) => idp.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});

test("sign-up: the service makes the person and their first team, once", async () => {
  const first = await api("POST", "/accounts", {
    email: "Ama@Example.com",
    name: "Ama",
    externalId: "cloud-user-1",
    team: { name: "Ama's studio", plan: "free" },
  });
  assert.equal(first.statusCode, 201, first.body);
  const made = first.json();
  assert.equal(made.created, true);
  assert.equal(made.account.email, "ama@example.com");
  assert.equal(made.account.instanceRole, "member");
  assert.equal(made.account.status, "active");
  assert.deepEqual(made.account.externalIds, [{ issuer: idpBase, subject: "cloud-user-1" }]);
  assert.equal(made.team.name, "Ama's studio");
  assert.equal(made.team.plan.id, "free");

  const again = await api("POST", "/accounts", {
    email: "ama@example.com",
    externalId: "cloud-user-1",
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().created, false);
  assert.equal(again.json().account.id, made.account.id);
  assert.equal(again.json().team.id, made.team.id);
});

test("the person the service made is the person who signs in: no second account", async () => {
  const response = await signInThroughService({
    sub: "cloud-user-1",
    email: "ama@example.com",
    email_verified: true,
    name: "Ama",
  });
  assert.equal(response.headers.location, "/signin");
  const session = (await me(cookieOf(response)!)).json();
  const found = (await api("GET", "/accounts?externalId=cloud-user-1")).json();
  assert.equal(session.user.id, found.id);
  assert.equal(session.teams.length, 1);
});

test("an account made on this server before is linked, not duplicated", async () => {
  // Made by an invitation-like path: an account with that email already exists.
  const earlier = await api("POST", "/accounts", {
    email: "kofi@example.com",
    externalId: "temp-id",
    team: false,
  });
  const linked = await api("POST", "/accounts", {
    email: "kofi@example.com",
    externalId: "cloud-user-2",
  });
  assert.equal(linked.statusCode, 200);
  assert.equal(linked.json().account.id, earlier.json().account.id);
  assert.equal(linked.json().account.externalIds.length, 2);
  assert.equal(linked.json().team, null, "made with team:false, so no team");
});

test("find a person by email or by the service's id; unknown is 404", async () => {
  assert.equal((await api("GET", "/accounts?email=AMA@example.com")).json().name, "Ama");
  assert.equal(
    (await api("GET", "/accounts?externalId=cloud-user-2")).json().email,
    "kofi@example.com",
  );
  assert.equal((await api("GET", "/accounts?email=nobody@example.com")).statusCode, 404);
  assert.equal((await api("GET", "/accounts/usr_nope")).statusCode, 404);
  assert.ok(Array.isArray((await api("GET", "/accounts")).json().accounts), "no filter: the list");
});

test("everyone, newest first, a page at a time; found by part of a name or email", async () => {
  const all = (await api("GET", "/accounts?limit=200")).json();
  assert.ok(all.accounts.length >= 2);
  const times = all.accounts.map((a: { createdAt: string }) => a.createdAt);
  assert.deepEqual([...times].sort().reverse(), times, "newest first");
  assert.equal(all.nextCursor, null);

  const first = (await api("GET", "/accounts?limit=1")).json();
  assert.equal(first.accounts.length, 1);
  assert.ok(first.nextCursor);
  const second = (await api("GET", `/accounts?limit=1&cursor=${first.nextCursor}`)).json();
  assert.notEqual(second.accounts[0].id, first.accounts[0].id);

  const found = (await api("GET", "/accounts?q=KOFI")).json();
  assert.ok(found.accounts.length >= 1);
  assert.ok(
    found.accounts.every((a: { email: string; name: string }) => /kofi/i.test(a.email + a.name)),
  );
  // % and _ are letters here, not patterns.
  assert.equal((await api("GET", "/accounts?q=%25")).json().accounts.length, 0);
  assert.equal((await api("GET", "/accounts?status=gone")).statusCode, 400);
});

test("the service changes email and name; a taken or reserved email is refused", async () => {
  const ama = (await api("GET", "/accounts?email=ama@example.com")).json();
  const changed = await api("PATCH", `/accounts/${ama.id}`, {
    email: "ama.new@example.com",
    name: "Ama Mensah",
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().email, "ama.new@example.com");
  assert.equal(changed.json().name, "Ama Mensah");
  assert.equal(
    (await api("PATCH", `/accounts/${ama.id}`, { email: "kofi@example.com" })).statusCode,
    409,
  );
  assert.equal(
    (await api("PATCH", `/accounts/${ama.id}`, { email: "x@service.invalid" })).statusCode,
    400,
  );
  assert.equal((await api("PATCH", `/accounts/${ama.id}`, {})).statusCode, 400);
});

test("sign-out ends every session the person has here", async () => {
  const response = await signInThroughService({
    sub: "cloud-user-1",
    email: "ama.new@example.com",
    email_verified: true,
  });
  const cookie = cookieOf(response)!;
  assert.equal((await me(cookie)).statusCode, 200);
  const ama = (await api("GET", "/accounts?externalId=cloud-user-1")).json();
  assert.equal((await api("POST", `/accounts/${ama.id}/sign-out`)).statusCode, 200);
  assert.equal((await me(cookie)).statusCode, 401);
});

test("a suspended person is signed out and cannot come back in, until restored", async () => {
  const signedIn = cookieOf(
    await signInThroughService({
      sub: "cloud-user-1",
      email: "ama.new@example.com",
      email_verified: true,
    }),
  )!;
  const ama = (await api("GET", "/accounts?externalId=cloud-user-1")).json();
  const suspended = await api("PUT", `/accounts/${ama.id}/status`, {
    status: "suspended",
    reason: "Payment dispute",
  });
  assert.equal(suspended.statusCode, 200, suspended.body);
  assert.equal(suspended.json().status, "suspended");
  assert.equal(suspended.json().statusReason, "Payment dispute");
  assert.equal((await me(signedIn)).statusCode, 401, "their open session ended");

  const attempt = await signInThroughService({
    sub: "cloud-user-1",
    email: "ama.new@example.com",
    email_verified: true,
  });
  assert.equal(attempt.headers.location, "/signin?error=suspended");
  assert.equal(cookieOf(attempt), null);

  const restored = await api("PUT", `/accounts/${ama.id}/status`, { status: "active" });
  assert.equal(restored.json().status, "active");
  assert.equal(restored.json().statusReason, null);
  const back = await signInThroughService({
    sub: "cloud-user-1",
    email: "ama.new@example.com",
    email_verified: true,
  });
  assert.ok(cookieOf(back));
});

test("the server's own administrators are out of the API's reach", async () => {
  const admin = (await me(adminCookie)).json().user;
  assert.equal(
    (await api("PUT", `/accounts/${admin.id}/status`, { status: "suspended" })).statusCode,
    403,
  );
  assert.equal((await api("DELETE", `/accounts/${admin.id}`)).statusCode, 403);
});

test("deleting: look first, then delete; a shared team stays, a team of one goes", async () => {
  const made = (
    await api("POST", "/accounts", {
      email: "leaving@example.com",
      externalId: "cloud-user-3",
      team: { name: "Solo" },
    })
  ).json();
  const stayer = (
    await api("POST", "/accounts", { email: "stayer@example.com", externalId: "cloud-user-4" })
  ).json();
  // A team the leaving person is in, owned by someone else.
  await server.store.teams.addMember(stayer.team.id, made.account.id, "editor");

  const looked = await api("DELETE", `/accounts/${made.account.id}?look=1`);
  assert.equal(looked.statusCode, 200, looked.body);
  assert.equal(looked.json().deleted, false);
  assert.deepEqual(
    looked.json().teamsRemoved.map((team: { id: string }) => team.id),
    [made.team.id],
  );
  assert.deepEqual(
    looked.json().teamsKept.map((team: { id: string }) => team.id),
    [stayer.team.id],
  );
  assert.ok(await server.store.users.findById(made.account.id), "looking deletes nothing");

  const deleted = await api("DELETE", `/accounts/${made.account.id}`);
  assert.equal(deleted.json().deleted, true);
  assert.equal(await server.store.users.findById(made.account.id), null);
  assert.equal(await server.store.teams.findById(made.team.id), null);
  assert.ok(await server.store.teams.findById(stayer.team.id));
});

test("the last owner of a team with other members cannot be deleted", async () => {
  const owner = (
    await api("POST", "/accounts", { email: "owner2@example.com", externalId: "cloud-user-5" })
  ).json();
  const member = (
    await api("POST", "/accounts", {
      email: "member2@example.com",
      externalId: "cloud-user-6",
      team: false,
    })
  ).json();
  await server.store.teams.addMember(owner.team.id, member.account.id, "editor");
  assert.equal((await api("DELETE", `/accounts/${owner.account.id}`)).statusCode, 409);
});

test("teams: made for a person on a plan, read with members, listed a page at a time", async () => {
  const owner = (await api("GET", "/accounts?externalId=cloud-user-4")).json();
  const made = await api("POST", "/teams", { ownerId: owner.id, name: "Agency", plan: "pro" });
  assert.equal(made.statusCode, 201, made.body);
  assert.equal(made.json().plan.id, "pro");
  assert.deepEqual(made.json().owners, [{ id: owner.id, email: "stayer@example.com" }]);

  const detail = (await api("GET", `/teams/${made.json().id}`)).json();
  assert.equal(detail.memberList.length, 1);
  assert.equal(detail.memberList[0].role, "owner");

  assert.equal(
    (await api("POST", "/teams", { ownerId: owner.id, name: "X", plan: "gold" })).statusCode,
    404,
  );
  assert.equal((await api("POST", "/teams", { ownerId: "usr_nope", name: "X" })).statusCode, 404);

  const all = (await api("GET", "/teams?limit=500")).json();
  assert.equal(all.nextCursor, null);
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page: { teams: Array<{ id: string }>; nextCursor: string | null } = (
      await api("GET", `/teams?limit=2${cursor ? `&cursor=${cursor}` : ""}`)
    ).json();
    assert.ok(page.teams.length <= 2);
    seen.push(...page.teams.map((team) => team.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(
    seen,
    all.teams.map((team: { id: string }) => team.id),
    "pages cover every team once",
  );

  const pro = (await api("GET", "/teams?plan=pro")).json();
  assert.ok(pro.teams.length >= 1);
  assert.ok(pro.teams.every((team: { plan: { id: string } }) => team.plan.id === "pro"));
});

test("usage for every team, a page at a time", async () => {
  const page = await api("GET", "/usage?limit=3");
  assert.equal(page.statusCode, 200, page.body);
  const body = page.json();
  assert.ok(body.usage.length <= 3);
  const first = body.usage[0];
  assert.ok(first.teamId.startsWith("tem_"));
  assert.ok(first.lines.some((line: { key: string }) => line.key === "storageMb"));
});

test("each call needs its scope", async () => {
  const narrow = (
    await new AdminKeyService(server.store).create(null, {
      name: "Only accounts",
      scopes: ["accounts"],
    })
  ).key;
  // From a session, a managed server makes no keys at all.
  const fromSession = await server.app.inject({
    method: "POST",
    url: "/api/admin-keys",
    headers: { cookie: adminCookie },
    payload: { name: "Sneaky", scopes: ["accounts"] },
  });
  assert.equal(fromSession.statusCode, 403);
  assert.equal((await api("GET", "/teams", undefined, narrow)).statusCode, 403);
  assert.equal((await api("GET", "/usage", undefined, narrow)).statusCode, 403);
  assert.equal(
    (await api("GET", "/accounts?email=kofi@example.com", undefined, narrow)).statusCode,
    200,
  );
});

test("changes are in the audit log with who they were about", async () => {
  const ama = (await api("GET", "/accounts?externalId=cloud-user-1")).json();
  const calls = await server.store.auditLog.listByAction("admin_api.call", 500);
  const statusChanges = calls.filter(
    (entry) => entry.detail.path === "/api/admin/v1/accounts/:id/status",
  );
  assert.ok(statusChanges.length >= 2);
  assert.ok(statusChanges.every((entry) => entry.detail.target === ama.id));
  assert.ok(statusChanges.every((entry) => entry.actorName === 'Admin key "Example Cloud"'));

  // A change to a team shows in that team's own activity.
  const teamMade = calls.find((entry) => entry.detail.path === "/api/admin/v1/teams");
  assert.ok(teamMade, "making a team is recorded");
  const moved = await api("PUT", `/teams/${ama.teams[0].id}/plan`, { plan: "pro" });
  assert.equal(moved.statusCode, 200);
  const teamLog = await server.store.auditLog.listForTeam(ama.teams[0].id);
  assert.ok(teamLog.some((entry) => entry.action === "admin_api.call"));
});

test("server administrators: made and unmade only with the admins scope; the last one stays", async () => {
  const person = (
    await api("POST", "/accounts", {
      email: "ops@example.com",
      name: "Ops",
      externalId: "cloud-ops-1",
    })
  ).json().account;
  // The account service's own key (accounts, teams, plans, usage) cannot.
  assert.equal(
    (await api("PUT", `/accounts/${person.id}/role`, { role: "admin" })).statusCode,
    403,
  );

  const admins = (
    await new AdminKeyService(server.store).create(null, {
      name: "Admin portal",
      scopes: ["admins", "accounts"],
    })
  ).key;
  const role = (id: string, value: string) =>
    api("PUT", `/accounts/${id}/role`, { role: value }, admins);
  assert.equal((await role(person.id, "owner")).statusCode, 400, "admin or member only");

  const made = await role(person.id, "admin");
  assert.equal(made.statusCode, 200, made.body);
  assert.equal(made.json().instanceRole, "admin");
  assert.equal((await role(person.id, "admin")).statusCode, 200, "again is no change");

  const signedIn = cookieOf(
    await signInThroughService({ sub: "cloud-ops-1", email: "ops@example.com", name: "Ops" }),
  );
  assert.ok(signedIn);
  assert.equal((await me(signedIn!)).json().user.instanceRole, "admin");

  assert.equal((await role(person.id, "member")).json().instanceRole, "member");
  // The server's own administrator is the last one: not unmade.
  const admin = (await me(adminCookie)).json().user;
  const last = await role(admin.id, "member");
  assert.equal(last.statusCode, 409, last.body);
  assert.match(last.json().error.message, /last administrator/);
});

test("extra storage raises a team's storage limit; a team without a limit stays without one", async () => {
  const owner = (
    await api("POST", "/accounts", {
      email: "extra@example.com",
      name: "Extra",
      externalId: "cloud-extra-1",
    })
  ).json().account;
  await api("PUT", "/plans", {
    plans: [
      { id: "free", name: "Free", limits: { apps: 3 } },
      { id: "pro", name: "Pro", limits: { apps: 30, storageMb: 1024 } },
    ],
    defaultPlan: "free",
  });
  const team = (
    await api("POST", "/teams", { ownerId: owner.id, name: "Big files", plan: "pro" })
  ).json();
  const storage = async () =>
    (await api("GET", `/teams/${team.id}/usage`))
      .json()
      .lines.find((l: { key: string }) => l.key === "storageMb");

  assert.deepEqual((await api("GET", `/teams/${team.id}/extras`)).json(), { storageMb: 0 });
  assert.equal((await storage()).limit, 1024);

  const bought = await api("PUT", `/teams/${team.id}/extras`, { storageMb: 20480 });
  assert.equal(bought.statusCode, 200, bought.body);
  assert.equal((await storage()).limit, 1024 + 20480);
  assert.deepEqual((await api("GET", `/teams/${team.id}/extras`)).json(), { storageMb: 20480 });

  assert.equal((await api("PUT", `/teams/${team.id}/extras`, { storageMb: -1 })).statusCode, 400);
  assert.equal(
    (await api("PUT", `/teams/${team.id}/extras`, { storageMb: 1, apps: 5 })).statusCode,
    400,
  );
  assert.equal((await api("PUT", "/teams/tem_nope/extras", { storageMb: 1 })).statusCode, 404);

  // On a plan without a storage limit, extras change nothing.
  await api("PUT", `/teams/${team.id}/plan`, { plan: "free" });
  assert.equal((await storage()).limit, null);

  await api("PUT", `/teams/${team.id}/plan`, { plan: "pro" });
  await api("PUT", `/teams/${team.id}/extras`, { storageMb: 0 });
  assert.equal((await storage()).limit, 1024, "back to the plan's own");
});

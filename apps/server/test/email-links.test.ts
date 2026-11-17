import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations, type Store } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { smtpSink } from "./smtp-sink.js";

/**
 * Password reset and team invitations by emailed link. Off until an admin
 * turns them on, and only offered once a mail server and the public web
 * address are both set: on a computer nobody else can reach, a link in an
 * email would lead nowhere.
 */

const tmp = path.join(os.tmpdir(), `zelyq-email-links-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "links.db")}`,
  agentUrl: "http://127.0.0.1:59992",
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
  pipelinesDir: path.join(tmp, "pipelines"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4964, 4967],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let store: Store;
let sink: Awaited<ReturnType<typeof smtpSink>>;
let ownerCookie: string;
let teamId: string;

const PASSWORD = "correct-horse-battery";
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const inboxFor = (address: string) => sink.inbox.filter((item) => item.to.includes(address));
const cookieOf = (response: { cookies: Array<{ name: string; value: string }> }) => {
  const value = response.cookies.find((c) => c.name === "zelyq_session")?.value;
  return value ? `zelyq_session=${value}` : "";
};
/** The token from the last link of this kind in someone's inbox. */
function tokenFrom(address: string, page: "reset-password" | "invite"): string {
  const messages = inboxFor(address);
  const text = messages.at(-1)?.data ?? "";
  const match = new RegExp(`https://zelyq\\.test/${page}#token=([A-Za-z0-9_-]+)`).exec(text);
  assert.ok(match, `no ${page} link in the email to ${address}: ${text.slice(-400)}`);
  return match[1]!;
}

function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  cookie = ownerCookie,
  headers: Record<string, string> = {},
) {
  return server.app.inject({
    method,
    url,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function register(email: string, name: string): Promise<string> {
  const response = await call(
    "POST",
    "/api/auth/register",
    { email, name, password: PASSWORD },
    "",
  );
  assert.equal(response.statusCode, 201, response.body);
  return cookieOf(response);
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  store = server.store;
  sink = await smtpSink();
  ownerCookie = await register("owner@example.com", "Owner");
  await register("bystander@example.com", "Bystander");
  teamId = (await call("GET", "/api/teams")).json().teams[0].id;
  const saved = await call("PUT", "/api/settings", {
    mailHost: "127.0.0.1",
    mailPort: String(sink.port),
    mailSecurity: "none",
    mailFrom: "Zelyq <noreply@zelyq.test>",
  });
  assert.equal(saved.statusCode, 200, saved.body);
});

after(async () => {
  await server.app.close();
  sink.server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("off by default: no forgot-password, and an unknown address still has to register first", async () => {
  assert.equal((await call("GET", "/api/auth/status", undefined, "")).json().passwordReset, false);
  const forgot = await call(
    "POST",
    "/api/auth/forgot-password",
    { email: "owner@example.com" },
    "",
  );
  assert.equal(forgot.statusCode, 404);
  const added = await call("POST", `/api/teams/${teamId}/members`, {
    email: "stranger@example.com",
    role: "editor",
  });
  assert.equal(added.statusCode, 404);
  assert.match(added.json().error.message, /register first/);
  const invites = (await call("GET", `/api/teams/${teamId}/invites`)).json();
  assert.equal(invites.canInvite, false);
  assert.match(invites.missing, /Settings → Email/);
});

test("the switch alone is not enough: links need the public web address too", async () => {
  assert.equal((await call("PUT", "/api/settings", { emailSignInLinks: "true" })).statusCode, 200);
  assert.equal((await call("GET", "/api/auth/status", undefined, "")).json().passwordReset, false);
  assert.match(
    (await call("GET", `/api/teams/${teamId}/invites`)).json().missing,
    /public web address/,
  );
  const bad = await call("PUT", "/api/settings", { publicUrl: "javascript:alert(1)" });
  assert.equal(bad.statusCode, 400);
  const good = await call("PUT", "/api/settings", { publicUrl: "https://zelyq.test/" });
  assert.equal(good.statusCode, 200, good.body);
  assert.equal((await call("GET", "/api/auth/status", undefined, "")).json().passwordReset, true);
});

test("forgot password: same answer for any address, one email only to a real account", async () => {
  const unknown = await call(
    "POST",
    "/api/auth/forgot-password",
    { email: "nobody@example.com" },
    "",
  );
  assert.equal(unknown.statusCode, 202);
  // A forged Host header must not decide where the link points.
  const known = await call(
    "POST",
    "/api/auth/forgot-password",
    { email: "Owner@Example.com" },
    "",
    { host: "evil.example" },
  );
  assert.equal(known.statusCode, 202);
  assert.deepEqual(known.json(), unknown.json());
  await settle();
  assert.equal(inboxFor("nobody@example.com").length, 0);
  assert.equal(inboxFor("owner@example.com").length, 1);
  assert.doesNotMatch(inboxFor("owner@example.com")[0]!.data, /evil\.example/);
  assert.match(inboxFor("owner@example.com")[0]!.data, /Reset your Zelyq password/);
});

test("a reset link sets the password once, signs out everywhere else, and then is spent", async () => {
  const token = tokenFrom("owner@example.com", "reset-password");
  const stale = ownerCookie;
  const reset = await call(
    "POST",
    "/api/auth/reset-password",
    { token, password: "a-brand-new-password" },
    "",
  );
  assert.equal(reset.statusCode, 200, reset.body);
  ownerCookie = cookieOf(reset);
  assert.ok(ownerCookie);
  assert.equal((await call("GET", "/api/auth/me", undefined, stale)).statusCode, 401);
  assert.equal((await call("GET", "/api/auth/me")).statusCode, 200);
  const login = await call(
    "POST",
    "/api/auth/login",
    { email: "owner@example.com", password: "a-brand-new-password" },
    "",
  );
  assert.equal(login.statusCode, 200);
  const again = await call(
    "POST",
    "/api/auth/reset-password",
    { token, password: "yet-another-password" },
    "",
  );
  assert.equal(again.statusCode, 404);
  assert.match(again.json().error.message, /expired or was already used/);
});

test("a newer reset email voids the older link, and an inbox is not flooded", async () => {
  await call("POST", "/api/auth/forgot-password", { email: "owner@example.com" }, "");
  await settle();
  const older = tokenFrom("owner@example.com", "reset-password");
  await call("POST", "/api/auth/forgot-password", { email: "owner@example.com" }, "");
  await settle();
  const newer = tokenFrom("owner@example.com", "reset-password");
  assert.notEqual(older, newer);
  const stale = await call(
    "POST",
    "/api/auth/reset-password",
    { token: older, password: "another-password-1" },
    "",
  );
  assert.equal(stale.statusCode, 404);
  // Three in the hour already: the fourth is answered the same, but nothing is sent.
  const before = inboxFor("owner@example.com").length;
  const fourth = await call(
    "POST",
    "/api/auth/forgot-password",
    { email: "owner@example.com" },
    "",
  );
  assert.equal(fourth.statusCode, 202);
  await settle();
  assert.equal(inboxFor("owner@example.com").length, before);
});

test("inviting someone with no account emails a link; accepting creates the account in that team", async () => {
  const invited = await call("POST", `/api/teams/${teamId}/members`, {
    email: "New.Person@example.com",
    role: "editor",
  });
  assert.equal(invited.statusCode, 202, invited.body);
  assert.equal(invited.json().invited, "new.person@example.com");
  const pending = (await call("GET", `/api/teams/${teamId}/invites`)).json();
  assert.equal(pending.canInvite, true);
  assert.deepEqual(
    pending.invites.map((row: { email: string; role: string }) => [row.email, row.role]),
    [["new.person@example.com", "editor"]],
  );
  const mail = inboxFor("new.person@example.com");
  assert.equal(mail.length, 1);
  assert.match(mail[0]!.data, /Owner invited you to/);
  const token = tokenFrom("new.person@example.com", "invite");

  const look = await call("POST", "/api/auth/invite/lookup", { token }, "");
  assert.equal(look.statusCode, 200, look.body);
  assert.equal(look.json().email, "new.person@example.com");
  assert.equal(look.json().role, "editor");
  assert.equal(look.json().accountExists, false);

  // Registration closed: an invitation still lets the invited person in.
  await call("PUT", "/api/settings", { allowRegistration: "false" });
  const missing = await call("POST", "/api/auth/invite/accept", { token }, "");
  assert.equal(missing.statusCode, 400);
  const accepted = await call(
    "POST",
    "/api/auth/invite/accept",
    { token, name: "New Person", password: PASSWORD },
    "",
  );
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().teamId, teamId);
  const newCookie = cookieOf(accepted);
  const me = (await call("GET", "/api/auth/me", undefined, newCookie)).json();
  assert.deepEqual(
    me.teams.map((team: { id: string; role: string }) => [team.id, team.role]),
    [[teamId, "editor"]],
  );
  // Joining is recorded as the person who joined, not the one who invited.
  await server.activity.settled();
  const joined = await server.store.productEvents.list({
    from: "2000-01-01T00:00:00.000Z",
    to: "2100-01-01T00:00:00.000Z",
    name: "member.joined",
    limit: 100,
  });
  assert.ok(joined.some((event) => event.userId === me.user.id && event.teamId === teamId));
  assert.equal(
    (await call("POST", "/api/auth/invite/accept", { token, name: "X", password: PASSWORD }, ""))
      .statusCode,
    404,
  );
  assert.equal((await call("GET", `/api/teams/${teamId}/invites`)).json().invites.length, 0);
  await call("PUT", "/api/settings", { allowRegistration: "true" });
});

test("only an admin can see or send invitations", async () => {
  const editorCookie = (
    await call(
      "POST",
      "/api/auth/login",
      { email: "new.person@example.com", password: PASSWORD },
      "",
    )
  ).cookies.find((c) => c.name === "zelyq_session")!.value;
  const asEditor = `zelyq_session=${editorCookie}`;
  assert.equal(
    (await call("GET", `/api/teams/${teamId}/invites`, undefined, asEditor)).statusCode,
    403,
  );
  const sent = await call(
    "POST",
    `/api/teams/${teamId}/members`,
    { email: "friend@example.com", role: "viewer" },
    asEditor,
  );
  assert.equal(sent.statusCode, 403);
  assert.equal(inboxFor("friend@example.com").length, 0);
});

test("a withdrawn invitation's link stops working", async () => {
  await call("POST", `/api/teams/${teamId}/members`, {
    email: "maybe@example.com",
    role: "viewer",
  });
  const token = tokenFrom("maybe@example.com", "invite");
  const [row] = (await call("GET", `/api/teams/${teamId}/invites`)).json().invites;
  assert.equal((await call("DELETE", `/api/teams/${teamId}/invites/${row.id}`)).statusCode, 204);
  assert.equal((await call("POST", "/api/auth/invite/lookup", { token }, "")).statusCode, 404);
  const log = (await call("GET", `/api/teams/${teamId}/audit-log`)).json().entries;
  assert.ok(log.some((entry: { action: string }) => entry.action === "team.invite_withdrawn"));
  assert.ok(log.some((entry: { action: string }) => entry.action === "team.member_invited"));
});

test("an invitation to an address that has an account since needs that account signed in", async () => {
  await call("POST", `/api/teams/${teamId}/members`, {
    email: "later@example.com",
    role: "viewer",
  });
  const token = tokenFrom("later@example.com", "invite");
  const laterCookie = await register("later@example.com", "Later");
  assert.equal(
    (await call("POST", "/api/auth/invite/lookup", { token }, "")).json().accountExists,
    true,
  );
  const anonymous = await call("POST", "/api/auth/invite/accept", { token }, "");
  assert.equal(anonymous.statusCode, 401);
  assert.match(anonymous.json().error.message, /Sign in as later@example.com/);
  const wrong = await call("POST", "/api/auth/invite/accept", { token }, ownerCookie);
  assert.equal(wrong.statusCode, 401);
  const right = await call("POST", "/api/auth/invite/accept", { token }, laterCookie);
  assert.equal(right.statusCode, 200, right.body);
  const user = await store.users.findByEmail("later@example.com");
  assert.equal(await store.teams.roleOf(teamId, user!.id), "viewer");
});

test("adding someone who already has an account tells them by email", async () => {
  const added = await call("POST", `/api/teams/${teamId}/members`, {
    email: "bystander@example.com",
    role: "viewer",
  });
  assert.equal(added.statusCode, 201, added.body);
  await settle();
  const mail = inboxFor("bystander@example.com");
  assert.equal(mail.length, 1);
  assert.match(mail[0]!.data, /Owner added you to/);
  assert.match(mail[0]!.data, new RegExp(`https://zelyq\\.test/teams/${teamId}`));
});

test("re-sending an invitation still counts: an admin cannot flood one inbox", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    statuses.push(
      (
        await call("POST", `/api/teams/${teamId}/members`, {
          email: "flood@example.com",
          role: "viewer",
        })
      ).statusCode,
    );
  }
  assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
  assert.equal(inboxFor("flood@example.com").length, 5);
  // Only the newest link works; the older ones were voided.
  const pending = (await call("GET", `/api/teams/${teamId}/invites`)).json().invites;
  assert.equal(
    pending.filter((row: { email: string }) => row.email === "flood@example.com").length,
    1,
  );
});

test("an invitation stops working once the admin who sent it is no longer an admin", async () => {
  const adminCookie = await register("helper@example.com", "Helper");
  const helper = await store.users.findByEmail("helper@example.com");
  await store.teams.addMember(teamId, helper!.id, "admin");
  const sent = await call(
    "POST",
    `/api/teams/${teamId}/members`,
    { email: "via-helper@example.com", role: "editor" },
    adminCookie,
  );
  assert.equal(sent.statusCode, 202, sent.body);
  const token = tokenFrom("via-helper@example.com", "invite");
  await store.teams.updateMemberRole(teamId, helper!.id, "viewer");
  const accepted = await call(
    "POST",
    "/api/auth/invite/accept",
    { token, name: "Via Helper", password: PASSWORD },
    "",
  );
  assert.equal(accepted.statusCode, 404);
  assert.match(accepted.json().error.message, /no longer valid/);
  assert.equal(await store.users.findByEmail("via-helper@example.com"), null);
});

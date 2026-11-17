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
 * Talking to people from the server's operators: announcements to everyone,
 * a plan, a team or one person; a message to one person; maintenance.
 */

const tmp = path.join(os.tmpdir(), `zelyq-messages-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

let server: ZelyqServer;
let adminCookie = "";
let key = "";
const ama = { cookie: "", id: "", teamId: "" };
const kofi = { cookie: "", id: "", teamId: "" };

const as = (cookie: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const admin = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  server.app.inject({
    method,
    url: `/api/admin/v1${url}`,
    headers: { authorization: `Bearer ${key}` },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const inbox = async (who: { cookie: string }) =>
  (await as(who.cookie, "GET", "/api/inbox/messages")).json();

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

async function announce(body: Record<string, unknown>) {
  const response = await admin("POST", "/announcements", body);
  assert.equal(response.statusCode, 201, response.body);
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
      previewPortRange: [4985, 4987],
      previewHost: "127.0.0.1",
    },
  } as ServerConfig;
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  adminCookie = (await register("admin@example.com")).cookie;
  key = (
    await as(adminCookie, "POST", "/api/admin-keys", {
      name: "Product team",
      scopes: ["notify", "plans", "teams"],
    })
  ).json().key;
  Object.assign(ama, await register("ama@example.com"));
  Object.assign(kofi, await register("kofi@example.com"));
  await admin("PUT", "/plans", {
    plans: [
      { id: "free", name: "Free", limits: {} },
      { id: "pro", name: "Pro", limits: {} },
    ],
    defaultPlan: "free",
  });
  await admin("PUT", `/teams/${kofi.teamId}/plan`, { plan: "pro" });
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

test("a banner to everyone reaches everyone; dismissing it is each person's own", async () => {
  const made = await announce({
    title: "New: Expo apps",
    body: "Build phone apps from a sentence.",
    link: { url: "/docs", label: "See how" },
  });
  assert.equal(made.live, true);
  assert.equal((await inbox(ama)).banners[0].title, "New: Expo apps");
  assert.equal((await inbox(kofi)).banners[0].title, "New: Expo apps");

  await as(ama.cookie, "POST", `/api/inbox/announcements/${made.id}/seen`);
  await as(ama.cookie, "POST", `/api/inbox/announcements/${made.id}/click`);
  await as(ama.cookie, "POST", `/api/inbox/announcements/${made.id}/dismiss`);
  assert.equal((await inbox(ama)).banners.length, 0, "gone for Ama");
  assert.equal((await inbox(kofi)).banners.length, 1, "still there for Kofi");

  const listed = (await admin("GET", "/announcements"))
    .json()
    .announcements.find((entry: { id: string }) => entry.id === made.id);
  assert.deepEqual(listed.counts, { seen: 1, dismissed: 1, clicked: 1 });
  await admin("DELETE", `/announcements/${made.id}`);
});

test("to one plan, one team or one person: nobody else sees it", async () => {
  await announce({ title: "Pro tip", display: "inbox", audience: { kind: "plan", value: "pro" } });
  await announce({
    title: "For Ama's team",
    display: "inbox",
    audience: { kind: "team", value: ama.teamId },
  });
  await announce({
    title: "For Kofi",
    display: "inbox",
    audience: { kind: "person", value: kofi.id },
  });
  const titles = async (who: { cookie: string }) =>
    (await inbox(who)).announcements.map((entry: { title: string }) => entry.title).sort();
  assert.deepEqual(await titles(kofi), ["For Kofi", "Pro tip"]);
  assert.deepEqual(await titles(ama), ["For Ama's team"]);
  assert.equal((await inbox(kofi)).unread, 2, "the bell counts what is unread");
});

test("only between its start and end", async () => {
  const later = await announce({
    title: "Coming soon",
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  assert.equal(later.live, false);
  assert.ok(!(await inbox(ama)).banners.some((entry: { id: string }) => entry.id === later.id));
  const now = await announce({ title: "Today only" });
  assert.ok((await inbox(ama)).banners.some((entry: { id: string }) => entry.id === now.id));
  const ended = await admin("PATCH", `/announcements/${now.id}`, {
    endsAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal(ended.statusCode, 400, "an end before the start is refused");
  await admin("PATCH", `/announcements/${now.id}`, {
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.ok(!(await inbox(ama)).banners.some((entry: { id: string }) => entry.id === now.id));
});

test("what an announcement may say and link to", async () => {
  for (const bad of [
    { title: "x", link: { url: "javascript:alert(1)" } },
    { title: "x", link: { url: "//evil.example.com" } },
    { title: "x", link: { url: "http://plain.example.com" } },
    { title: "" },
    { title: "x", level: "shouting" },
    { title: "x", audience: { kind: "team", value: "tem_nope" } },
    { title: "x", startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-01-01T00:00:00Z" },
  ]) {
    const response = await admin("POST", "/announcements", bad);
    assert.ok(
      [400, 404].includes(response.statusCode),
      `${JSON.stringify(bad)} → ${response.statusCode}`,
    );
  }
  const ok = await admin("POST", "/announcements", {
    title: "Status page",
    link: { url: "https://status.example.com", label: "Status" },
  });
  assert.equal(ok.statusCode, 201);
});

test("a message to one person: in their bell, theirs to read", async () => {
  const sent = await admin("POST", "/notifications", {
    accountIds: [ama.id],
    title: "Your build failed three times",
    body: "Here is what usually fixes it.",
    link: { url: "/docs" },
  });
  assert.equal(sent.statusCode, 201, sent.body);
  const mine = await inbox(ama);
  assert.equal(mine.notifications[0].title, "Your build failed three times");
  assert.equal(mine.notifications[0].read, false);
  assert.equal((await inbox(kofi)).notifications.length, 0);

  // Kofi cannot mark Ama's message.
  await as(kofi.cookie, "POST", `/api/inbox/notifications/${sent.json().ids[0]}/read`);
  assert.equal((await inbox(ama)).notifications[0].read, false);
  await as(ama.cookie, "POST", `/api/inbox/notifications/${sent.json().ids[0]}/read`);
  assert.equal((await inbox(ama)).notifications[0].read, true);

  await admin("POST", "/notifications", { accountIds: [ama.id], title: "One" });
  await admin("POST", "/notifications", { accountIds: [ama.id], title: "Two" });
  await as(ama.cookie, "POST", "/api/inbox/notifications/read-all");
  assert.ok((await inbox(ama)).notifications.every((entry: { read: boolean }) => entry.read));
  assert.equal(
    (await admin("POST", "/notifications", { accountIds: ["usr_nope"], title: "x" })).statusCode,
    404,
  );
});

test("an announcement someone cannot see cannot be marked by them", async () => {
  const forKofi = await announce({
    title: "Only Kofi",
    audience: { kind: "person", value: kofi.id },
  });
  const response = await as(ama.cookie, "POST", `/api/inbox/announcements/${forKofi.id}/dismiss`);
  assert.equal(response.statusCode, 404);
});

test("maintenance: shown to everyone, and new building waits while it is on", async () => {
  const set = await admin("PUT", "/maintenance", {
    message: "Moving to a bigger machine.",
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    pauseBuilds: true,
  });
  assert.equal(set.statusCode, 200, set.body);
  const shown = (await inbox(ama)).maintenance;
  assert.equal(shown.message, "Moving to a bigger machine.");
  assert.equal(shown.underway, true);

  const app = await as(ama.cookie, "POST", "/api/projects", { name: "During maintenance" });
  assert.equal(app.statusCode, 201, "making an app is fine; building waits");
  const preview = await as(
    ama.cookie,
    "POST",
    `/api/projects/${app.json().project.id}/preview/start`,
  );
  assert.equal(preview.statusCode, 503);
  assert.equal(preview.json().error.message, "Moving to a bigger machine.");

  await admin("DELETE", "/maintenance");
  assert.equal((await inbox(ama)).maintenance, null);
  const bad = await admin("PUT", "/maintenance", {
    message: "x",
    startsAt: "2026-02-01T00:00:00Z",
    endsAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(bad.statusCode, 400);
});

test("only a key with `notify` talks to people", async () => {
  const analytics = (
    await as(adminCookie, "POST", "/api/admin-keys", { name: "Numbers", scopes: ["analytics"] })
  ).json().key;
  const refused = await server.app.inject({
    method: "POST",
    url: "/api/admin/v1/announcements",
    headers: { authorization: `Bearer ${analytics}` },
    payload: { title: "x" },
  });
  assert.equal(refused.statusCode, 403);
});

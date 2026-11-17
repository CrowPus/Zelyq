import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import { eventsFromEnv, type ServerConfig } from "../src/config.js";
import { EventsOut, signEvent, verifyEventSignature } from "../src/services/events-out.js";
import { HealthWatch } from "../src/services/observability.js";

/**
 * Events for an account service: written when something happens, sent signed
 * to the receiver, retried while it is down, and readable through the admin API.
 */

const tmp = path.join(os.tmpdir(), `zelyq-events-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const SECRET = "test-secret-that-is-long-enough-1234";

type Received = { id: string; type: string; data: Record<string, unknown>; signed: boolean };
const received: Received[] = [];
let failNext = 0;

const receiver = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    if (failNext > 0) {
      failNext -= 1;
      res.statusCode = 503;
      res.end();
      return;
    }
    const event = JSON.parse(body);
    received.push({
      ...event,
      signed: verifyEventSignature(SECRET, String(req.headers["zelyq-signature"]), body),
    });
    res.statusCode = 204;
    res.end();
  });
});

let server: ZelyqServer;
let adminCookie = "";
let key = "";

const as = (cookie: string, method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
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

async function register(email: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: email.split("@")[0], password: "a-long-password-1" },
  });
  assert.equal(response.statusCode, 201, response.body);
  const session = response.cookies.find((c) => c.name === "zelyq_session")!;
  return { cookie: `zelyq_session=${session.value}`, body: response.json() };
}

/** Everything recorded so far has been offered to the receiver. */
async function flush() {
  await server.activity.settled();
  await server.errors.settled();
  await server.eventsOut.settled();
  await server.eventsOut.deliver();
}

const of = (type: string) => received.filter((event) => event.type === type);

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const address = receiver.address();
  const port = typeof address === "object" && address ? address.port : 0;
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
    events: { url: `http://127.0.0.1:${port}/zelyq-events`, secret: SECRET },
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
      previewPortRange: [4982, 4984],
      previewHost: "127.0.0.1",
    },
  } as ServerConfig;
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  adminCookie = (await register("admin@example.com")).cookie;
  key = (
    await as(adminCookie, "POST", "/api/admin-keys", { name: "Cloud", scopes: ["events", "teams"] })
  ).json().key;
});

after(async () => {
  await server.close();
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

test("the settings: a URL needs a long secret, and https outside this machine", () => {
  assert.equal(eventsFromEnv({}), undefined);
  assert.throws(
    () => eventsFromEnv({ ZELYQ_EVENTS_URL: "https://cloud.example.com/hook" }),
    /SECRET/,
  );
  assert.throws(() =>
    eventsFromEnv({
      ZELYQ_EVENTS_URL: "http://cloud.example.com/hook",
      ZELYQ_EVENTS_SECRET: SECRET,
    }),
  );
  assert.deepEqual(
    eventsFromEnv({
      ZELYQ_EVENTS_URL: "https://cloud.example.com/hook",
      ZELYQ_EVENTS_SECRET: SECRET,
    }),
    { url: "https://cloud.example.com/hook", secret: SECRET },
  );
});

test("a signature is checked by time and body; a changed body or an old one fails", () => {
  const body = '{"id":"obx_1"}';
  const now = Date.now();
  const t = Math.floor(now / 1000);
  const header = `t=${t},v1=${signEvent(SECRET, t, body)}`;
  assert.equal(verifyEventSignature(SECRET, header, body, 300, now), true);
  assert.equal(verifyEventSignature(SECRET, header, `${body} `, 300, now), false);
  assert.equal(verifyEventSignature("another-secret-entirely-1234", header, body, 300, now), false);
  assert.equal(verifyEventSignature(SECRET, header, body, 300, now + 10 * 60_000), false);
});

test("a sign-up reaches the receiver, signed: the account and its team", async () => {
  const ama = await register("ama@example.com");
  await flush();
  const created = of("account.created").find((event) => event.data.accountId === ama.body.user.id);
  assert.ok(created, JSON.stringify(received));
  assert.equal(created.signed, true);
  assert.equal(created.data.teamId, ama.body.teams[0].id);
  assert.equal(created.data.via, "password");
  assert.ok(of("team.created").some((event) => event.data.teamId === ama.body.teams[0].id));
  assert.equal(new Set(received.map((event) => event.id)).size, received.length, "each id once");
});

test("members joining and leaving, a status change and a resume are said", async () => {
  const login = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "ama@example.com", password: "a-long-password-1" },
  });
  const session = login.cookies.find((c) => c.name === "zelyq_session")!;
  const amaCookie = `zelyq_session=${session.value}`;
  const teamId = login.json().teams[0].id;
  const kofi = await register("kofi@example.com");
  await as(amaCookie, "POST", `/api/teams/${teamId}/members`, {
    email: "kofi@example.com",
    role: "editor",
  });
  await as(amaCookie, "DELETE", `/api/teams/${teamId}/members/${kofi.body.user.id}`);
  await admin("PUT", `/teams/${teamId}/status`, { status: "paused", reason: "unused" });
  await as(amaCookie, "POST", `/api/teams/${teamId}/resume`);
  await flush();
  assert.ok(of("team.member_added").some((event) => event.data.accountId === kofi.body.user.id));
  const left = of("team.member_removed").find(
    (event) => event.data.accountId === kofi.body.user.id,
  );
  assert.ok(left);
  assert.equal(left.data.byThemselves, false);
  assert.ok(
    of("team.status_changed").some(
      (event) => event.data.teamId === teamId && event.data.status === "paused",
    ),
  );
  assert.ok(of("team.resumed").some((event) => event.data.teamId === teamId));
});

test("a new kind of server error, and a deleted team, are said", async () => {
  server.errors.capture(new Error("Database fell over in a brand new way"));
  const quiet = await register("quiet@example.com");
  const teamId = quiet.body.teams[0].id;
  await admin("PUT", `/teams/${teamId}/status`, { status: "suspended" });
  const deleted = await admin("DELETE", `/teams/${teamId}`);
  assert.equal(deleted.statusCode, 200, deleted.body);
  await flush();
  const error = of("error.new").find(
    (event) => event.data.message === "Database fell over in a brand new way",
  );
  assert.ok(error);
  assert.ok(error.data.groupId);
  assert.ok(of("team.deleted").some((event) => event.data.teamId === teamId));
});

test("while the receiver is down, events wait and are retried; none is lost or sent twice", async () => {
  const before = received.length;
  failNext = 1;
  await register("during-outage@example.com");
  await flush();
  const pending = (await admin("GET", "/events?limit=1000"))
    .json()
    .events.filter(
      (event: { delivery: { status: string } }) => event.delivery.status === "pending",
    );
  assert.ok(pending.length >= 1, "the failed one waits");
  assert.equal(pending[0].delivery.lastError, "answered 503");
  assert.ok(received.length >= before, "the rest went on");
  // Its time comes round again: make it due now and deliver.
  for (const event of pending) {
    await server.store.outbox.retryLater(event.id, {
      attempts: event.delivery.attempts,
      nextAttemptAt: new Date(0).toISOString(),
      lastError: "answered 503",
      failed: false,
    });
  }
  await server.eventsOut.deliver();
  const after = (await admin("GET", "/events?limit=1000")).json().events;
  assert.ok(
    after.every((event: { delivery: { status: string } }) => event.delivery.status === "delivered"),
  );
  assert.equal(new Set(received.map((event) => event.id)).size, received.length, "nothing twice");
  assert.ok(
    received.some((event) => event.data.via === "password" && event.type === "account.created"),
  );
});

test("the waits grow, and an event is given up after three days", async () => {
  let now = Date.parse("2026-01-01T00:00:00Z");
  const tries: number[] = [];
  const flaky = new EventsOut(server.store, {
    target: { url: "http://127.0.0.1:1/nowhere", secret: SECRET },
    now: () => now,
    fetch: (async () => {
      tries.push(now);
      return new Response(null, { status: 500 });
    }) as typeof fetch,
  });
  flaky.emit("health.down", { checks: [] });
  await flaky.settled();
  // Its clock says January: found by that, not by being the newest.
  const id = (await server.store.outbox.after(null, 10_000)).find((row) =>
    row.createdAt.startsWith("2026-01-01"),
  )!.id;
  const waits: number[] = [];
  for (let i = 0; i < 12; i++) {
    const row = (await server.store.outbox.findById(id))!;
    if (row.status !== "pending") break;
    now = Math.max(now, Date.parse(row.nextAttemptAt));
    const last = tries.at(-1);
    await flaky.deliver();
    if (last !== undefined) waits.push(tries.at(-1)! - last);
  }
  assert.deepEqual(waits.slice(0, 3), [30_000, 60_000, 120_000]);
  assert.ok(waits.every((wait) => wait <= 6 * 60 * 60_000));
  now += 3 * 24 * 60 * 60_000;
  await server.store.outbox.retryLater(id, {
    attempts: 20,
    nextAttemptAt: new Date(now).toISOString(),
    lastError: "x",
    failed: false,
  });
  await flaky.deliver();
  assert.equal((await server.store.outbox.findById(id))!.status, "failed");
});

test("reading events back: after a cursor, by type, a page at a time", async () => {
  const all = (await admin("GET", "/events?limit=1000")).json();
  assert.ok(all.events.length > 5);
  const first = (await admin("GET", "/events?limit=2")).json();
  assert.equal(first.events.length, 2);
  assert.ok(first.next);
  const second = (await admin("GET", `/events?limit=2&after=${first.next}`)).json();
  assert.equal(second.events[0].id, all.events[2].id);
  const accounts = (await admin("GET", "/events?type=account.created&limit=1000")).json().events;
  assert.ok(accounts.length >= 3);
  assert.ok(accounts.every((event: { type: string }) => event.type === "account.created"));
  assert.equal((await admin("GET", "/events?type=made.up")).statusCode, 400);
  assert.equal((await admin("GET", "/events?after=obx_nope")).statusCode, 400);
});

test("a server nobody listens to keeps no events; one key with `events` is enough", async () => {
  const quietStore = server.store;
  const nobody = new EventsOut(quietStore, {});
  const count = async () => (await quietStore.outbox.after(null, 100_000)).length;
  // The only events key is revoked for this check.
  const keys = await quietStore.adminKeys.list();
  const eventsKeys = keys.filter(
    (entry) => !entry.revokedAt && JSON.parse(entry.scopes).includes("events"),
  );
  for (const entry of eventsKeys)
    await quietStore.adminKeys.revoke(entry.id, new Date().toISOString());
  const before = await count();
  nobody.emit("health.down", { checks: [] });
  await nobody.settled();
  assert.equal(await count(), before, "nobody could read it: nothing kept");

  await as(adminCookie, "POST", "/api/admin-keys", { name: "Reader", scopes: ["events"] });
  nobody.keysChanged();
  nobody.emit("health.down", { checks: [] });
  await nobody.settled();
  assert.equal(await count(), before + 1);
});

test("the health watch says when the server goes down and when it comes back, not every check", async () => {
  const said: Array<{ down: boolean; names: string[] }> = [];
  let status = "ok";
  const watch = new HealthWatch(
    async () => ({
      status,
      checks: [{ name: "agent", status: status === "down" ? "down" : "ok", detail: "x" }] as never,
    }),
    {
      listening: async () => true,
      changed: (down, checks) => said.push({ down, names: checks.map((check) => check.name) }),
    },
  );
  await watch.tick();
  status = "down";
  await watch.tick();
  await watch.tick();
  status = "ok";
  await watch.tick();
  assert.deepEqual(said, [
    { down: true, names: ["agent"] },
    { down: false, names: [] },
  ]);
});

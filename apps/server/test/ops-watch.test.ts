import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { User } from "@zelyq/core";
import { runMigrations, type Store } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import {
  CheckService,
  ESCALATE_AFTER_MS,
  type WatchEvent,
} from "../src/services/ops/watch/checks.js";
import {
  type MachineFacts,
  type ProbeResult,
  probeAddress,
  readMachine,
} from "../src/services/ops/watch/probes.js";

/**
 * The watch (075 Step 1): what is watched follows Zelyq's records; each rule
 * for "failing" (twice in a row, ten minutes slow, disk, unreachable); one
 * alert per problem, closed when it passes; escalation, acknowledge, silence;
 * the status view; nothing needs the model or the spending cap.
 */

const tmp = path.join(os.tmpdir(), `zelyq-ops-watch-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "ops-watch.db")}`,
  agentUrl: "http://127.0.0.1:59995",
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
    previewPortRange: [4948, 4951],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let store: Store;
let teamId: string;
let ownerCookie: string;
let owner: User;
let second: User;
let app: http.Server;
let appUrl: string;
let appMode: "ok" | "error" = "ok";

/** What the stand-in probes say: the test sets it, step by step. */
const say = {
  address: null as ProbeResult | null,
  machine: null as MachineFacts | Error | null,
};
const events: WatchEvent[] = [];
let watch: CheckService;

const minutes = (base: Date, count: number) => new Date(base.getTime() + count * 60_000);
const facts = (state: string, disk = 40): MachineFacts =>
  // As a deploy behind the proxy names it: with its number, found by its deployment label.
  readMachine(
    `disk ${disk}%\nmem 60\nload 0.3 4\nc zelyq-shop-production-7|${state}|dep_watch_shop|\nc zelyq-shop-production-worker|running|dep_watch_shop|worker\n`,
  );

async function register(email: string, name: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}
const as = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as never }),
  });

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  store = server.store;
  ownerCookie = await register("owner@example.com", "Owner");
  const secondCookie = await register("second@example.com", "Second");
  teamId = (await as(ownerCookie, "GET", "/api/teams")).json().teams[0].id;
  await as(ownerCookie, "POST", `/api/teams/${teamId}/members`, {
    email: "second@example.com",
    role: "admin",
  });
  void secondCookie;
  owner = (await store.users.findByEmail("owner@example.com")) as unknown as User;
  second = (await store.users.findByEmail("second@example.com")) as unknown as User;
  await as(ownerCookie, "POST", `/api/teams/${teamId}/ops`);

  // A real little app to answer (or not).
  app = http.createServer((_request, response) => {
    response.statusCode = appMode === "ok" ? 200 : 503;
    response.end("hi");
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;

  const now = new Date().toISOString();
  await store.pipelines.runners.create({
    id: "rnr_watch_box",
    teamId,
    kind: "ssh",
    name: "box",
    host: "203.0.113.30",
    port: 22,
    username: "zelyq",
    labels: "[]",
    description: null,
    enabled: true,
    maxConcurrent: 0,
    cpus: 4,
    memoryMb: 8192,
    os: "linux",
    shells: "[]",
    tools: "[]",
    hostKey: null,
    hostKeyFingerprint: null,
    lastTestAt: null,
    lastTestOk: null,
    lastLatencyMs: null,
    lastTestMessage: null,
    acceptedKeyFingerprint: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  });
  await store.deploy.environments.create({
    id: "env_watch_production",
    teamId,
    name: "production",
    runnerId: "rnr_watch_box",
    address: "203.0.113.30",
    domain: null,
    https: "auto",
    httpPort: 80,
    httpsPort: 443,
    protected: true,
    frozen: false,
    frozenReason: null,
    opsTrust: "ask",
    variables: "{}",
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  } as never);
  await store.deploy.deployments.create({
    id: "dep_watch_shop",
    teamId,
    environmentId: "env_watch_production",
    app: "shop",
    status: "live",
    kind: "deploy",
    image: "zelyq-shop:1",
    rolledBackTo: null,
    promotedFrom: null,
    runId: null,
    triggeredBy: null,
    url: appUrl,
    port: 3000,
    hostPort: 3000,
    healthPath: "/",
    options: "{}",
    changedDatabase: false,
    error: null,
    log: "",
    createdAt: now,
    finishedAt: now,
  } as never);

  watch = new CheckService(
    store,
    { target: async () => ({}) as never },
    {
      probeAddress: async (url: string) => say.address ?? probeAddress(url),
      probeCertificate: async () => ({
        ok: true,
        ms: 0,
        daysLeft: 60,
        detail: "valid, 60 days left",
      }),
      probeDomain: async () => ({ ok: true, ms: 0, detail: "leads to its machine" }),
      machine: async () => {
        if (say.machine instanceof Error) throw say.machine;
        return say.machine ?? facts("running");
      },
    },
  );
  watch.events = (event) => events.push(event);
});

after(async () => {
  await server?.close();
  await new Promise((resolve) => app?.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true });
});

const checkOf = async (kind: string) =>
  (await store.ops.checks.listForTeam(teamId)).find((row) => row.kind === kind)!;

test("what is watched follows Zelyq's records: an app with an address, its machine; no certificate for a bare address", async () => {
  await watch.sync(teamId);
  const kinds = (await store.ops.checks.listForTeam(teamId)).map((row) => row.kind).sort();
  assert.deepEqual(kinds, ["address", "app", "machine", "speed"]);
  const address = await checkOf("address");
  assert.equal(address.title, "shop on production answers");
});

test("an app that stops answering: no alert at the first miss, an urgent one at the second, closed when it answers again", async () => {
  const start = new Date("2026-11-14T10:00:00Z");
  await watch.tick(start);
  assert.equal((await checkOf("address")).state, "ok");
  appMode = "error";
  await watch.tick(minutes(start, 1));
  assert.equal(
    events.filter((event) => event.kind === "alert_opened").length,
    0,
    "one miss is a maybe",
  );
  await watch.tick(minutes(start, 2));
  const opened = events.filter((event) => event.kind === "alert_opened");
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.alert.severity, "urgent");
  assert.equal(opened[0]?.alert.title, "shop on production does not answer");
  assert.deepEqual(opened[0]?.to, [owner.id], "the first admin hears first");
  // One alert per problem, not one per minute.
  await watch.tick(minutes(start, 3));
  assert.equal(events.filter((event) => event.kind === "alert_opened").length, 1);
  appMode = "ok";
  await watch.tick(minutes(start, 4));
  const closed = events.filter((event) => event.kind === "alert_closed");
  assert.equal(closed.length, 1);
  assert.equal(closed[0]?.alert.closedHow, "back by itself");
});

test("slow is judged against the app's own normal, and only after ten minutes of it", async () => {
  const start = new Date("2026-11-14T11:00:00Z");
  events.length = 0;
  say.address = { ok: true, ms: 100, detail: "answered 200 in 100 ms" };
  for (let minute = 0; minute < 5; minute += 1) await watch.tick(minutes(start, minute));
  const learned = (await checkOf("speed")).normalMs ?? 0;
  assert.ok(learned > 0, "it has learned a normal");
  say.address = { ok: true, ms: 1500, detail: "answered 200 in 1500 ms" };
  for (let minute = 5; minute < 14; minute += 1) await watch.tick(minutes(start, minute));
  assert.equal(
    events.filter((event) => event.kind === "alert_opened").length,
    0,
    "under ten minutes",
  );
  for (let minute = 14; minute < 17; minute += 1) await watch.tick(minutes(start, minute));
  const slow = events.find((event) => event.kind === "alert_opened");
  assert.equal(slow?.alert.severity, "warning");
  assert.match(String(slow?.alert.title), /slower than usual/);
  assert.ok(
    ((await checkOf("speed")).normalMs ?? 0) < 200,
    "slowness does not become the new normal",
  );
  say.address = { ok: true, ms: 100, detail: "answered 200 in 100 ms" };
  await watch.tick(minutes(start, 18));
  assert.ok(events.some((event) => event.kind === "alert_closed"));
  say.address = null;
});

test("a stopped container and a full disk are seen on one visit to the machine; an unreachable machine is urgent", async () => {
  const start = new Date("2026-11-14T12:00:00Z");
  events.length = 0;
  say.machine = facts("exited", 91);
  await watch.tick(start);
  await watch.tick(minutes(start, 5));
  const titles = events
    .filter((event) => event.kind === "alert_opened")
    .map((event) => event.alert.title);
  assert.ok(titles.includes("shop on production is not running properly"), JSON.stringify(titles));
  assert.ok(titles.includes("box needs attention"), JSON.stringify(titles));
  const machine = events.find((event) => event.alert.title === "box needs attention")?.alert;
  assert.equal(machine?.severity, "warning");
  assert.match(String(machine?.detail), /disk 91% full/);
  say.machine = facts("running", 40);
  await watch.tick(minutes(start, 10));
  assert.equal((await store.ops.alerts.listOpen(teamId)).length, 0);

  // The whole machine goes away, and its app with it: one cause, one alert.
  events.length = 0;
  say.machine = new Error("connection refused");
  appMode = "error";
  for (let minute = 15; minute <= 20; minute += 1) await watch.tick(minutes(start, minute));
  const opened = events.filter((event) => event.kind === "alert_opened");
  assert.deepEqual(
    opened.map((event) => event.alert.title),
    ["box cannot be reached"],
    "the machine's alert, not one more per app on it",
  );
  assert.equal(opened[0]?.alert.severity, "urgent");
  // An app on a machine nobody can reach is "not known", never "fine".
  assert.equal((await checkOf("app")).state, "unknown");
  assert.equal((await checkOf("address")).state, "failing", "still recorded, only not raised");
  say.machine = null;
  appMode = "ok";
  await watch.tick(minutes(start, 25));
  assert.equal((await store.ops.alerts.listOpen(teamId)).length, 0);
});

test("an app being deployed is not judged while its container is replaced", async () => {
  events.length = 0;
  appMode = "error";
  await store.deploy.deployments.update("dep_watch_shop", { status: "deploying" } as never);
  const start = new Date("2026-11-14T13:00:00Z");
  await watch.tick(start);
  await watch.tick(minutes(start, 1));
  await watch.tick(minutes(start, 2));
  assert.equal(events.length, 0);
  await store.deploy.deployments.update("dep_watch_shop", { status: "live" } as never);
  appMode = "ok";
  await watch.tick(minutes(start, 3));
});

test("an urgent alert nobody answers goes to the next person; acknowledged it stops; silenced it waits", async () => {
  const start = new Date("2026-11-14T14:00:00Z");
  events.length = 0;
  appMode = "error";
  await watch.tick(start);
  await watch.tick(minutes(start, 1));
  const alert = (await store.ops.alerts.listOpen(teamId))[0]!;
  assert.deepEqual(events.find((event) => event.kind === "alert_opened")?.to, [owner.id]);
  await watch.tick(new Date(start.getTime() + 60_000 + ESCALATE_AFTER_MS + 1000));
  const moved = events.find((event) => event.kind === "alert_escalated");
  assert.deepEqual(moved?.to, [second.id], "it went to the second admin");

  // Silenced for planned work: nothing more; the clock starts again when the silence ends.
  events.length = 0;
  const silencedAt = new Date(start.getTime() + 20 * 60_000);
  await watch.silence(alert.id, owner.id, 30, silencedAt);
  await watch.tick(new Date(silencedAt.getTime() + 25 * 60_000));
  assert.equal(events.filter((event) => event.kind === "alert_escalated").length, 0);

  // Acknowledged: it stops moving on.
  await watch.acknowledge(alert.id, second.id);
  await watch.tick(new Date(silencedAt.getTime() + 120 * 60_000));
  assert.equal(events.filter((event) => event.kind === "alert_escalated").length, 0);
  appMode = "ok";
  await watch.tick(new Date(silencedAt.getTime() + 121 * 60_000));
  assert.equal((await store.ops.alerts.listOpen(teamId)).length, 0);
});

test("checks run whatever the spending cap: the watch needs no model", async () => {
  await as(ownerCookie, "PATCH", `/api/teams/${teamId}/ops`, { monthlyTokenCap: 0, paused: true });
  const before = (await checkOf("address")).lastCheckedAt;
  await watch.tick(new Date("2026-11-14T18:00:00Z"));
  assert.notEqual((await checkOf("address")).lastCheckedAt, before);
  await as(ownerCookie, "PATCH", `/api/teams/${teamId}/ops`, {
    monthlyTokenCap: null,
    paused: false,
  });
});

test("a deploying pipeline that fails is an alert; its next pass closes it", async () => {
  const pipeline = (
    await as(ownerCookie, "POST", `/api/teams/${teamId}/pipelines`, {
      source:
        "name: Ship shop\nruns-on: local\nstages:\n  - name: S\n    steps:\n      - deploy: {to: production, app: shop, port: 3000}\n",
    })
  ).json().pipeline;
  await watch.sync(teamId);
  events.length = 0;
  await watch.runFinished(teamId, pipeline.id, "failed", "#7");
  const opened = events.find((event) => event.kind === "alert_opened");
  assert.equal(opened?.alert.title, "Pipeline Ship shop failed");
  await watch.runFinished(teamId, pipeline.id, "passed", "#8");
  assert.ok(events.some((event) => event.kind === "alert_closed"));
});

test("the status view: a light per app, uptime from the hours, alerts; only a person acknowledges or switches a check off", async () => {
  const status = (await as(ownerCookie, "GET", `/api/teams/${teamId}/ops/status`)).json();
  const shop = status.apps.find((row: { app: string }) => row.app === "shop");
  assert.equal(shop.light, "green");
  assert.ok(shop.uptime30d > 0 && shop.uptime30d < 100, String(shop.uptime30d));
  assert.equal(status.watchedFromTwoPlaces, false);
  assert.ok(status.recent.length > 0);

  const check = await checkOf("speed");
  const stranger = await register("stranger@example.com", "Stranger");
  assert.equal((await as(stranger, "GET", `/api/teams/${teamId}/ops/status`)).statusCode, 404);
  const off = await as(ownerCookie, "PATCH", `/api/teams/${teamId}/ops/checks/${check.id}`, {
    enabled: false,
  });
  assert.equal(off.statusCode, 200, off.body);
  assert.equal((await checkOf("speed")).enabled, false);
  // The records do not switch it back on.
  await watch.sync(teamId);
  assert.equal((await checkOf("speed")).enabled, false);
});

test("a certificate is checked only for a site served by name over public HTTPS", async () => {
  const before = (await store.ops.checks.listForTeam(teamId)).filter(
    (row) => row.kind === "certificate",
  );
  assert.equal(before.length, 0, "an http address by IP has none");
  await store.deploy.environments.update("env_watch_production", {
    domain: "shop.example.org",
    https: "internal",
  } as never);
  await store.deploy.deployments.update("dep_watch_shop", {
    url: "https://shop.example.org",
  } as never);
  const internal = (await watch.wanted(teamId)).filter((want) => want.kind === "certificate");
  assert.equal(internal.length, 0, "Zelyq's own certificates are not judged as public ones");
  await store.deploy.environments.update("env_watch_production", { https: "auto" } as never);
  const auto = (await watch.wanted(teamId)).filter((want) => want.kind === "certificate");
  assert.equal(auto.length, 1);
  await store.deploy.environments.update("env_watch_production", { domain: null } as never);
  await store.deploy.deployments.update("dep_watch_shop", { url: appUrl } as never);
});

test("the normal does not drift towards a slow week; a check switched back on starts afresh", async () => {
  const speed = await checkOf("speed");
  await store.ops.checks.update(speed.id, {
    normalMs: 100,
    enabled: true,
    failures: 0,
    failingSince: null,
  });
  const at = new Date("2026-11-15T09:00:00Z");
  for (let index = 0; index < 60; index += 1) {
    await watch.record(
      { ...(await checkOf("speed")) },
      { ok: true, ms: 280, detail: "answered 200 in 280 ms" },
      new Date(at.getTime() + index * 60_000),
    );
  }
  assert.equal((await checkOf("speed")).normalMs, 100, "280 ms is not learned as normal");

  const address = await checkOf("address");
  await store.ops.checks.update(address.id, { failures: 5, failingSince: at.toISOString() });
  await watch.setEnabled(address.id, teamId, false, owner.id);
  await watch.setEnabled(address.id, teamId, true, owner.id);
  const fresh = await checkOf("address");
  assert.equal(fresh.failures, 0);
  assert.equal(fresh.failingSince, null);
});

test("right after a new deploy, the check follows the new container at once: no false alert", async () => {
  events.length = 0;
  const start = new Date("2026-11-15T12:00:00Z");
  // The records were read just now: the next read is five minutes away.
  await watch.sync(teamId, start);
  const now = new Date().toISOString();
  await store.deploy.deployments.create({
    id: "dep_watch_shop_2",
    teamId,
    environmentId: "env_watch_production",
    app: "shop",
    status: "live",
    kind: "deploy",
    image: "zelyq-shop:2",
    rolledBackTo: null,
    promotedFrom: null,
    runId: null,
    triggeredBy: null,
    url: appUrl,
    port: 3000,
    hostPort: 3000,
    healthPath: "/",
    options: "{}",
    changedDatabase: false,
    error: null,
    log: "",
    createdAt: now,
    finishedAt: now,
  } as never);
  await store.deploy.deployments.update("dep_watch_shop", { status: "replaced" } as never);
  // The machine now runs only the new container, with the new deployment's label.
  say.machine = readMachine("c zelyq-shop-production-8|running|dep_watch_shop_2|\n");
  await watch.tick(minutes(start, 1));
  await watch.tick(minutes(start, 2));
  assert.equal(
    events.filter((event) => event.kind === "alert_opened").length,
    0,
    JSON.stringify(events),
  );
  assert.equal((await checkOf("app")).state, "ok");
  say.machine = null;
});

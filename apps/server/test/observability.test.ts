import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { cleanProductDetail, newId, type ProductEventName } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { scrub } from "../src/services/observability.js";

/**
 * What developers see through the admin API: every part's health, server
 * errors grouped (with secrets taken out), why work fails, and how fast the
 * server answers.
 */

const tmp = path.join(os.tmpdir(), `zelyq-observability-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

let server: ZelyqServer;
let adminCookie = "";
let devKey = "";

const call = (method: "GET" | "PATCH", url: string, payload?: unknown, key = devKey) =>
  server.app.inject({
    method,
    url: `/api/admin/v1${url}`,
    headers: { authorization: `Bearer ${key}` },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

/** Thrown from one place in this file: the same location every time. */
function failInTheSamePlace(message: string): Error {
  return new Error(message);
}

async function past(name: ProductEventName, detail: Record<string, unknown>, teamId = "tem_obs") {
  await server.store.productEvents.record({
    id: newId("productEvent"),
    name,
    userId: "usr_obs",
    teamId,
    projectId: null,
    detail: cleanProductDetail(name, detail),
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  });
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
    // Nothing listens here: the agent check must say so.
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
      previewPortRange: [4975, 4978],
      previewHost: "127.0.0.1",
    },
  } as ServerConfig;
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  // A call that breaks the way a real bug would: not one of our own answers.
  server.app.get("/api/test-only/crash", async () => {
    const broken = undefined as unknown as { name: string };
    return { name: broken.name };
  });
  server.app.get("/api/test-only/refused", async () => {
    throw new (await import("@zelyq/core")).ZelyqError("forbidden", "Not yours.");
  });
  const setup = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "admin@example.com", name: "Admin", password: "a-long-password-1" },
  });
  const session = setup.cookies.find((c) => c.name === "zelyq_session")!;
  adminCookie = `zelyq_session=${session.value}`;
  devKey = (
    await server.app.inject({
      method: "POST",
      url: "/api/admin-keys",
      headers: { cookie: adminCookie },
      payload: { name: "Developers", scopes: ["health", "errors", "metrics"] },
    })
  ).json().key;
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

test("secrets are taken out of anything stored about an error", () => {
  const dirty = [
    "Anthropic said no to sk-ant-api03-abcdefghijklmnopqrstuv",
    "gemini key AIzaSyA1234567890abcdefghijklmnop failed",
    "header Authorization: Bearer abc.def.ghijklmnop",
    'body {"password":"hunter2-very-secret"} and token=xyz123456',
    "postgres://zelyq:supersecret@db.internal:5432/zelyq",
    "account ama@example.com could not",
    "agent key zlq_agent_AbCdEf1234567890xyz",
    "github ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  ].join("\n");
  const clean = scrub(dirty);
  for (const secret of [
    "sk-ant-api03",
    "AIzaSyA1234567890",
    "abc.def.ghijklmnop",
    "hunter2",
    "xyz123456",
    "supersecret",
    "ama@example.com",
    "zlq_agent_AbCdEf",
    "ghp_abcdef",
  ]) {
    assert.ok(!clean.includes(secret), `${secret} should be gone from:\n${clean}`);
  }
  assert.match(clean, /Anthropic said no to \[key\]/, "the words around a secret stay");
});

test("the same failure is one group however often it happens; ids and numbers do not split it", async () => {
  server.errors.capture(
    failInTheSamePlace("Could not load project prj_1a2b3c4d5e6f7a8b after 3 tries"),
    {
      route: "GET /api/projects/:id",
      userId: "usr_a",
      teamId: "tem_a",
    },
  );
  server.errors.capture(
    failInTheSamePlace("Could not load project prj_ffffeeeeddddcccc after 5 tries"),
    {
      route: "GET /api/projects/:id",
      userId: "usr_b",
      teamId: "tem_a",
    },
  );
  server.errors.capture(failInTheSamePlace("Something else entirely"), { route: "POST /api/x" });
  await server.errors.settled();

  const list = await call("GET", "/errors");
  assert.equal(list.statusCode, 200, list.body);
  const groups = list.json().groups;
  const load = groups.find((group: { message: string }) =>
    group.message.startsWith("Could not load"),
  );
  assert.ok(load, JSON.stringify(groups));
  assert.equal(load.count, 2);
  assert.equal(load.inRange.count, 2);
  assert.equal(load.inRange.people, 2);
  assert.equal(load.inRange.teams, 1);
  assert.equal(load.status, "open");
  assert.match(load.location, /apps\/server\/test\/observability\.test\.ts/);
  assert.ok(
    groups.some((group: { message: string }) => group.message === "Something else entirely"),
  );
});

test("a stored error never holds the secret that was in it", async () => {
  server.errors.capture(
    new Error("Provider refused key sk-proj-ABCDEFGHIJKLMNOPQRSTUV for kofi@example.com"),
  );
  await server.errors.settled();
  const groups = (await call("GET", "/errors")).json().groups;
  const leaked = JSON.stringify(groups);
  assert.ok(!leaked.includes("sk-proj-ABCDEF"));
  assert.ok(!leaked.includes("kofi@example.com"));
  const group = groups.find((entry: { message: string }) =>
    entry.message.startsWith("Provider refused"),
  );
  const detail = (await call("GET", `/errors/${group.id}`)).json();
  assert.ok(!detail.sampleStack.includes("sk-proj-ABCDEF"));
  assert.equal(detail.last30Days.count, 1);
  assert.equal(detail.byDay.length, 1);
});

test("resolving a group, and it coming back, opens it again and says so", async () => {
  const seen: Array<{ regressed: boolean }> = [];
  server.errors.onNewGroup = (_group, regressed) => seen.push({ regressed });
  server.errors.capture(failInTheSamePlace("Flaky thing broke"));
  await server.errors.settled();
  assert.deepEqual(seen, [{ regressed: false }], "a new group is announced");

  const group = (await call("GET", "/errors"))
    .json()
    .groups.find((entry: { message: string }) => entry.message === "Flaky thing broke");
  const resolved = await call("PATCH", `/errors/${group.id}`, { status: "resolved" });
  assert.equal(resolved.json().status, "resolved");
  assert.ok(resolved.json().resolvedAt);
  assert.equal((await call("GET", "/errors?status=resolved")).json().groups.length, 1);

  server.errors.capture(failInTheSamePlace("Flaky thing broke"));
  await server.errors.settled();
  assert.deepEqual(seen.at(-1), { regressed: true });
  assert.equal((await call("GET", `/errors/${group.id}`)).json().status, "open");

  assert.equal((await call("PATCH", `/errors/${group.id}`, { status: "gone" })).statusCode, 400);
  assert.equal((await call("PATCH", "/errors/egr_nope", { status: "ignored" })).statusCode, 404);
  server.errors.onNewGroup = undefined;
});

test("the deep health check says which part is down, and why; down answers 503", async () => {
  const response = await call("GET", "/health/deep");
  assert.equal(response.statusCode, 503, response.body);
  const report = response.json();
  assert.equal(report.status, "down");
  const check = (name: string) =>
    report.checks.find((entry: { name: string }) => entry.name === name);
  assert.equal(check("database").status, "ok");
  assert.match(check("database").detail, /sqlite/);
  assert.equal(check("agent").status, "down", "nothing listens at the agent's address");
  assert.ok(["ok", "slow", "down"].includes(check("disk").status));
  assert.match(check("disk").detail, /GB free/);
  assert.equal(check("mail").status, "off");
  assert.ok(check("event_loop"));
  assert.ok(check("memory"));
  assert.equal(typeof report.uptimeSeconds, "number");
});

test("why agent work fails, by reason and provider", async () => {
  await past("agent.build_finished", { ok: true, provider: "google", seconds: 30 });
  await past("agent.build_finished", { ok: true, provider: "google", seconds: 90 });
  await past("agent.build_finished", { ok: false, provider: "google", reason: "no_key" });
  await past(
    "agent.build_finished",
    { ok: false, provider: "anthropic", reason: "rate_limited" },
    "tem_two",
  );
  const body = (await call("GET", "/failures/agent")).json();
  assert.equal(body.builds, 4);
  assert.equal(body.failed, 2);
  assert.equal(body.failureRate, 50);
  assert.deepEqual(body.byReason, { no_key: 1, rate_limited: 1 });
  assert.deepEqual(body.byProvider.google, { builds: 3, failed: 1 });
  assert.equal(body.teamsHit, 2);
});

test("failed previews, pipeline runs and deploys", async () => {
  await past("preview.started", { seconds: 4 });
  await past("preview.failed", { reason: "runtime_unavailable" });
  await past("pipeline.run_finished", { ok: false, status: "failed", seconds: 120 });
  await past("pipeline.run_finished", { ok: true, status: "passed", seconds: 60 });
  await past("deploy.finished", { ok: false, kind: "deploy" });
  const body = (await call("GET", "/failures/builds")).json();
  assert.deepEqual(body.previews, { started: 1, failed: 1, byReason: { runtime_unavailable: 1 } });
  assert.deepEqual(body.pipelineRuns, { finished: 2, failed: 1, byStatus: { failed: 1 } });
  assert.deepEqual(body.deploys, { finished: 1, failed: 1, byKind: { deploy: 1 } });
});

test("performance: each call's timing, and how long the main work takes", async () => {
  for (let i = 0; i < 3; i++) {
    await server.app.inject({ method: "GET", url: "/api/auth/status" });
  }
  const body = (await call("GET", "/performance")).json();
  const status = body.routes.find(
    (route: { route: string }) => route.route === "GET /api/auth/status",
  );
  assert.ok(status, JSON.stringify(body.routes));
  assert.ok(status.calls >= 3);
  assert.equal(typeof status.p95Ms, "number");
  assert.equal(body.work.agentTurnSeconds.samples, 2);
  assert.equal(body.work.agentTurnSeconds.p50, 90);
  assert.equal(body.work.previewStartSeconds.samples, 1);
  assert.equal(typeof body.eventLoopDelayMs.p99, "number");
});

test("a feed for Prometheus, Grafana or Google Cloud Monitoring", async () => {
  const response = await call("GET", "/prometheus");
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] as string, /^text\/plain/);
  assert.match(response.body, /^# HELP zelyq_uptime_seconds/m);
  assert.match(
    response.body,
    /zelyq_http_requests_total\{method="GET",route="\/api\/auth\/status",class="2xx"\} \d+/,
  );
  assert.match(response.body, /zelyq_event_loop_delay_p99_ms \d/);
});

test("each call needs its scope; analytics cannot read errors", async () => {
  const analytics = (
    await server.app.inject({
      method: "POST",
      url: "/api/admin-keys",
      headers: { cookie: adminCookie },
      payload: { name: "Marketing", scopes: ["analytics"] },
    })
  ).json().key;
  assert.equal((await call("GET", "/errors", undefined, analytics)).statusCode, 403);
  assert.equal((await call("GET", "/health/deep", undefined, analytics)).statusCode, 403);
  assert.equal((await call("GET", "/prometheus", undefined, analytics)).statusCode, 403);
});

test("a call that crashes is captured where it happened; ordinary refusals are not errors", async () => {
  const crash = await server.app.inject({ method: "GET", url: "/api/test-only/crash" });
  assert.equal(crash.statusCode, 500);
  const refused = await server.app.inject({ method: "GET", url: "/api/test-only/refused" });
  assert.equal(refused.statusCode, 403);
  await server.errors.settled();
  const groups = (await call("GET", "/errors")).json().groups;
  const typeError = groups.find((group: { kind: string }) => group.kind === "TypeError");
  assert.ok(typeError, JSON.stringify(groups));
  assert.equal(typeError.route, "GET /api/test-only/crash");
  assert.ok(!groups.some((group: { message: string }) => group.message === "Not yours."));
  const stats = (await call("GET", "/performance")).json().routes;
  assert.equal(
    stats.find((route: { route: string }) => route.route === "GET /api/test-only/crash")
      .serverErrors,
    1,
  );
});

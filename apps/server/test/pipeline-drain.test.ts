import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Before an update (SIGTERM with ZELYQ_SHUTDOWN_DRAIN_SECONDS): runs already
 * going finish, nothing new starts, and a queued run says it waits for the
 * update — on this server's local runner.
 */

const tmp = path.join(os.tmpdir(), `zelyq-drain-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "drain.db")}`,
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
let owner: string;
let teamId: string;

function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) {
  return server.app.inject({
    method,
    url,
    headers: { cookie: owner },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}
const team = (suffix: string) => `/api/teams/${teamId}${suffix}`;

async function create(source: string): Promise<string> {
  const response = await call("POST", team("/pipelines"), { source });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().pipeline.id;
}

async function start(id: string, body: unknown = {}) {
  return call("POST", team(`/pipelines/${id}/runs`), body);
}

async function finished(runId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = (await call("GET", team(`/pipeline-runs/${runId}`))).json().run;
    if (["passed", "failed", "cancelled", "timed_out"].includes(run.status)) {
      const lines = (await call("GET", team(`/pipeline-runs/${runId}/logs?after=0`))).json().lines;
      return { run, log: lines.map((line: { text: string }) => line.text).join("\n") as string };
    }
    if (Date.now() > deadline) throw new Error(`run ${runId} still ${run.status}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  owner = `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
  teamId = (await call("GET", "/api/teams")).json().teams[0].id;
  await call("PUT", "/api/settings", { pipelineLocalRunner: "host" });
  await call("PUT", "/api/settings", { pipelineLocalConcurrency: 6 });
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const sleeper = (name: string, seconds: number) =>
  `name: ${name}\nruns-on: local\nstages:\n  - name: Work\n    steps: [{run: sleep ${seconds}}]\n`;

async function statusOf(runId: string) {
  return (await call("GET", team(`/pipeline-runs/${runId}`))).json().run;
}

async function until(runId: string, status: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await statusOf(runId);
    if (run.status === status) return run;
    if (Date.now() > deadline) throw new Error(`run ${runId} still ${run.status}, not ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

test("before an update, runs going finish, a new one waits and says why, and the time limit holds", async () => {
  const short = (await start(await create(sleeper("Short", 3)))).json().run.id;
  const long = (await start(await create(sleeper("Long", 60)))).json().run.id;
  await until(short, "running");
  await until(long, "running");

  const draining = server.drain(8_000);
  const later = (await start(await create(sleeper("Later", 1)))).json().run.id;

  const left = await draining;
  // The short run finished normally; the long one was still going at the limit.
  assert.equal((await finished(short)).run.status, "passed");
  assert.equal(left, 1);
  assert.equal((await statusOf(long)).status, "running");

  // Nothing new started meanwhile, and the queued run says it waits for the update.
  const waiting = await statusOf(later);
  assert.equal(waiting.status, "queued");
  const detail = (await call("GET", team(`/pipeline-runs/${later}`))).json();
  assert.equal((detail.queue ?? detail.run.queue)?.reason, "update", JSON.stringify(detail));
});

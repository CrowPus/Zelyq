import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * A plan's "Pipeline runs at once": the team's runs past that number wait in
 * line, say why, and start as one ends. A run waiting for a person does not
 * count. Another team is not held back.
 */

const tmp = path.join(os.tmpdir(), `zelyq-runs-at-once-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "runs-at-once.db")}`,
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
    previewPortRange: [4968, 4971],
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
  const plans = await call("PUT", "/api/plans", {
    plans: [{ id: "free", name: "Free", limits: { runsAtOnce: 1 } }],
    defaultPlan: "free",
  });
  assert.equal(plans.statusCode, 200, plans.body);
  // The server admin's own team stays Unlimited unless put on a plan by name.
  const moved = await call("PUT", `/api/teams/${teamId}/plan`, { plan: "free" });
  assert.equal(moved.statusCode, 200, moved.body);
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const sleeper = (name: string, seconds: number) =>
  `name: ${name}\nruns-on: local\nstages:\n  - name: Work\n    steps: [{run: sleep ${seconds}}]\n`;

async function detail(runId: string) {
  return (await call("GET", team(`/pipeline-runs/${runId}`))).json();
}

async function until(runId: string, status: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { run } = await detail(runId);
    if (run.status === status) return run;
    if (Date.now() > deadline) throw new Error(`run ${runId} still ${run.status}, not ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function usageLine() {
  const lines = (await call("GET", team("/usage"))).json().lines;
  return lines.find((line: { key: string }) => line.key === "runsAtOnce");
}

test("a plan of one run at once: the second waits, says why, and starts when the first ends", async () => {
  const first = (await start(await create(sleeper("First", 4)))).json().run.id;
  await until(first, "running");
  const second = (await start(await create(sleeper("Second", 1)))).json().run.id;

  // It waits, for the plan, behind the first.
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  const waiting = await detail(second);
  assert.equal(waiting.run.status, "queued");
  const queue = waiting.queue ?? waiting.run.queue;
  assert.equal(queue?.reason, "plan", JSON.stringify(waiting));
  assert.equal(queue.places, 1);
  assert.deepEqual(
    queue.blockers.map((blocker: { id: string }) => blocker.id),
    [first],
  );
  assert.deepEqual(
    { used: (await usageLine()).used, limit: (await usageLine()).limit },
    { used: 1, limit: 1 },
  );

  // Nothing fails for it: both pass, one after the other.
  const a = await finished(first);
  const b = await finished(second);
  assert.equal(a.run.status, "passed");
  assert.equal(b.run.status, "passed");
  assert.ok(Date.parse(b.run.startedAt) >= Date.parse(a.run.finishedAt) - 1_000);
});

test("a run waiting for a person does not hold the team's place", async () => {
  const asking = (
    await start(
      await create(
        "name: Asks\nruns-on: local\nstages:\n  - name: Gate\n    steps:\n      - approval: {message: ok}\n",
      ),
    )
  ).json().run.id;
  await until(asking, "waiting");
  const other = (await start(await create(sleeper("Meanwhile", 1)))).json().run.id;
  assert.equal((await finished(other, 30_000)).run.status, "passed");
  await call("POST", team(`/pipeline-runs/${asking}/cancel`));
  await until(asking, "cancelled");
});

test("a pipeline waiting for the one it started never blocks it, even at one run at once", async () => {
  await create(sleeper("Child job", 1));
  const parent = (
    await start(
      await create(
        "name: Parent job\nruns-on: local\nstages:\n  - name: Call\n    steps:\n      - pipeline: {run: Child job}\n",
      ),
    )
  ).json().run.id;
  const done = await finished(parent, 60_000);
  assert.equal(done.run.status, "passed", done.log);
});

test("a plan of zero runs at once says so instead of leaving the run waiting", async () => {
  await call("PUT", "/api/plans", {
    plans: [{ id: "free", name: "Free", limits: { runsAtOnce: 0 } }],
    defaultPlan: "free",
  });
  try {
    const run = (await start(await create(sleeper("Never", 1)))).json().run.id;
    const done = await finished(run, 30_000);
    assert.equal(done.run.status, "failed");
    assert.match(done.run.error ?? done.log, /plan runs no pipelines/);
  } finally {
    await call("PUT", "/api/plans", {
      plans: [{ id: "free", name: "Free", limits: { runsAtOnce: 1 } }],
      defaultPlan: "free",
    });
  }
});

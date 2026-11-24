import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * A run whose end could not be saved: it still ends, Cancel still ends it, and
 * one left as running by something else is found and ended.
 */

const tmp = path.join(os.tmpdir(), `zelyq-stuck-runs-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "stuck-runs.db")}`,
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
    previewPortRange: [4972, 4975],
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

const quick = (name: string) =>
  `name: ${name}\nruns-on: local\nstages:\n  - name: Work\n    steps: [{run: echo hello}]\n`;

/** A run that ended, put back as it looks when its end was never saved. */
async function lostRun(name: string): Promise<string> {
  const runId = (await start(await create(quick(name)))).json().run.id;
  await finished(runId);
  await server.store.pipelines.runs.update(runId, { status: "running", finishedAt: null });
  for (const step of await server.store.pipelines.steps.list(runId)) {
    await server.store.pipelines.steps.update(step.id, { status: "running", finishedAt: null });
  }
  return runId;
}

test("log lines that cannot be written do not leave the run going for ever", async () => {
  const logs = server.store.pipelines.logs;
  const append = logs.append;
  const id = await create(quick("No log"));
  logs.append = async () => {
    throw new Error("database is locked");
  };
  try {
    const { run } = await finished((await start(id)).json().run.id, 30_000);
    // It may fail for it; what matters is that it ends.
    assert.ok(run.finishedAt);
  } finally {
    logs.append = append;
  }
});

test("a run whose end could not be saved the first time still ends", async () => {
  const runs = server.store.pipelines.runs;
  const update = runs.update;
  const id = await create(quick("No end"));
  let failures = 0;
  let broken = 1;
  runs.update = async (runId, patch) => {
    if (patch.finishedAt && failures++ < broken) throw new Error("database is locked");
    return update(runId, patch);
  };
  try {
    const { run } = await finished((await start(id)).json().run.id, 30_000);
    assert.equal(run.status, "passed", "how it really ended is kept");
    failures = 0;
    broken = 3;
    const worse = await finished((await start(id)).json().run.id, 60_000);
    assert.equal(worse.run.status, "failed");
    assert.match(worse.run.error, /lost track of this run/);
  } finally {
    runs.update = update;
  }
});

test("Cancel ends a run that nothing is running any more", async () => {
  const runId = await lostRun("Lost, cancelled");
  const cancelled = await call("POST", team(`/pipeline-runs/${runId}/cancel`));
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  const run = (await call("GET", team(`/pipeline-runs/${runId}`))).json().run;
  assert.equal(run.status, "cancelled");
  assert.ok(run.finishedAt);
  assert.equal(run.steps[0].status, "cancelled");
});

test("a lost run is found and ended by itself; one really going is left alone", async () => {
  const going = (
    await start(
      await create(
        "name: Long\nruns-on: local\nstages:\n  - name: Work\n    steps: [{run: sleep 150}]\n",
      ),
    )
  ).json().run.id;
  const { run } = await finished(await lostRun("Lost, found"), 140_000);
  assert.equal(run.status, "failed");
  assert.match(run.error, /lost track of this run/);
  assert.equal((await call("GET", team(`/pipeline-runs/${going}`))).json().run.status, "running");
  await call("POST", team(`/pipeline-runs/${going}/cancel`));
  assert.equal((await finished(going, 30_000)).run.status, "cancelled");
});

test("Cancel at the moment a run starts stops it", async () => {
  const runs = server.store.pipelines.runs;
  const claim = runs.claim;
  const id = await create(
    "name: Race\nruns-on: local\nstages:\n  - name: Work\n    steps: [{run: sleep 60}]\n",
  );
  // The claim is saved, and the engine hears of it a moment later.
  runs.claim = async (...args) => {
    const row = await claim(...args);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return row;
  };
  try {
    const runId = (await start(id)).json().run.id;
    const deadline = Date.now() + 20_000;
    while ((await runs.findById(runId))?.status === "queued" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await call("POST", team(`/pipeline-runs/${runId}/cancel`));
    assert.equal((await finished(runId, 30_000)).run.status, "cancelled");
  } finally {
    runs.claim = claim;
  }
});

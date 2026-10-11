import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Pipelines group 1 (docs/pipeline-chaining-plan.md): inputs, upstream and
 * downstream with artifacts passed down, the `pipeline` step, one at a time,
 * retry, and keeping runs — on this server's local runner.
 */

const tmp = path.join(os.tmpdir(), `zelyq-chaining-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "chaining.db")}`,
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
    previewPortRange: [4946, 4949],
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

async function runs(id: string) {
  return (await call("GET", team(`/pipelines/${id}/runs`))).json().runs as {
    id: string;
    number: number;
    status: string;
    trigger: string;
    startedAt: string | null;
    finishedAt: string | null;
    upstream: { pipelineName: string; number: number } | null;
    inputs: Record<string, string>;
  }[];
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

async function until<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`gave up waiting: ${JSON.stringify(value)}`);
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
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("inputs: chosen when started, checked, filled in, and kept by Run again", async () => {
  const id = await create(`name: With inputs
runs-on: local
inputs:
  environment: {choices: [staging, production], default: staging}
  version: {description: Which version}
stages:
  - name: A
    steps:
      - run: echo "to=\${{ inputs.environment }} v=$ZELYQ_INPUT_VERSION"
`);
  const missing = await start(id, {});
  assert.equal(missing.statusCode, 400);
  assert.match(missing.body, /version is needed/);
  const wrong = await start(id, { inputs: { environment: "dev", version: "1" } });
  assert.match(wrong.body, /environment must be one of: staging, production/);

  const started = await start(id, { inputs: { environment: "production", version: "1.4" } });
  assert.equal(started.statusCode, 201, started.body);
  const done = await finished(started.json().run.id);
  assert.equal(done.run.status, "passed", done.log);
  assert.match(done.log, /to=production v=1\.4/);
  assert.deepEqual(done.run.inputs, { environment: "production", version: "1.4" });

  const again = await call("POST", team(`/pipeline-runs/${done.run.id}/rerun`), {});
  assert.match((await finished(again.json().run.id)).log, /to=production v=1\.4/);
});

test("upstream and downstream: a pipeline starts after another passes, and takes its artifact", async () => {
  const build = await create(`name: Shop build
runs-on: local
artifacts:
  - name: dist
    path: dist
stages:
  - name: Build
    steps:
      - run: mkdir -p dist && echo "built by build" > dist/out.txt
`);
  const deploy = await create(`name: Shop deploy
runs-on: local
stages:
  - name: Ship
    steps:
      - download: {artifact: dist}
      - run: cat dist/out.txt
`);
  const trigger = await call("POST", team(`/pipelines/${deploy}/triggers`), {
    kind: "pipeline",
    pipelineId: build,
  });
  assert.equal(trigger.statusCode, 201, trigger.body);
  assert.equal(trigger.json().trigger.upstream.name, "Shop build");
  const self = await call("POST", team(`/pipelines/${deploy}/triggers`), {
    kind: "pipeline",
    pipelineId: deploy,
  });
  assert.equal(self.statusCode, 400);

  await finished((await start(build)).json().run.id);
  const [downstream] = await until(
    () => runs(deploy),
    (list) => list.length === 1 && ["passed", "failed"].includes(list[0]?.status ?? ""),
  );
  assert.equal(downstream?.trigger, "pipeline");
  assert.deepEqual(
    downstream?.upstream && {
      name: downstream.upstream.pipelineName,
      n: downstream.upstream.number,
    },
    {
      name: "Shop build",
      n: 1,
    },
  );
  const done = await finished(downstream?.id as string);
  assert.equal(done.run.status, "passed", done.log);
  assert.match(done.log, /Unpacking dist from Shop build #1/);
  assert.match(done.log, /built by build/);

  // Started by hand, there is no upstream: say where from instead.
  const alone = await finished((await start(deploy)).json().run.id);
  assert.equal(alone.run.status, "failed");
  assert.match(alone.log, /was not started by another pipeline/);
});

test("the pipeline step starts another pipeline with inputs, waits, and takes its result", async () => {
  await create(`name: Child
runs-on: local
inputs:
  message: {}
  fail: {default: "no"}
stages:
  - name: A
    steps:
      - run: echo "child got $ZELYQ_INPUT_MESSAGE"; test "$ZELYQ_INPUT_FAIL" = no
`);
  const parent = await create(`name: Parent
runs-on: local
stages:
  - name: A
    steps:
      - pipeline: {run: Child, with: {message: hello}}
      - pipeline: {run: Child, with: {message: again, fail: "yes"}}
        continue-on-error: true
      - pipeline: {run: Child, wait: false, with: {message: no-wait}}
`);
  const done = await finished((await start(parent)).json().run.id);
  assert.equal(done.run.status, "passed", done.log);
  const [first, second, third] = done.run.steps;
  assert.equal(first.status, "passed");
  assert.equal(second.status, "failed", "a failing child fails the step");
  assert.equal(third.status, "passed", "wait: false passes once started");
  assert.ok(first.child?.number && second.child?.number);
  assert.match(done.log, /Started Child #\d+/);
  const child = await finished(first.child.id);
  assert.match(child.log, /child got hello/);
  assert.equal(child.run.upstream.pipelineName, "Parent");
});

test("a loop of pipelines starting each other stops at ten", async () => {
  const a = await create(
    "name: Loop A\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo a\n",
  );
  const b = await create(
    "name: Loop B\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo b\n",
  );
  await call("POST", team(`/pipelines/${b}/triggers`), { kind: "pipeline", pipelineId: a });
  await call("POST", team(`/pipelines/${a}/triggers`), { kind: "pipeline", pipelineId: b });
  await finished((await start(a)).json().run.id);
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const total = (await runs(a)).length + (await runs(b)).length;
  assert.ok(total <= 10, `${total} runs`);
  assert.ok(total >= 9, `${total} runs`);
  await call("PUT", team(`/pipelines/${a}`), {
    source: "name: Loop A\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo a\n",
  });
});

test("one-at-a-time waits; newest-wins cancels the older run", async () => {
  const queued = await create(`name: One at a time
runs-on: local
concurrency: one-at-a-time
stages:
  - name: A
    steps:
      - run: sleep 2
`);
  const first = (await start(queued)).json().run.id;
  const second = (await start(queued)).json().run.id;
  const a = await finished(first);
  const b = await finished(second);
  assert.ok(
    Date.parse(b.run.startedAt) >= Date.parse(a.run.finishedAt),
    "the second waited for the first",
  );

  const newest = await create(`name: Newest wins
runs-on: local
concurrency: newest-wins
stages:
  - name: A
    steps:
      - run: sleep 30
`);
  const older = (await start(newest)).json().run.id;
  await until(
    async () => (await call("GET", team(`/pipeline-runs/${older}`))).json().run.status,
    (status) => status === "running",
  );
  const newer = (await start(newest)).json().run.id;
  assert.equal((await finished(older)).run.status, "cancelled");
  await call("POST", team(`/pipeline-runs/${newer}/cancel`));
});

test("retry: a failed step is tried again", async () => {
  const id = await create(`name: Flaky
runs-on: local
stages:
  - name: A
    steps:
      - run: |
          if [ -f tried ]; then echo "worked the second time"; else touch tried; exit 7; fi
        retry: 2
`);
  const done = await finished((await start(id)).json().run.id);
  assert.equal(done.run.status, "passed", done.log);
  assert.match(done.log, /The step failed with code 7/);
  assert.match(done.log, /Attempt 2 of 3/);
  assert.equal(done.run.steps[0].attempt, 2);
});

test("keeping runs: only the newest are kept, and artifacts expire", async () => {
  const id = await create(`name: Kept
runs-on: local
keep: {runs: 2, artifacts: 2s}
artifacts:
  - name: out
    path: out.txt
stages:
  - name: A
    steps:
      - run: echo hi > out.txt
`);
  for (let i = 0; i < 4; i++) await finished((await start(id)).json().run.id);
  const result = await server.pipelineEngine.cleanUp(new Date(Date.now() + 5_000));
  assert.ok(result.runs >= 2, JSON.stringify(result));
  const left = await runs(id);
  assert.deepEqual(
    left.map((run) => run.number),
    [4, 3],
  );
  const detail = (await call("GET", team(`/pipeline-runs/${left[0]?.id}`))).json().run;
  assert.equal(detail.artifacts.length, 0, "the artifact older than 2s was removed");
});

test("Settings shows a Pipelines section with every pipeline setting", async () => {
  const groups = (await call("GET", "/api/settings")).json().groups as {
    name: string;
    fields: { key: string }[];
  }[];
  const pipelines = groups.find((group) => group.name === "Pipelines");
  assert.ok(pipelines, `groups: ${groups.map((g) => g.name).join(", ")}`);
  assert.deepEqual(pipelines.fields.map((field) => field.key).sort(), [
    "pipelineKeepArtifactsDays",
    "pipelineKeepRuns",
    "pipelineLocalConcurrency",
    "pipelineLocalImage",
    "pipelineLocalRunner",
  ]);
});

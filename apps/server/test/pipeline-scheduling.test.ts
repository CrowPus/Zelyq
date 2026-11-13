import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { automaticConcurrency } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Scheduling: stages that say what they wait for (needs:), how many runs a
 * machine takes at once, why a run waits in line, and a newer commit taking
 * the place of an older one still waiting — on this server's local runner.
 */

const tmp = path.join(os.tmpdir(), `zelyq-scheduling-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "scheduling.db")}`,
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
    previewPortRange: [4960, 4963],
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

type Step = { stage: string; status: string; startedAt: string | null; finishedAt: string | null };

/** When a stage's first step started and its last one ended. */
function span(steps: Step[], stage: string): { from: number; to: number } {
  const own = steps.filter((step) => step.stage === stage);
  return {
    from: Math.min(...own.map((step) => Date.parse(step.startedAt ?? ""))),
    to: Math.max(...own.map((step) => Date.parse(step.finishedAt ?? ""))),
  };
}

test("with needs:, a stage starts as soon as what it names is done", async () => {
  const id = await create(
    [
      "name: Graph",
      "runs-on: local",
      "stages:",
      "  - name: Build",
      "    steps: [{run: sleep 2}]",
      "  - name: Lint",
      "    needs: []",
      "    steps: [{run: sleep 1}]",
      "  - name: Test",
      "    needs: Build",
      "    matrix: {node: [20, 22]}",
      "    steps:",
      '      - run: "echo node-${{ matrix.node }}"',
      "  - name: Ship",
      "    needs: [Lint, Test]",
      "    steps: [{run: echo shipped}]",
      "",
    ].join("\n"),
  );
  const started = await start(id);
  assert.equal(started.statusCode, 201, started.body);
  const { run, log } = await finished(started.json().run.id);
  assert.equal(run.status, "passed", log);
  const detail = (await call("GET", team(`/pipeline-runs/${run.id}`))).json().run;
  // Build 0, Lint 1, Test (20) 2, Test (22) 3, Ship 4.
  assert.deepEqual(detail.stageNeeds, [[], [], [0], [0], [1, 2, 3]]);
  assert.deepEqual(detail.stageGroups, [[0, 1], [2, 3], [4]]);
  const build = span(detail.steps, "Build");
  const lint = span(detail.steps, "Lint");
  const ship = span(detail.steps, "Ship");
  // Lint did not wait for Build; Ship waited for everything it named.
  assert.ok(lint.from < build.to, "Lint ran beside Build");
  for (const stage of ["Lint", "Test (20)", "Test (22)"]) {
    assert.ok(ship.from >= span(detail.steps, stage).to, `Ship waited for ${stage}`);
  }
  assert.match(log, /shipped/);
});

test("with needs:, a failure skips only what waits for it", async () => {
  const id = await create(
    [
      "name: Graph failing",
      "runs-on: local",
      "stages:",
      "  - name: Broken",
      "    steps: [{run: exit 3}]",
      "  - name: After broken",
      "    needs: Broken",
      "    steps: [{run: echo never}]",
      "  - name: Independent",
      "    needs: []",
      "    steps: [{run: echo independent-ran}]",
      "  - name: Alert",
      "    needs: After broken",
      "    if: failure()",
      "    steps: [{run: echo alerted}]",
      "",
    ].join("\n"),
  );
  const { run, log } = await finished((await start(id)).json().run.id);
  assert.equal(run.status, "failed");
  const detail = (await call("GET", team(`/pipeline-runs/${run.id}`))).json().run;
  const status = (stage: string) => detail.steps.find((step: Step) => step.stage === stage)?.status;
  assert.equal(status("Broken"), "failed");
  assert.equal(status("After broken"), "skipped");
  assert.equal(status("Independent"), "passed");
  assert.equal(status("Alert"), "passed");
  assert.match(log, /independent-ran/);
  assert.match(log, /alerted/);
});

test("needs: is checked: a name above it, and not with parallel:", async () => {
  const check = (source: string) => call("POST", team("/pipelines/check"), { source });
  const unknown = await check(
    "name: X\nruns-on: local\nstages:\n  - name: A\n    steps: [{run: 'true'}]\n  - name: B\n    needs: Nope\n    steps: [{run: 'true'}]\n",
  );
  assert.match(unknown.body, /no stage above it is called that/);
  const below = await check(
    "name: X\nruns-on: local\nstages:\n  - name: A\n    needs: B\n    steps: [{run: 'true'}]\n  - name: B\n    steps: [{run: 'true'}]\n",
  );
  assert.match(below.body, /can only wait for stages above it/);
  const mixed = await check(
    "name: X\nruns-on: local\nstages:\n  - name: A\n    steps: [{run: 'true'}]\n  - name: B\n    needs: A\n    steps: [{run: 'true'}]\n  - name: C\n    parallel: true\n    steps: [{run: 'true'}]\n",
  );
  assert.match(mixed.body, /instead of parallel/);
});

test("the local runner sizes itself, and a waiting run says why and when", async () => {
  // Automatic (0): from this machine's processors and memory.
  await call("PUT", "/api/settings", { pipelineLocalConcurrency: 0 });
  const local = (await call("GET", team("/runners"))).json().local;
  assert.equal(
    local.places,
    Math.max(
      2,
      automaticConcurrency(os.availableParallelism(), Math.floor(os.totalmem() / 1024 / 1024)),
    ),
  );
  assert.equal(local.automatic, true);

  await call("PUT", "/api/settings", { pipelineLocalConcurrency: 1 });
  try {
    const slow = await create(
      "name: Slow\nruns-on: local\ninputs:\n  wait: {default: '0'}\nstages:\n  - name: A\n    steps: [{run: 'sleep ${{ inputs.wait }}'}]\n",
    );
    // A passed run first, so Zelyq knows how long Slow usually takes.
    assert.equal((await finished((await start(slow)).json().run.id)).run.status, "passed");
    const holder = (await start(slow, { inputs: { wait: "4" } })).json().run;
    const other = await create(
      "name: Behind\nruns-on: local\nstages:\n  - name: A\n    steps: [{run: echo behind}]\n",
    );
    const waiting = (await start(other)).json().run;
    const deadline = Date.now() + 10_000;
    let queue = null;
    while (!queue && Date.now() < deadline) {
      const detail = (await call("GET", team(`/pipeline-runs/${waiting.id}`))).json().run;
      if (detail.status === "queued") queue = detail.queue;
      else break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(queue, "the waiting run explains itself");
    assert.equal(queue.reason, "machine");
    assert.equal(queue.machine, "the local runner");
    assert.equal(queue.places, 1);
    assert.equal(queue.position, 1);
    assert.deepEqual(
      queue.blockers.map((blocker: { id: string; pipelineName: string }) => [
        blocker.id,
        blocker.pipelineName,
      ]),
      [[holder.id, "Slow"]],
    );
    assert.ok(queue.startsAt, "an estimate, from Slow's passed run");
    // In the list too.
    const listed = (await call("GET", team(`/pipelines/${other}/runs`))).json().runs[0];
    assert.equal(listed.queue?.position, 1);
    assert.equal((await finished(waiting.id)).run.status, "passed");
    const done = (await call("GET", team(`/pipeline-runs/${waiting.id}`))).json().run;
    assert.equal(done.queue, null);
    await finished(holder.id);
  } finally {
    await call("PUT", "/api/settings", { pipelineLocalConcurrency: 6 });
  }
});

test("a newer push takes the place of an older one still waiting on its branch", async () => {
  await call("PUT", "/api/settings", { pipelineLocalConcurrency: 1 });
  try {
    const blocker = await create(
      "name: Blocker\nruns-on: local\nstages:\n  - name: A\n    steps: [{run: sleep 3}]\n",
    );
    const id = await create(
      "name: Pushy\nruns-on: local\nstages:\n  - name: A\n    steps: [{run: echo pushed}]\n",
    );
    const added = await call("POST", team(`/pipelines/${id}/triggers`), {
      kind: "push",
      branches: ["main", "dev"],
    });
    assert.equal(added.statusCode, 201, added.body);
    const { trigger, secret } = added.json();
    const push = (branch: string, sha: string) => {
      const payload = JSON.stringify({ ref: `refs/heads/${branch}`, after: sha.repeat(40) });
      return server.app.inject({
        method: "POST",
        url: `/api/hooks/pipelines/${trigger.id}`,
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
        },
        payload,
      });
    };
    const holding = (await start(blocker)).json().run;
    assert.equal((await push("main", "a")).statusCode, 201);
    assert.equal((await push("dev", "b")).statusCode, 201);
    assert.equal((await push("main", "c")).statusCode, 201);
    const runs = (await call("GET", team(`/pipelines/${id}/runs`))).json().runs as {
      id: string;
      number: number;
      status: string;
      branch: string;
      error: string | null;
    }[];
    const byNumber = new Map(runs.map((run) => [run.number, run]));
    // The first push to main gave way to the second; dev's run is another branch.
    assert.equal(byNumber.get(1)?.status, "cancelled");
    assert.match(byNumber.get(1)?.error ?? "", /Replaced by run #3, for a later push to main/);
    assert.notEqual(byNumber.get(2)?.status, "cancelled");
    await finished(holding.id);
    assert.equal((await finished(byNumber.get(3)?.id ?? "")).run.status, "passed");
    assert.equal((await finished(byNumber.get(2)?.id ?? "")).run.status, "passed");
  } finally {
    await call("PUT", "/api/settings", { pipelineLocalConcurrency: 6 });
  }
});

test("with needs:, running again from a stage runs it and what waits on it", async () => {
  const id = await create(
    [
      "name: Graph rerun",
      "runs-on: local",
      "stages:",
      "  - name: A",
      "    steps: [{run: echo a-ran}]",
      "  - name: B",
      "    needs: A",
      "    steps: [{run: echo b-ran}]",
      "  - name: C",
      "    needs: []",
      "    steps: [{run: echo c-ran}]",
      "  - name: D",
      "    needs: B",
      "    steps: [{run: echo d-ran}]",
      "",
    ].join("\n"),
  );
  const first = await finished((await start(id)).json().run.id);
  assert.equal(first.run.status, "passed");
  const again = await call("POST", team(`/pipeline-runs/${first.run.id}/rerun`), { fromStage: 1 });
  assert.equal(again.statusCode, 201, again.body);
  const { run } = await finished(again.json().run.id);
  assert.equal(run.status, "passed");
  const detail = (await call("GET", team(`/pipeline-runs/${run.id}`))).json().run;
  const status = (stage: string) => detail.steps.find((step: Step) => step.stage === stage)?.status;
  assert.deepEqual(["A", "B", "C", "D"].map(status), ["skipped", "passed", "skipped", "passed"]);
});

test("changing one thing on a runner leaves the rest as it was", async () => {
  const created = await call("POST", team("/runners"), {
    name: "build-02",
    host: "10.0.0.9",
    port: 2222,
    username: "deploy",
    labels: ["gpu"],
    maxConcurrent: 3,
  });
  assert.equal(created.statusCode, 201, created.body);
  const runner = created.json().runner;
  assert.equal(runner.concurrency, 3);
  const off = await call("PATCH", team(`/runners/${runner.id}`), { enabled: false });
  assert.equal(off.statusCode, 200, off.body);
  const after = off.json().runner;
  assert.equal(after.enabled, false);
  assert.equal(after.port, 2222);
  assert.deepEqual(after.labels, ["gpu"]);
  assert.equal(after.maxConcurrent, 3);
  // Empty is automatic; untested, Zelyq knows nothing of it yet: one at a time.
  const automatic = (
    await call("PATCH", team(`/runners/${runner.id}`), { maxConcurrent: 0 })
  ).json().runner;
  assert.equal(automatic.maxConcurrent, 0);
  assert.equal(automatic.concurrency, 1);
  assert.equal(automatic.port, 2222);
});

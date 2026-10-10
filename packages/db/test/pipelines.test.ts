import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId } from "@zelyq/core";
import { createStore, runMigrations, type Store } from "../src/index.js";

let tmp: string;
let store: Store;
let teamId: string;
const now = () => new Date().toISOString();

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-pipelines-"));
  const url = `file:${tmp}/test.db`;
  await runMigrations(url);
  store = createStore(url);
  teamId = newId("team");
  await store.teams.create({ id: teamId, name: "ship", slug: "ship" });
});

after(async () => {
  await store?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function pipeline(name: string) {
  return store.pipelines.pipelines.create({
    id: newId("pipeline"),
    teamId,
    name,
    source: "name: x",
    createdBy: null,
    updatedBy: null,
    createdAt: now(),
    updatedAt: now(),
  });
}

function runRow(pipelineId: string) {
  return {
    id: newId("pipelineRun"),
    pipelineId,
    teamId,
    status: "queued",
    trigger: "manual",
    triggeredBy: null,
    runnerId: null,
    runnerName: null,
    source: "name: x",
    ref: null,
    fromStage: null,
    error: null,
    logBytes: 0,
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
  };
}

test("runs are numbered 1, 2, 3… per pipeline, even when created at the same moment", async () => {
  const p = await pipeline("numbers");
  const created = await Promise.all(
    [1, 2, 3, 4, 5].map(() => store.pipelines.runs.create(runRow(p.id), [])),
  );
  assert.deepEqual(created.map((run) => run.number).sort(), [1, 2, 3, 4, 5]);
  const other = await pipeline("numbers-other");
  assert.equal((await store.pipelines.runs.create(runRow(other.id), [])).number, 1);
});

test("a queued run can be claimed only once", async () => {
  const p = await pipeline("claim");
  const run = await store.pipelines.runs.create(runRow(p.id), []);
  const [a, b] = await Promise.all([
    store.pipelines.runs.claim(run.id, null, "local", now()),
    store.pipelines.runs.claim(run.id, null, "local", now()),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.equal((await store.pipelines.runs.findById(run.id))?.status, "running");
});

test("steps come back in stage and step order; logs page after a sequence number", async () => {
  const p = await pipeline("logs");
  const stepId = newId("pipelineStep");
  const run = await store.pipelines.runs.create(runRow(p.id), [
    {
      id: newId("pipelineStep"),
      stageIndex: 1,
      stepIndex: 0,
      stage: "B",
      name: "b",
      status: "pending",
      exitCode: null,
      startedAt: null,
      finishedAt: null,
    },
    {
      id: stepId,
      stageIndex: 0,
      stepIndex: 0,
      stage: "A",
      name: "a",
      status: "pending",
      exitCode: null,
      startedAt: null,
      finishedAt: null,
    },
  ]);
  assert.deepEqual(
    (await store.pipelines.steps.list(run.id)).map((s) => s.stage),
    ["A", "B"],
  );

  const lines = [1, 2, 3].map((seq) => ({
    id: newId("event"),
    seq,
    stepId,
    stream: "out",
    text: `line ${seq}`,
    at: now(),
  }));
  await store.pipelines.logs.append(run.id, lines, 18);
  assert.deepEqual(
    (await store.pipelines.logs.after(run.id, 1)).map((l) => l.text),
    ["line 2", "line 3"],
  );
  assert.equal(await store.pipelines.logs.lastSeq(run.id), 3);
  assert.equal((await store.pipelines.runs.findById(run.id))?.logBytes, 18);
});

test("deleting a pipeline deletes its runs, steps and logs; a runner's name is unique per team", async () => {
  const p = await pipeline("cascade");
  const run = await store.pipelines.runs.create(runRow(p.id), [
    {
      id: newId("pipelineStep"),
      stageIndex: 0,
      stepIndex: 0,
      stage: "A",
      name: "a",
      status: "pending",
      exitCode: null,
      startedAt: null,
      finishedAt: null,
    },
  ]);
  await store.pipelines.pipelines.remove(p.id);
  assert.equal(await store.pipelines.runs.findById(run.id), null);
  assert.deepEqual(await store.pipelines.steps.list(run.id), []);

  const runner = {
    id: newId("runner"),
    teamId,
    kind: "ssh",
    name: "build-01",
    host: "10.0.0.5",
    port: 22,
    username: "ci",
    labels: "[]",
    description: null,
    enabled: true,
    maxConcurrent: 1,
    os: null,
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
    createdAt: now(),
    updatedAt: now(),
  };
  await store.pipelines.runners.create(runner);
  await assert.rejects(() => store.pipelines.runners.create({ ...runner, id: newId("runner") }));
});

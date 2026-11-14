import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { OpsJobDetail, User } from "@zelyq/core";
import { runMigrations, type Store } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import type { OpsTurnRequest, OpsTurnResult } from "../src/services/agent-client.js";
import { OpsBrain } from "../src/services/ops/brain.js";

/**
 * Ops, step 5: the brain. A person talks; a turn runs; every tool call the
 * model makes comes back through the bridge, where the gate and the proofs
 * decide. The model here is a stand-in that calls the real bridge.
 */

const tmp = path.join(os.tmpdir(), `zelyq-ops-brain-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "ops-brain.db")}`,
  agentUrl: "http://127.0.0.1:59988",
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
    previewPortRange: [4980, 4983],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let store: Store;
let owner: User;
let teamId: string;
let cookie: string;
let brain: OpsBrain;
const seen: OpsTurnRequest[] = [];
const script: ((request: OpsTurnRequest) => Promise<OpsTurnResult>)[] = [];

/** The stand-in model: each turn plays the next scripted function against the real bridge. */
const agent = {
  async opsTurn(request: OpsTurnRequest): Promise<OpsTurnResult> {
    seen.push(request);
    const next = script.shift();
    if (!next)
      return {
        text: "Nothing more.",
        usage: { inputTokens: 1, outputTokens: 1 },
        rounds: 1,
        stopped: null,
        model: "stand-in",
      };
    return next(request);
  },
};
const tool = (request: OpsTurnRequest, name: string, input: unknown = {}) =>
  brain.bridge(request.bridge.token, name, input);
const answer = (text: string, tokens = 100): OpsTurnResult => ({
  text,
  usage: { inputTokens: tokens, outputTokens: tokens / 10 },
  rounds: 3,
  stopped: null,
  model: "stand-in",
});

/** A person puts a secret in the team's Vault. */
async function addSecret(name: string) {
  const response = await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/vault`,
    headers: { cookie },
    payload: { name, value: `a value for ${name}` },
  });
  assert.ok(response.statusCode < 300, response.body);
}

async function idle(jobId: string): Promise<OpsJobDetail> {
  for (let i = 0; i < 200; i += 1) {
    const view = await server.ops.engineerView(jobId);
    if (!view.working) return view;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Ops is still working");
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  store = server.store;
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  cookie = `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
  teamId = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: { cookie } })
  ).json().teams[0].id;
  owner = (await store.users.findByEmail("owner@example.com")) as unknown as User;
  await server.app.inject({ method: "POST", url: `/api/teams/${teamId}/ops`, headers: { cookie } });
  const now = new Date().toISOString();
  await store.pipelines.runners.create({
    id: "rnr_brain_box",
    teamId,
    kind: "ssh",
    name: "box",
    host: "203.0.113.20",
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
  brain = new OpsBrain(server.ops, server.settings, agent as never, "http://127.0.0.1:1");
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("talk, look, plan, wait for approval, act, prove, finish", async () => {
  // Turn 1: Ops looks, plans a protected production, and stops for approval.
  script.push(async (request) => {
    const machines = await tool(request, "list_machines");
    assert.match(machines.output, /"name": "box"/);
    const plan = await tool(request, "propose_plan", {
      steps: [
        {
          action: "create_environment",
          inputs: { name: "production", machine: "box", protected: true },
        },
      ],
    });
    assert.equal(plan.isError, false, plan.output);
    assert.match(plan.output, /waits for a person's approval/);
    // It cannot jump ahead.
    const early = await tool(request, "create_environment", {
      name: "production",
      machine: "box",
      protected: true,
    });
    assert.equal(early.isError, true);
    return answer(
      "The plan is ready: one step, a protected production on box. Please read it and press Approve.",
    );
  });
  const started = await brain.talk(owner, teamId, {
    text: "Make me a production environment on box.",
    spoken: true,
  });
  const waiting = await idle(started.id);
  assert.equal(waiting.stage, "approve");
  assert.equal(waiting.messages.at(-1)?.role, "ops");
  assert.match(waiting.messages.at(-1)?.text ?? "", /press Approve/);
  assert.ok(
    waiting.activity.includes("Look at the team's machines"),
    JSON.stringify(waiting.activity),
  );
  // What the model read: its way of working, the playbooks, and this job.
  assert.match(seen[0]?.systemPrompt ?? "", /Survey\. Look before touching/);
  assert.match(seen[0]?.systemPrompt ?? "", /## Launch/);
  assert.match(seen[0]?.systemPrompt ?? "", /Asked: Make me a production environment on box\./);
  assert.equal(seen[0]?.message, "Make me a production environment on box.");
  assert.ok(seen[0]?.tools.some((entry) => entry.name === "propose_plan"));
  assert.ok(seen[0]?.tools.some((entry) => entry.name === "survey_app"));

  // A person approves; Ops goes on, acts, is proven, finishes.
  await server.ops.decidePlan(owner, teamId, started.id, {
    decision: "approve",
    planHash: waiting.planHash as string,
  });
  script.push(async (request) => {
    const done = await tool(request, "create_environment", {
      name: "production",
      machine: "box",
      protected: true,
    });
    assert.equal(done.isError, false, done.output);
    assert.match(done.output, /"ok": true/);
    const finished = await tool(request, "finish_job", {
      outcome: "production exists on box, protected; checked.",
    });
    assert.match(finished.output, /"stage": "done"/);
    return answer("Done: production exists on box and is protected. I checked it.");
  });
  await brain.talk(owner, teamId, { text: "Approved, go on.", jobId: started.id });
  const done = await idle(started.id);
  assert.equal(done.stage, "done");
  assert.equal(done.steps[0]?.status, "done");
  assert.equal(done.steps[0]?.proof?.ok, true);
  // The second turn knew what was said before.
  assert.deepEqual(
    seen[1]?.history.map((entry) => entry.role),
    ["user", "assistant"],
  );
  assert.ok((await store.ops.jobs.findById(started.id))!.tokensIn >= 200);
  // A new message after the job is over starts a new job.
  script.push(async () => answer("Production is on box."));
  const next = await brain.talk(owner, teamId, { text: "Where is production?", jobId: started.id });
  assert.notEqual(next.id, started.id);
  await idle(next.id);
});

test("the bridge answers only a live turn's token", async () => {
  await assert.rejects(brain.bridge("not-a-token", "list_machines", {}), /turn has ended/);
  await assert.rejects(brain.bridge(undefined, "list_machines", {}), /turn has ended/);
  const http = await server.app.inject({
    method: "POST",
    url: "/api/ops-bridge/call",
    headers: { "x-zelyq-ops-bridge": "nope" },
    payload: { tool: "list_machines", input: {} },
  });
  assert.equal(http.statusCode, 401);
});

test("paused, or over the month's limit: no turn runs, and the job says why", async () => {
  await server.ops.engineers.update(owner, teamId, { monthlyTokenCap: 100 });
  const before = seen.length;
  const capped = await brain.talk(owner, teamId, { text: "Anything?" });
  const view = await idle(capped.id);
  assert.equal(seen.length, before, "no model call was made");
  assert.match(view.messages.at(-1)?.text ?? "", /this month's limit/);
  await server.ops.engineers.update(owner, teamId, { monthlyTokenCap: null, paused: true });
  await assert.rejects(brain.talk(owner, teamId, { text: "Anything now?" }), /paused/);
  await server.ops.engineers.update(owner, teamId, { paused: false });
});

test("the page talks through the API", async () => {
  // The route uses the server's own brain (no stand-in model here): only the conversation is checked.
  const response = await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/ops/talk`,
    headers: { cookie },
    payload: { text: "What do we have?" },
  });
  assert.equal(response.statusCode, 200, response.body);
  const job = response.json().job as OpsJobDetail;
  assert.equal(job.messages[0]?.text, "What do we have?");
});

test("run_step carries out exactly what was approved; planning again keeps what already ran", async () => {
  script.push(async (request) => {
    await tool(request, "propose_plan", {
      steps: [
        { action: "create_environment", inputs: { name: "qa", machine: "box" } },
        { action: "create_environment", inputs: { name: "uat", machine: "box", protected: true } },
      ],
    });
    return answer("Two steps; the second waits for approval.");
  });
  const job = await brain.talk(owner, teamId, { text: "Make qa and uat." });
  const waiting = await idle(job.id);
  assert.equal(waiting.stage, "approve", JSON.stringify(waiting.messages.map((m) => m.text)));
  await server.ops.decidePlan(owner, teamId, job.id, {
    decision: "approve",
    planHash: waiting.planHash as string,
  });

  script.push(async (request) => {
    // Runs step 1 by number: no inputs retyped.
    const first = await tool(request, "run_step", { step: 1 });
    assert.equal(first.isError, false, first.output);
    // Running it again is refused: it already ran.
    assert.match((await tool(request, "run_step", { step: 1 })).output, /already run/);
    // Plan again: the finished step and its proof stay; the new step comes after it.
    const again = await tool(request, "propose_plan", {
      steps: [
        { action: "write_sheet", inputs: { subject: "environment:qa", body: "qa: on box." } },
      ],
    });
    assert.equal(again.isError, false, again.output);
    assert.match(again.output, /"position": 2/);
    const second = await tool(request, "run_step", { step: 2 });
    assert.equal(second.isError, false, second.output);
    await tool(request, "finish_job", { outcome: "qa exists, written down." });
    return answer("Done: qa exists on box and is written down; both checked.");
  });
  await brain.talk(owner, teamId, { text: "Go on.", jobId: job.id });
  const done = await idle(job.id);
  assert.equal(done.stage, "done");
  assert.deepEqual(
    done.steps.map((step) => [step.position, step.status, step.proof?.ok]),
    [
      [0, "done", true],
      [1, "done", true],
    ],
  );
  assert.ok(await store.deploy.environments.findByName(teamId, "qa"));
  // The step that was replaced never ran.
  assert.equal(await store.deploy.environments.findByName(teamId, "uat"), null);
});

test("a job with failures is not closed until Ops learns from them, or says why none applies", async () => {
  script.push(async (request) => {
    await tool(request, "propose_plan", {
      steps: [
        {
          action: "set_environment_variables",
          inputs: { environment: "qa", set: { KEY: "vault://MISSING_KEY" } },
        },
      ],
    });
    const failed = await tool(request, "run_step", { step: 1 });
    assert.equal(failed.isError, true);
    // Plan again, the right way: the same change on the same environment, by Vault name.
    await tool(request, "propose_plan", {
      steps: [
        {
          action: "set_environment_variables",
          inputs: { environment: "qa", set: { KEY: "vault://KEY" } },
        },
      ],
    });
    const redone = await tool(request, "run_step", { step: 2 });
    assert.equal(redone.isError, false, redone.output);
    const refused = await tool(request, "finish_job", { outcome: "qa is set." });
    assert.equal(refused.isError, true);
    assert.match(refused.output, /no lesson was recorded/);
    const learned = await tool(request, "learn_lesson", {
      what: "Put a secret value in a variable.",
      why: "Secrets belong in Vault.",
      rule: "Give secrets as vault://NAME, never as a value.",
      evidence: { step: 1 },
    });
    assert.equal(learned.isError, false, learned.output);
    const closed = await tool(request, "finish_job", { outcome: "qa is set." });
    assert.equal(closed.isError, false, closed.output);
    return answer("Done; I learned not to put secret values in variables.");
  });
  await addSecret("KEY");
  const job = await brain.talk(owner, teamId, { text: "Set a KEY on qa." });
  const done = await idle(job.id);
  assert.equal(done.stage, "done");
  assert.equal(await server.ops.lessonsFromJob(job.id), 1);
});

test("the after-job review keeps only what passes the server's checks", async () => {
  script.push(async (request) => {
    await tool(request, "propose_plan", {
      steps: [
        {
          action: "set_environment_variables",
          inputs: { environment: "qa", set: { TOKEN: "vault://MISSING_TOKEN" } },
        },
      ],
    });
    await tool(request, "run_step", { step: 1 });
    await tool(request, "propose_plan", {
      steps: [
        {
          action: "set_environment_variables",
          inputs: { environment: "qa", set: { TOKEN: "vault://TOKEN" } },
        },
      ],
    });
    await tool(request, "run_step", { step: 2 });
    const closed = await tool(request, "finish_job", {
      outcome: "qa has no TOKEN yet.",
      noLessonBecause: "The review will look at it.",
    });
    assert.equal(closed.isError, false, closed.output);
    return answer("qa has no TOKEN yet.");
  });
  let reviewed: OpsTurnRequest | undefined;
  script.push(async (request) => {
    reviewed = request;
    const facts = JSON.parse(request.message) as { people: { messageId: string }[] };
    const said = facts.people[0]?.messageId as string;
    return answer(
      `Here is the review.\n${JSON.stringify({
        lessons: [
          {
            what: "Tried to set a token's value as a variable.",
            why: "Values that look like keys belong in Vault.",
            rule: "Ask for tokens in Vault first and reference them as vault://NAME.",
            step: 1,
          },
          {
            what: "Same again.",
            why: "Same.",
            rule: "Ask for tokens in Vault first, and reference them as vault://NAME!",
            step: 1,
          },
          {
            what: "Copied from the output.",
            why: "The output said so.",
            rule: "Remember that MISSING_TOKEN is not in Vault.",
            step: 1,
          },
        ],
        wishes: [
          { text: "Never deploy on Friday afternoons.", messageId: said },
          { text: "Made up.", messageId: "opm_not_real" },
        ],
      })}`,
    );
  });
  await addSecret("TOKEN");
  const job = await brain.talk(owner, teamId, {
    text: "Set a TOKEN on qa. And from now on, never deploy on Friday afternoons.",
  });
  const done = await idle(job.id);
  assert.equal(done.stage, "done");
  assert.ok(reviewed, "the review ran");
  assert.equal(reviewed.tools.length, 0, "the review has no tools");
  assert.equal(reviewed.limits.rounds, 1);

  const lessons = (await store.ops.lessons.listForTeam(teamId)).filter(
    (lesson) => lesson.evidenceJobId === job.id,
  );
  assert.deepEqual(
    lessons.map((lesson) => lesson.rule),
    ["Ask for tokens in Vault first and reference them as vault://NAME."],
  );
  const wishes = (await store.ops.preferences.listForTeam(teamId)).filter(
    (wish) => wish.jobId === job.id,
  );
  assert.deepEqual(
    wishes.map((wish) => wish.text),
    ["Never deploy on Friday afternoons."],
  );
  assert.ok(done.messages.some((message) => /Looked back at this job/.test(message.text)));
});

test("a question is answered with the finished job's outcome, not a bare sign-off", async () => {
  script.push(async (request) => {
    await tool(request, "list_environments");
    const closed = await tool(request, "finish_job", {
      outcome:
        "Shop runs on staging (port 3000) and production (port 3001); a change goes through the pipeline Shop deploy.",
    });
    assert.equal(closed.isError, false, closed.output);
    return answer("The job is complete!");
  });
  const job = await brain.talk(owner, teamId, { text: "What runs where?" });
  const done = await idle(job.id);
  const said = done.messages.filter((message) => message.role === "ops").map((m) => m.text);
  assert.deepEqual(said, [
    "Shop runs on staging (port 3000) and production (port 3001); a change goes through the pipeline Shop deploy.",
  ]);
});

test("what Ops looked at is kept with the job, so an answer can be traced afterwards", async () => {
  script.push(async (request) => {
    await tool(request, "list_machines");
    await tool(request, "list_environments");
    await tool(request, "finish_job", { outcome: "One machine, box; environments listed." });
    return answer("One machine.");
  });
  const job = await brain.talk(owner, teamId, { text: "What do we have?" });
  await idle(job.id);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const view = await server.ops.engineerView(job.id);
  assert.equal(view.working, false);
  assert.ok(view.activity.includes("Look at the team's machines"), JSON.stringify(view.activity));
  assert.ok(view.activity.includes("Look at the team's environments"));
});

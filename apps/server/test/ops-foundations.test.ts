import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { OpsRisk, User } from "@zelyq/core";
import { runMigrations, type Store } from "@zelyq/db";
import { z } from "zod";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { AccessControl } from "../src/services/access.js";
import { ActionList, environmentByName, type OpsAction } from "../src/services/ops/actions.js";
import { decide, type GateFacts } from "../src/services/ops/gate.js";
import { OpsService } from "../src/services/ops/service.js";

/**
 * Ops, step 1: the engineer's account, its jobs, the gate and proof — the
 * rules every later part of Ops stands on, tested with no model attached.
 */

const tmp = path.join(os.tmpdir(), `zelyq-ops-foundations-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "ops.db")}`,
  agentUrl: "http://127.0.0.1:59992",
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
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4964, 4967],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let store: Store;
let ownerCookie: string;
let editorCookie: string;
let owner: User;
let editor: User;
let teamId: string;

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

const as = (
  cookie: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

async function environment(
  name: string,
  extra: { protected?: boolean; frozen?: boolean; opsTrust?: string } = {},
) {
  const now = new Date().toISOString();
  await store.deploy.environments.create({
    id: `env_${name}_${Date.now()}`,
    teamId,
    name,
    runnerId: null,
    address: null,
    domain: null,
    https: "auto",
    httpPort: 80,
    httpsPort: 443,
    protected: extra.protected ?? false,
    frozen: extra.frozen ?? false,
    frozenReason: extra.frozen ? "release week" : null,
    opsTrust: extra.opsTrust ?? "ask",
    variables: "{}",
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  } as never);
}

// Stand-in actions, so every gate rule can be driven without a machine.
const done: string[] = [];
const envInput = z.object({ environment: z.string(), tag: z.string().default("a") }).strict();
function fake(
  name: string,
  risk: OpsRisk,
  options: { env?: boolean; prove?: boolean | null; freeUse?: boolean } = {},
): OpsAction {
  return {
    name,
    description: name,
    input: envInput as unknown as z.ZodType<Record<string, unknown>>,
    risk,
    freeUse: options.freeUse ?? false,
    ...(options.env === false
      ? {}
      : { environment: (ctx, inputs) => environmentByName(ctx, inputs.environment) }),
    words: (inputs) => `${name} on ${String(inputs.environment)} (${String(inputs.tag)})`,
    run: async (_ctx, inputs) => {
      done.push(`${name}:${String(inputs.environment)}:${String(inputs.tag)}`);
      return { ok: true, summary: `${name} done` };
    },
    ...(options.prove === null
      ? {}
      : {
          prove: async (_ctx, inputs) => ({
            kind: "fake",
            target: String(inputs.environment),
            ok: options.prove !== false,
            detail: null,
          }),
        }),
  };
}

let ops: OpsService;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  store = server.store;
  ownerCookie = await register("owner@example.com", "Owner");
  editorCookie = await register("editor@example.com", "Editor");
  teamId = (await as(ownerCookie, "GET", "/api/teams")).json().teams[0].id;
  await as(ownerCookie, "POST", `/api/teams/${teamId}/members`, {
    email: "editor@example.com",
    role: "editor",
  });
  owner = (await store.users.findByEmail("owner@example.com")) as unknown as User;
  editor = (await store.users.findByEmail("editor@example.com")) as unknown as User;
  await environment("staging");
  await environment("production", { protected: true });
  await environment("frozen", { frozen: true });
  await environment("advice", { opsTrust: "advise" });
  await environment("trusted", { protected: true, opsTrust: "trusted" });
  ops = new OpsService(
    store,
    new AccessControl(store),
    new ActionList([
      fake("look", "read"),
      fake("change", "change"),
      fake("unproven", "change", { prove: null }),
      fake("broken", "change", { prove: false }),
      fake("note", "change", { env: false, freeUse: true }),
      fake("structural", "change", { env: false }),
      fake("delete_data", "always-ask"),
      fake("raise_trust", "own-limits"),
    ]),
    {} as never,
  );
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------------------ the gate

const base: GateFacts = {
  actor: "ops",
  paused: false,
  risk: "change",
  environment: null,
  alreadyTried: false,
  inApprovedPlan: false,
  confirmed: false,
  freeUse: false,
};
const env = (extra: Partial<NonNullable<GateFacts["environment"]>> = {}) => ({
  id: "env",
  name: "production",
  frozen: false,
  frozenReason: null,
  protected: false,
  trust: "ask" as const,
  ...extra,
});

test("the gate: each rule, in order", () => {
  assert.equal(decide({ ...base, paused: true, risk: "read" }).verdict, "refuse");
  assert.equal(decide({ ...base, risk: "own-limits", inApprovedPlan: true }).verdict, "refuse");
  assert.equal(decide({ ...base, risk: "always-ask", inApprovedPlan: true }).verdict, "ask");
  assert.equal(
    decide({ ...base, risk: "always-ask", inApprovedPlan: true, confirmed: true }).verdict,
    "run",
  );
  assert.equal(
    decide({ ...base, environment: env({ frozen: true }), inApprovedPlan: true }).verdict,
    "refuse",
  );
  assert.equal(
    decide({ ...base, risk: "read", environment: env({ frozen: true }) }).verdict,
    "run",
  );
  assert.equal(decide({ ...base, inApprovedPlan: true, alreadyTried: true }).verdict, "refuse");
  // Outside agents are capped at "ask first", whatever the trust level.
  assert.equal(
    decide({ ...base, actor: "agent", environment: env({ trust: "oncall" }) }).verdict,
    "ask",
  );
  assert.equal(decide({ ...base, actor: "agent", risk: "read" }).verdict, "run");
  assert.equal(
    decide({ ...base, environment: env({ trust: "advise" }), inApprovedPlan: true }).verdict,
    "refuse",
  );
  assert.equal(
    decide({ ...base, environment: env({ protected: true }), inApprovedPlan: true }).verdict,
    "run",
  );
  assert.equal(decide({ ...base }).verdict, "ask");
  assert.equal(decide({ ...base, freeUse: true }).verdict, "run");
  assert.equal(decide({ ...base, environment: env() }).verdict, "run");
  assert.equal(decide({ ...base, environment: env({ protected: true }) }).verdict, "ask");
  assert.equal(
    decide({ ...base, environment: env({ protected: true, trust: "trusted" }) }).verdict,
    "run",
  );
});

// ------------------------------------------------------- the engineer's account

test("Ops is a team member nobody can sign in as, and no person can manage it as a member", async () => {
  const setUp = await as(ownerCookie, "POST", `/api/teams/${teamId}/ops`);
  assert.equal(setUp.statusCode, 201, setUp.body);
  assert.equal(setUp.json().engineer.name, "Ops");
  // An editor cannot set it up or change its limits.
  assert.equal(
    (await as(editorCookie, "PATCH", `/api/teams/${teamId}/ops`, { paused: true })).statusCode,
    403,
  );

  const engineer = (await store.ops.engineers.findByTeam(teamId))!;
  const account = (await store.users.findById(engineer.serviceUserId))!;
  assert.match(account.email, /@service\.invalid$/);

  for (const password of ["x", "service-account:no-sign-in", "correct-horse-battery"]) {
    const login = await server.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: account.email, password },
    });
    assert.equal(login.statusCode, 401, `login with "${password}"`);
  }
  const members = (await as(ownerCookie, "GET", `/api/teams/${teamId}/members`)).json().members;
  assert.ok(!members.some((member: { userId: string }) => member.userId === account.id));
  assert.equal(
    (
      await as(ownerCookie, "PATCH", `/api/teams/${teamId}/members/${account.id}`, {
        role: "viewer",
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await as(ownerCookie, "DELETE", `/api/teams/${teamId}/members/${account.id}`)).statusCode,
    404,
  );
  // Another team cannot add it by its email.
  const other = await register("other@example.com", "Other");
  const otherTeam = (await as(other, "GET", "/api/teams")).json().teams[0].id;
  const invite = await as(other, "POST", `/api/teams/${otherTeam}/members`, {
    email: account.email,
    role: "viewer",
  });
  assert.equal(invite.statusCode, 404);
  // Its own account cannot approve or ask for work.
  await assert.rejects(
    ops.startJob(account, teamId, { request: "anything" }),
    /cannot approve or ask/,
  );
});

// ------------------------------------------------------------------ the flow

test("look, plan, approve, act, prove: a change happens only once the plan stands", async () => {
  const job = await ops.startJob(editor, teamId, { request: "Ship it", kind: "ship" });
  assert.equal(job.stage, "survey");

  // Looking is always fine; changing before a plan is not.
  assert.equal(
    (await ops.perform(job.id, "look", { environment: "production" })).verdict.verdict,
    "run",
  );
  const early = await ops.perform(job.id, "change", { environment: "staging" });
  assert.equal(early.verdict.verdict, "refuse");
  assert.match(early.verdict.verdict === "refuse" ? early.verdict.reason : "", /plan first/i);

  // A plan touching production waits for an admin.
  const plan = await ops.proposePlan(job.id, {
    steps: [
      { action: "change", inputs: { environment: "staging" } },
      { action: "change", inputs: { environment: "production" } },
    ],
  });
  assert.ok(plan.ok, JSON.stringify(plan.issues));
  assert.equal(plan.job?.stage, "approve");
  assert.deepEqual(
    plan.job?.steps.map((step) => [step.words, step.needsApproval]),
    [
      ["change on staging (a)", false],
      ["change on production (a)", true],
    ],
  );
  const planHash = plan.job?.planHash as string;
  // Nothing runs while it waits.
  assert.equal(
    (await ops.perform(job.id, "change", { environment: "staging" })).verdict.verdict,
    "refuse",
  );
  // An editor may not approve production; a stale plan is refused; then the owner approves.
  await assert.rejects(
    ops.decidePlan(editor, teamId, job.id, { decision: "approve", planHash }),
    /admin|owner|role/i,
  );
  await assert.rejects(
    ops.decidePlan(owner, teamId, job.id, { decision: "approve", planHash: "not-it" }),
    /changed after you opened it/,
  );
  const approved = await ops.decidePlan(owner, teamId, job.id, { decision: "approve", planHash });
  assert.equal(approved.stage, "act");
  assert.equal(approved.planApprovedBy, "Owner");

  // Exactly the approved step runs, and is proven.
  const production = await ops.perform(job.id, "change", { environment: "production" });
  assert.equal(production.verdict.verdict, "run");
  assert.equal(production.step?.status, "done");
  assert.equal(production.proof?.ok, true);
  // Not twice the same way.
  const again = await ops.perform(job.id, "change", { environment: "production" });
  assert.equal(again.verdict.verdict, "refuse");
  assert.equal(again.verdict.rule, 6);
  // A production change that is not in the plan waits for a person.
  const offPlan = await ops.perform(job.id, "change", { environment: "production", tag: "b" });
  assert.equal(offPlan.verdict.verdict, "ask");
  // Staging, "ask first" and unprotected: Ops may act alone.
  assert.equal(
    (await ops.perform(job.id, "change", { environment: "staging" })).verdict.verdict,
    "run",
  );

  const detail = await ops.getJob(owner, teamId, job.id);
  assert.equal(detail.stage, "record");
  assert.ok(detail.steps.every((step) => step.status === "done"));
  const finished = await ops.finish(job.id, { outcome: "Shipped to staging and production." });
  assert.equal(finished.stage, "done");
  await assert.rejects(ops.perform(job.id, "look", { environment: "staging" }), /done/);
});

test("frozen, advise-only and own limits are refused; an irreversible step is confirmed by itself", async () => {
  const job = await ops.startJob(editor, teamId, { request: "Tidy up" });
  const refused = await ops.proposePlan(job.id, {
    steps: [
      { action: "change", inputs: { environment: "frozen" } },
      { action: "change", inputs: { environment: "advice" } },
      { action: "raise_trust", inputs: { environment: "staging" } },
    ],
  });
  assert.equal(refused.ok, false);
  assert.deepEqual(
    refused.issues.map((issue) => issue.position),
    [0, 1, 2],
  );

  const plan = await ops.proposePlan(job.id, {
    steps: [{ action: "delete_data", inputs: { environment: "staging" } }],
  });
  assert.ok(plan.ok);
  const approved = await ops.decidePlan(owner, teamId, job.id, {
    decision: "approve",
    planHash: plan.job?.planHash as string,
  });
  // Approving the plan is not enough for this one.
  assert.equal(
    (await ops.perform(job.id, "delete_data", { environment: "staging" })).verdict.verdict,
    "ask",
  );
  await assert.rejects(
    ops.confirmStep(editor, teamId, job.id, approved.steps[0]?.id as string),
    /admin|owner|role/i,
  );
  await ops.confirmStep(owner, teamId, job.id, approved.steps[0]?.id as string);
  assert.equal(
    (await ops.perform(job.id, "delete_data", { environment: "staging" })).verdict.verdict,
    "run",
  );
});

test("no proof, no done: an unproven or failed step keeps the job from being done", async () => {
  const job = await ops.startJob(editor, teamId, { request: "Two things" });
  const plan = await ops.proposePlan(job.id, {
    steps: [
      { action: "unproven", inputs: { environment: "staging" } },
      { action: "broken", inputs: { environment: "staging" } },
    ],
  });
  assert.equal(plan.job?.stage, "act");
  assert.equal(
    (await ops.perform(job.id, "unproven", { environment: "staging" })).step?.status,
    "not_verified",
  );
  assert.equal(
    (await ops.perform(job.id, "broken", { environment: "staging" })).step?.status,
    "failed",
  );
  await assert.rejects(ops.finish(job.id, { outcome: "All good" }), /not proven/);
  const failed = await ops.finish(job.id, {
    outcome: "The second step did not work.",
    failed: true,
  });
  assert.equal(failed.stage, "failed");
});

test("changes outside any environment need a plan unless they are free to use; pause stops everything", async () => {
  const job = await ops.startJob(editor, teamId, { request: "Notes" });
  await ops.proposePlan(job.id, { steps: [{ action: "note", inputs: { environment: "none" } }] });
  assert.equal(
    (await ops.perform(job.id, "structural", { environment: "none" })).verdict.verdict,
    "ask",
  );
  assert.equal((await ops.perform(job.id, "note", { environment: "none" })).verdict.verdict, "run");

  await as(ownerCookie, "PATCH", `/api/teams/${teamId}/ops`, { paused: true });
  const paused = await ops.perform(job.id, "look", { environment: "staging" });
  assert.equal(paused.verdict.verdict, "refuse");
  assert.equal(paused.verdict.rule, 1);
  await assert.rejects(ops.startJob(editor, teamId, { request: "More" }), /paused/);
  await as(ownerCookie, "PATCH", `/api/teams/${teamId}/ops`, { paused: false });
});

test("a run granted by an approved plan is not asked about twice; any other run still is", async () => {
  const job = await ops.startJob(editor, teamId, { request: "Deploy" });
  const env = (await store.deploy.environments.findByName(teamId, "production"))!;
  const pipeline = await as(ownerCookie, "POST", `/api/teams/${teamId}/pipelines`, {
    source:
      "name: Grant test\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo hi\n",
  });
  assert.equal(pipeline.statusCode, 201, pipeline.body);
  const started = await as(
    ownerCookie,
    "POST",
    `/api/teams/${teamId}/pipelines/${pipeline.json().pipeline.id}/runs`,
    {},
  );
  const runRow = (await store.pipelines.runs.findById(started.json().run.id))!;
  assert.equal(await ops.preApproved(runRow, env.id), false);
  await ops.grantRun({
    jobId: job.id,
    stepId: null,
    runId: runRow.id,
    environmentId: env.id,
    approvedBy: owner.id,
  });
  assert.equal(await ops.preApproved(runRow, env.id), true);
  // Only for that environment.
  const staging = (await store.deploy.environments.findByName(teamId, "staging"))!;
  assert.equal(await ops.preApproved(runRow, staging.id), false);
});

test("the Ops page API: a person starts, reads and stops a job", async () => {
  const started = await as(editorCookie, "POST", `/api/teams/${teamId}/ops/jobs`, {
    request: "Is everything OK?",
    kind: "question",
  });
  assert.equal(started.statusCode, 201, started.body);
  const jobId = started.json().job.id;
  const list = (await as(editorCookie, "GET", `/api/teams/${teamId}/ops/jobs`)).json().jobs;
  assert.ok(list.some((job: { id: string }) => job.id === jobId));
  const read = (await as(editorCookie, "GET", `/api/teams/${teamId}/ops/jobs/${jobId}`)).json().job;
  assert.equal(read.messages[0].text, "Is everything OK?");
  assert.equal(read.messages[0].author, "Editor");
  const stopped = await as(editorCookie, "POST", `/api/teams/${teamId}/ops/jobs/${jobId}/stop`);
  assert.equal(stopped.json().job.stage, "stopped");
  // Approval is a POST from a signed-in person; reading the job approves nothing.
  const anonymous = await server.app.inject({
    method: "GET",
    url: `/api/teams/${teamId}/ops/jobs/${jobId}`,
  });
  assert.equal(anonymous.statusCode, 401);
});

test("a failed attempt may go again once something has changed; replaced steps do not keep a job from done", async () => {
  const job = await ops.startJob(editor, teamId, { request: "Try, fix, retry" });
  await ops.proposePlan(job.id, {
    steps: [
      { action: "broken", inputs: { environment: "staging", tag: "x" } },
      { action: "change", inputs: { environment: "staging", tag: "fix" } },
    ],
  });
  // Fails.
  assert.equal(
    (await ops.perform(job.id, "broken", { environment: "staging", tag: "x" })).step?.status,
    "failed",
  );
  // Nothing has changed: the same again is refused.
  const same = await ops.perform(job.id, "broken", { environment: "staging", tag: "x" });
  assert.equal(same.verdict.rule, 6);
  // Something succeeds in between: now it may go again.
  assert.equal(
    (await ops.perform(job.id, "change", { environment: "staging", tag: "fix" })).step?.status,
    "done",
  );
  const again = await ops.perform(job.id, "broken", { environment: "staging", tag: "x" });
  assert.equal(again.verdict.verdict, "run");
  // A new plan takes the failed step's place; the job can then be done, and the record keeps it.
  await ops.proposePlan(job.id, {
    steps: [{ action: "change", inputs: { environment: "staging", tag: "other way" } }],
  });
  await ops.perform(job.id, "change", { environment: "staging", tag: "other way" });
  const finished = await ops.finish(job.id, { outcome: "Done another way." });
  assert.equal(finished.stage, "done");
  assert.deepEqual(
    finished.steps.map((step) => step.status),
    ["replaced", "done", "done"],
  );
});

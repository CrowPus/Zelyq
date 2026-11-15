import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { User } from "@zelyq/core";
import { runMigrations, type Store } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import type { OpsService } from "../src/services/ops/service.js";

/**
 * 076: Ops reaches only what a team admin gave it. Nothing at first; each
 * environment, machine, pipeline and app at "look only" or "manage"; only a
 * team admin changes that, never Ops; and what Ops makes under an approved
 * plan becomes its own.
 */

const tmp = path.join(os.tmpdir(), `zelyq-ops-access-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "ops-access.db")}`,
  agentUrl: "http://127.0.0.1:59993",
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
    previewPortRange: [4976, 4979],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let store: Store;
let ops: OpsService;
let owner: User;
let ownerCookie: string;
let editorCookie: string;
let teamId: string;
const ids: Record<string, string> = {};

function call(
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  cookie = ownerCookie,
) {
  return server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

/** What an admin does on Ops → Access. */
async function give(
  kind: string,
  resourceId: string,
  level: "see" | "manage" | null,
  trust?: string,
) {
  const response = await call("PUT", `/api/teams/${teamId}/ops/access`, {
    kind,
    resourceId,
    level,
    ...(trust ? { trust } : {}),
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().items as { kind: string; name: string; level: string | null }[];
}

async function environment(name: string): Promise<string> {
  const now = new Date().toISOString();
  const id = `env_access_${name}`;
  await store.deploy.environments.create({
    id,
    teamId,
    name,
    runnerId: "rnr_access_box",
    address: "203.0.113.20",
    domain: null,
    https: "auto",
    httpPort: 80,
    httpsPort: 443,
    protected: false,
    frozen: false,
    frozenReason: null,
    opsTrust: "trusted",
    variables: "{}",
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  } as never);
  return id;
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  store = server.store;
  ops = server.ops;
  ownerCookie = await register("owner@example.com", "Owner");
  editorCookie = await register("editor@example.com", "Editor");
  teamId = (await call("GET", "/api/teams")).json().teams[0].id;
  owner = (await store.users.findByEmail("owner@example.com")) as unknown as User;
  const editor = await store.users.findByEmail("editor@example.com");
  await store.teams.addMember(teamId, editor!.id, "editor");
  await call("POST", `/api/teams/${teamId}/ops`);
  const now = new Date().toISOString();
  await store.pipelines.runners.create({
    id: "rnr_access_box",
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
    cpus: 2,
    memoryMb: 4096,
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
  ids.production = await environment("production");
  ids.staging = await environment("staging");
  ids.project = (await call("POST", "/api/projects", { name: "Shop", teamId })).json().project.id;
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("nothing is given at first: Ops sees no environment, machine or app, and says why", async () => {
  const items = (await call("GET", `/api/teams/${teamId}/ops/access`)).json().items;
  assert.ok(items.length >= 4);
  assert.ok(items.every((item: { level: string | null }) => item.level === null));
  const job = await ops.startJob(owner, teamId, { request: "What runs where?" });
  const listed = await ops.perform(job.id, "list_environments", {});
  assert.deepEqual(listed.outcome?.data, []);
  const machines = await ops.perform(job.id, "list_machines", {});
  assert.deepEqual(machines.outcome?.data, []);
  const looked = await ops.perform(job.id, "deployment_history", { environment: "production" });
  assert.equal(looked.verdict.verdict, "refuse");
  assert.equal(looked.verdict.rule, 13);
  assert.match(
    (looked.verdict as { reason: string }).reason,
    /environment production has not been given to Ops.*Ops → Access/,
  );
  const survey = await ops.perform(job.id, "survey_app", { app: "Shop" });
  assert.equal(survey.verdict.verdict, "refuse");
  const secrets = await ops.perform(job.id, "list_secret_names", {});
  assert.match((secrets.verdict as { reason: string }).reason, /secret names have not been given/);
  // What Ops reads first says so too.
  const reach = await ops.reachOf(teamId);
  assert.match(reach.summary, /Nothing has been given to you yet/);
});

test("look only: Ops may look and advise, never change; a plan step is refused at once", async () => {
  await give("environment", ids.staging!, "see");
  const job = await ops.startJob(owner, teamId, { request: "Restart the shop on staging" });
  const listed = await ops.perform(job.id, "list_environments", {});
  assert.deepEqual(
    ((listed.outcome?.data ?? []) as { name: string }[]).map((row) => row.name),
    ["staging"],
  );
  const history = await ops.perform(job.id, "deployment_history", { environment: "staging" });
  assert.equal(history.verdict.verdict, "run");
  const plan = await ops.proposePlan(job.id, {
    steps: [{ action: "restart_app", inputs: { environment: "staging", app: "shop" } }],
  });
  assert.equal(plan.ok, false);
  assert.match(plan.issues[0]!.reason, /only given to Ops to look at, not to change/);
  const reach = await ops.reachOf(teamId);
  assert.match(reach.summary, /staging \(look only\)/);
  assert.doesNotMatch(reach.summary, /production/);
});

test("manage: the change goes ahead within the environment's trust level", async () => {
  await give("environment", ids.staging!, "manage", "ask");
  const job = await ops.startJob(owner, teamId, { request: "Restart the shop on staging" });
  const plan = await ops.proposePlan(job.id, {
    steps: [{ action: "restart_app", inputs: { environment: "staging", app: "shop" } }],
  });
  assert.ok(plan.ok, JSON.stringify(plan.issues));
  // Production was never given: a plan that also reaches it is refused as a whole.
  const job2 = await ops.startJob(owner, teamId, { request: "Promote to production" });
  const promote = await ops.proposePlan(job2.id, {
    steps: [{ action: "promote", inputs: { from: "staging", to: "production", app: "shop" } }],
  });
  assert.equal(promote.ok, false);
  assert.match(promote.issues[0]!.reason, /environment production has not been given/);
  const env = await store.deploy.environments.findById(ids.staging!);
  assert.equal(env?.opsTrust, "ask");
});

test("only a team admin changes what Ops may reach; never an editor, never Ops itself", async () => {
  const asEditor = await call(
    "PUT",
    `/api/teams/${teamId}/ops/access`,
    { kind: "environment", resourceId: ids.production, level: "manage" },
    editorCookie,
  );
  assert.equal(asEditor.statusCode, 403);
  const engineer = await store.ops.engineers.findByTeam(teamId);
  const account = (await store.users.findById(engineer!.serviceUserId)) as User;
  await assert.rejects(
    ops.accessList.change(account, teamId, {
      kind: "environment",
      resourceId: ids.production,
      level: "manage",
    }),
    /cannot change what it may reach/,
  );
  // An app's code and the secret names are only ever looked at.
  const manageCode = await call("PUT", `/api/teams/${teamId}/ops/access`, {
    kind: "project",
    resourceId: ids.project,
    level: "manage",
  });
  assert.equal(manageCode.statusCode, 400);
  // Any member can see the list; the history says who changed it.
  assert.equal(
    (await call("GET", `/api/teams/${teamId}/ops/access`, undefined, editorCookie)).statusCode,
    200,
  );
  const log = (await call("GET", `/api/teams/${teamId}/audit-log`)).json().entries;
  assert.ok(
    log.some(
      (entry: { action: string; detail: { name?: string } }) =>
        entry.action === "ops.access_changed" && entry.detail.name === "staging",
    ),
  );
});

test("what Ops makes under an approved plan is its own; taking a thing away takes it at once", async () => {
  await give("machine", "rnr_access_box", "manage");
  const job = await ops.startJob(owner, teamId, { request: "Make a review environment" });
  const plan = await ops.proposePlan(job.id, {
    steps: [{ action: "create_environment", inputs: { name: "review", machine: "box" } }],
  });
  assert.ok(plan.ok, JSON.stringify(plan.issues));
  if (plan.job?.stage === "approve") {
    await ops.decidePlan(owner, teamId, job.id, {
      decision: "approve",
      planHash: plan.job.planHash as string,
    });
  }
  const created = await ops.perform(job.id, "create_environment", {
    name: "review",
    machine: "box",
  });
  assert.equal(created.outcome?.ok, true, JSON.stringify(created));
  const review = await store.deploy.environments.findByName(teamId, "review");
  const items = (await call("GET", `/api/teams/${teamId}/ops/access`)).json().items as {
    id: string;
    level: string | null;
  }[];
  assert.equal(items.find((item) => item.id === review!.id)?.level, "manage");
  // Taken away: gone from what Ops sees in the same job.
  await give("environment", review!.id, null);
  const listed = await ops.perform(job.id, "list_environments", {});
  assert.ok(
    !((listed.outcome?.data ?? []) as { name: string }[]).some((row) => row.name === "review"),
  );
});

test("a pipeline is run only with every environment it deploys to; by schedule too", async () => {
  const source =
    "name: Ship prod\nruns-on: box\nsource: {app: Shop}\nstages:\n  - name: Ship\n    steps:\n      - deploy: {to: production, port: 3000}\n";
  const engineer = await store.ops.engineers.findByTeam(teamId);
  const account = (await store.users.findById(engineer!.serviceUserId)) as User;
  // Written by Ops (as its own account), then given to it to manage; production is not.
  const created = await server.pipelines.create(account, teamId, source, { note: "test" });
  await give("pipeline", created.id, "manage");
  const job = await ops.startJob(owner, teamId, { request: "Ship" });
  const plan = await ops.proposePlan(job.id, {
    steps: [{ action: "run_pipeline", inputs: { pipeline: "Ship prod" } }],
  });
  assert.equal(plan.ok, false);
  assert.match(plan.issues[0]!.reason, /environment production has not been given/);
  // Started by a schedule, it does not start either, and says why.
  const run = await server.pipelines.startTriggered(created.id, "schedule", null);
  assert.equal(run.status, "failed");
  const detail = await store.pipelines.runs.findById(run.id);
  assert.match(JSON.stringify(detail), /has not been given to Ops/);
});

test("Ops's notes about things it was not given stay hidden from it", async () => {
  await ops.memory.writeSheet(teamId, "environment:production", "Prod secrets live on box.", "ops");
  await ops.memory.writeSheet(teamId, "environment:staging", "Staging resets nightly.", "ops");
  await ops.memory.writeSheet(teamId, "app:newthing", "Not built yet.", "ops");
  const reach = await ops.reachOf(teamId);
  assert.equal(reach.seesSubject("environment:production"), false);
  assert.equal(reach.seesSubject("environment:staging"), true);
  // Nothing in the team by that name: nothing to hide.
  assert.equal(reach.seesSubject("app:newthing"), true);
  const opening = await ops.memory.openingContext(teamId, [], reach.seesSubject);
  assert.doesNotMatch(opening, /Prod secrets/);
  assert.match(opening, /Staging resets nightly/);
  const job = await ops.startJob(owner, teamId, { request: "What do you know?" });
  const recalled = await ops.perform(job.id, "recall", { about: "prod secrets staging resets" });
  const kinds = ((recalled.outcome?.data ?? []) as { kind: string }[]).map((row) => row.kind);
  assert.ok(kinds.includes("sheet environment:staging"));
  assert.ok(!kinds.includes("sheet environment:production"));
  const read = await ops.perform(job.id, "read_sheet", { subject: "environment:production" });
  assert.equal(read.verdict.verdict, "refuse");
});

test("an outside agent works through Ops's hands: it reaches only what Ops was given", async () => {
  await assert.rejects(
    ops.performFor(
      owner,
      teamId,
      "deployment_history",
      { environment: "production" },
      {
        changesAllowed: false,
      },
    ),
    /environment production has not been given to Ops/,
  );
  const ok = await ops.performFor(
    owner,
    teamId,
    "deployment_history",
    { environment: "staging" },
    { changesAllowed: false },
  );
  assert.equal(ok.outcome.ok, true);
});

test("the watcher watches only what Ops was given", async () => {
  const wanted = await server.watch.wanted(teamId);
  const targets = JSON.stringify(wanted);
  assert.doesNotMatch(targets, /production/);
});

test("a pipeline reaches what its file names: machines, label lists, an app's code, other pipelines", async () => {
  const now = new Date().toISOString();
  await store.pipelines.runners.create({
    id: "rnr_access_prod",
    teamId,
    kind: "ssh",
    name: "prod box",
    host: "203.0.113.21",
    port: 22,
    username: "zelyq",
    labels: '["gpu"]',
    description: null,
    enabled: true,
    maxConcurrent: 0,
    cpus: 2,
    memoryMb: 4096,
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
  const job = await ops.startJob(owner, teamId, { request: "Pipelines" });
  const refusedFor = async (source: string) => {
    const plan = await ops.proposePlan(job.id, {
      steps: [{ action: "create_pipeline", inputs: { source } }],
    });
    assert.equal(plan.ok, false, source);
    return plan.issues[0]!.reason;
  };
  const stage = "stages:\n  - name: A\n    steps:\n      - run: npm test\n";
  assert.match(
    await refusedFor(`name: P1\nruns-on: prod box\n${stage}`),
    /machine prod box has not been given/,
  );
  assert.match(
    await refusedFor(`name: P2\nruns-on: [gpu]\n${stage}`),
    /labelled gpu.*prod box has not been given/,
  );
  // Only box is Ops's: a stage of its own on prod box is still caught.
  assert.match(
    await refusedFor(
      "name: P3\nruns-on: box\nstages:\n  - name: A\n    runs-on: prod box\n    steps:\n      - run: npm test\n",
    ),
    /prod box/,
  );
  // Starting another pipeline reaches whatever that one reaches.
  assert.match(
    await refusedFor(
      "name: P4\nruns-on: box\nstages:\n  - name: A\n    steps:\n      - pipeline: {run: Ship prod}\n",
    ),
    /environment production has not been given/,
  );
  // An app's code it was not given.
  await give("project", ids.project!, null);
  assert.match(
    await refusedFor(`name: P5\nruns-on: box\nsource: {app: Shop}\n${stage}`),
    /app Shop has not been given/,
  );
  await give("project", ids.project!, "see");
  const fine = await ops.proposePlan(job.id, {
    steps: [
      {
        action: "create_pipeline",
        inputs: { source: `name: P6\nruns-on: box\nsource: {app: Shop}\n${stage}` },
      },
    ],
  });
  assert.ok(fine.ok, JSON.stringify(fine.issues));
});

test("a note about a machine or app Ops was not given cannot be read or written, whatever its name", async () => {
  await ops.memory.writeSheet(teamId, "machine:prod-box", "Root password hint here.", "ops");
  const job = await ops.startJob(owner, teamId, { request: "Notes" });
  const read = await ops.perform(job.id, "read_sheet", { subject: "machine:prod-box" });
  assert.equal(read.outcome?.ok, false);
  assert.match(read.outcome?.summary ?? "", /not given to Ops/);
  assert.equal(read.outcome?.data, undefined);
  const write = await ops.perform(job.id, "write_sheet", {
    subject: "machine:prod-box",
    body: "Overwritten.",
  });
  assert.equal(write.outcome?.ok, false);
  // Zelyq refreshes the facts part itself; what Ops tried to write never lands.
  const body = (await store.ops.sheets.find(teamId, "machine:prod-box"))?.body ?? "";
  assert.doesNotMatch(body, /Overwritten/);
});

test("an outside agent reaches what it was given on the Agents page, not what Ops was", async () => {
  // Ops was never given production; an agent given it may look there.
  const agent = {
    projectIds: [ids.project!],
    pipelineIds: [],
    environmentIds: [ids.production!],
    secretNames: false,
  };
  const looked = await ops.performFor(
    owner,
    teamId,
    "deployment_history",
    { environment: "production" },
    { changesAllowed: false, agent },
  );
  assert.equal(looked.outcome.ok, true, looked.outcome.summary);
  // Staging is Ops's, but not this agent's.
  await assert.rejects(
    ops.performFor(
      owner,
      teamId,
      "deployment_history",
      { environment: "staging" },
      {
        changesAllowed: false,
        agent,
      },
    ),
    /environment staging has not been given/,
  );
  await assert.rejects(
    ops.performFor(owner, teamId, "list_secret_names", {}, { changesAllowed: false, agent }),
    /secret names/,
  );
  // A message only to the person it works for needs no request: it goes now, or says why not.
  const told = await ops.performFor(
    owner,
    teamId,
    "message_me",
    { message: "crowpus looks fine.", where: "telegram" },
    { changesAllowed: false, agent },
  );
  assert.doesNotMatch(told.outcome.summary, /conversation on the Ops page/);
  assert.match(told.outcome.summary, /Telegram|link/i);
});

test("the bell lists Ops's plans waiting for approval, and says who may approve", async () => {
  const job = await ops.startJob(owner, teamId, { request: "Put the shop on shop.example.org" });
  const plan = await ops.proposePlan(job.id, {
    steps: [
      {
        action: "set_app_address",
        inputs: { environment: "staging", app: "shop", domain: "shop.example.org" },
      },
    ],
  });
  assert.ok(plan.ok, JSON.stringify(plan.issues));
  assert.equal(plan.job?.stage, "approve");
  const forOwner = (await call("GET", `/api/teams/${teamId}/ops/waiting`)).json().waiting;
  const mine = forOwner.find((one: { jobId: string }) => one.jobId === job.id);
  assert.equal(mine?.kind, "plan");
  assert.equal(mine?.canDecide, true);
  const forEditor = (
    await call("GET", `/api/teams/${teamId}/ops/waiting`, undefined, editorCookie)
  ).json().waiting;
  const theirs = forEditor.find((one: { jobId: string }) => one.jobId === job.id);
  assert.equal(theirs?.canDecide, false);
  assert.match(String(theirs?.why), /admin/);
});

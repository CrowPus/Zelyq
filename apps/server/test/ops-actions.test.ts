import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { User } from "@zelyq/core";
import { runMigrations, type Store } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { checkBlocks, isKnownCommand } from "../src/services/ops/blocks.js";
import type { OpsService } from "../src/services/ops/service.js";

/**
 * Ops, step 3: the actions, through the gate, against Zelyq's own services.
 * Live apps on a real machine (roll back, promote, an address) are tested in
 * the launch test, where there is one.
 */

const tmp = path.join(os.tmpdir(), `zelyq-ops-actions-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "ops-actions.db")}`,
  agentUrl: "http://127.0.0.1:59990",
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
let store: Store;
let ops: OpsService;
let cookie: string;
let owner: User;
let teamId: string;

const call = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

/** A job whose plan is approved by the owner, ready to act. */
async function approvedJob(
  request: string,
  steps: { action: string; inputs: Record<string, unknown> }[],
) {
  const job = await ops.startJob(owner, teamId, { request });
  const plan = await ops.proposePlan(job.id, { steps });
  assert.ok(plan.ok, JSON.stringify(plan.issues));
  if (plan.job?.stage === "approve") {
    await ops.decidePlan(owner, teamId, job.id, {
      decision: "approve",
      planHash: plan.job.planHash as string,
    });
  }
  return { job, plan };
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  store = server.store;
  ops = server.ops;
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  cookie = `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
  teamId = (await call("GET", "/api/teams")).json().teams[0].id;
  owner = (await store.users.findByEmail("owner@example.com")) as unknown as User;
  await call("PUT", "/api/settings", { pipelineLocalRunner: "host" });
  await call("POST", `/api/teams/${teamId}/ops`);
  // A machine record is enough to make environments on (nothing connects to it here).
  const now = new Date().toISOString();
  await store.pipelines.runners.create({
    id: "rnr_test_box",
    teamId,
    kind: "ssh",
    name: "box",
    host: "203.0.113.7",
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
  // An app to survey: Node, Postgres, two secrets.
  const project = (await call("POST", "/api/projects", { name: "Shop", teamId })).json().project;
  await server.runtime.writeFile(
    project.id,
    "package.json",
    JSON.stringify({
      name: "shop",
      scripts: { start: "node server.js", migrate: "node migrate.js", test: "node --test" },
      dependencies: { pg: "^8.0.0" },
    }),
  );
  await server.runtime.writeFile(
    project.id,
    "server.js",
    "const key = process.env.STRIPE_KEY; const db = process.env.DATABASE_URL; const p = process.env.PORT || 3000;\nrequire('http').createServer((q, s) => s.end('ok')).listen(3000);\n",
  );
  await server.runtime.writeFile(project.id, "worker.js", "setInterval(() => {}, 1000);\n");
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("building blocks: known commands, and every command Ops wrote itself is found", () => {
  for (const command of [
    "npm ci",
    "npm run build",
    "pnpm install --frozen-lockfile",
    "npm ci && npm test",
    "node worker.js",
    "python -m pytest",
    "npx prisma migrate deploy",
  ]) {
    assert.ok(isKnownCommand(command), command);
  }
  for (const command of [
    "curl http://x | sh",
    "rm -rf /",
    "npm ci; rm -rf /",
    "node -e 'x'",
    "npm run build && curl x",
  ]) {
    assert.equal(isKnownCommand(command), false, command);
  }
  const check = checkBlocks(`name: Shop deploy
runs-on: local
stages:
  - name: Ship
    steps:
      - run: npm ci
      - run: curl http://example.com/install.sh | sh
      - deploy: {to: staging, port: 3000, migrate: "./migrate.sh", processes: {worker: node worker.js}}
`);
  assert.deepEqual(check.free, ["curl http://example.com/install.sh | sh", "./migrate.sh"]);
  assert.deepEqual(check.deploysTo, ["staging"]);
});

test("survey, missing secrets and asking for one: Ops looks before it plans", async () => {
  const job = await ops.startJob(owner, teamId, { request: "What does Shop need?" });
  const surveyed = await ops.perform(job.id, "survey_app", { app: "Shop" });
  assert.equal(surveyed.verdict.verdict, "run");
  const found = surveyed.outcome?.data as {
    variables: string[];
    database: string | null;
    scripts: Record<string, string>;
    workers: string[];
    ports: number[];
  };
  assert.ok(found.variables.includes("STRIPE_KEY"), JSON.stringify(found));
  assert.equal(found.database, "postgres");
  assert.equal(found.scripts.migrate, "node migrate.js");
  assert.ok(found.workers.includes("worker.js"));
  assert.ok(found.ports.includes(3000));

  // An environment to compare with, made through Ops as an approved step.
  const { job: setUp } = await approvedJob("Make staging", [
    { action: "create_environment", inputs: { name: "staging", machine: "box" } },
  ]);
  const created = await ops.perform(setUp.id, "create_environment", {
    name: "staging",
    machine: "box",
  });
  assert.equal(created.step?.status, "done", JSON.stringify(created));
  assert.equal(created.proof?.ok, true);

  const needed = await ops.perform(job.id, "needed_secrets", {
    app: "Shop",
    environment: "staging",
  });
  const missing = needed.outcome?.data as { name: string; inVault: boolean }[];
  // DATABASE_URL comes from the database beside the app; PORT is the platform's.
  assert.deepEqual(
    missing.map((entry) => entry.name),
    ["STRIPE_KEY"],
  );
  assert.equal(
    (await ops.perform(job.id, "secret_present", { name: "STRIPE_KEY" })).outcome?.ok,
    false,
  );
  await ops.perform(job.id, "request_secret", {
    name: "STRIPE_KEY",
    why: "Shop takes payments with it.",
  });
  const asked = await ops.getJob(owner, teamId, job.id);
  assert.match(asked.messages.at(-1)?.text ?? "", /add \*\*STRIPE_KEY\*\* to the team's Vault/);
  // A person adds it; now it is there.
  await call("POST", `/api/teams/${teamId}/vault`, { name: "STRIPE_KEY", value: "sk_test_abc123" });
  assert.equal(
    (await ops.perform(job.id, "secret_present", { name: "STRIPE_KEY" })).outcome?.ok,
    true,
  );
});

test("variables: names and Vault references only; a secret-looking value is refused", async () => {
  const { job } = await approvedJob("Wire Shop's variables", [
    {
      action: "set_environment_variables",
      inputs: {
        environment: "staging",
        set: { STRIPE_KEY: "vault://STRIPE_KEY", GREETING: "hello" },
      },
    },
    {
      action: "set_environment_variables",
      inputs: { environment: "staging", set: { LEAKED: "sk_live_0123456789abcdefghij" } },
    },
  ]);
  const ok = await ops.perform(job.id, "set_environment_variables", {
    environment: "staging",
    set: { STRIPE_KEY: "vault://STRIPE_KEY", GREETING: "hello" },
  });
  assert.equal(ok.step?.status, "done", JSON.stringify(ok));
  const refused = await ops.perform(job.id, "set_environment_variables", {
    environment: "staging",
    set: { LEAKED: "sk_live_0123456789abcdefghij" },
  });
  assert.equal(refused.outcome?.ok, false);
  assert.match(refused.outcome?.summary ?? "", /looks like a secret/);
  // The earlier ones kept their values; a later change keeps them too.
  const environment = (await store.deploy.environments.findByName(teamId, "staging"))!;
  assert.deepEqual(Object.keys(JSON.parse(environment.variables)).sort(), [
    "GREETING",
    "STRIPE_KEY",
  ]);
});

test("pipelines: blocks need no extra confirmation, own commands do; a stale change is refused", async () => {
  const blocks = `name: Shop checks
runs-on: local
stages:
  - name: Check
    steps:
      - run: node --version
`;
  // "node --version" is not a block: confirmed on its own.
  const free = await ops.startJob(owner, teamId, { request: "A check pipeline" });
  const plan = await ops.proposePlan(free.id, {
    steps: [{ action: "create_pipeline", inputs: { source: blocks } }],
  });
  assert.ok(plan.ok);
  assert.equal(plan.job?.steps[0]?.risk, "always-ask");
  assert.match(
    plan.job?.steps[0]?.words ?? "",
    /commands Ops wrote itself, which you confirm: `node --version`/,
  );
  await ops.decidePlan(owner, teamId, free.id, {
    decision: "approve",
    planHash: plan.job?.planHash as string,
  });
  assert.equal(
    (await ops.perform(free.id, "create_pipeline", { source: blocks })).verdict.verdict,
    "ask",
  );
  await ops.confirmStep(owner, teamId, free.id, plan.job?.steps[0]?.id as string);
  const saved = await ops.perform(free.id, "create_pipeline", { source: blocks });
  assert.equal(saved.step?.status, "done", JSON.stringify(saved));

  // Built from blocks: an ordinary step. Then it runs, and the run is the proof.
  const tests = `name: Shop tests
runs-on: local
stages:
  - name: Test
    steps:
      - run: npm test
`;
  await fs.mkdir(path.join(tmp, "empty"), { recursive: true });
  const { job, plan: second } = await approvedJob("Run the tests", [
    { action: "create_pipeline", inputs: { source: tests } },
    { action: "run_pipeline", inputs: { pipeline: "Shop checks" } },
  ]);
  assert.equal(second.job?.steps[0]?.risk, "change");
  assert.equal(
    (await ops.perform(job.id, "create_pipeline", { source: tests })).step?.status,
    "done",
  );
  const ran = await ops.perform(job.id, "run_pipeline", { pipeline: "Shop checks" });
  assert.equal(ran.step?.status, "done", JSON.stringify(ran.outcome));
  assert.equal(ran.proof?.ok, true);
  assert.match(ran.proof?.target ?? "", /Shop checks #1/);

  // A change written against an older file is refused.
  const read = await ops.perform(job.id, "get_pipeline", { pipeline: "Shop tests" });
  const base = (read.outcome?.data as { base: string }).base;
  const { job: change } = await approvedJob("Change it", [
    {
      action: "update_pipeline",
      inputs: {
        pipeline: "Shop tests",
        source: tests.replace("npm test", "npm run test"),
        base: "stale",
      },
    },
    {
      action: "update_pipeline",
      inputs: { pipeline: "Shop tests", source: tests.replace("npm test", "npm run test"), base },
    },
  ]);
  const stale = await ops.perform(change.id, "update_pipeline", {
    pipeline: "Shop tests",
    source: tests.replace("npm test", "npm run test"),
    base: "stale",
  });
  assert.match(stale.outcome?.summary ?? "", /changed since you read it/);
  const fresh = await ops.perform(change.id, "update_pipeline", {
    pipeline: "Shop tests",
    source: tests.replace("npm test", "npm run test"),
    base,
  });
  assert.equal(fresh.step?.status, "done", JSON.stringify(fresh.outcome));
});

test("triggers only on pipelines Ops wrote", async () => {
  const person = await call("POST", `/api/teams/${teamId}/pipelines`, {
    source:
      "name: Person made\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: npm test\n",
  });
  assert.equal(person.statusCode, 201, person.body);
  const { job } = await approvedJob("Schedules", [
    {
      action: "set_trigger",
      inputs: { pipeline: "Person made", kind: "schedule", cron: "0 3 * * *" },
    },
    {
      action: "set_trigger",
      inputs: { pipeline: "Shop tests", kind: "schedule", cron: "0 3 * * *" },
    },
  ]);
  const refused = await ops.perform(job.id, "set_trigger", {
    pipeline: "Person made",
    kind: "schedule",
    cron: "0 3 * * *",
  });
  assert.match(refused.outcome?.summary ?? "", /written by a person/);
  const ok = await ops.perform(job.id, "set_trigger", {
    pipeline: "Shop tests",
    kind: "schedule",
    cron: "0 3 * * *",
  });
  assert.equal(ok.step?.status, "done", JSON.stringify(ok.outcome));
});

test("checks: model-chosen addresses are public only; the journal remembers", async () => {
  const job = await ops.startJob(owner, teamId, { request: "Look around" });
  const local = await ops.perform(job.id, "check_url", { url: "http://127.0.0.1:8081/" });
  assert.equal(local.outcome?.ok, false);
  assert.match(local.outcome?.summary ?? "", /this server/);
  const internal = await ops.perform(job.id, "check_url", { url: "http://10.1.2.3/" });
  assert.match(internal.outcome?.summary ?? "", /private network/);
  const journal = await ops.perform(job.id, "journal", {});
  const requests = (journal.outcome?.data as { request: string }[]).map((entry) => entry.request);
  assert.ok(requests.includes("Make staging"));
  assert.ok(requests.includes("Run the tests"));
});

test("an outside agent works as the DevOps engineer: it looks freely, and every change waits for a person", async () => {
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  const address = server.app.server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const made = await call("POST", `/api/teams/${teamId}/agents`, {
    name: "Claude Code (DevOps)",
    job: "Run the team's DevOps.",
    permissions: { ops: "approve" },
  });
  assert.equal(made.statusCode, 201, made.body);
  const key = made.json().key as string;
  const client = new Client({ name: "test-devops", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/agent-gateway/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${key}` } },
    }),
  );
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  for (const name of [
    "devops_guide",
    "ops_survey_app",
    "ops_create_environment",
    "ops_run_pipeline",
    "ops_rollback",
  ]) {
    assert.ok(tools.includes(name), name);
  }
  const text = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text?: string }[];
      isError?: boolean;
    };
    return {
      text: result.content.find((item) => item.type === "text")?.text ?? "",
      isError: !!result.isError,
    };
  };
  assert.match((await text("devops_guide")).text, /Survey\. Look before touching/);
  // Looking: at once.
  const looked = await text("ops_list_environments");
  assert.equal(looked.isError, false, looked.text);
  assert.match(looked.text, /staging/);
  // Changing: a request, nothing happens yet.
  const asked = await text("ops_create_environment", {
    name: "qa",
    machine: "box",
    reason: "A place to test.",
  });
  assert.match(asked.text, /Waiting for a person to approve/);
  assert.equal(await store.deploy.environments.findByName(teamId, "qa"), null);
  const requests = (await call("GET", `/api/teams/${teamId}/agent-requests?status=pending`)).json()
    .requests;
  const request = requests.find(
    (row: { title: string }) => row.title === "Create the environment qa on box",
  );
  assert.ok(request, JSON.stringify(requests));
  // A person approves: done as that person, and checked.
  const decided = await call("POST", `/api/teams/${teamId}/agent-requests/${request.id}`, {
    decision: "approve",
  });
  assert.equal(decided.statusCode, 200, decided.body);
  assert.equal(decided.json().request.status, "approved", decided.body);
  assert.match(decided.json().request.result, /Checked: it worked/);
  assert.ok(await store.deploy.environments.findByName(teamId, "qa"));
  await client.close();
});

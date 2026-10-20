import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createStore, runMigrations, type Store } from "@zelyq/db";
import sharp from "sharp";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Outside agents through `/agent-gateway/mcp`, driven by the official MCP
 * client exactly as Claude Code or Codex would. What matters is the boundary:
 * an agent sees only the apps and tools it was given, everything it changes is
 * recorded and undoable, and nothing that reaches outside the app happens
 * without a person approving it.
 */

const tmp = path.join(os.tmpdir(), `zelyq-agent-gateway-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "agents.db")}`,
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
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4960, 4963],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let store: Store;
let base: string;
let owner: string;
let editor: string;
let teamId: string;
let shared: string;
let privateApp: string;

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

const asUser = (
  cookie: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });

async function createProject(name: string): Promise<string> {
  const response = await asUser(owner, "POST", "/api/projects", { name, template: "vite-react" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().project.id;
}

async function newAgent(input: Record<string, unknown>) {
  const response = await asUser(owner, "POST", `/api/teams/${teamId}/agents`, {
    name: "Claude Code",
    job: "Fix bugs in the shop.",
    ...input,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { agent: { id: string; keyPrefix: string }; key: string };
}

async function connect(key: string): Promise<Client> {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/agent-gateway/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${key}` } },
    }),
  );
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  return {
    text: result.content.find((c) => c.type === "text")?.text ?? "",
    isError: !!result.isError,
  };
}

/** A deploy environment record; no machine is needed to ask about one. */
function environment(name: string) {
  const now = new Date().toISOString();
  return store.deploy.environments.create({
    id: `env_${name}${Date.now()}`,
    teamId,
    name,
    runnerId: null,
    address: null,
    domain: null,
    https: "auto",
    httpPort: 80,
    httpsPort: 443,
    protected: false,
    frozen: false,
    frozenReason: null,
    variables: "{}",
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  } as never);
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  const address = server.app.server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  store = createStore(config.databaseUrl);
  owner = await register("owner@example.com", "Owner");
  editor = await register("editor@example.com", "Editor");
  teamId = (await asUser(owner, "GET", "/api/teams")).json().teams[0].id;
  await asUser(owner, "POST", `/api/teams/${teamId}/members`, {
    email: "editor@example.com",
    role: "editor",
  });
  shared = await createProject("Shop");
  privateApp = await createProject("Payroll");
});

after(async () => {
  await store.close();
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("only admins manage agents, and the key is shown once", async () => {
  const refused = await asUser(editor, "POST", `/api/teams/${teamId}/agents`, { name: "Sneaky" });
  assert.equal(refused.statusCode, 403);

  const { agent, key } = await newAgent({ projectIds: [shared] });
  assert.match(key, /^zlq_agent_/);
  assert.ok(key.startsWith(agent.keyPrefix));
  const list = await asUser(owner, "GET", `/api/teams/${teamId}/agents`);
  assert.ok(!list.body.includes(key), "the key never comes back");

  // Pushing can never run freely.
  const pushAllowed = await asUser(owner, "POST", `/api/teams/${teamId}/agents`, {
    name: "Pusher",
    permissions: { "git.push": "allow" },
  });
  assert.equal(pushAllowed.statusCode, 400);
});

test("the gateway refuses a missing, wrong or revoked key", async () => {
  const none = await fetch(`${base}/agent-gateway/mcp`, { method: "POST", body: "{}" });
  assert.equal(none.status, 401);
  const wrong = await fetch(`${base}/agent-gateway/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer zlq_agent_nope", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(wrong.status, 401);

  const { agent, key } = await newAgent({ projectIds: [shared] });
  await asUser(owner, "POST", `/api/teams/${teamId}/agents/${agent.id}/revoke`);
  await assert.rejects(connect(key));

  const { agent: other, key: oldKey } = await newAgent({ projectIds: [shared] });
  const rotated = await asUser(owner, "POST", `/api/teams/${teamId}/agents/${other.id}/rotate`);
  await assert.rejects(connect(oldKey));
  const client = await connect(rotated.json().key);
  await client.close();
});

test("an agent sees only its apps, and works on them with Zelyq's own tools", async () => {
  const { key } = await newAgent({ projectIds: [shared] });
  const client = await connect(key);

  const job = JSON.parse((await call(client, "my_job")).text);
  assert.equal(job.job, "Fix bugs in the shop.");

  const apps = JSON.parse((await call(client, "list_apps")).text).apps;
  assert.deepEqual(
    apps.map((app: { app_id: string }) => app.app_id),
    [shared],
  );

  const outside = await call(client, "read_file", { app_id: privateApp, path: "package.json" });
  assert.ok(outside.isError);
  assert.match(outside.text, /No app/);

  const written = await call(client, "write_file", {
    app_id: shared,
    path: "src/agent-note.txt",
    content: "written by an outside agent\n",
  });
  assert.ok(!written.isError, written.text);
  const read = await call(client, "read_file", { app_id: shared, path: "src/agent-note.txt" });
  assert.match(read.text, /written by an outside agent/);

  // An undo point came first, and the change is recorded under the agent's name.
  const snapshots = await store.snapshots.listForProject(shared);
  assert.ok(snapshots.some((snapshot) => snapshot.label === "Before: Claude Code (agent)"));
  const log = await asUser(owner, "GET", `/api/teams/${teamId}/audit-log`);
  assert.ok(
    log
      .json()
      .entries.some(
        (entry: { action: string; actorName: string }) =>
          entry.action === "agent.files_changed" && entry.actorName === "Claude Code (agent)",
      ),
    log.body,
  );
  await client.close();
});

test("a permission switched off removes its tools", async () => {
  const { key } = await newAgent({
    projectIds: null,
    permissions: { "code.write": "off", commands: "off", "git.push": "off" },
  });
  const client = await connect(key);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.ok(names.includes("read_file"));
  assert.ok(!names.includes("write_file"));
  assert.ok(!names.includes("run_command"));
  assert.ok(!names.includes("request_push"));
  const attempt = await call(client, "write_file", { app_id: shared, path: "x.txt", content: "x" });
  assert.ok(attempt.isError);

  // projectIds null: every app in the team.
  const apps = JSON.parse((await call(client, "list_apps")).text).apps;
  assert.equal(apps.length, 2);
  await client.close();
});

test("a push waits for an admin, and an approval is carried out as that person", async () => {
  const { key } = await newAgent({ projectIds: [shared] });
  const client = await connect(key);
  const asked = JSON.parse(
    (await call(client, "request_push", { app_id: shared, reason: "Ship the fix" })).text,
  );
  assert.equal(asked.status, "pending");

  const inbox = await asUser(editor, "GET", `/api/teams/${teamId}/agent-requests?status=pending`);
  assert.ok(inbox.json().requests.some((r: { id: string }) => r.id === asked.request));

  const editorTries = await asUser(
    editor,
    "POST",
    `/api/teams/${teamId}/agent-requests/${asked.request}`,
    { decision: "approve" },
  );
  assert.equal(editorTries.statusCode, 403);

  // No remote is set, so the push itself fails — and says why, instead of
  // pretending it happened.
  const approved = await asUser(
    owner,
    "POST",
    `/api/teams/${teamId}/agent-requests/${asked.request}`,
    { decision: "approve" },
  );
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().request.status, "failed");
  assert.ok(approved.json().request.result);

  const again = await asUser(
    owner,
    "POST",
    `/api/teams/${teamId}/agent-requests/${asked.request}`,
    { decision: "decline" },
  );
  assert.equal(again.statusCode, 400, "a request is decided once");

  const mine = JSON.parse((await call(client, "my_requests")).text).requests;
  assert.equal(mine[0].status, "failed");

  const second = JSON.parse(
    (await call(client, "request_push", { app_id: shared, reason: "Again" })).text,
  );
  const declined = await asUser(
    owner,
    "POST",
    `/api/teams/${teamId}/agent-requests/${second.request}`,
    { decision: "decline" },
  );
  assert.equal(declined.json().request.status, "declined");
  await client.close();
});

test("secret names, never values", async () => {
  await asUser(owner, "POST", `/api/teams/${teamId}/vault`, {
    name: "STRIPE_SECRET",
    value: "sk_live_never_shown",
  });
  const { key } = await newAgent({ projectIds: [shared] });
  const client = await connect(key);
  const result = await call(client, "list_secret_names", { app_id: shared });
  assert.ok(!result.isError, result.text);
  assert.ok(!result.text.includes("sk_live_never_shown"));
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.ok(!names.some((name) => /secret_value|read_secret/.test(name)));
  await client.close();
});

test("an agent writes a pipeline, and a run waits for approval and then really starts", async () => {
  const { key } = await newAgent({ projectIds: [shared] });
  const client = await connect(key);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  for (const name of [
    "pipeline_guide",
    "check_pipeline",
    "create_pipeline",
    "request_pipeline_run",
    "list_environments",
    "request_rollback",
  ]) {
    assert.ok(names.includes(name), `${name} is offered by default`);
  }

  const guide = await call(client, "pipeline_guide");
  assert.match(guide.text, /## The file/);
  assert.match(guide.text, /deploy/i);

  const bad = JSON.parse((await call(client, "check_pipeline", { source: "name: x\n" })).text);
  assert.equal(bad.ok, false);

  const source =
    "name: Agent checks\nruns-on: local\nsource:\n  app: Shop\nstages:\n  - name: Check\n    steps:\n      - checkout: true\n      - run: echo hello from the agent\n";
  const good = JSON.parse((await call(client, "check_pipeline", { source })).text);
  assert.equal(good.ok, true, JSON.stringify(good));
  const created = await call(client, "create_pipeline", { source });
  assert.ok(!created.isError, created.text);
  const pipelineId = JSON.parse(created.text).id;

  const edited = await call(client, "update_pipeline", {
    pipeline_id: pipelineId,
    source: source.replace("hello", "hello again"),
  });
  assert.ok(!edited.isError, edited.text);

  // Nothing ran yet: running waits for a person.
  const asked = JSON.parse(
    (await call(client, "request_pipeline_run", { pipeline_id: pipelineId, reason: "Check it" }))
      .text,
  );
  assert.equal(asked.status, "pending");
  const runsBefore = JSON.parse(
    (await call(client, "list_runs", { pipeline_id: pipelineId })).text,
  );
  assert.equal(runsBefore.runs.length, 0);

  const approved = await asUser(
    owner,
    "POST",
    `/api/teams/${teamId}/agent-requests/${asked.request}`,
    { decision: "approve" },
  );
  assert.equal(approved.json().request.status, "approved", approved.body);
  assert.match(approved.json().request.result, /run .* started/);
  const runsAfter = JSON.parse((await call(client, "list_runs", { pipeline_id: pipelineId })).text);
  assert.equal(runsAfter.runs.length, 1);
  const run = await call(client, "get_run", { run_id: runsAfter.runs[0].id });
  assert.ok(!run.isError, run.text);

  // A person's trigger makes a pipeline start runs by itself: the agent may
  // no longer change it.
  const trigger = await asUser(
    owner,
    "POST",
    `/api/teams/${teamId}/pipelines/${pipelineId}/triggers`,
    {
      kind: "schedule",
      cron: "0 3 * * *",
    },
  );
  assert.equal(trigger.statusCode, 201, trigger.body);
  const blocked = await call(client, "update_pipeline", { pipeline_id: pipelineId, source });
  assert.ok(blocked.isError);
  assert.match(blocked.text, /triggers/);
  const notDeleted = await call(client, "delete_pipeline", { pipeline_id: pipelineId });
  assert.ok(notDeleted.isError);
  await client.close();
});

test("deployment changes are requests, and running can never be switched to allowed", async () => {
  const { key } = await newAgent({ projectIds: [shared] });
  const client = await connect(key);
  const environments = JSON.parse((await call(client, "list_environments")).text);
  assert.ok(Array.isArray(environments.environments));
  const asked = JSON.parse(
    (
      await call(client, "request_app_action", {
        environment_id: (await environment("qa")).id,
        app: "shop",
        action: "restart",
        reason: "It stopped answering",
      })
    ).text,
  );
  assert.equal(asked.status, "pending");
  await client.close();

  for (const permission of ["pipelines.run", "deploy.manage"]) {
    const refused = await asUser(owner, "POST", `/api/teams/${teamId}/agents`, {
      name: "Too free",
      permissions: { [permission]: "allow" },
    });
    assert.equal(refused.statusCode, 400, `${permission} cannot be allowed`);
  }

  const off = await newAgent({
    projectIds: [shared],
    permissions: { "pipelines.write": "off", "pipelines.run": "off", "deploy.manage": "off" },
  });
  const limited = await connect(off.key);
  const names = (await limited.listTools()).tools.map((tool) => tool.name);
  for (const name of [
    "pipeline_guide",
    "list_pipelines",
    "create_pipeline",
    "request_pipeline_run",
    "run_logs",
    "cancel_run",
    "list_environments",
    "app_status",
    "request_rollback",
    "request_promote",
  ]) {
    assert.ok(!names.includes(name), `${name} is gone when its permission is off`);
  }
  assert.ok(names.includes("run_command"), "running commands is a separate permission");
  await limited.close();
});

test("an agent keeps to the pipelines and environments it was given", async () => {
  const staging = await environment("staging");
  const production = await environment("production");

  // A pipeline a person wrote, that this agent is not given.
  const theirs = await asUser(owner, "POST", `/api/teams/${teamId}/pipelines`, {
    source:
      "name: Payroll checks\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo payroll\n",
  });
  assert.equal(theirs.statusCode, 201, theirs.body);
  const theirsId = theirs.json().pipeline.id;

  const { key } = await newAgent({
    projectIds: [shared],
    pipelineIds: [],
    environmentIds: [staging.id],
  });
  const client = await connect(key);

  const visible = JSON.parse((await call(client, "list_pipelines")).text).pipelines;
  assert.ok(!visible.some((p: { id: string }) => p.id === theirsId), "not given: not listed");
  const peek = await call(client, "get_pipeline", { pipeline_id: theirsId });
  assert.ok(peek.isError);
  const ask = await call(client, "request_pipeline_run", { pipeline_id: theirsId, reason: "x" });
  assert.ok(ask.isError);

  const envs = JSON.parse((await call(client, "list_environments")).text).environments;
  assert.deepEqual(
    envs.map((e: { id: string }) => e.id),
    [staging.id],
  );
  const restart = await call(client, "request_app_action", {
    environment_id: production.id,
    app: "shop",
    action: "restart",
    reason: "x",
  });
  assert.ok(restart.isError, "production is not its environment");

  const deployTo = (to: string, app = "Shop") =>
    `name: Ship ${to} ${app}\nruns-on: local\nsource:\n  app: ${app}\nstages:\n  - name: Ship\n    steps:\n      - checkout: true\n      - deploy:\n          to: ${to}\n          port: 3000\n`;

  const toProduction = await call(client, "create_pipeline", { source: deployTo("production") });
  assert.ok(toProduction.isError);
  assert.match(toProduction.text, /may not deploy to "production"/);
  const otherApp = await call(client, "create_pipeline", {
    source: deployTo("staging", "Payroll"),
  });
  assert.ok(otherApp.isError);
  assert.match(otherApp.text, /may not build "Payroll"/);

  // What it may: it creates it, and from then on the pipeline is its own.
  const mine = await call(client, "create_pipeline", { source: deployTo("staging") });
  assert.ok(!mine.isError, mine.text);
  const mineId = JSON.parse(mine.text).id;
  const now2 = JSON.parse((await call(client, "list_pipelines")).text).pipelines;
  assert.deepEqual(
    now2.map((p: { id: string }) => p.id),
    [mineId],
  );
  const run = JSON.parse(
    (await call(client, "request_pipeline_run", { pipeline_id: mineId, reason: "ship" })).text,
  );
  assert.equal(run.status, "pending");

  // Editing it to reach further is refused too.
  const widen = await call(client, "update_pipeline", {
    pipeline_id: mineId,
    source: deployTo("production"),
  });
  assert.ok(widen.isError);
  await client.close();
});

test("every pipeline save is kept, and an earlier version can be put back", async () => {
  const v1 =
    "name: History demo\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo one\n";
  const v2 = v1.replace("echo one", "echo two");
  const created = await asUser(owner, "POST", `/api/teams/${teamId}/pipelines`, { source: v1 });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().pipeline.id;
  const base = `/api/teams/${teamId}/pipelines/${id}`;
  const saved = await server.app.inject({
    method: "PUT",
    url: base,
    headers: { cookie: owner },
    payload: { source: v2 },
  });
  assert.equal(saved.statusCode, 200, saved.body);

  let versions = (await asUser(owner, "GET", `${base}/versions`)).json().versions;
  assert.deepEqual(
    versions.map((v: { version: number; current: boolean }) => [v.version, v.current]),
    [
      [2, true],
      [1, false],
    ],
  );
  assert.equal((await asUser(owner, "GET", `${base}/versions/1`)).json().version.source, v1);

  const restored = await asUser(owner, "POST", `${base}/versions/1/restore`);
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().pipeline.source, v1);
  versions = (await asUser(owner, "GET", `${base}/versions`)).json().versions;
  assert.equal(versions[0].version, 3);
  assert.equal(versions[0].note, "Restored version 1");
  assert.equal(versions[0].by.name, "Owner");

  // A pipeline from before history was kept: its first save keeps what it was.
  const legacy =
    "name: Legacy\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo old\n";
  const made = await asUser(owner, "POST", `/api/teams/${teamId}/pipelines`, { source: legacy });
  const legacyId = made.json().pipeline.id;
  assert.match(legacyId, /^pip_[a-f0-9]+$/);
  await store.exec(`delete from pipeline_versions where pipeline_id = '${legacyId}'`);
  await server.app.inject({
    method: "PUT",
    url: `/api/teams/${teamId}/pipelines/${legacyId}`,
    headers: { cookie: owner },
    payload: { source: legacy.replace("old", "new") },
  });
  const legacyVersions = (
    await asUser(owner, "GET", `/api/teams/${teamId}/pipelines/${legacyId}/versions`)
  ).json().versions;
  assert.deepEqual(
    legacyVersions.map((v: { version: number; note: string | null }) => [v.version, v.note]),
    [
      [2, null],
      [1, "Before history was kept"],
    ],
  );
  assert.equal(
    (await asUser(owner, "GET", `/api/teams/${teamId}/pipelines/${legacyId}/versions/1`)).json()
      .version.source,
    legacy,
  );
});

test("with writes that need approval, an agent's pipeline change waits, shown as a diff", async () => {
  const before =
    "name: Reviewed\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo before\n";
  const created = await asUser(owner, "POST", `/api/teams/${teamId}/pipelines`, { source: before });
  const id = created.json().pipeline.id;
  const { key } = await newAgent({
    projectIds: [shared],
    pipelineIds: [id],
    permissions: { "pipelines.write": "approve" },
  });
  const client = await connect(key);
  const after = before.replace("echo before", "echo after");

  const broken = await call(client, "update_pipeline", { pipeline_id: id, source: "name: x\n" });
  assert.ok(broken.isError, "an invalid file is never sent for approval");

  const asked = JSON.parse(
    (await call(client, "update_pipeline", { pipeline_id: id, source: after, reason: "Say after" }))
      .text,
  );
  assert.equal(asked.status, "pending");
  const unchanged = (await asUser(owner, "GET", `/api/teams/${teamId}/pipelines/${id}`)).json();
  assert.equal(unchanged.pipeline.source, before, "nothing changes before approval");

  const inbox = (await asUser(owner, "GET", `/api/teams/${teamId}/agent-requests?status=pending`))
    .json()
    .requests.find((r: { id: string }) => r.id === asked.request);
  assert.equal(inbox.payload.baseSource, before);
  assert.equal(inbox.payload.source, after);

  const approved = await asUser(
    owner,
    "POST",
    `/api/teams/${teamId}/agent-requests/${asked.request}`,
    { decision: "approve" },
  );
  assert.equal(approved.json().request.status, "approved", approved.body);
  const versions = (
    await asUser(owner, "GET", `/api/teams/${teamId}/pipelines/${id}/versions`)
  ).json().versions;
  assert.match(versions[0].note, /By Claude Code \(agent\), approved by Owner/);
  assert.equal(
    (await asUser(owner, "GET", `/api/teams/${teamId}/pipelines/${id}`)).json().pipeline.source,
    after,
  );

  // Stale: a person changes the pipeline after the agent asked. Approving
  // would no longer be the change that was seen, so it fails instead.
  const third = after.replace("echo after", "echo third");
  const stale = JSON.parse(
    (await call(client, "update_pipeline", { pipeline_id: id, source: third })).text,
  );
  await server.app.inject({
    method: "PUT",
    url: `/api/teams/${teamId}/pipelines/${id}`,
    headers: { cookie: owner },
    payload: { source: after.replace("echo after", "echo by a person") },
  });
  const late = await asUser(owner, "POST", `/api/teams/${teamId}/agent-requests/${stale.request}`, {
    decision: "approve",
  });
  assert.equal(late.json().request.status, "failed");
  assert.match(late.json().request.result, /changed after the agent asked/);

  // The agent can read the history and ask to restore an earlier version.
  const history = JSON.parse((await call(client, "pipeline_history", { pipeline_id: id })).text);
  assert.ok(history.versions.length >= 3);
  const restore = JSON.parse(
    (await call(client, "restore_pipeline_version", { pipeline_id: id, version: 1 })).text,
  );
  assert.equal(restore.status, "pending");
  await client.close();
});

test("an agent uses Studio on its own key, never the server's, and brings its own files", async () => {
  // The provider, stood in for: a real PNG back, and which key it was sent.
  const png = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 200, g: 40, b: 90 } },
  })
    .png()
    .toBuffer();
  const keysSeen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let isGoogleHost = false;
    try {
      isGoogleHost = new URL(url).hostname === "generativelanguage.googleapis.com";
    } catch {
      isGoogleHost = false;
    }
    if (isGoogleHost) {
      keysSeen.push(`google:${new Headers(init?.headers).get("x-goog-api-key")}`);
      return new Response(
        JSON.stringify(
          url.includes(":predictLongRunning")
            ? { name: "models/veo-test/operations/op123" }
            : { done: false },
        ),
        { headers: { "content-type": "application/json" } },
      );
    }
    if (url.startsWith("https://api.openai.com/")) {
      keysSeen.push(String(new Headers(init?.headers).get("authorization")));
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), {
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    await asUser(owner, "POST", `/api/teams/${teamId}/vault`, {
      name: "AGENT_OPENAI_KEY",
      value: "sk-agents-own-key",
    });
    const missing = await asUser(owner, "POST", `/api/teams/${teamId}/agents`, {
      name: "No such key",
      media: { image: { provider: "openai", secret: "NOT_IN_VAULT" } },
    });
    assert.equal(missing.statusCode, 400);

    const plain = await connect((await newAgent({ projectIds: [shared] })).key);
    const plainTools = (await plain.listTools()).tools.map((tool) => tool.name);
    assert.ok(!plainTools.includes("generate_image"), "no key, no generation");
    assert.ok(!plainTools.includes("request_video"));
    assert.ok(plainTools.includes("add_media"));
    await plain.close();

    const { key } = await newAgent({
      projectIds: [shared],
      media: {
        image: { provider: "openai", secret: "AGENT_OPENAI_KEY" },
        video: { provider: "google", secret: "AGENT_OPENAI_KEY" },
      },
    });
    const client = await connect(key);
    const made = (await client.callTool({
      name: "generate_image",
      arguments: { app_id: shared, prompt: "A pink square", path: "public/hero.png" },
    })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    assert.ok(!made.isError, JSON.stringify(made.content));
    assert.ok(
      made.content.some((c) => c.type === "image"),
      "the agent sees what it made",
    );
    assert.deepEqual(keysSeen, ["Bearer sk-agents-own-key"], "the agent's key, nothing else");
    keysSeen.length = 0;

    // Studio on its own: no app needed, and the next image can build on the first.
    const firstId = JSON.parse(made.content[0]?.text ?? "{}").id as string;
    const studioOnly = (await client.callTool({
      name: "generate_image",
      arguments: { prompt: "The same square, smiling", reference_ids: [firstId] },
    })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    assert.ok(!studioOnly.isError, JSON.stringify(studioOnly.content));
    const second = JSON.parse(studioOnly.content[0]?.text ?? "{}");
    assert.equal(second.in_studio, true);
    assert.equal(second.path, undefined, "nothing was put in an app");
    const library = JSON.parse((await call(client, "studio_library", { kind: "image" })).text);
    assert.deepEqual(
      library.images.map((image: { id: string }) => image.id).sort(),
      [firstId, second.id].sort(),
    );
    const view = (await client.callTool({
      name: "studio_view",
      arguments: { kind: "image", id: second.id },
    })) as { content: Array<{ type: string }> };
    assert.ok(view.content.some((c) => c.type === "image"));
    // Studio holds them for the person who made the agent too.
    const studio = await asUser(owner, "GET", "/api/images/generations");
    assert.ok(studio.body.includes(second.id), studio.body.slice(0, 200));
    keysSeen.length = 0;
    const onDisk = await fs.readFile(
      path.join(config.runtime.workspaceDir, shared, "public", "hero.png"),
    );
    assert.equal((await sharp(onDisk).metadata()).format, "png");

    // Video waits for a person.
    const video = JSON.parse(
      (
        await call(client, "request_video", {
          app_id: shared,
          prompt: "A slow pan over a market",
          aspect_ratio: "16:9",
          duration_seconds: 8,
          resolution: "720p",
        })
      ).text,
    );
    assert.equal(video.status, "pending");
    const animate = JSON.parse(
      (
        await call(client, "request_video", {
          prompt: "The square slowly spins",
          aspect_ratio: "16:9",
          duration_seconds: 8,
          resolution: "720p",
          start_image_id: firstId,
        })
      ).text,
    );
    assert.equal(animate.status, "pending");
    const animated = await asUser(
      owner,
      "POST",
      `/api/teams/${teamId}/agent-requests/${animate.request}`,
      { decision: "approve" },
    );
    assert.equal(animated.json().request.status, "approved", animated.body);
    const animatedId = /Video (vid_[a-f0-9]+)/.exec(animated.json().request.result)?.[1];
    const animatedRow = await store.videos.find(animatedId ?? "");
    assert.equal(JSON.parse(animatedRow?.input ?? "{}").mode, "image-to-video");
    assert.ok(animatedRow?.referenceId, "its Studio image is the starting frame");
    // One video at a time: the other request is refused for now, and keeps waiting.
    const busy = await asUser(
      owner,
      "POST",
      `/api/teams/${teamId}/agent-requests/${video.request}`,
      { decision: "approve" },
    );
    assert.equal(busy.statusCode, 400);
    assert.match(busy.body, /still being generated/);
    const stillWaiting = (
      await asUser(owner, "GET", `/api/teams/${teamId}/agent-requests?status=pending`)
    ).json().requests;
    assert.ok(stillWaiting.some((r: { id: string }) => r.id === video.request));
    for (let i = 0; i < 40 && !keysSeen.some((k) => k.startsWith("google:")); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(keysSeen.includes("google:sk-agents-own-key"), JSON.stringify(keysSeen));
    const status = JSON.parse(
      (await call(client, "studio_view", { kind: "video", id: animatedId ?? "" })).text,
    );
    assert.ok(["queued", "submitting", "generating"].includes(status.status), status.status);

    // Its own files: a real image is placed, a fake one and a private link are refused.
    const own = await call(client, "add_media", {
      app_id: shared,
      path: "public/own.png",
      data_base64: png.toString("base64"),
    });
    assert.ok(!own.isError, own.text);
    const fake = await call(client, "add_media", {
      app_id: shared,
      path: "public/fake.png",
      data_base64: Buffer.from("not an image").toString("base64"),
    });
    assert.ok(fake.isError);
    const internal = await call(client, "add_media", {
      app_id: shared,
      path: "public/x.png",
      url: "http://127.0.0.1:8081/secret.png",
    });
    assert.ok(internal.isError);
    assert.match(internal.text, /cannot be fetched/);

    // Someone else's image is not its to place.
    const theirs = await call(client, "place_media", {
      kind: "image",
      id: "img_00000000000000000000000000000000",
      app_id: shared,
      path: "public/theirs.png",
    });
    assert.ok(theirs.isError);
    await client.close();
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an agent brings a portrait and a logo into Studio and builds a flyer from them", async () => {
  const square = (r: number, g: number, b: number, size = 1024) =>
    sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } });
  const result = await sharp({
    create: { width: 1024, height: 1536, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
  const openaiCalls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.openai.com/")) {
      openaiCalls.push(new URL(url).pathname);
      return new Response(JSON.stringify({ data: [{ b64_json: result.toString("base64") }] }), {
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    await asUser(owner, "POST", `/api/teams/${teamId}/vault`, {
      name: "FLYER_OPENAI_KEY",
      value: "sk-flyer",
    });
    await asUser(owner, "POST", `/api/teams/${teamId}/vault`, {
      name: "FLYER_GOOGLE_KEY",
      value: "g-flyer",
    });
    const { agent, key } = await newAgent({
      projectIds: [shared],
      media: {
        image: { provider: "openai", secret: "FLYER_OPENAI_KEY" },
        video: { provider: "google", secret: "FLYER_GOOGLE_KEY" },
      },
    });
    const client = await connect(key);

    // A portrait sent as a file, a logo already in one of its apps.
    const portrait = await square(200, 160, 120, 1600).jpeg().toBuffer();
    const fromFile = (await client.callTool({
      name: "studio_import_image",
      arguments: { name: "Mohamed portrait", data_base64: portrait.toString("base64") },
    })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    assert.ok(!fromFile.isError, JSON.stringify(fromFile.content));
    assert.ok(
      fromFile.content.some((c) => c.type === "image"),
      "it sees what it imported",
    );
    const portraitId = JSON.parse(fromFile.content[0]?.text ?? "{}").id as string;
    assert.match(portraitId, /^arf_/);

    const logo = await square(255, 255, 255, 400).png().toBuffer();
    await call(client, "add_media", {
      app_id: shared,
      path: "public/logo.png",
      data_base64: logo.toString("base64"),
    });
    const fromApp = await call(client, "studio_import_image", {
      name: "Dee Empire logo",
      app_id: shared,
      path: "public/logo.png",
    });
    assert.ok(!fromApp.isError, fromApp.text);
    const logoId = JSON.parse(fromApp.text).id as string;

    const notImage = await call(client, "studio_import_image", {
      name: "x",
      data_base64: Buffer.from("plain text").toString("base64"),
    });
    assert.ok(notImage.isError);
    const internal = await call(client, "studio_import_image", {
      name: "x",
      url: "http://169.254.169.254/latest/meta-data",
    });
    assert.ok(internal.isError);

    const library = JSON.parse((await call(client, "studio_library", { kind: "reference" })).text);
    assert.deepEqual(library.references.map((r: { name: string }) => r.name).sort(), [
      "Dee Empire logo",
      "Mohamed portrait",
    ]);
    // Large photos are fitted to what a provider takes.
    const portraitRow = await store.agents.references.find(portraitId);
    assert.ok((portraitRow?.width ?? 0) <= 2048);

    // The flyer: both as references, so the provider gets them.
    const flyer = (await client.callTool({
      name: "generate_image",
      arguments: {
        prompt: "A flyer with this person and this logo",
        reference_ids: [portraitId, logoId],
        size: "1024x1536",
      },
    })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    assert.ok(!flyer.isError, JSON.stringify(flyer.content));
    assert.ok(
      flyer.content.some((c) => c.type === "image"),
      "it sees the flyer",
    );
    // With references, the provider's edit endpoint is the one used.
    assert.deepEqual(openaiCalls, ["/v1/images/edits"]);

    const animate = JSON.parse(
      (
        await call(client, "request_video", {
          prompt: "He waves",
          aspect_ratio: "16:9",
          duration_seconds: 8,
          resolution: "720p",
          start_image_id: portraitId,
        })
      ).text,
    );
    assert.equal(animate.status, "pending");

    // Another agent cannot use them.
    const other = await connect((await newAgent({ projectIds: [shared] })).key);
    const peek = await call(other, "studio_view", { kind: "reference", id: portraitId });
    assert.ok(peek.isError);
    await other.close();
    await client.close();

    // Deleting the agent deletes its imported files.
    const file = path.join(
      path.dirname(config.attachmentsDir),
      "agent-references",
      `${portraitId}.png`,
    );
    await fs.access(file);
    const removed = await asUser(owner, "DELETE", `/api/teams/${teamId}/agents/${agent.id}`);
    assert.equal(removed.statusCode, 204);
    await assert.rejects(fs.access(file));
  } finally {
    globalThis.fetch = realFetch;
  }
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { parsePipelineFile } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { PIPELINE_REFERENCE } from "@zelyq/tools";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * The build agent's way into Zelyq's pipelines and deploys: it sees what the
 * team has, writes and runs this app's pipelines as the person in the chat,
 * and cannot reach another app's pipeline, approve a protected deploy, or do
 * more than the person's role allows.
 */

const tmp = path.join(os.tmpdir(), `zelyq-agent-platform-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "platform.db")}`,
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
    previewPortRange: [4980, 4983],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
const users: Record<"owner" | "editor" | "viewer" | "outsider", { cookie: string; id: string }> = {
  owner: { cookie: "", id: "" },
  editor: { cookie: "", id: "" },
  viewer: { cookie: "", id: "" },
  outsider: { cookie: "", id: "" },
};
let teamId: string;
let shopId: string;
let blogId: string;

async function register(email: string, name: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, response.body);
  const cookie = `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
  return { cookie, id: response.json().user.id as string };
}

function call(cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
  return server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

/** What the agent's tools send: the session's preview grant, nothing else. */
function agent(
  who: keyof typeof users,
  projectId: string,
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
) {
  const token = server.previewGrants.mint(`ses_${who}_${projectId}`, projectId, users[who].id);
  return server.app.inject({
    method,
    url: `/api/internal/platform/${url}`,
    headers: { "x-zelyq-preview-bridge": token },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function settle(who: keyof typeof users, runId: string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const run = (await agent(who, shopId, "POST", "runs/status", { runId })).json();
    if (run.ended || run.waitingFor?.length) return run;
    if (Date.now() > deadline) throw new Error(`run still ${run.status}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const shopPipeline = (extra = "") => `name: Shop CI
runs-on: local
source: {app: Shop}
stages:
  - name: Test
    steps:
      - checkout: true
      - run: test -f package.json && echo checked out${extra}
`;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  users.owner = await register("owner@example.com", "Owner");
  for (const role of ["editor", "viewer", "outsider"] as const) {
    users[role] = await register(`${role}@example.com`, role);
  }
  teamId = (await call(users.owner.cookie, "GET", "/api/teams")).json().teams[0].id;
  for (const role of ["editor", "viewer"] as const) {
    const added = await call(users.owner.cookie, "POST", `/api/teams/${teamId}/members`, {
      email: `${role}@example.com`,
      role,
    });
    assert.equal(added.statusCode, 201, added.body);
  }
  await call(users.owner.cookie, "PUT", "/api/settings", { pipelineLocalRunner: "host" });
  shopId = (
    await call(users.owner.cookie, "POST", "/api/projects", { name: "Shop", teamId })
  ).json().project.id;
  blogId = (
    await call(users.owner.cookie, "POST", "/api/projects", { name: "Blog", teamId })
  ).json().project.id;
  await server.runtime.writeFile(shopId, "package.json", '{"name":"shop"}');

  // A machine and two environments: staging, and a protected production.
  const now = new Date().toISOString();
  await server.store.pipelines.runners.create({
    id: "rnr_box",
    teamId,
    kind: "ssh",
    name: "box",
    host: "203.0.113.7",
    port: 22,
    username: "zelyq",
    labels: '["docker"]',
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
  } as never);
  for (const [name, isProtected] of [
    ["staging", false],
    ["production", true],
  ] as const) {
    await server.store.deploy.environments.create({
      id: `env_${name}`,
      teamId,
      name,
      runnerId: "rnr_box",
      address: "203.0.113.7",
      domain: `${name}.example.com`,
      https: "auto",
      httpPort: 80,
      httpsPort: 443,
      protected: isProtected,
      frozen: false,
      frozenReason: null,
      opsTrust: "ask",
      variables: "{}",
      createdBy: null,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    } as never);
  }
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("only the session's own grant gets in, and only for a member of the team", async () => {
  const none = await server.app.inject({ method: "GET", url: "/api/internal/platform/overview" });
  assert.equal(none.statusCode, 401);
  const forged = await server.app.inject({
    method: "GET",
    url: "/api/internal/platform/overview",
    headers: { "x-zelyq-preview-bridge": "not-a-grant" },
  });
  assert.equal(forged.statusCode, 401);
  assert.equal((await agent("outsider", shopId, "GET", "overview")).statusCode, 404);
});

test("the overview shows the machines, the environments and that nothing is live yet", async () => {
  const response = await agent("viewer", shopId, "GET", "overview");
  assert.equal(response.statusCode, 200, response.body);
  const overview = response.json();
  assert.equal(overview.app.name, "Shop");
  assert.equal(overview.role, "viewer");
  assert.equal(overview.localRunner.available, true);
  assert.deepEqual(
    overview.runners.map((runner: { name: string }) => runner.name),
    ["box"],
  );
  const environments = Object.fromEntries(
    overview.environments.map((environment: { name: string }) => [environment.name, environment]),
  );
  assert.equal(environments.production.protected, true);
  assert.equal(environments.staging.protected, false);
  assert.equal(environments.staging.thisApp, null);
  assert.deepEqual(overview.pipelines, []);
});

test("a file is checked by line, and must be this app's", async () => {
  const broken = await agent("editor", shopId, "POST", "pipelines/save", {
    source: "name: Shop CI\nruns-on: local\nstages: nope\n",
    save: false,
  });
  assert.equal(broken.statusCode, 200, broken.body);
  assert.equal(broken.json().ok, false);
  assert.ok(broken.json().issues.length > 0);

  const otherApp = await agent("editor", shopId, "POST", "pipelines/save", {
    source: shopPipeline().replace("{app: Shop}", "{app: Blog}"),
    save: true,
  });
  assert.equal(otherApp.json().ok, false);
  assert.match(otherApp.json().issues[0].message, /source must be this app/);
  assert.equal(await server.store.pipelines.pipelines.findByName(teamId, "Shop CI"), null);

  const fine = await agent("editor", shopId, "POST", "pipelines/save", {
    source: shopPipeline(),
    save: false,
  });
  assert.equal(fine.json().ok, true, fine.body);
  assert.equal(fine.json().saved, null, "check_only saves nothing");
  assert.equal(await server.store.pipelines.pipelines.findByName(teamId, "Shop CI"), null);
});

test("a viewer can look but not save", async () => {
  const response = await agent("viewer", shopId, "POST", "pipelines/save", {
    source: shopPipeline(),
    save: true,
  });
  assert.equal(response.statusCode, 403, response.body);
});

test("an editor saves this app's pipeline; a later change needs the version it was written against", async () => {
  const created = await agent("editor", shopId, "POST", "pipelines/save", {
    source: shopPipeline(),
    save: true,
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(created.json().saved.created, true);
  const base = created.json().saved.base as string;

  const listed = (await agent("viewer", shopId, "GET", "overview")).json();
  assert.equal(listed.pipelines.length, 1);
  assert.equal(listed.pipelines[0].name, "Shop CI");
  assert.equal(listed.pipelines[0].base, base);
  assert.equal(listed.pipelines[0].source, shopPipeline());
  // Another app's chat does not see it as its own.
  assert.deepEqual((await agent("viewer", blogId, "GET", "overview")).json().pipelines, []);

  // Someone edits it in Zelyq: the agent's stale copy is refused, not saved over it.
  const row = await server.store.pipelines.pipelines.findByName(teamId, "Shop CI");
  const edited = await call(
    users.owner.cookie,
    "PUT",
    `/api/teams/${teamId}/pipelines/${row?.id}`,
    {
      source: shopPipeline(" by a person"),
    },
  );
  assert.equal(edited.statusCode, 200, edited.body);
  const stale = await agent("editor", shopId, "POST", "pipelines/save", {
    source: shopPipeline(" by the agent"),
    base,
    save: true,
  });
  assert.equal(stale.json().ok, false);
  assert.match(stale.json().issues[0].message, /changed in Zelyq since you read it/);

  const fresh = (await agent("viewer", shopId, "GET", "overview")).json().pipelines[0];
  const updated = await agent("editor", shopId, "POST", "pipelines/save", {
    source: shopPipeline(" by the agent"),
    base: fresh.base,
    save: true,
  });
  assert.equal(updated.json().ok, true, updated.body);
  assert.equal(updated.json().saved.created, false);

  // A pipeline of the same name that belongs to another app is never taken over.
  const blogs = await agent("editor", blogId, "POST", "pipelines/save", {
    source: shopPipeline().replace("{app: Shop}", "{app: Blog}"),
    save: true,
  });
  assert.equal(blogs.json().ok, false);
  assert.match(blogs.json().issues[0].message, /belongs to something else/);
});

test("a run passes, a broken one says where and shows its output", async () => {
  const started = await agent("editor", shopId, "POST", "pipelines/run", { pipeline: "shop ci" });
  assert.equal(started.statusCode, 200, started.body);
  const passed = await settle("editor", started.json().runId);
  assert.equal(passed.status, "passed", JSON.stringify(passed));
  assert.equal(passed.failedStep, null);

  const fresh = (await agent("viewer", shopId, "GET", "overview")).json().pipelines[0];
  await agent("editor", shopId, "POST", "pipelines/save", {
    source: `${shopPipeline()}      - run: echo "Cannot find module ./missing" && exit 3\n`,
    base: fresh.base,
    save: true,
  });
  const again = await agent("editor", shopId, "POST", "pipelines/run", { pipeline: "Shop CI" });
  const failed = await settle("editor", again.json().runId);
  assert.equal(failed.status, "failed");
  assert.equal(failed.failedStep.stage, "Test");
  assert.equal(failed.failedStep.exitCode, 3);
  assert.ok(failed.logTail.some((line: string) => line.includes("Cannot find module ./missing")));

  // Latest run, by pipeline name and by number.
  const latest = (
    await agent("viewer", shopId, "POST", "runs/status", { pipeline: "Shop CI" })
  ).json();
  assert.equal(latest.number, failed.number);
  const first = (
    await agent("viewer", shopId, "POST", "runs/status", { pipeline: "Shop CI", number: 1 })
  ).json();
  assert.equal(first.status, "passed");
});

test("a viewer cannot run, and no chat can run or read another app's pipeline", async () => {
  assert.equal(
    (await agent("viewer", shopId, "POST", "pipelines/run", { pipeline: "Shop CI" })).statusCode,
    403,
  );
  const fromBlog = await agent("editor", blogId, "POST", "pipelines/run", { pipeline: "Shop CI" });
  assert.equal(fromBlog.statusCode, 400);
  assert.match(fromBlog.json().error.message, /not one of this app's pipelines/);
  const shopRun = (
    await agent("viewer", shopId, "POST", "runs/status", { pipeline: "Shop CI" })
  ).json().runId;
  const peek = await agent("editor", blogId, "POST", "runs/status", { runId: shopRun });
  assert.equal(peek.statusCode, 400);
});

test("a deploy to a protected environment waits for a person; the agent cannot answer it", async () => {
  const fresh = (await agent("viewer", shopId, "GET", "overview")).json().pipelines[0];
  const saved = await agent("editor", shopId, "POST", "pipelines/save", {
    source: `name: Shop CI
runs-on: local
source: {app: Shop}
stages:
  - name: Production
    steps:
      - deploy: {to: production, port: 3000}
`,
    base: fresh.base,
    save: true,
  });
  assert.equal(saved.json().ok, true, saved.body);
  assert.deepEqual(saved.json().saved.deploysTo, ["production"]);
  const started = await agent("editor", shopId, "POST", "pipelines/run", { pipeline: "Shop CI" });
  const run = await settle("editor", started.json().runId);
  assert.equal(run.ended, false);
  assert.equal(run.waitingFor.length, 1);
  assert.match(run.waitingFor[0].message, /production/i);
  // Nothing on the bridge decides an approval.
  const routes = server.app.printRoutes({ commonPrefix: false });
  assert.ok(!/internal\/platform[^\n]*(approv|decide)/.test(routes));
  await call(users.owner.cookie, "POST", `/api/teams/${teamId}/pipeline-runs/${run.runId}/cancel`);
});

test("the app status for an environment it is not on says so", async () => {
  const response = await agent("viewer", shopId, "POST", "apps/status", { environment: "staging" });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { live: false, environment: "staging" });
  const missing = await agent("viewer", shopId, "POST", "apps/status", { environment: "mars" });
  assert.equal(missing.statusCode, 400);
});

test("the reference the agent is given is itself a valid pipeline", () => {
  const yaml = PIPELINE_REFERENCE.split("\n")
    .slice(1)
    .filter((line) => !/^(Other steps:|The deploy step builds)/.test(line))
    .join("\n")
    .replace("<App> CI", "Shop CI")
    .replace("<exact app name>", "Shop");
  const parsed = parsePipelineFile(yaml);
  assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.issues));
});

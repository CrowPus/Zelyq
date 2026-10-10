import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { containerEngineAvailable } from "@zelyq/runtime";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { type DebianSsh, debianImageAvailable, startDebianSsh } from "./helpers/debian-ssh.js";

/**
 * The built-in steps — approval, setup, cache, docker — end to end through
 * the HTTP API, on this server's local runner and on a real Debian machine
 * over SSH. Downloads are real (nodejs.org, the Python builds, Docker Hub):
 * these tests need the internet, and skip what they cannot reach.
 */

const tmp = path.join(os.tmpdir(), `zelyq-steps-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const SECRET = "xxxxxxxx-registry-xxxxxxxx";

function config(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "steps.db")}`,
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
      previewPortRange: [4966, 4969],
      previewHost: "127.0.0.1",
    },
  };
}

let server: ZelyqServer;
const cookies = { owner: "", admin: "", editor: "", viewer: "" };
let teamId: string;
let debian: DebianSsh | null = null;
let registry: { container: string; port: number } | null = null;
const online = await fetch("https://nodejs.org/dist/index.json", {
  method: "HEAD",
  signal: AbortSignal.timeout(5000),
})
  .then((response) => response.ok)
  .catch(() => false);
const docker = await containerEngineAvailable();

function call(
  cookie: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) {
  return server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}
const team = (suffix: string) => `/api/teams/${teamId}${suffix}`;

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, response.body);
  const cookie = response.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(cookie);
  return `zelyq_session=${cookie.value}`;
}

async function createPipeline(source: string): Promise<string> {
  const response = await call(cookies.owner, "POST", team("/pipelines"), { source });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().pipeline.id;
}

async function start(pipelineId: string, cookie = cookies.owner): Promise<string> {
  const response = await call(cookie, "POST", team(`/pipelines/${pipelineId}/runs`), {});
  assert.equal(response.statusCode, 201, response.body);
  return response.json().run.id;
}

async function runOf(runId: string) {
  return (await call(cookies.owner, "GET", team(`/pipeline-runs/${runId}`))).json().run;
}

async function logOf(runId: string): Promise<string> {
  const lines = (
    await call(cookies.owner, "GET", team(`/pipeline-runs/${runId}/logs?after=0`))
  ).json().lines;
  return lines.map((line: { text: string }) => line.text).join("\n");
}

async function until(runId: string, statuses: string[], timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await runOf(runId);
    if (statuses.includes(run.status)) return { run, log: await logOf(runId) };
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `run ${runId} did not reach ${statuses.join("/")}: ${JSON.stringify(await runOf(runId))}`,
  );
}
const finished = (runId: string, timeoutMs?: number) =>
  until(runId, ["passed", "failed", "cancelled", "timed_out"], timeoutMs);

async function answer(
  runId: string,
  cookie: string,
  decision: "approved" | "rejected",
  comment?: string,
) {
  const run = await runOf(runId);
  const open = run.approvals.find((approval: { decision: string | null }) => !approval.decision);
  assert.ok(open, "there is an open approval");
  return call(cookie, "POST", team(`/pipeline-runs/${runId}/approvals/${open.id}`), {
    decision,
    ...(comment ? { comment } : {}),
  });
}

async function boot() {
  server = await buildServer(config());
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config().databaseUrl);
  await boot();
  cookies.owner = await register("owner@example.com", "Owner");
  teamId = (await call(cookies.owner, "GET", "/api/teams")).json().teams[0].id;
  for (const role of ["admin", "editor", "viewer"] as const) {
    cookies[role] = await register(`${role}@example.com`, role[0]?.toUpperCase() + role.slice(1));
    const added = await call(cookies.owner, "POST", team("/members"), {
      email: `${role}@example.com`,
      role,
    });
    assert.equal(added.statusCode, 201, added.body);
  }
  await call(cookies.owner, "PUT", "/api/settings", { pipelineLocalRunner: "host" });
});

after(async () => {
  debian?.stop();
  if (registry) execFileSync("docker", ["rm", "-f", registry.container], { stdio: "ignore" });
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------------------ approval

test("approval: the run waits, holds nothing, and continues when an admin approves", async () => {
  const id = await createPipeline(`name: Approve me
runs-on: local
stages:
  - name: Build
    steps:
      - run: echo built > out.txt
  - name: Production
    steps:
      - approval: Deploy to production?
      - run: cat out.txt && echo deployed
`);
  const runId = await start(id, cookies.editor);
  const { run } = await until(runId, ["waiting"]);
  assert.equal(run.stages[1].status, "waiting");
  assert.equal(run.approvals[0].message, "Deploy to production?");
  assert.equal(run.approvals[0].canDecide, true, "the owner may answer");

  // Who may answer is checked when they answer.
  assert.equal((await answer(runId, cookies.viewer, "approved")).statusCode, 403);
  assert.equal((await answer(runId, cookies.editor, "approved")).statusCode, 403);
  const editorView = (await call(cookies.editor, "GET", team(`/pipeline-runs/${runId}`))).json()
    .run;
  assert.equal(editorView.approvals[0].canDecide, false);

  const approved = await answer(runId, cookies.admin, "approved", "Looks good");
  assert.equal(approved.statusCode, 200, approved.body);
  const done = await finished(runId);
  assert.equal(done.run.status, "passed", done.log);
  assert.match(done.log, /Approved by Admin: Looks good/);
  assert.match(done.log, /built\ndeployed/, "the files from before the wait are still there");
});

test("approval: rejected fails the step, and failure() stages still run; allow-self: false needs someone else", async () => {
  const id = await createPipeline(`name: Reject me
runs-on: local
stages:
  - name: Production
    steps:
      - approval:
          message: Ship it?
          allow-self: false
      - run: echo shipped
  - name: Tell someone
    if: failure()
    steps:
      - run: echo told
`);
  const runId = await start(id, cookies.admin);
  await until(runId, ["waiting"]);
  const self = await answer(runId, cookies.admin, "approved");
  assert.equal(self.statusCode, 403);
  assert.match(self.body, /someone other than the person who started/);
  assert.equal((await answer(runId, cookies.owner, "rejected", "Not today")).statusCode, 200);
  const done = await finished(runId);
  assert.equal(done.run.status, "failed");
  assert.match(done.log, /Rejected by Owner: Not today/);
  assert.match(done.log, /told/);
  assert.doesNotMatch(done.log, /^shipped$/m);
});

test("approval: nobody answers in time, and the run's own timeout does not count the wait", async () => {
  const id = await createPipeline(`name: Too slow
runs-on: local
timeout: 5s
stages:
  - name: A
    steps:
      - approval: {message: Anyone?, timeout: 8s}
`);
  const runId = await start(id);
  const done = await finished(runId, 60_000);
  assert.equal(done.run.steps[0].status, "timed_out");
  assert.equal(done.run.status, "failed", "the approval timed out, not the run");
  assert.match(done.log, /Nobody answered in time/);
});

test("approval: a run waiting when Zelyq restarts is still waiting after, and continues", async () => {
  const id = await createPipeline(`name: Survive a restart
runs-on: local
stages:
  - name: A
    steps:
      - run: echo before > kept.txt
      - approval: Carry on?
      - run: cat kept.txt
`);
  const runId = await start(id);
  await until(runId, ["waiting"]);
  await server.close();
  await boot();
  const after = await runOf(runId);
  assert.equal(after.status, "waiting");
  assert.equal((await answer(runId, cookies.owner, "approved")).statusCode, 200);
  const done = await finished(runId);
  assert.equal(done.run.status, "passed", done.log);
  assert.match(done.log, /continues after Zelyq restarted/);
  assert.match(done.log, /^before$/m);
});

// --------------------------------------------------------------------- cache

test("cache: a miss is saved only when the run passes, and the next run hits", async () => {
  const id = await createPipeline(`name: Cached
runs-on: local
stages:
  - name: A
    steps:
      - run: echo '{"lockfileVersion":3}' > package-lock.json
      - cache: node_modules
      - run: |
          if [ -f node_modules/marker ]; then echo "restored: $(cat node_modules/marker)"; else mkdir -p node_modules && echo installed > node_modules/marker; fi
`);
  const first = await finished(await start(id));
  assert.equal(first.run.status, "passed", first.log);
  assert.match(first.log, /Cache miss: node_modules/);
  assert.match(first.log, /Saved the cache of node_modules/);

  const second = await finished(await start(id));
  assert.match(second.log, /Cache hit: node_modules/);
  assert.match(second.log, /restored: installed/);

  // A changed lock file is a different cache.
  const changed = await createPipeline(`name: Cached failing
runs-on: local
stages:
  - name: A
    steps:
      - run: echo '{"lockfileVersion":2}' > package-lock.json
      - cache: node_modules
      - run: mkdir -p node_modules && echo x > node_modules/marker && exit 1
`);
  const failing = await finished(await start(changed));
  assert.equal(failing.run.status, "failed");
  assert.match(failing.log, /Cache miss/);
  assert.doesNotMatch(failing.log, /Saved the cache/, "a failed run saves nothing");
});

// --------------------------------------------------------------------- setup

test("setup on this server: Node from the approved list, checked, on PATH for later steps", {
  skip: !online && "offline",
}, async () => {
  const id = await createPipeline(`name: Node here
runs-on: local
stages:
  - name: A
    steps:
      - setup: node@22
      - run: node -e "console.log('node says', process.version)"
      - setup: node@99
`);
  const done = await finished(await start(id));
  assert.match(done.log, /Node 22\.\d+\.\d+ is on PATH/);
  assert.match(done.log, /node says v22\./);
  assert.match(done.log, /Node 99 is not on Zelyq's approved tools list\. Approved: /);
  assert.equal(done.run.steps[2].status, "failed");
});

test("setup and cache on a Debian machine over SSH, set up with the setup command", {
  skip: (!online || !debianImageAvailable()) && "offline or no Debian image",
}, async () => {
  const keys = (await call(cookies.owner, "GET", team("/ssh-keys"))).json().keys;
  debian = await startDebianSsh(keys[0].publicKey);
  if (!debian) return;
  const added = await call(cookies.owner, "POST", team("/runners"), {
    name: "debian",
    host: debian.host,
    port: debian.port,
    username: debian.username,
  });
  assert.equal(added.statusCode, 201, added.body);
  const runnerId = added.json().runner.id;
  const tested = (await call(cookies.owner, "POST", team(`/runners/${runnerId}/test`))).json();
  const confirmed = await call(cookies.owner, "POST", team(`/runners/${runnerId}/confirm`), {
    fingerprint: tested.hostKeyFingerprint,
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);

  const id = await createPipeline(`name: On Debian
runs-on: debian
stages:
  - name: Tools
    steps:
      - run: echo 22 > .nvmrc && echo '{"lockfileVersion":3}' > package-lock.json
      - setup: node
      - setup: python@3.12
      - run: |
          node --version
          python --version
          python3 -c "print('python works')"
      - cache: node_modules
      - run: |
          if [ -d node_modules/left-pad ]; then echo "from cache"; else mkdir -p node_modules/left-pad && echo fresh; fi
`);
  const first = await finished(await start(id), 600_000);
  assert.equal(first.run.status, "passed", first.log);
  assert.match(first.log, /Downloading Node 22\.\d+\.\d+ \(linux-x64\) from nodejs\.org/);
  assert.match(first.log, /v22\./, ".nvmrc chose Node 22");
  assert.match(first.log, /Python 3\.12\.\d+/);
  assert.match(first.log, /python works/);
  assert.match(first.log, /fresh/);
  assert.match(first.log, /Saved the cache of node_modules/);

  const second = await finished(await start(id), 300_000);
  assert.equal(second.run.status, "passed", second.log);
  assert.match(second.log, /Node 22\.\d+\.\d+ is already on this machine/);
  assert.doesNotMatch(second.log, /Downloading/);
  assert.match(second.log, /Cache hit: node_modules/);
  assert.match(second.log, /from cache/);
  assert.match(debian.root("ls /home/zelyq/zelyq/tools/node"), /^22\./m);

  // What Zelyq keeps there, and clearing it.
  const disk = (await call(cookies.owner, "GET", team(`/runners/${runnerId}/disk`))).json().disk;
  assert.ok(disk.toolsBytes > 10_000_000, `tools: ${disk.toolsBytes}`);
  assert.ok(disk.cacheBytes > 0, `cache: ${disk.cacheBytes}`);
  assert.ok(disk.freeBytes > 0 && disk.totalBytes >= disk.freeBytes);
  assert.equal(
    (await call(cookies.editor, "GET", team(`/runners/${runnerId}/disk`))).statusCode,
    403,
  );
  const cleared = await call(cookies.owner, "POST", team(`/runners/${runnerId}/disk/clear`), {
    what: "cache",
  });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().disk.cacheBytes, 0);
  assert.ok(cleared.json().disk.toolsBytes > 0, "tools stay");
});

// -------------------------------------------------------------------- docker

test("docker: build, log in and push from Vault; the password is in no log and no file afterwards", {
  skip: !docker && "no Docker",
}, async () => {
  try {
    const container = execFileSync("docker", [
      "run",
      "-d",
      "--rm",
      "-p",
      "127.0.0.1::5000",
      "registry:2",
    ])
      .toString()
      .trim();
    const port = Number(
      execFileSync("docker", ["port", container, "5000/tcp"]).toString().trim().split(":").pop(),
    );
    registry = { container, port };
  } catch {
    return; // no registry image and no network
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const secret = await call(cookies.owner, "POST", team("/vault"), {
    name: "REGISTRY_PASSWORD",
    value: SECRET,
  });
  assert.equal(secret.statusCode, 201, secret.body);
  const image = `localhost:${registry.port}/zelyq-test/hello`;
  const id = await createPipeline(`name: Image
runs-on: local
stages:
  - name: Build
    steps:
      - run: printf 'FROM alpine:latest\\nARG GREETING\\nRUN echo "$GREETING" > /greeting\\n' > Dockerfile
      - docker:
          image: ${image}
          tags: [latest, "run-$ZELYQ_RUN_NUMBER"]
          build-args:
            GREETING: hello
          push: true
          login:
            username: deploy
            password: vault://REGISTRY_PASSWORD
      - run: ls -a "$ZELYQ_WORKSPACE" | grep zelyq-docker || echo "no docker login left"
`);
  const done = await finished(await start(id), 600_000);
  assert.equal(done.run.status, "passed", done.log);
  assert.match(done.log, /Login Succeeded/);
  assert.match(done.log, /Pushed /);
  assert.match(done.log, /no docker login left/);
  assert.ok(!done.log.includes(SECRET), "the registry password appeared in the log");
  const tags = await fetch(`http://127.0.0.1:${registry.port}/v2/zelyq-test/hello/tags/list`).then(
    (r) => r.json(),
  );
  assert.deepEqual(tags.tags.sort(), ["latest", "run-1"]);
  const config = await fs
    .readFile(path.join(os.homedir(), ".docker", "config.json"), "utf8")
    .catch(() => "");
  assert.ok(
    !config.includes(`localhost:${registry.port}`),
    "the login was written to the machine's own Docker config",
  );
});

test("docker: the local runner's container has no Docker, and says so", {
  skip: !docker && "no Docker",
}, async () => {
  await call(cookies.owner, "PUT", "/api/settings", {
    pipelineLocalRunner: "container",
    pipelineLocalImage: "alpine:latest",
  });
  try {
    const id = await createPipeline(`name: No docker here
runs-on: local
stages:
  - name: A
    steps:
      - docker: {image: example/app}
`);
    const done = await finished(await start(id));
    assert.equal(done.run.status, "failed");
    assert.match(done.log, /docker steps need a machine with Docker/);
  } finally {
    await call(cookies.owner, "PUT", "/api/settings", { pipelineLocalRunner: "host" });
  }
});

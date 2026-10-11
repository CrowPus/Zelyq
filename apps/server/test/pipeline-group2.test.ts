import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { type DockerSsh, dockerHostAvailable, startDockerSsh } from "./helpers/docker-ssh.js";

/**
 * Pipelines group 2 (docs/pipeline-group2-plan.md): push paths, pull
 * requests and forks, ✓ / ✗ reported to the repository, step outputs,
 * service containers and JUnit test reports — on this server's local runner.
 */

const tmp = path.join(os.tmpdir(), `zelyq-group2-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "group2.db")}`,
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
    previewPortRange: [4950, 4953],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let sshMachine: DockerSsh | null = null;
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
  sshMachine?.stop();
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const dockerAvailable = (() => {
  try {
    execFileSync("docker", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let lastSecret = { id: "", secret: "" };

async function pushTrigger(id: string, extra: Record<string, unknown>) {
  const added = await call("POST", team(`/pipelines/${id}/triggers`), {
    kind: "push",
    branches: ["main"],
    ...extra,
  });
  assert.equal(added.statusCode, 201, added.body);
  const { trigger, secret } = added.json() as { trigger: { id: string }; secret: string };
  lastSecret = { id: trigger.id, secret };
  return (event: string, body: object) => {
    const payload = JSON.stringify(body);
    return server.app.inject({
      method: "POST",
      url: `/api/hooks/pipelines/${trigger.id}`,
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
      },
      payload,
    });
  };
}

const SIMPLE = (name: string) =>
  `name: ${name}\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo hi\n`;

test("paths: a push runs only when it changed a matching file", async () => {
  const id = await create(SIMPLE("Frontend"));
  const hook = await pushTrigger(id, { paths: ["frontend/**", "package.json"] });
  const push = (files: string[]) => ({
    ref: "refs/heads/main",
    after: "b".repeat(40),
    commits: [{ added: [], modified: files, removed: [] }],
  });
  const none = await hook("push", push(["docs/readme.md", "backend/app.ts"]));
  assert.equal(none.statusCode, 202);
  assert.match(none.json().message, /none of this trigger's paths/);
  assert.equal((await hook("push", push(["frontend/src/deep/App.tsx"]))).statusCode, 201);
  assert.equal((await hook("push", push(["package.json"]))).statusCode, 201);
  // Too big for the webhook to list every file: it runs anyway.
  const big = {
    ref: "refs/heads/main",
    after: "c".repeat(40),
    commits: Array.from({ length: 20 }, () => ({
      added: [],
      modified: ["docs/x.md"],
      removed: [],
    })),
  };
  assert.equal((await hook("push", big)).statusCode, 201);
  assert.equal((await runs(id)).length, 3);
  const listed = (await call("GET", team(`/pipelines/${id}/triggers`))).json().triggers;
  assert.deepEqual(listed[0].paths, ["frontend/**", "package.json"]);
});

test("pull requests: run on the newest commit, never from a fork, only when asked", async () => {
  const id = await create(SIMPLE("Pull requests"));
  const hook = await pushTrigger(id, { pullRequests: true });
  const request = (fork: boolean, base = "main", action = "opened") => ({
    action,
    pull_request: {
      head: {
        sha: "d".repeat(40),
        ref: "feature/login",
        repo: { full_name: fork ? "stranger/shop" : "team/shop" },
      },
      base: { ref: base, repo: { full_name: "team/shop" } },
    },
  });
  const fork = await hook("pull_request", request(true));
  assert.equal(fork.statusCode, 202);
  assert.match(fork.json().message, /forks do not run/);
  assert.equal((await hook("pull_request", request(false, "develop"))).statusCode, 202);
  assert.equal((await hook("pull_request", request(false, "main", "closed"))).statusCode, 202);
  const started = await hook("pull_request", request(false));
  assert.equal(started.statusCode, 201, started.body);
  const [run] = await runs(id);
  assert.equal(run?.trigger, "pull_request");

  // GitLab's merge request, the same way.
  const gitlab = (token: string, fork: boolean) =>
    server.app.inject({
      method: "POST",
      url: `/api/hooks/pipelines/${lastSecret.id}`,
      headers: {
        "content-type": "application/json",
        "x-gitlab-event": "Merge Request Hook",
        "x-gitlab-token": token,
      },
      payload: {
        object_kind: "merge_request",
        object_attributes: {
          action: "update",
          source_branch: "feature/cart",
          target_branch: "main",
          source_project_id: fork ? 99 : 7,
          target_project_id: 7,
          last_commit: { id: "f".repeat(40) },
        },
      },
    });
  assert.equal((await gitlab("wrong", false)).statusCode, 401);
  assert.equal((await gitlab(lastSecret.secret, true)).statusCode, 202);
  const merge = await gitlab(lastSecret.secret, false);
  assert.equal(merge.statusCode, 201, merge.body);
  assert.equal((await runs(id)).length, 2);

  // A trigger without "pull requests" ignores them.
  const other = await create(SIMPLE("Pushes only"));
  const pushOnly = await pushTrigger(other, {});
  const ignored = await pushOnly("pull_request", request(false));
  assert.equal(ignored.statusCode, 202);
  assert.equal((await runs(other)).length, 0);
});

test("report-status: pending, then success or failure, on the run's commit", async () => {
  const reports: {
    state: string;
    sha: string;
    context: string;
    url: string | null;
    token: string;
  }[] = [];
  server.pipelineEngine.reporter = async (target, state) => {
    reports.push({
      state,
      sha: target.sha,
      context: target.context,
      url: target.url,
      token: target.token,
    });
  };
  const saved = await call("POST", team("/vault"), {
    name: "GITHUB_TOKEN",
    value: "ghp_test_token",
  });
  assert.equal(saved.statusCode, 201, saved.body);
  const id = await create(`name: Checks
runs-on: local
source:
  repo: https://github.com/team/shop
  token: vault://GITHUB_TOKEN
  report-status: true
stages:
  - name: A
    steps:
      - run: exit \${{ inputs.code }}
inputs:
  code: {default: "0"}
`);
  const sha = "e".repeat(40);
  const passed = await start(id, { ref: sha });
  assert.equal(passed.statusCode, 201, passed.body);
  await finished(passed.json().run.id);
  const failed = await start(id, { ref: sha, inputs: { code: "1" } });
  await finished(failed.json().run.id);
  // Not a commit: nothing is reported.
  await finished((await start(id, { ref: "main" })).json().run.id);
  assert.deepEqual(
    reports.map((r) => r.state),
    ["pending", "success", "pending", "failure"],
  );
  assert.ok(reports.every((r) => r.sha === sha && r.context === "zelyq/Checks"));
  assert.ok(reports.every((r) => r.token === "ghp_test_token"));

  // A repository that refuses: the run still passes, with a line in its log.
  server.pipelineEngine.reporter = async () => {
    throw new Error("GitHub answered 403.");
  };
  const refused = await finished((await start(id, { ref: sha })).json().run.id);
  assert.equal(refused.run.status, "passed");
  assert.match(refused.log, /Could not report the status to the repository: GitHub answered 403/);
});

test("outputs: a step's values reach later steps, and a missing one fails clearly", async () => {
  const id = await create(`name: Outputs
runs-on: local
stages:
  - name: Build
    steps:
      - id: meta
        run: |
          echo "version=1.4.2" >> "$ZELYQ_OUTPUT"
          printf 'notes<<END\\nline one\\nline two\\nEND\\n' >> "$ZELYQ_OUTPUT"
  - name: Ship
    steps:
      - run: echo "shipping \${{ steps.meta.outputs.version }} / $(echo "\${{ steps.meta.outputs.notes }}" | wc -l) lines"
`);
  const { run, log } = await finished((await start(id)).json().run.id);
  assert.equal(run.status, "passed", log);
  assert.match(log, /shipping 1\.4\.2 \/ 2 lines/);
  assert.match(log, /Outputs: version, notes\./);
  const meta = run.steps.find((step: { name: string }) => step.name.includes("version"));
  assert.deepEqual(meta.outputs, { version: "1.4.2", notes: "line one\nline two" });

  const wrong = await create(`name: Wrong output
runs-on: local
stages:
  - name: A
    steps:
      - id: meta
        run: echo "version=1" >> "$ZELYQ_OUTPUT"
      - run: echo "\${{ steps.meta.outputs.versoin }}"
`);
  const failed = await finished((await start(wrong)).json().run.id);
  assert.equal(failed.run.status, "failed");
  assert.match(
    failed.log,
    /Not known when this step starts: \$\{\{ steps\.meta\.outputs\.versoin \}\}/,
  );
});

test("the file is checked: unique step ids, services' names", async () => {
  const duplicate = await call("POST", team("/pipelines"), {
    source: `name: Dup\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - id: a\n        run: echo\n      - id: a\n        run: echo\n`,
  });
  assert.equal(duplicate.statusCode, 400, duplicate.body);
  const badService = await call("POST", team("/pipelines"), {
    source: `name: Bad\nruns-on: local\nservices:\n  My-DB: {image: postgres:16, port: 5432}\nstages:\n  - name: A\n    steps:\n      - run: echo\n`,
  });
  assert.equal(badService.statusCode, 400, badService.body);
});

test("tests: a JUnit report shows passed, failed and skipped, with each failure", async () => {
  const id = await create(`name: Reports
runs-on: local
stages:
  - name: Test
    steps:
      - run: |
          mkdir -p reports/unit
          cat > reports/unit/junit.xml <<'XML'
          <?xml version="1.0"?>
          <testsuites>
            <testsuite name="cart" tests="4">
              <testcase classname="cart" name="adds an item"/>
              <testcase classname="cart" name="removes an item"/>
              <testcase classname="cart" name="applies a coupon">
                <failure message="expected 90 to be 80">AssertionError: expected 90 to be 80
            at cart.test.ts:42</failure>
              </testcase>
              <testcase classname="cart" name="ships abroad"><skipped/></testcase>
            </testsuite>
          </testsuites>
          XML
          echo 'not xml at all' > reports/broken.xml
          exit 1
        tests: reports/**/*.xml
`);
  const { run, log } = await finished((await start(id)).json().run.id);
  assert.equal(run.status, "failed");
  assert.match(log, /Tests: 2 passed, 1 failed, 1 skipped\./);
  const step = run.steps[0];
  assert.equal(step.tests.passed, 2);
  assert.equal(step.tests.failures[0].name, "applies a coupon");
  assert.equal(step.tests.failures[0].message, "expected 90 to be 80");
  assert.match(step.tests.failures[0].details, /cart\.test\.ts:42/);

  const none = await create(`name: No reports
runs-on: local
stages:
  - name: Test
    steps:
      - run: echo nothing
        tests: reports/*.xml
`);
  const empty = await finished((await start(none)).json().run.id);
  assert.equal(empty.run.status, "passed");
  assert.match(empty.log, /No test report matches reports\/\*\.xml\./);
});

test("services: Postgres and Redis for the run, reachable on 127.0.0.1, removed after", {
  skip: !dockerAvailable && "no Docker",
}, async () => {
  const id = await create(`name: Services
runs-on: local
services:
  postgres:
    image: postgres:16-alpine
    env: {POSTGRES_PASSWORD: test}
    port: 5432
  redis:
    image: redis:7-alpine
    port: 6379
stages:
  - name: Test
    steps:
      - run: |
          echo "db=postgres://postgres:test@\${{ services.postgres.host }}:\${{ services.postgres.port }}/postgres"
          echo "redis on $ZELYQ_SERVICE_REDIS_HOST:$ZELYQ_SERVICE_REDIS_PORT"
          exec 3<>/dev/tcp/$ZELYQ_SERVICE_REDIS_HOST/$ZELYQ_SERVICE_REDIS_PORT
          printf 'PING\\r\\n' >&3
          head -c 5 <&3
          echo
        shell: bash
`);
  const started = (await start(id)).json().run.id as string;
  const { run, log } = await finished(started, 300_000);
  assert.equal(run.status, "passed", log);
  assert.match(log, /db=postgres:\/\/postgres:test@127\.0\.0\.1:\d+\/postgres/);
  assert.match(log, /\+PONG/);
  assert.match(log, /Services are ready\./);
  const left = execFileSync("docker", [
    "ps",
    "-aq",
    "--filter",
    `label=zelyq.pipeline-run=${started}`,
  ])
    .toString()
    .trim();
  assert.equal(left, "", "the service containers were removed");
});

test("services beside the local runner's container: reached by their name", {
  skip: !dockerAvailable && "no Docker",
}, async () => {
  await call("PUT", "/api/settings", { pipelineLocalRunner: "container" });
  try {
    const id = await create(`name: Services in a container
runs-on: local
services:
  redis: {image: redis:7-alpine, port: 6379}
stages:
  - name: Test
    steps:
      - run: |
          echo "redis on \${{ services.redis.host }}:\${{ services.redis.port }}"
          exec 3<>/dev/tcp/redis/6379
          printf 'PING\\r\\n' >&3
          head -c 5 <&3
          echo
        shell: bash
`);
    const started = (await start(id)).json().run.id as string;
    const { run, log } = await finished(started, 300_000);
    assert.equal(run.status, "passed", log);
    assert.match(log, /redis on redis:6379/);
    assert.match(log, /\+PONG/);
    const network = execFileSync("docker", [
      "network",
      "ls",
      "-q",
      "--filter",
      `label=zelyq.pipeline-run=${started}`,
    ])
      .toString()
      .trim();
    assert.equal(network, "", "the run's network was removed");
  } finally {
    await call("PUT", "/api/settings", { pipelineLocalRunner: "host" });
  }
});

test("services on an SSH runner with Docker: a vault value as the password, masked", {
  skip: !dockerHostAvailable() && "no Docker SSH image",
}, async () => {
  const keys = (await call("GET", team("/ssh-keys"))).json().keys;
  sshMachine = await startDockerSsh(keys[0].publicKey);
  assert.ok(sshMachine, "the SSH machine started");
  const added = await call("POST", team("/runners"), {
    name: "docker-box",
    host: sshMachine.host,
    port: sshMachine.port,
    username: sshMachine.username,
  });
  const runnerId = added.json().runner.id;
  const tested = (await call("POST", team(`/runners/${runnerId}/test`))).json();
  await call("POST", team(`/runners/${runnerId}/confirm`), {
    fingerprint: tested.hostKeyFingerprint,
  });
  await call("POST", team("/vault"), { name: "DB_PASS", value: "s3cret-db-pass" });
  const id = await create(`name: Services over SSH
runs-on: docker-box
services:
  postgres:
    image: postgres:16-alpine
    env: {POSTGRES_PASSWORD: vault://DB_PASS}
    port: 5432
stages:
  - name: Test
    steps:
      - run: |
          echo "db on $ZELYQ_SERVICE_POSTGRES_HOST:$ZELYQ_SERVICE_POSTGRES_PORT"
          docker exec "$(docker ps -q --filter label=zelyq.pipeline-run=$ZELYQ_RUN_ID)" printenv POSTGRES_PASSWORD
`);
  const started = (await start(id)).json().run.id as string;
  const { run, log } = await finished(started, 300_000);
  assert.equal(run.status, "passed", log);
  assert.match(log, /db on 127\.0\.0\.1:\d+/);
  assert.match(log, /\*\*\*/, "the password is masked in the log");
  assert.ok(!log.includes("s3cret-db-pass"));
  const left = execFileSync("docker", [
    "ps",
    "-aq",
    "--filter",
    `label=zelyq.pipeline-run=${started}`,
  ])
    .toString()
    .trim();
  assert.equal(left, "", "the service containers were removed");
});

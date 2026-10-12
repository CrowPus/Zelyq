import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { containerEngineAvailable } from "@zelyq/runtime";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { type SshServer, sshImageAvailable, startSshServer } from "./helpers/ssh-server.js";

/**
 * Pipelines end to end, through the HTTP API: a real OpenSSH machine as the
 * runner, the team's Vault for secrets, and the server's own local runner.
 */

const tmp = path.join(os.tmpdir(), `zelyq-pipelines-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const SECRET = "tok_9d2e7b-should-never-be-seen";
const sshAvailable = sshImageAvailable();

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "pipelines.db")}`,
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
    previewPortRange: [4976, 4979],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let machine: SshServer | null = null;
let owner: string;
let editor: string;
let viewer: string;
let teamId: string;

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

async function createPipeline(source: string, cookie = owner): Promise<string> {
  const response = await call(cookie, "POST", team("/pipelines"), { source });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().pipeline.id;
}

async function runToEnd(pipelineId: string, cookie = owner) {
  const started = await call(cookie, "POST", team(`/pipelines/${pipelineId}/runs`), {});
  assert.equal(started.statusCode, 201, started.body);
  return waitFor(started.json().run.id);
}

async function waitFor(runId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = (await call(owner, "GET", team(`/pipeline-runs/${runId}`))).json().run;
    if (!["queued", "running"].includes(run.status)) {
      const log = (await call(owner, "GET", team(`/pipeline-runs/${runId}/logs?after=0`))).json();
      return {
        run,
        log: log.lines.map((line: { text: string }) => line.text).join("\n") as string,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`run ${runId} did not finish`);
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  owner = await register("owner@example.com", "Owner");
  editor = await register("editor@example.com", "Editor");
  viewer = await register("viewer@example.com", "Viewer");
  teamId = (await call(owner, "GET", "/api/teams")).json().teams[0].id;
  for (const [email, role] of [
    ["editor@example.com", "editor"],
    ["viewer@example.com", "viewer"],
  ]) {
    const added = await call(owner, "POST", team("/members"), { email, role });
    assert.equal(added.statusCode, 201, added.body);
  }
  const secret = await call(owner, "POST", team("/vault"), { name: "DEPLOY_TOKEN", value: SECRET });
  assert.equal(secret.statusCode, 201, secret.body);
  // Host mode keeps these tests fast and free of image pulls; the container
  // mode has its own test below.
  const settings = await call(owner, "PUT", "/api/settings", { pipelineLocalRunner: "host" });
  assert.equal(settings.statusCode, 200, settings.body);
});

after(async () => {
  machine?.stop();
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("a file is checked with line numbers; a missing secret is a warning, a typed token an error", async () => {
  const bad = await call(owner, "POST", team("/pipelines/check"), {
    source:
      "name: x\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo\n        shel: bash\n",
  });
  assert.equal(bad.json().ok, false);
  // At the key that does not belong, not at the step it is in.
  const issue = bad.json().issues[0];
  assert.equal(issue.line, 7);
  assert.equal(issue.path, "stages.0.steps.0.shel");
  assert.equal(
    "name: x\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo\n        shel: bash\n".slice(
      issue.from,
      issue.to,
    ),
    "shel",
  );

  const warned = await call(owner, "POST", team("/pipelines/check"), {
    source:
      "name: x\nruns-on: build-99\nenv:\n  A: vault://NOT_THERE\nstages:\n  - name: A\n    steps:\n      - run: echo\n",
  });
  assert.equal(warned.json().ok, true);
  assert.deepEqual(warned.json().warnings, [
    "NOT_THERE is not in the team's Vault yet.",
    "There is no runner called build-99 yet. Add it in Runners.",
  ]);

  const typed = await call(owner, "POST", team("/pipelines"), {
    source:
      "name: x\nruns-on: local\nsource:\n  repo: https://example.com/r.git\n  token: ghp_typed\nstages:\n  - name: A\n    steps:\n      - checkout: true\n",
  });
  assert.equal(typed.statusCode, 400);
  assert.match(typed.body, /must come from Vault/);
});

test("the local runner runs stages in order, masks secrets, and honours if: and continue-on-error", async () => {
  const id = await createPipeline(`name: Local basics
runs-on: local
env:
  TOKEN: vault://DEPLOY_TOKEN
stages:
  - name: Build
    steps:
      - name: Say
        run: |
          echo "token is $TOKEN"
          echo "b64 $(printf %s "$TOKEN" | base64)"
          echo "number $ZELYQ_RUN_NUMBER"
      - name: Soft fail
        run: exit 3
        continue-on-error: true
  - name: Test
    steps:
      - run: exit 1
      - name: Never
        run: echo never
      - name: Cleanup
        if: always()
        run: echo cleaning
  - name: Report
    if: failure()
    steps:
      - run: echo reporting
`);
  const { run, log } = await runToEnd(id);
  assert.equal(run.status, "failed");
  assert.ok(!log.includes(SECRET), "the secret appeared in the log");
  assert.ok(
    !log.includes(Buffer.from(SECRET).toString("base64").replace(/=+$/, "")),
    "base64 leaked",
  );
  assert.match(log, /token is \*\*\*/);
  assert.match(log, /number 1/);
  assert.match(log, /cleaning/);
  assert.match(log, /reporting/);
  assert.doesNotMatch(log, /^never$/m);
  const status = Object.fromEntries(
    run.steps.map((step: { name: string; status: string }) => [step.name, step.status]),
  );
  assert.equal(status.Say, "passed");
  assert.equal(status["Soft fail"], "failed");
  assert.equal(status.Never, "skipped");
  assert.equal(status.Cleanup, "passed");
  assert.equal(
    (await call(owner, "GET", team(`/pipeline-runs/${run.id}`))).body.includes(SECRET),
    false,
  );

  // Each run carries its stages, for the picture and the lists.
  const runs = (await call(owner, "GET", team(`/pipelines/${id}/runs`))).json().runs;
  assert.deepEqual(
    runs[0].stages.map(
      (stage: { name: string; status: string }) => `${stage.name}:${stage.status}`,
    ),
    ["Build:failed", "Test:failed", "Report:passed"],
  );
  const download = await call(owner, "GET", team(`/pipeline-runs/${run.id}/log.txt`));
  assert.equal(download.statusCode, 200);
  assert.match(download.headers["content-disposition"] as string, /Local-basics-1\.log/);
  assert.match(download.body, /## Build › Say/);
  assert.ok(!download.body.includes(SECRET));
});

test("a step's timeout stops it and everything it started; Cancel stops a run", async () => {
  const id = await createPipeline(`name: Slow
runs-on: local
stages:
  - name: Wait
    steps:
      - run: |
          sleep 120 &
          sleep 120
        timeout: 2s
`);
  const started = Date.now();
  const { run, log } = await runToEnd(id);
  assert.equal(run.status, "failed");
  assert.equal(run.steps[0].status, "timed_out");
  assert.ok(Date.now() - started < 30_000);
  assert.match(log, /Timed out/);

  const again = await call(owner, "POST", team(`/pipelines/${id}/runs`), {});
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const cancelled = await call(
    editor,
    "POST",
    team(`/pipeline-runs/${again.json().run.id}/cancel`),
  );
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  const ended = await waitFor(again.json().run.id);
  assert.equal(ended.run.status, "cancelled");
  assert.equal(ended.run.number, 2);
});

test("roles: a viewer reads but cannot run; an editor cannot save a Protected secret", async () => {
  const id = await createPipeline(
    "name: Roles\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo hi\n",
  );
  assert.equal((await call(viewer, "GET", team(`/pipelines/${id}`))).statusCode, 200);
  assert.equal((await call(viewer, "POST", team(`/pipelines/${id}/runs`), {})).statusCode, 403);

  const secret = await call(owner, "POST", team("/vault"), {
    name: "PROD_KEY",
    value: "prod-value-123",
    protected: true,
  });
  assert.equal(secret.statusCode, 201, secret.body);
  const source =
    "name: Prod\nruns-on: local\nenv:\n  K: vault://PROD_KEY\nstages:\n  - name: A\n    steps:\n      - run: echo hi\n";
  assert.equal((await call(editor, "POST", team("/pipelines"), { source })).statusCode, 403);
  const prod = await createPipeline(source, owner);
  // An editor's harmless-looking edit would make it theirs: refused for the same reason.
  const edited = await call(editor, "PUT", team(`/pipelines/${prod}`), {
    source: `${source}      - run: echo "$K"\n`,
  });
  assert.equal(edited.statusCode, 403);
  assert.equal((await runToEnd(prod, editor)).run.status, "passed");
});

test("artifacts are kept and downloadable; a re-run from a stage skips the stages before it", async () => {
  const id = await createPipeline(`name: Artifacts
runs-on: local
artifacts:
  - name: dist
    path: dist
stages:
  - name: One
    steps:
      - run: mkdir -p dist && echo built > dist/out.txt
  - name: Two
    steps:
      - run: echo second
`);
  const { run } = await runToEnd(id);
  assert.equal(run.status, "passed");
  assert.equal(run.artifacts.length, 1);
  const download = await call(owner, "GET", team(`/pipeline-artifacts/${run.artifacts[0].id}`));
  assert.equal(download.statusCode, 200);
  assert.equal(download.headers["content-type"], "application/gzip");

  const rerun = await call(owner, "POST", team(`/pipeline-runs/${run.id}/rerun`), { fromStage: 1 });
  assert.equal(rerun.statusCode, 201, rerun.body);
  const second = await waitFor(rerun.json().run.id);
  assert.equal(second.run.status, "passed");
  assert.deepEqual(
    second.run.steps.map((step: { status: string }) => step.status),
    ["skipped", "passed"],
  );
});

test("a push webhook runs only with the right signature and for a listed branch", async () => {
  const id = await createPipeline(
    "name: Pushed\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo pushed\n",
  );
  const added = await call(editor, "POST", team(`/pipelines/${id}/triggers`), {
    kind: "push",
    branches: ["main", "release/*"],
  });
  assert.equal(added.statusCode, 201, added.body);
  const { trigger, secret } = added.json();
  const hook = (body: object, signWith: string) => {
    const payload = JSON.stringify(body);
    return server.app.inject({
      method: "POST",
      url: `/api/hooks/pipelines/${trigger.id}`,
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-hub-signature-256": `sha256=${createHmac("sha256", signWith).update(payload).digest("hex")}`,
      },
      payload,
    });
  };
  const push = { ref: "refs/heads/main", after: "a".repeat(40) };
  assert.equal((await hook(push, "wrong-secret")).statusCode, 401);
  assert.equal((await hook({ ...push, ref: "refs/heads/feature/x" }, secret)).statusCode, 202);
  assert.equal((await hook({ ...push, ref: "refs/heads/release/2.0" }, secret)).statusCode, 201);
  const runs = (await call(owner, "GET", team(`/pipelines/${id}/runs`))).json().runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trigger, "push");
  // The secret is shown once only.
  assert.ok(!(await call(owner, "GET", team(`/pipelines/${id}/triggers`))).body.includes(secret));
});

test("a service key with the pipelines scope starts a run in its own team only", async () => {
  const id = await createPipeline(
    "name: Api\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo api\n",
  );
  const key = await call(owner, "POST", team("/vault-keys"), { name: "ci", scopes: ["pipelines"] });
  assert.equal(key.statusCode, 201, key.body);
  const token = key.json().secret as string;
  const started = await server.app.inject({
    method: "POST",
    url: `/api/v1/pipelines/${id}/runs`,
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(started.statusCode, 201, started.body);
  assert.equal((await waitFor(started.json().run.id)).run.trigger, "api");

  const readOnly = await call(owner, "POST", team("/vault-keys"), {
    name: "reader",
    scopes: ["read"],
  });
  const refused = await server.app.inject({
    method: "POST",
    url: `/api/v1/pipelines/${id}/runs`,
    headers: { authorization: `Bearer ${readOnly.json().secret}` },
    payload: {},
  });
  assert.equal(refused.statusCode, 403);
});

test("an SSH runner: confirm its fingerprint, then run a pipeline on it with an app as the source", {
  skip: !sshAvailable && "no SSH image",
}, async () => {
  const keys = (await call(owner, "GET", team("/ssh-keys"))).json().keys;
  assert.equal(keys.length, 1);
  assert.match(keys[0].publicKey, /^ssh-ed25519 /);
  assert.ok(!JSON.stringify(keys).includes("PRIVATE"), "the private key left the server");
  machine = await startSshServer([keys[0].publicKey]);

  const added = await call(owner, "POST", team("/runners"), {
    name: "build-01",
    host: machine.host,
    port: machine.port,
    username: machine.username,
    labels: ["fast"],
  });
  assert.equal(added.statusCode, 201, added.body);
  const runnerId = added.json().runner.id;
  assert.equal(
    (await call(editor, "POST", team(`/runners/${runnerId}/test`))).statusCode,
    403,
    "admins only",
  );

  // Before confirming: nothing runs there.
  const project = (await call(owner, "POST", "/api/projects", { name: "Shop", teamId })).json()
    .project;
  await server.runtime.writeFile(project.id, "hello.txt", "from the app\n");
  const pipelineId = await createPipeline(`name: On SSH
runs-on: [linux, fast]
source:
  app: Shop
env:
  TOKEN: vault://DEPLOY_TOKEN
stages:
  - name: Get
    steps:
      - checkout: true
  - name: Use
    steps:
      - run: |
          cat hello.txt
          echo "token $TOKEN"
          uname -s
`);
  const early = await runToEnd(pipelineId);
  assert.equal(early.run.status, "failed");
  assert.match(early.run.error, /No confirmed/);

  const tested = (await call(owner, "POST", team(`/runners/${runnerId}/test`))).json();
  assert.equal(tested.needsConfirmation, true);
  assert.match(tested.hostKeyFingerprint, /^SHA256:/);
  const wrong = await call(owner, "POST", team(`/runners/${runnerId}/confirm`), {
    fingerprint: "SHA256:not-this-one",
  });
  assert.equal(wrong.statusCode, 400);
  const confirmed = await call(owner, "POST", team(`/runners/${runnerId}/confirm`), {
    fingerprint: tested.hostKeyFingerprint,
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().runner.os, "linux");

  const { run, log } = await runToEnd(pipelineId);
  assert.equal(run.status, "passed", log);
  assert.equal(run.runner, "build-01");
  assert.match(log, /from the app/);
  assert.match(log, /token \*\*\*/);
  assert.match(log, /Linux/);
  assert.ok(!log.includes(SECRET));
  // The folder of a run that passed is removed from the machine.
  assert.equal(machine.root("ls /config/zelyq/runs 2>/dev/null | wc -l").trim(), "0");
});

test("the container local runner runs in a fresh container", {
  skip: !(await containerEngineAvailable()) && "no Docker",
}, async () => {
  await call(owner, "PUT", "/api/settings", {
    pipelineLocalRunner: "container",
    pipelineLocalImage: "alpine:latest",
  });
  try {
    const id = await createPipeline(`name: In a container
runs-on: local
stages:
  - name: A
    steps:
      - shell: sh
        run: |
          cat /etc/os-release | head -1
          test ! -e ${tmp}
`);
    const { run, log } = await runToEnd(id);
    assert.equal(run.status, "passed", log);
    assert.match(log, /Alpine/);
  } finally {
    await call(owner, "PUT", "/api/settings", { pipelineLocalRunner: "host" });
  }
});

test("checkout fetches a git repository at a ref", async (t) => {
  const online = await fetch("https://github.com", {
    method: "HEAD",
    signal: AbortSignal.timeout(5000),
  })
    .then(() => true)
    .catch(() => false);
  if (!online) return t.skip("offline");
  const id = await createPipeline(`name: Git
runs-on: local
source:
  repo: https://github.com/octocat/Hello-World
  ref: master
stages:
  - name: Get
    steps:
      - checkout: true
      - run: test -f README && git log -1 --format=%H
`);
  const { run, log } = await runToEnd(id);
  assert.equal(run.status, "passed", log);
  assert.match(log, /[0-9a-f]{40}/);
});

test("a schedule starts one run in each minute it matches, and none when turned off", async () => {
  const id = await createPipeline(
    "name: Nightly\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo nightly\n",
  );
  const added = await call(editor, "POST", team(`/pipelines/${id}/triggers`), {
    kind: "schedule",
    cron: "0 3 * * *",
  });
  assert.equal(added.statusCode, 201, added.body);
  const runs = async () => (await call(owner, "GET", team(`/pipelines/${id}/runs`))).json().runs;

  await server.pipelineTriggers.tick(new Date("2030-01-01T02:59:40Z"));
  assert.equal((await runs()).length, 0, "not yet 03:00");
  await server.pipelineTriggers.tick(new Date("2030-01-01T03:00:05Z"));
  await server.pipelineTriggers.tick(new Date("2030-01-01T03:00:35Z"));
  const first = await runs();
  assert.equal(first.length, 1, "once in that minute, however often the clock ticks");
  assert.equal(first[0].trigger, "schedule");
  assert.equal(first[0].triggeredBy, null);
  assert.equal((await waitFor(first[0].id)).run.status, "passed");

  await server.pipelineTriggers.tick(new Date("2030-01-01T03:01:00Z"));
  assert.equal((await runs()).length, 1, "03:01 does not match");

  const off = await call(
    editor,
    "PATCH",
    team(`/pipelines/${id}/triggers/${added.json().trigger.id}`),
    {
      enabled: false,
    },
  );
  assert.equal(off.statusCode, 200, off.body);
  await server.pipelineTriggers.tick(new Date("2030-01-02T03:00:10Z"));
  assert.equal((await runs()).length, 1, "a turned-off schedule does nothing");
});

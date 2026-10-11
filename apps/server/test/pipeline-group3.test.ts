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
 * Pipelines group 3: changing a trigger, stages at the same time, a machine
 * per stage and matrix copies — on this server's local runner, and on an SSH
 * runner for a stage that names one.
 */

const tmp = path.join(os.tmpdir(), `zelyq-group3-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "group3.db")}`,
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
  await call("PUT", "/api/settings", { pipelineLocalConcurrency: 6 });
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

test("a trigger can be changed; a push trigger keeps its address and secret", async () => {
  const id = await create(
    "name: Edit me\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo hi\n",
  );
  const added = await call("POST", team(`/pipelines/${id}/triggers`), {
    kind: "push",
    branches: ["main"],
  });
  assert.equal(added.statusCode, 201, added.body);
  const { trigger, secret } = added.json() as {
    trigger: { id: string; webhookUrl: string };
    secret: string;
  };
  const changed = await call("PUT", team(`/pipelines/${id}/triggers/${trigger.id}`), {
    kind: "push",
    branches: ["main", "release/*"],
    paths: ["docs/**"],
    pullRequests: true,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  const after = changed.json().trigger;
  assert.deepEqual(after.branches, ["main", "release/*"]);
  assert.deepEqual(after.paths, ["docs/**"]);
  assert.equal(after.pullRequests, true);
  assert.equal(after.webhookUrl, trigger.webhookUrl);

  // GitHub, still signing with the old secret, gets in.
  const payload = JSON.stringify({ zen: "hi" });
  const ping = await server.app.inject({
    method: "POST",
    url: `/api/hooks/pipelines/${trigger.id}`,
    headers: {
      "content-type": "application/json",
      "x-github-event": "ping",
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
    },
    payload,
  });
  assert.equal(ping.statusCode, 200, ping.body);

  const otherKind = await call("PUT", team(`/pipelines/${id}/triggers/${trigger.id}`), {
    kind: "schedule",
    cron: "0 3 * * *",
  });
  assert.equal(otherKind.statusCode, 400);
  assert.match(otherKind.body, /keeps its kind/);

  const schedule = (
    await call("POST", team(`/pipelines/${id}/triggers`), { kind: "schedule", cron: "0 3 * * *" })
  ).json().trigger;
  const moved = await call("PUT", team(`/pipelines/${id}/triggers/${schedule.id}`), {
    kind: "schedule",
    cron: "*/15 * * * *",
  });
  assert.equal(moved.json().trigger.cron, "*/15 * * * *");
});

test("the file is checked: parallel, matrix and what a stage of its own cannot do", async () => {
  const check = async (source: string) => (await call("POST", team("/pipelines"), { source })).body;
  const head = "name: Bad\nruns-on: local\nstages:\n";
  assert.match(
    await check(`${head}  - name: A\n    parallel: true\n    steps:\n      - run: a\n`),
    /first stage/,
  );
  assert.match(
    await check(
      `${head}  - name: A\n    steps:\n      - run: a\n  - name: B\n    parallel: true\n    steps:\n      - approval: {message: ok}\n`,
    ),
    /approval needs a stage on the run's own machine/,
  );
  assert.match(
    await check(
      `${head}  - name: A\n    matrix: {a: [1,2,3,4,5], b: [1,2,3,4,5]}\n    steps:\n      - run: a\n`,
    ),
    /makes 25 copies/,
  );
  assert.match(
    await check(`${head}  - name: A\n    steps:\n      - run: echo \${{ matrix.node }}\n`),
    /no matrix/,
  );
  assert.match(
    await check(
      `${head}  - name: A\n    matrix: {node: [20]}\n    steps:\n      - run: echo \${{ matrix.ruby }}\n`,
    ),
    /has no ruby/,
  );
});

test("parallel stages run at the same time, each in a folder of its own", async () => {
  const id = await create(`name: Together
runs-on: local
stages:
  - name: Build
    steps:
      - run: echo built > shared.txt
  - name: Left
    steps:
      - id: left
        run: |
          date +%s%N > /dev/null
          echo "left start $(date +%s.%N)"
          sleep 2
          test ! -f shared.txt && echo "left has its own folder"
          echo "side=left" >> "$ZELYQ_OUTPUT"
          echo "left end $(date +%s.%N)"
  - name: Right
    parallel: true
    steps:
      - run: |
          echo "right start $(date +%s.%N)"
          sleep 2
          echo "right end $(date +%s.%N)"
  - name: After
    steps:
      - run: |
          cat shared.txt
          echo "after got \${{ steps.left.outputs.side }}"
`);
  const started = (await start(id)).json().run.id as string;
  const { run, log } = await finished(started);
  assert.equal(run.status, "passed", log);
  assert.match(log, /left has its own folder/);
  assert.match(log, /^built$/m, "the run's own folder is kept for later stages");
  assert.match(log, /after got left/);
  const time = (label: string) => Number(new RegExp(`${label} (\\d+\\.\\d+)`).exec(log)?.[1]);
  assert.ok(
    time("right start") < time("left end") && time("left start") < time("right end"),
    `the two stages overlapped:\n${log}`,
  );
  const detail = (await call("GET", team(`/pipeline-runs/${started}`))).json().run;
  assert.deepEqual(detail.stageGroups, [[0], [1, 2], [3]]);
});

test("a matrix makes a copy per combination; one failing copy fails the run", async () => {
  const id = await create(`name: Matrix
runs-on: local
stages:
  - name: Test
    matrix:
      node: [20, 22]
      flavour: [plain, extra]
    steps:
      - run: |
          echo "copy node=\${{ matrix.node }} flavour=\${{ matrix.flavour }}"
          test "\${{ matrix.node }}-\${{ matrix.flavour }}" != "22-extra"
  - name: Ship
    steps:
      - run: echo shipped
`);
  const started = (await start(id)).json().run.id as string;
  const { run, log } = await finished(started);
  assert.equal(run.status, "failed", log);
  for (const copy of [
    "20 flavour=plain",
    "20 flavour=extra",
    "22 flavour=plain",
    "22 flavour=extra",
  ]) {
    assert.match(log, new RegExp(`copy node=${copy}`));
  }
  assert.doesNotMatch(log, /^shipped$/m);
  const detail = (await call("GET", team(`/pipeline-runs/${started}`))).json().run;
  const stages = [...new Set(detail.steps.map((step: { stage: string }) => step.stage))];
  assert.deepEqual(stages, [
    "Test (20, plain)",
    "Test (20, extra)",
    "Test (22, plain)",
    "Test (22, extra)",
    "Ship",
  ]);
  const status = (stage: string) =>
    detail.steps.find((step: { stage: string }) => step.stage === stage).status;
  assert.equal(status("Test (22, extra)"), "failed");
  assert.equal(status("Test (20, plain)"), "passed");
  assert.equal(status("Ship"), "skipped");
});

test("a stage on its own runner: SSH for one stage, the local runner for the rest", {
  skip: !dockerHostAvailable() && "no Docker SSH image",
}, async () => {
  const keys = (await call("GET", team("/ssh-keys"))).json().keys;
  sshMachine = await startDockerSsh(keys[0].publicKey);
  assert.ok(sshMachine, "the SSH machine started");
  const added = await call("POST", team("/runners"), {
    name: "remote-box",
    host: sshMachine.host,
    port: sshMachine.port,
    username: sshMachine.username,
  });
  const runnerId = added.json().runner.id;
  const tested = (await call("POST", team(`/runners/${runnerId}/test`))).json();
  await call("POST", team(`/runners/${runnerId}/confirm`), {
    fingerprint: tested.hostKeyFingerprint,
  });
  const id = await create(`name: Two machines
runs-on: local
stages:
  - name: Here
    steps:
      - run: echo "here in $PWD"
  - name: There
    runs-on: remote-box
    steps:
      - id: where
        run: |
          echo "there in $PWD as $(whoami)"
          echo "user=$(whoami)" >> "$ZELYQ_OUTPUT"
  - name: Back
    steps:
      - run: echo "back, remote user was \${{ steps.where.outputs.user }}"
`);
  const started = (await start(id)).json().run.id as string;
  const { run, log } = await finished(started, 180_000);
  assert.equal(run.status, "passed", log);
  assert.match(log, /There on remote-box\./);
  assert.match(
    log,
    new RegExp(
      `there in /home/${sshMachine.username}/zelyq/runs/\\S+-s1 as ${sshMachine.username}`,
    ),
  );
  assert.match(log, new RegExp(`back, remote user was ${sshMachine.username}`));
});

test("parallel stages in the local runner's containers: one container each, all removed", {
  skip: !dockerAvailable && "no Docker",
}, async () => {
  await call("PUT", "/api/settings", { pipelineLocalRunner: "container" });
  try {
    const id = await create(`name: Containers side by side
runs-on: local
stages:
  - name: One
    steps:
      - run: echo "one in $(hostname)"
  - name: Two
    parallel: true
    steps:
      - run: echo "two in $(hostname)"
`);
    const started = (await start(id)).json().run.id as string;
    const { run, log } = await finished(started, 300_000);
    assert.equal(run.status, "passed", log);
    const one = /^one in (\S+)$/m.exec(log)?.[1];
    const two = /^two in (\S+)$/m.exec(log)?.[1];
    assert.ok(one && two && one !== two, `two containers:\n${log}`);
    const left = execFileSync("docker", ["ps", "-aq", "--filter", "name=zelyq-run-"])
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    const ours = left.filter((container) =>
      execFileSync("docker", [
        "inspect",
        "-f",
        '{{index .Config.Labels "zelyq.pipeline-run"}}',
        container,
      ])
        .toString()
        .startsWith(started),
    );
    assert.deepEqual(ours, [], "the stages' containers were removed");
  } finally {
    await call("PUT", "/api/settings", { pipelineLocalRunner: "host" });
  }
});

test("uses: another pipeline's stages are copied in, with its inputs from with:", async () => {
  await create(`name: Node checks
runs-on: local
inputs:
  greeting: {default: hello}
env:
  FROM_TEMPLATE: "yes"
stages:
  - name: Lint
    steps:
      - run: echo "lint says \${{ inputs.greeting }} ($FROM_TEMPLATE)"
  - name: Unit
    steps:
      - run: echo "unit tests"
`);
  const id = await create(`name: Shop
runs-on: local
stages:
  - name: Build
    steps:
      - run: echo built
  - name: Checks
    uses: Node checks
    with: {greeting: hi}
  - name: Ship
    steps:
      - run: echo shipped
`);
  const started = (await start(id)).json().run.id as string;
  const { run, log } = await finished(started);
  assert.equal(run.status, "passed", log);
  assert.match(log, /^lint says hi \(yes\)$/m);
  assert.match(log, /^unit tests$/m);
  const detail = (await call("GET", team(`/pipeline-runs/${started}`))).json().run;
  const stages = [...new Set(detail.steps.map((step: { stage: string }) => step.stage))];
  assert.deepEqual(stages, ["Build", "Checks › Lint", "Checks › Unit", "Ship"]);
  assert.doesNotMatch(detail.source, /uses:/, "the run keeps the file as it ran");

  const bad = async (source: string) => (await call("POST", team("/pipelines"), { source })).body;
  const head = "name: Bad\nruns-on: local\nstages:\n";
  assert.match(await bad(`${head}  - uses: Nothing here\n`), /no pipeline called Nothing here/);
  assert.match(
    await bad(`${head}  - uses: Node checks\n    with: {colour: red}\n`),
    /has no input called colour/,
  );
  assert.match(
    await bad(`${head}  - uses: Shop\n    steps: [{run: echo}]\n`),
    /takes only name, with/,
  );
});

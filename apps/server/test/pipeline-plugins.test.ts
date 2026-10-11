import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Pipeline plugins: a package installed for a team (checked, kept exactly as
 * installed), used with `plugin:` — inputs as variables, a secret masked,
 * outputs for later steps, its own script files — on the local runner.
 */

const tmp = path.join(os.tmpdir(), `zelyq-plugins-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "plugins.db")}`,
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

const work = path.join(tmp, "packages");

/** Packs a plugin folder the way an author would: tar -czf … -C folder . */
async function pack(name: string, files: Record<string, string>, links: [string, string][] = []) {
  const folder = path.join(work, name);
  await fs.rm(folder, { recursive: true, force: true });
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await fs.writeFile(path.join(folder, file), content);
  }
  for (const [link, target] of links) await fs.symlink(target, path.join(folder, link));
  const out = path.join(work, `${name}.tar.gz`);
  execFileSync("tar", ["-czf", out, "-C", folder, "."]);
  return fs.readFile(out);
}

function install(body: Buffer) {
  return server.app.inject({
    method: "POST",
    url: team("/pipeline-plugins"),
    headers: { cookie: owner, "content-type": "application/gzip" },
    payload: body,
  });
}

const HELLO = (version = "1.0.0", extra = "") => `id: acme/hello
version: ${version}
name: Hello
description: Says hello, and keeps a token secret.
category: other
runs-on: {os: [linux, macos]}
inputs:
  who: {description: Whom to greet, default: world}
  token: {description: An API token, required: true, secret: true}
outputs:
  greeting: What it said
steps:
  - name: Greet
    run: |
      echo "Hello, $ZELYQ_INPUT_WHO"
      echo "token is $ZELYQ_INPUT_TOKEN"
      echo "greeting=Hello, $ZELYQ_INPUT_WHO" >> "$ZELYQ_OUTPUT"
  - name: Its own script
    run: sh "$ZELYQ_PLUGIN_DIR/scripts/check.sh"
${extra}`;

const HELLO_FILES = (version = "1.0.0", extra = "") => ({
  "zelyq-plugin.yml": HELLO(version, extra),
  "scripts/check.sh": 'echo "script ran in $(basename "$ZELYQ_PLUGIN_DIR")"\n',
  "README.md": "# Hello\n",
});

before(async () => {
  await fs.mkdir(work, { recursive: true });
});

test("a package is checked before it is installed, and a version never changes", async () => {
  const good = await pack("hello", HELLO_FILES());
  const installed = await install(good);
  assert.equal(installed.statusCode, 201, installed.body);
  const plugin = installed.json().plugin;
  assert.equal(plugin.pluginId, "acme/hello");
  assert.equal(plugin.version, "1.0.0");
  assert.deepEqual(
    plugin.inputs.map((input: { name: string; secret: boolean; required: boolean }) => [
      input.name,
      input.secret,
      input.required,
    ]),
    [
      ["who", false, false],
      ["token", true, true],
    ],
  );

  const again = await install(good);
  assert.equal(again.statusCode, 201, "the same file again is fine");
  const changed = await install(await pack("hello-changed", HELLO_FILES("1.0.0", "# changed\n")));
  assert.equal(changed.statusCode, 409);
  assert.match(changed.body, /never changes/);

  const refused = async (files: Record<string, string>, links: [string, string][] = []) =>
    (await install(await pack(`bad-${Math.random()}`, files, links))).body;
  assert.match(await refused({ "README.md": "x" }), /no zelyq-plugin.yml/);
  assert.match(
    await refused({ "inner/zelyq-plugin.yml": HELLO() }),
    /must be at the top of the package/,
  );
  assert.match(
    await refused({ "zelyq-plugin.yml": HELLO() }, [["escape", "/etc/passwd"]]),
    /link or a special file/,
  );
  assert.match(
    await refused({ "zelyq-plugin.yml": HELLO().replace("id: acme/hello", "id: Acme Hello") }),
    /id: Use publisher\/name/,
  );
  assert.match(
    await refused({
      "zelyq-plugin.yml": `${HELLO()}  - deploy: {to: production, port: 80}\n`,
    }),
    /Unrecognized key: \\"deploy\\"/,
  );
  const notGzip = await install(Buffer.from("plain text"));
  assert.match(notGzip.body, /not a \.tar\.gz/);

  const list = (await call("GET", team("/pipeline-plugins"))).json().plugins;
  assert.equal(list.length, 1);
});

test("a pipeline is checked against the installed plugin when it is saved", async () => {
  const head = "name: Uses hello\nruns-on: local\nstages:\n  - name: A\n    steps:\n";
  const save = async (step: string) =>
    (await call("POST", team("/pipelines"), { source: `${head}${step}` })).body;
  assert.match(
    await save("      - plugin: acme/nothing@1.0.0\n"),
    /acme\/nothing@1.0.0 is not installed for this team/,
  );
  assert.match(
    await save("      - plugin: acme/hello@1.0.0\n        with: {who: you}\n"),
    /needs with: token/,
  );
  assert.match(
    await save("      - plugin: acme/hello@1.0.0\n        with: {token: typed-in}\n"),
    /is a secret: give it as vault:\/\/NAME/,
  );
  assert.match(
    await save("      - plugin: acme/hello@1.0.0\n        with: {token: vault://T, colour: red}\n"),
    /has no input called colour/,
  );
  assert.match(await save("      - plugin: acme/hello\n"), /exact version/);
});

test("a plugin step runs its steps, with inputs, a masked secret and outputs", async () => {
  await call("POST", team("/vault"), { name: "HELLO_TOKEN", value: "tok-very-secret-123" });
  const id = await create(`name: Hello run
runs-on: local
stages:
  - name: Greet
    steps:
      - id: hello
        plugin: acme/hello@1.0.0
        with:
          who: Zelyq
          token: vault://HELLO_TOKEN
      - run: echo "later step saw \${{ steps.hello.outputs.greeting }}"
`);
  const started = (await start(id)).json().run.id as string;
  const { run, log } = await finished(started);
  assert.equal(run.status, "passed", log);
  assert.match(log, /Hello 1\.0\.0 \(acme\/hello\)/);
  assert.match(log, /› Greet/);
  assert.match(log, /^Hello, Zelyq$/m);
  assert.match(log, /^token is \*\*\*$/m);
  assert.ok(!log.includes("tok-very-secret-123"), "the secret never reaches the log");
  assert.match(log, /^script ran in hello$/m);
  assert.match(log, /^later step saw Hello, Zelyq$/m);
  const detail = (await call("GET", team(`/pipeline-runs/${started}`))).json().run;
  assert.equal(detail.steps[0].name, "Plugin acme/hello");
  assert.equal(detail.steps[0].outputs.greeting, "Hello, Zelyq");

  // An input is a value, never part of the script.
  const careful = await create(`name: Hello careful
runs-on: local
stages:
  - name: Greet
    steps:
      - plugin: acme/hello@1.0.0
        with: {who: "x; echo INJECTED", token: vault://HELLO_TOKEN}
`);
  const second = await finished((await start(careful)).json().run.id as string);
  assert.equal(second.run.status, "passed", second.log);
  assert.match(second.log, /^Hello, x; echo INJECTED$/m);
  assert.doesNotMatch(second.log, /^INJECTED$/m);
});

test("a plugin for other systems fails clearly, and removing waits for the pipelines", async () => {
  const windowsOnly = await install(
    await pack("win", {
      "zelyq-plugin.yml": `id: acme/win-only
version: 0.1.0
name: Windows only
description: Only for Windows.
runs-on: {os: [windows]}
steps:
  - run: echo hi
`,
    }),
  );
  assert.equal(windowsOnly.statusCode, 201, windowsOnly.body);
  const id = await create(`name: Wrong system
runs-on: local
stages:
  - name: A
    steps: [{plugin: acme/win-only@0.1.0}]
`);
  const { run, log } = await finished((await start(id)).json().run.id as string);
  assert.equal(run.status, "failed");
  assert.match(log, /Windows only runs on windows; this machine is (linux|macos)\./);

  const plugin = (await call("GET", team("/pipeline-plugins")))
    .json()
    .plugins.find((item: { pluginId: string }) => item.pluginId === "acme/win-only");
  assert.deepEqual(
    plugin.usedBy.map((pipeline: { name: string }) => pipeline.name),
    ["Wrong system"],
  );
  const blocked = await call("DELETE", team(`/pipeline-plugins/${plugin.id}`));
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.body, /used by Wrong system/);
  await call("DELETE", team(`/pipelines/${id}`));
  const removed = await call("DELETE", team(`/pipeline-plugins/${plugin.id}`));
  assert.equal(removed.statusCode, 204, removed.body);
  const files = await fs.readdir(path.join(tmp, "pipelines", "plugins"));
  assert.ok(!files.includes(`${plugin.sha256}.tar.gz`), "its file went with it");
});

test("plugins in the local runner's container", {
  skip: !dockerAvailable && "no Docker",
}, async () => {
  await call("PUT", "/api/settings", { pipelineLocalRunner: "container" });
  try {
    const id = await create(`name: Hello in a container
runs-on: local
stages:
  - name: Greet
    steps:
      - plugin: acme/hello@1.0.0
        with: {token: vault://HELLO_TOKEN}
`);
    const { run, log } = await finished((await start(id)).json().run.id as string, 300_000);
    assert.equal(run.status, "passed", log);
    assert.match(log, /^Hello, world$/m);
    assert.match(log, /^script ran in hello$/m);
  } finally {
    await call("PUT", "/api/settings", { pipelineLocalRunner: "host" });
  }
});

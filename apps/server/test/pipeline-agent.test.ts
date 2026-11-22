import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { WebSocketServer } from "ws";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { AgentHub, agentKeyFingerprint } from "../src/services/pipelines/agents.js";
import { probeMachine, type RunnerSession } from "../src/services/pipelines/ssh.js";
import { runnerProgram } from "./helpers/agent-runner.js";

/**
 * Runners that connect out to Zelyq, end to end: the real runner program (apps/runner, built)
 * against the real server. The machine opens nothing; everything goes down its own connection.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
// Built before the server starts: the server serves this program to machines that install it.
const agentFile = runnerProgram();
const tmp = path.join(os.tmpdir(), `zelyq-agent-${Date.now()}`);
const SECRET = "tok_agent-7f3a-never-in-a-log";
const children: ChildProcess[] = [];

function startAgent(home: string, command: string[], userHome: string): ChildProcess {
  const child = spawn(process.execPath, [agentFile, ...command], {
    env: { ...process.env, ZELYQ_RUNNER_HOME: home, HOME: userHome, SHELL: "/bin/bash" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout?.on("data", (chunk) => {
    out += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    out += chunk;
  });
  Object.defineProperty(child, "output", { get: () => out });
  children.push(child);
  return child;
}

function output(child: ChildProcess): string {
  return (child as unknown as { output: string }).output;
}

/**
 * The process has ended. In a container with no init (CI's), an ended child of an ended parent stays a
 * zombie until someone reaps it: that is ended too.
 */
async function stopped_(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
  return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) === "Z";
}

async function until<T>(
  what: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await what();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out");
}

after(async () => {
  for (const child of children) child.kill("SIGKILL");
  await fs.rm(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------------------ the connection itself

test("the connection: output, input, exit codes, a slow reader, stop, several at once, a lost link", async (t) => {
  const dir = path.join(tmp, "hub");
  const home = path.join(dir, "agent");
  const userHome = path.join(dir, "home");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(userHome, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const row = {
    id: "run_test",
    name: "edge-01",
    kind: "agent",
    hostKey: spki,
    hostKeyFingerprint: agentKeyFingerprint(spki),
    lastSeenAt: null as string | null,
    os: null,
    host: "",
    username: "",
  };
  const store = {
    pipelines: {
      runners: {
        findById: async (id: string) => (id === row.id ? row : null),
        update: async (_id: string, patch: Record<string, unknown>) => Object.assign(row, patch),
      },
    },
  };
  const hub = new AgentHub(store as never);
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1", path: "/ws/runner-agent" });
  wss.on("connection", (socket) => hub.accept(socket));
  await new Promise((resolve) => wss.once("listening", resolve));
  t.after(() => wss.close());
  const port = (wss.address() as { port: number }).port;
  await fs.writeFile(
    path.join(home, "config.json"),
    JSON.stringify({ url: `http://127.0.0.1:${port}`, runnerId: row.id, name: row.name }),
  );
  await fs.writeFile(
    path.join(home, "key.pem"),
    privateKey.export({ type: "pkcs8", format: "pem" }),
    {
      mode: 0o600,
    },
  );

  let agent = startAgent(home, ["run"], userHome);
  await until(async () => hub.online(row.id)).catch((e) => {
    throw new Error(`${e.message}: ${output(agent)}`);
  });
  assert.equal(row.agentVersion, "1.0.0");
  assert.equal(row.host, os.hostname().replace(/[^\w.@:-]/g, ""));
  const session: RunnerSession = await hub.session(row);
  assert.equal(session.acceptedKeyFingerprint, row.hostKeyFingerprint);

  // What the machine is, the way SSH runners are probed.
  const facts = await probeMachine(session);
  assert.equal(facts.os, "linux");
  assert.equal(facts.home, userHome);
  assert.ok(facts.shells.includes("bash"));

  // Output on both streams, and the exit code.
  const both = await session.capture("echo out; echo err >&2; exit 7");
  assert.deepEqual([both.code, both.stdout, both.stderr], [7, "out\n", "err\n"]);

  // 5 MB in on stdin, the same bytes back.
  const input = Buffer.alloc(5 * 1024 * 1024);
  for (let i = 0; i < input.length; i++) input[i] = (i * 31) % 251;
  let echoed = createHash("sha256");
  let size = 0;
  const round = await session.exec("cat", {
    stdin: input,
    onStdout: (chunk) => {
      size += chunk.length;
      echoed.update(chunk);
    },
  });
  assert.equal(round.code, 0);
  assert.equal(size, input.length);
  assert.equal(echoed.digest("hex"), createHash("sha256").update(input).digest("hex"));

  // 40 MB out to a reader that takes its time: held at the machine, nothing lost or reordered.
  echoed = createHash("sha256");
  size = 0;
  let paused = 0;
  const slow = new Writable({
    highWaterMark: 64 * 1024,
    write(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      echoed.update(chunk);
      if (size % (4 * 1024 * 1024) < chunk.length) paused++;
      setTimeout(done, size % (1024 * 1024) < chunk.length ? 20 : 0);
    },
  });
  const big = await session.exec("head -c 41943040 /dev/zero | tr '\\0' 'z'", { stdout: slow });
  assert.equal(big.code, 0);
  assert.equal(size, 41_943_040);
  assert.equal(
    echoed.digest("hex"),
    createHash("sha256").update(Buffer.alloc(41_943_040, "z")).digest("hex"),
  );
  assert.ok(paused > 0);

  // Several at once on the one connection.
  const many = await Promise.all(
    Array.from({ length: 8 }, (_, i) => session.capture(`sleep 0.$((RANDOM % 5)); echo ${i}`)),
  );
  assert.deepEqual(
    many.map((r) => r.stdout.trim()),
    Array.from({ length: 8 }, (_, i) => String(i)),
  );

  // Stop: the command and what it started end.
  const marker = path.join(userHome, "child.pid");
  const stop = new AbortController();
  const stopped = session.exec(`bash -c 'sleep 300 & echo $! > ${marker}; wait'`, {
    signal: stop.signal,
  });
  const childPid = Number(
    await until(async () => (await fs.readFile(marker, "utf8").catch(() => "")).trim()),
  );
  stop.abort();
  const result = await stopped;
  assert.notEqual(result.code, 0);
  await until(async () => stopped_(childPid));

  // A stream in, slower to read than to send: held on both sides, nothing lost.
  const { Readable } = await import("node:stream");
  const total = 24 * 1024 * 1024;
  let sent = 0;
  const source = new Readable({
    read() {
      if (sent >= total) return this.push(null);
      const chunk = Buffer.alloc(Math.min(256 * 1024, total - sent), "q");
      sent += chunk.length;
      this.push(chunk);
    },
  });
  let counting = "";
  const slowRead = await session.exec("sleep 2; wc -c", {
    stdin: source,
    onStdout: (chunk) => {
      counting += chunk;
    },
  });
  assert.equal(slowRead.code, 0);
  assert.equal(counting.trim(), String(total));

  // Something escapes the command and keeps its output open: a stop still ends the call.
  const breakOut = new AbortController();
  const escaping = session.exec("setsid sleep 299 & sleep 300", { signal: breakOut.signal });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const stoppedAt = Date.now();
  breakOut.abort();
  await escaping;
  assert.ok(Date.now() - stoppedAt < 20_000, "a stop ends the call within its grace period");
  spawnSync("pkill", ["-f", "^sleep 2[9]9$"]);

  // Before signing in, one small message and nothing else.
  const { WebSocket: Client } = await import("ws");
  for (const attempt of [
    (c: InstanceType<typeof Client>) => c.send("x".repeat(10_000)),
    (c: InstanceType<typeof Client>) => {
      c.send("{}");
      c.send("{}");
    },
    (c: InstanceType<typeof Client>) => c.send(Buffer.from([1, 2, 3])),
  ]) {
    const probe = new Client(`ws://127.0.0.1:${port}/ws/runner-agent`);
    await new Promise((resolve) => probe.once("open", resolve));
    attempt(probe);
    const [closed] = (await new Promise((resolve) =>
      probe.once("close", (...args) => resolve(args)),
    )) as [number];
    assert.equal(closed, 4401);
  }
  assert.equal(hub.online(row.id), true, "the real runner is unaffected");

  // The machine goes away mid-command: the command fails as a lost connection, not silently.
  const hanging = session.exec("sleep 300");
  await new Promise((resolve) => setTimeout(resolve, 300));
  agent.kill("SIGKILL");
  await assert.rejects(hanging, /connection to Zelyq was lost/);
  await until(async () => !hub.online(row.id));
  await assert.rejects(hub.session(row), /not connected to Zelyq/);

  // It comes back: a session waits for it.
  agent = startAgent(home, ["run"], userHome);
  const again = await hub.session(row, 10_000);
  assert.equal((await again.capture("echo back")).stdout, "back\n");

  // Another key is refused: Zelyq accepts only the key it registered.
  hub.disconnect(row.id, "test");
  agent.kill("SIGKILL");
  const other = generateKeyPairSync("ed25519").privateKey;
  await fs.writeFile(path.join(home, "key.pem"), other.export({ type: "pkcs8", format: "pem" }));
  const impostor = startAgent(home, ["run"], userHome);
  await until(async () => output(impostor).includes("does not know this runner"));
  assert.equal(hub.online(row.id), false);
});

// ------------------------------------------------------------------ the whole thing, through Zelyq

const config = (): ServerConfig => ({
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "zelyq.db")}`,
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
    previewPortRange: [4986, 4989],
    previewHost: "127.0.0.1",
  },
});

let server: ZelyqServer;
let origin: string;
let owner: string;
let teamId: string;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  const cfg = config();
  await runMigrations(cfg.databaseUrl);
  server = await buildServer(cfg);
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  origin = `http://127.0.0.1:${(server.app.server.address() as { port: number }).port}`;
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  owner = String(registered.headers["set-cookie"]).split(";")[0] as string;
  teamId = (await call("GET", "/api/teams")).json().teams[0].id;
  assert.equal(
    (await call("POST", team("/vault"), { name: "DEPLOY_TOKEN", value: SECRET })).statusCode,
    201,
  );
});

after(async () => {
  await server?.close();
});

function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
  return server.app.inject({
    method,
    url,
    headers: { cookie: owner, origin },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}
const team = (suffix: string) => `/api/teams/${teamId}${suffix}`;

async function runToEnd(pipelineId: string) {
  const started = await call("POST", team(`/pipelines/${pipelineId}/runs`), {});
  assert.equal(started.statusCode, 201, started.body);
  return waitFor(started.json().run.id);
}

async function waitFor(runId: string) {
  return until(async () => {
    const run = (await call("GET", team(`/pipeline-runs/${runId}`))).json().run;
    if (["queued", "running"].includes(run.status)) return null;
    const log = (await call("GET", team(`/pipeline-runs/${runId}/logs?after=0`))).json();
    return { run, log: log.lines.map((line: { text: string }) => line.text).join("\n") as string };
  }, 120_000);
}

test("through Zelyq: install with a one-time code, online, test, a pipeline with a secret, cancel, remove", async () => {
  const added = await call("POST", team("/runners/agent"), { name: "prod-01", labels: ["deploy"] });
  assert.equal(added.statusCode, 201, added.body);
  const { runner, install } = added.json();
  assert.equal(runner.kind, "agent");
  assert.equal(runner.online, false);
  assert.equal(runner.installPending, true);
  assert.equal(install.url, origin);

  // The program the install command downloads is the one its checksum names.
  const program = await fetch(`${origin}/runner-agent/zelyq-runner.mjs`);
  assert.equal(program.status, 200);
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await program.arrayBuffer()))
      .digest("hex"),
    install.agentSha256,
  );

  // Two machines with one code at the same moment: one wins.
  const race = await call("POST", team("/runners/agent"), { name: "race-01" });
  const raceCode = race.json().install.code;
  const key = () =>
    generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64");
  const both = await Promise.all(
    [key(), key()].map((publicKey) =>
      fetch(`${origin}/api/runner-agent/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: raceCode, publicKey, version: "1.0.0", facts: {} }),
      }).then((r) => r.status),
    ),
  );
  assert.deepEqual(both.sort(), [200, 400]);

  // Zelyq cannot say where it is: nothing is made, so the name stays free.
  const noOrigin = await server.app.inject({
    method: "POST",
    url: team("/runners/agent"),
    headers: { cookie: owner },
    payload: { name: "lost-01" },
  });
  assert.equal(noOrigin.statusCode, 400);
  const names = (await call("GET", team("/runners")))
    .json()
    .runners.map((r: { name: string }) => r.name);
  assert.ok(!names.includes("lost-01"));

  // The machine registers its own key with the code; the code then works no more.
  const home = path.join(tmp, "prod-01");
  const userHome = path.join(tmp, "prod-01-home");
  await fs.mkdir(userHome, { recursive: true });
  const registering = startAgent(
    home,
    ["register", "--url", install.url, "--code", install.code],
    userHome,
  );
  const registered = await new Promise<number | null>((resolve) => registering.on("exit", resolve));
  assert.equal(registered, 0, output(registering));
  const reuse = startAgent(
    path.join(tmp, "thief"),
    ["register", "--url", install.url, "--code", install.code],
    userHome,
  );
  assert.equal(await new Promise((resolve) => reuse.on("exit", resolve)), 1);
  assert.match(output(reuse), /not valid any more/);
  assert.equal((await fs.stat(path.join(home, "key.pem"))).mode & 0o777, 0o600);

  startAgent(home, ["run"], userHome);
  const online = await until(async () => {
    const list = (await call("GET", team("/runners"))).json().runners as Array<
      Record<string, unknown>
    >;
    const found = list.find((r) => r.name === "prod-01");
    return found?.online ? found : null;
  });
  assert.equal(online.installPending, false);
  assert.match(String(online.hostKeyFingerprint), /^SHA256:/);

  const tested = (await call("POST", team(`/runners/${runner.id}/test`))).json();
  assert.equal(tested.ok, true, tested.message);
  assert.equal(tested.os, "linux");
  // Nothing to confirm, nothing to point at.
  assert.equal(
    (await call("POST", team(`/runners/${runner.id}/confirm`), { fingerprint: "x" })).statusCode,
    400,
  );
  assert.equal(
    (await call("PATCH", team(`/runners/${runner.id}`), { host: "10.0.0.1" })).statusCode,
    400,
  );

  // A pipeline on it, with a Vault secret: it runs there, and the secret never shows.
  const created = await call("POST", team("/pipelines"), {
    source: [
      "name: On the agent",
      "runs-on: prod-01",
      "stages:",
      "  - name: Work",
      "    steps:",
      "      - name: Where am I",
      "        env:",
      "          TOKEN: vault://DEPLOY_TOKEN",
      "        run: |",
      '          echo "on $(hostname) as $(whoami)"',
      '          echo "token: $TOKEN"',
      '          test "$TOKEN" = "' + SECRET + '"',
      '          echo "$HOME" > "$HOME/ran-here"',
      "",
    ].join("\n"),
  });
  assert.equal(created.statusCode, 201, created.body);
  const { run, log } = await runToEnd(created.json().pipeline.id);
  assert.equal(run.status, "passed", log);
  assert.match(log, new RegExp(`on ${os.hostname()}`));
  assert.ok(!log.includes(SECRET), "the secret is masked");
  assert.equal((await fs.readFile(path.join(userHome, "ran-here"), "utf8")).trim(), userHome);

  // Cancel stops the step on the machine.
  const long = await call("POST", team("/pipelines"), {
    source:
      "name: Long\nruns-on: prod-01\nstages:\n  - name: Wait\n    steps:\n      - run: sleep 287\n",
  });
  const started = await call("POST", team(`/pipelines/${long.json().pipeline.id}/runs`), {});
  const runId = started.json().run.id;
  await until(async () => spawnSync("pgrep", ["-f", "sleep 287"]).status === 0);
  assert.equal((await call("POST", team(`/pipeline-runs/${runId}/cancel`))).statusCode, 200);
  const cancelled = await waitFor(runId);
  assert.equal(cancelled.run.status, "cancelled");
  await until(async () => spawnSync("pgrep", ["-f", "sleep 287"]).status !== 0);

  // A new install code replaces the machine: the old one is cut off.
  const code = await call("POST", team(`/runners/${runner.id}/install-code`));
  assert.equal(code.statusCode, 200, code.body);
  assert.notEqual(code.json().install.code, install.code);

  // Removed: its connection ends, and it may not come back.
  assert.equal((await call("DELETE", team(`/runners/${runner.id}`))).statusCode, 204);
  const audit = (await call("GET", team("/audit-log"))).json();
  assert.ok(
    JSON.stringify(audit).includes("runner.agent_registered"),
    "the machine's registration is in the team's audit log",
  );
});

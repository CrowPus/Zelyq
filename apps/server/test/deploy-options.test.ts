import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { type DockerSsh, dockerHostAvailable, startDockerSsh } from "./helpers/docker-ssh.js";

/**
 * What a deploy keeps and runs beside an app, on a real machine: folders that
 * survive every version, a worker from the same image, a database update that
 * runs before traffic (and stops the deploy when it fails), a Postgres beside
 * the app, and limits on logs and memory.
 */

const tmp = path.join(os.tmpdir(), `zelyq-deploy-options-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const available = dockerHostAvailable();
const app = `kept${Date.now().toString(36)}`;

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "deploy-options.db")}`,
  agentUrl: "http://127.0.0.1:59991",
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
    previewPortRange: [4968, 4971],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let owner = "";
let teamId = "";
let projectId = "";
let machine: DockerSsh | null = null;
let hostPort = 0;

const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie: owner },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
const team = (suffix: string) => `/api/teams/${teamId}${suffix}`;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address() as net.AddressInfo;
      probe.close(() => resolve(address.port));
    });
  });
}

/**
 * The app: counts visits in its kept folder, says whether its database update
 * ran and whether its worker is alive (both write to the kept folder), and
 * whether it can reach its database.
 */
async function writeApp(version: string) {
  const files: Record<string, string> = {
    Dockerfile: 'FROM node:22-bookworm\nWORKDIR /app\nCOPY *.js .\nCMD ["node", "server.js"]\n',
    "server.js": `
const fs = require("fs"); const net = require("net"); const http = require("http");
const file = (name) => "/app/data/" + name;
http.createServer((q, s) => {
  const count = Number(fs.existsSync(file("count")) ? fs.readFileSync(file("count"), "utf8") : 0) + 1;
  fs.writeFileSync(file("count"), String(count));
  const beat = fs.existsSync(file("beat")) ? Number(fs.readFileSync(file("beat"), "utf8")) : 0;
  const url = new URL(process.env.DATABASE_URL);
  const socket = net.connect(Number(url.port), url.hostname);
  const done = (database) => { socket.destroy(); s.end(JSON.stringify({
    version: "${version}", count,
    migrated: fs.existsSync(file("migrated")) ? fs.readFileSync(file("migrated"), "utf8") : null,
    worker: Date.now() - beat < 5000, database })); };
  socket.once("connect", () => done(true)); socket.once("error", () => done(false));
}).listen(3000);
`,
    "migrate.js": `require("fs").writeFileSync("/app/data/migrated", "${version}");\n`,
    "worker.js":
      'setInterval(() => require("fs").writeFileSync("/app/data/beat", String(Date.now())), 1000);\n',
  };
  for (const [name, text] of Object.entries(files)) {
    await server.runtime.writeFile(projectId, name, text);
  }
}

async function pipeline(name: string, migrate: string): Promise<string> {
  const created = await call("POST", team("/pipelines"), {
    source: `name: ${name}
runs-on: local
source:
  app: Kept
stages:
  - name: Ship
    steps:
      - checkout: true
      - deploy:
          to: staging
          app: ${app}
          port: 3000
          host-port: ${hostPort}
          health-timeout: 60s
          memory: 256m
          database: postgres
          migrate: ${JSON.stringify(migrate)}
          volumes: [{name: data, path: /app/data}]
          processes: {worker: node worker.js}
`,
  });
  assert.equal(created.statusCode, 201, created.body);
  return created.json().pipeline.id;
}

async function runToEnd(pipelineId: string) {
  const started = await call("POST", team(`/pipelines/${pipelineId}/runs`), {});
  assert.equal(started.statusCode, 201, started.body);
  const runId = started.json().run.id;
  const deadline = Date.now() + 600_000;
  for (;;) {
    const run = (await call("GET", team(`/pipeline-runs/${runId}`))).json().run;
    if (["passed", "failed", "cancelled", "timed_out"].includes(run.status)) {
      const lines = (await call("GET", team(`/pipeline-runs/${runId}/logs?after=0`))).json().lines;
      return { run, log: lines.map((line: { text: string }) => line.text).join("\n") as string };
    }
    if (Date.now() > deadline) throw new Error(`run did not finish: ${run.status}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

type Answer = {
  version: string;
  count: number;
  migrated: string | null;
  worker: boolean;
  database: boolean;
};
async function served(): Promise<Answer | null> {
  return fetch(`http://127.0.0.1:${hostPort}/`, { signal: AbortSignal.timeout(5000) })
    .then((response) => response.json() as Promise<Answer>)
    .catch(() => null);
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
  projectId = (await call("POST", "/api/projects", { name: "Kept", teamId })).json().project.id;
  hostPort = await freePort();
  if (!available) return;
  const keys = (await call("GET", team("/ssh-keys"))).json().keys;
  machine = await startDockerSsh(keys[0].publicKey);
  if (!machine) return;
  const added = await call("POST", team("/runners"), {
    name: "kept-box",
    host: machine.host,
    port: machine.port,
    username: machine.username,
  });
  const runnerId = added.json().runner.id;
  const tested = (await call("POST", team(`/runners/${runnerId}/test`))).json();
  await call("POST", team(`/runners/${runnerId}/confirm`), {
    fingerprint: tested.hostKeyFingerprint,
  });
  const environment = await call("POST", team("/environments"), {
    name: "staging",
    runnerId,
    address: "127.0.0.1",
  });
  assert.equal(environment.statusCode, 201, environment.body);
});

after(async () => {
  const containers = [
    `zelyq-${app}-staging`,
    `zelyq-${app}-staging-previous`,
    `zelyq-${app}-staging-worker`,
    `zelyq-db-staging-${app}`,
  ];
  try {
    execFileSync("docker", ["rm", "-f", ...containers], { stdio: "ignore" });
  } catch {
    // gone already
  }
  try {
    execFileSync(
      "docker",
      ["volume", "rm", "-f", `zelyq-staging-${app}-data`, `zelyq-db-staging-${app}-data`],
      { stdio: "ignore" },
    );
    const images = execFileSync("docker", ["images", "-q", "--filter", `label=zelyq.app=${app}`])
      .toString()
      .split(/\s+/)
      .filter(Boolean);
    if (images.length) execFileSync("docker", ["rmi", "-f", ...images], { stdio: "ignore" });
  } catch {
    // nothing kept
  }
  machine?.stop();
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const ready = () => (machine ? false : "no Docker host for the test machine");

test("kept folders, a worker, a database update and a database beside the app", {
  skip: !available && "no Docker",
}, async (t) => {
  if (ready()) return t.skip(String(ready()));
  await writeApp("1");
  const id = await pipeline("Ship kept", "node migrate.js");
  const first = await runToEnd(id);
  assert.equal(first.run.status, "passed", first.log);
  assert.match(first.log, /Starting .*'s database/);
  assert.match(first.log, /Updating the database: node migrate\.js/);
  assert.match(first.log, /Kept across versions: \/app\/data/);
  // The database password never appears.
  const stored = await server.store.deploy.apps.find(
    (await server.store.deploy.environments.findByName(teamId, "staging"))!.id,
    app,
  );
  assert.ok(stored?.database, "the database credentials are kept");
  assert.ok(!first.log.includes("postgres://app:"), "the database address appeared in the log");

  // Give the worker a moment to write its first beat.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const one = await served();
  assert.equal(one?.version, "1");
  assert.equal(one?.migrated, "1");
  assert.equal(one?.database, true, "the app reaches its database");
  assert.equal(one?.worker, true, "the worker is running");
  const before = one?.count ?? 0;

  // Limits on every container.
  const inspect = JSON.parse(
    execFileSync("docker", ["inspect", `zelyq-${app}-staging`]).toString(),
  )[0];
  assert.equal(inspect.HostConfig.Memory, 256 * 1024 * 1024);
  assert.equal(inspect.HostConfig.LogConfig.Config["max-size"], "10m");

  // A new version keeps the data.
  await writeApp("2");
  const second = await runToEnd(id);
  assert.equal(second.run.status, "passed", second.log);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const two = await served();
  assert.equal(two?.version, "2");
  assert.equal(two?.migrated, "2");
  // The health check visits too, so the count grows by more than one; a lost folder would start at 1.
  assert.ok((two?.count ?? 0) > before, "the kept folder survived the new version");
  assert.equal(two?.worker, true);
});

test("a database update that fails stops the deploy; the running version keeps serving", {
  skip: !available && "no Docker",
}, async (t) => {
  if (ready()) return t.skip(String(ready()));
  await writeApp("3");
  const id = await pipeline("Ship broken update", "exit 3");
  const { run, log } = await runToEnd(id);
  assert.equal(run.status, "failed", log);
  assert.match(log, /The database update did not work, so the new version was not started/);
  const answer = await served();
  assert.equal(answer?.version, "2", "the running version was touched");
});

test("a roll back keeps the data and says the database was changed after it", {
  skip: !available && "no Docker",
}, async (t) => {
  if (ready()) return t.skip(String(ready()));
  const environments = (await call("GET", team("/environments"))).json().environments;
  const staging = environments.find((env: { name: string }) => env.name === "staging");
  const history = (
    await call("GET", team(`/environments/${staging.id}/deployments?app=${app}`))
  ).json();
  const deployments = history.deployments as { id: string; number: number }[];
  const first = deployments.find((row) => row.number === 1);
  assert.ok(first, JSON.stringify(history).slice(0, 300));
  const before = (await served())?.count ?? 0;
  const rolled = await call("POST", team(`/deployments/${first.id}/roll-back`));
  assert.equal(rolled.statusCode, 200, rolled.body);
  const deadline = Date.now() + 120_000;
  let answer: Answer | null = null;
  while (Date.now() < deadline) {
    answer = await served();
    if (answer?.version === "1") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(answer?.version, "1");
  assert.ok((answer?.count ?? 0) > before, "the kept folder survived the roll back");
  // Wait for the roll back to finish (its worker starts last), so nothing is left behind.
  let detail: { deployment: { status: string } } | null = null;
  while (Date.now() < deadline) {
    detail = (await call("GET", team(`/deployments/${rolled.json().deployment.id}`))).json();
    if (detail?.deployment.status !== "deploying") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(detail?.deployment.status, "live", JSON.stringify(detail).slice(0, 400));
  assert.match(JSON.stringify(detail), /changed the database after #1/);
});

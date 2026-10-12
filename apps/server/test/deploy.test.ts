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
import { reachProblem } from "../src/services/deploy.js";
import { type DockerSsh, dockerHostAvailable, startDockerSsh } from "./helpers/docker-ssh.js";

/**
 * Deploy end to end: a real app with a Dockerfile, deployed by a pipeline to
 * a Debian machine over SSH with real Docker, reached over HTTP — replaced,
 * broken and rolled back by itself, rolled back by hand, protected, frozen.
 */

const tmp = path.join(os.tmpdir(), `zelyq-deploy-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const SECRET = "xxxxxxxx-deploy-secret-xxxxxxxx";
const available = dockerHostAvailable();

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "deploy.db")}`,
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
    previewPortRange: [4956, 4959],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
const cookies = { owner: "", admin: "", editor: "" };
let teamId: string;
let projectId: string;
let machine: DockerSsh | null = null;
let runnerId = "";
let hostPort = 0;
const app = `shop${Date.now().toString(36)}`;

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

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address() as net.AddressInfo;
      probe.close(() => resolve(address.port));
    });
  });
}

/** The app: answers with its version and the variables it was given. */
async function writeApp(version: string, broken = false) {
  await server.runtime.writeFile(
    projectId,
    "Dockerfile",
    'FROM node:22-bookworm\nWORKDIR /app\nCOPY server.js .\nCMD ["node", "server.js"]\n',
  );
  await server.runtime.writeFile(
    projectId,
    "server.js",
    broken
      ? "process.exit(1);\n"
      : `require("http").createServer((q, s) => s.end(JSON.stringify({ version: "${version}", greeting: process.env.GREETING, secret: process.env.API_KEY }))).listen(3000);\n`,
  );
}

async function pipeline(name: string, to: string): Promise<string> {
  const created = await call(cookies.owner, "POST", team("/pipelines"), {
    source: `name: ${name}
runs-on: local
source:
  app: Shop
stages:
  - name: Ship
    steps:
      - checkout: true
      - deploy:
          to: ${to}
          app: ${app}
          port: 3000
          host-port: ${hostPort}
          health-timeout: 60s
`,
  });
  assert.equal(created.statusCode, 201, created.body);
  return created.json().pipeline.id;
}

async function runToEnd(pipelineId: string, cookie = cookies.owner) {
  const started = await call(cookie, "POST", team(`/pipelines/${pipelineId}/runs`), {});
  assert.equal(started.statusCode, 201, started.body);
  return waitFor(started.json().run.id);
}

async function waitFor(runId: string, statuses = ["passed", "failed", "cancelled", "timed_out"]) {
  const deadline = Date.now() + 600_000;
  for (;;) {
    const run = (await call(cookies.owner, "GET", team(`/pipeline-runs/${runId}`))).json().run;
    if (statuses.includes(run.status)) {
      const lines = (
        await call(cookies.owner, "GET", team(`/pipeline-runs/${runId}/logs?after=0`))
      ).json().lines;
      return { run, log: lines.map((line: { text: string }) => line.text).join("\n") as string };
    }
    if (Date.now() > deadline) throw new Error(`run did not finish: ${run.status}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function served(): Promise<{ version: string; greeting: string; secret: string } | null> {
  return fetch(`http://127.0.0.1:${hostPort}/`, { signal: AbortSignal.timeout(3000) })
    .then((response) => response.json())
    .catch(() => null);
}

async function environments() {
  return (await call(cookies.owner, "GET", team("/environments"))).json().environments as {
    id: string;
    name: string;
    live: { id: string; number: number; status: string; url: string; app: string }[];
  }[];
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  cookies.owner = await register("owner@example.com", "Owner");
  teamId = (await call(cookies.owner, "GET", "/api/teams")).json().teams[0].id;
  for (const role of ["admin", "editor"] as const) {
    cookies[role] = await register(`${role}@example.com`, role[0]?.toUpperCase() + role.slice(1));
    await call(cookies.owner, "POST", team("/members"), { email: `${role}@example.com`, role });
  }
  await call(cookies.owner, "PUT", "/api/settings", { pipelineLocalRunner: "host" });
  projectId = (await call(cookies.owner, "POST", "/api/projects", { name: "Shop", teamId })).json()
    .project.id;
  hostPort = await freePort();
  if (!available) return;
  const keys = (await call(cookies.owner, "GET", team("/ssh-keys"))).json().keys;
  machine = await startDockerSsh(keys[0].publicKey);
  if (!machine) return;
  const added = await call(cookies.owner, "POST", team("/runners"), {
    name: "deploy-box",
    host: machine.host,
    port: machine.port,
    username: machine.username,
  });
  runnerId = added.json().runner.id;
  const tested = (await call(cookies.owner, "POST", team(`/runners/${runnerId}/test`))).json();
  const confirmed = await call(cookies.owner, "POST", team(`/runners/${runnerId}/confirm`), {
    fingerprint: tested.hostKeyFingerprint,
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const secret = await call(cookies.owner, "POST", team("/vault"), {
    name: "SHOP_API_KEY",
    value: SECRET,
  });
  assert.equal(secret.statusCode, 201, secret.body);
});

after(async () => {
  for (const name of ["staging", "production"]) {
    try {
      execFileSync(
        "docker",
        ["rm", "-f", `zelyq-${app}-${name}`, `zelyq-${app}-${name}-previous`],
        { stdio: "ignore" },
      );
    } catch {
      // not there
    }
  }
  try {
    for (const id of execFileSync("docker", ["ps", "-aq", "--filter", `label=zelyq.app=${app}`])
      .toString()
      .split(/\s+/)
      .filter(Boolean)) {
      execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
    }
    execFileSync("docker", ["rm", "-f", "zelyq-proxy"], { stdio: "ignore" });
    execFileSync(
      "docker",
      ["volume", "rm", "-f", "zelyq-proxy-sites", "zelyq-proxy-data", "zelyq-proxy-config"],
      {
        stdio: "ignore",
      },
    );
    const images = [app, `${app}x`].flatMap((name) =>
      execFileSync("docker", ["images", "-q", "--filter", `label=zelyq.app=${name}`])
        .toString()
        .split(/\s+/),
    );
    const found = images.filter(Boolean);
    if (found.length) execFileSync("docker", ["rmi", "-f", ...found], { stdio: "ignore" });
  } catch {
    // nothing kept
  }
  machine?.stop();
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const ready = () => (machine ? false : "no Docker host for the test machine");

test("environments: admins make them, values never come back, editors cannot", {
  skip: !available && "no Docker",
}, async (t) => {
  if (ready()) return t.skip(String(ready()));
  const refused = await call(cookies.editor, "POST", team("/environments"), {
    name: "staging",
    runnerId,
  });
  assert.equal(refused.statusCode, 403);
  const created = await call(cookies.admin, "POST", team("/environments"), {
    name: "staging",
    runnerId,
    address: "127.0.0.1",
    variables: { GREETING: "hello from staging", API_KEY: "vault://SHOP_API_KEY" },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.deepEqual(created.json().environment.variables, [
    { name: "GREETING", fromVault: false },
    { name: "API_KEY", fromVault: true },
  ]);
  assert.ok(!created.body.includes("hello from staging"), "a typed value came back");
});

test("deploy: built on the machine, started, reachable, with its variables, secrets kept out of the log", {
  skip: !available && "no Docker",
}, async (t) => {
  if (ready()) return t.skip(String(ready()));
  await writeApp("1");
  const id = await pipeline("Ship to staging", "staging");
  const { run, log } = await runToEnd(id);
  assert.equal(run.status, "passed", log);
  assert.match(log, /Building zelyq-/);
  assert.match(log, /Healthy: http:\/\/127\.0\.0\.1:\d+\/ answered 200/);
  assert.match(log, new RegExp(`${app} #1 is live on staging: http://127\\.0\\.0\\.1:${hostPort}`));
  assert.ok(!log.includes(SECRET), "the secret appeared in the log");
  const answer = await served();
  assert.deepEqual(answer, { version: "1", greeting: "hello from staging", secret: SECRET });
  const staging = (await environments()).find((e) => e.name === "staging");
  assert.equal(staging?.live[0]?.number, 1);
  assert.equal(staging?.live[0]?.url, `http://127.0.0.1:${hostPort}`);
});

test("deploy: a new version replaces the old; a broken one is rolled back by itself", {
  skip: !available && "no Docker",
}, async (t) => {
  if (ready()) return t.skip(String(ready()));
  const id = (await call(cookies.owner, "GET", team("/pipelines"))).json().pipelines[0].id;
  await writeApp("2");
  const second = await runToEnd(id);
  assert.equal(second.run.status, "passed", second.log);
  assert.equal((await served())?.version, "2");

  await writeApp("3", true);
  const broken = await runToEnd(id);
  assert.equal(broken.run.status, "failed");
  assert.match(broken.log, /The new version did not come up/);
  assert.match(broken.log, /Rolled back automatically/);
  assert.equal((await served())?.version, "2", "version 2 is serving again");

  const staging = (await environments()).find((e) => e.name === "staging");
  assert.equal(staging?.live[0]?.number, 2);
  const history = (
    await call(cookies.owner, "GET", team(`/environments/${staging?.id}/deployments?app=${app}`))
  ).json().deployments;
  assert.deepEqual(
    history.map((d: { number: number; status: string }) => `${d.number}:${d.status}`),
    ["3:failed", "2:live", "1:replaced"],
  );
});

test("roll back: by hand, to an earlier version still on the machine", {
  skip: !available && "no Docker",
}, async (t) => {
  if (ready()) return t.skip(String(ready()));
  const staging = (await environments()).find((e) => e.name === "staging");
  const history = (
    await call(cookies.owner, "GET", team(`/environments/${staging?.id}/deployments?app=${app}`))
  ).json().deployments;
  const first = history.find((d: { number: number }) => d.number === 1);
  assert.equal(first.canRollBackTo, true);
  const rolled = await call(cookies.editor, "POST", team(`/deployments/${first.id}/roll-back`));
  assert.equal(rolled.statusCode, 200, rolled.body);
  // It answers at once, still going; the page then follows it to the end.
  assert.equal(rolled.json().deployment.status, "deploying");
  assert.equal(rolled.json().deployment.kind, "rollback");
  const id = rolled.json().deployment.id;
  let detail = (await call(cookies.editor, "GET", team(`/deployments/${id}`))).json().deployment;
  for (let i = 0; i < 120 && detail.status === "deploying"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    detail = (await call(cookies.editor, "GET", team(`/deployments/${id}`))).json().deployment;
  }
  assert.equal(detail.status, "live");
  const lines = detail.log.map((line: { text: string }) => line.text).join("\n");
  assert.match(lines, /Rolling back to #1/);
  assert.match(lines, /Healthy: /);
  assert.match(lines, /#\d+ is live on staging/);
  assert.equal((await served())?.version, "1");

  // A pipeline that would take another app's port is warned about while it is written.
  const warned = await call(cookies.owner, "POST", team("/pipelines/check"), {
    source: `name: x\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - deploy: {to: staging, app: other, port: 3000, host-port: ${hostPort}}\n`,
  });
  assert.ok(
    warned
      .json()
      .warnings.some((w: string) => w.includes(`Port ${hostPort} on staging is used by ${app}`)),
    JSON.stringify(warned.json()),
  );
});

test("protected and frozen environments", { skip: !available && "no Docker" }, async (t) => {
  if (ready()) return t.skip(String(ready()));
  const production = await call(cookies.owner, "POST", team("/environments"), {
    name: "production",
    runnerId,
    address: "127.0.0.1",
    protected: true,
    variables: { GREETING: "hello from production" },
  });
  assert.equal(production.statusCode, 201, production.body);
  hostPort = await freePort();
  await writeApp("4");
  const id = await pipeline("Ship to production", "production");
  const started = await call(cookies.editor, "POST", team(`/pipelines/${id}/runs`), {});
  const runId = started.json().run.id;
  const waiting = await waitFor(runId, ["waiting"]);
  assert.equal(waiting.run.approvals[0].message, "Deploy to production?");
  const open = waiting.run.approvals[0];
  assert.equal(
    (
      await call(cookies.editor, "POST", team(`/pipeline-runs/${runId}/approvals/${open.id}`), {
        decision: "approved",
      })
    ).statusCode,
    403,
  );
  await call(cookies.admin, "POST", team(`/pipeline-runs/${runId}/approvals/${open.id}`), {
    decision: "approved",
  });
  const done = await waitFor(runId);
  assert.equal(done.run.status, "passed", done.log);
  assert.equal((await served())?.greeting, "hello from production");

  // An editor cannot roll back a protected environment.
  const env = (await environments()).find((e) => e.name === "production");
  const live = env?.live[0];
  assert.equal(
    (await call(cookies.editor, "POST", team(`/deployments/${live?.id}/roll-back`))).statusCode,
    403,
  );

  const frozen = await call(cookies.admin, "PATCH", team(`/environments/${env?.id}`), {
    frozen: true,
    frozenReason: "release freeze",
  });
  assert.equal(frozen.statusCode, 200, frozen.body);
  const refused = await runToEnd(id);
  assert.equal(refused.run.status, "failed");
  assert.match(refused.log, /production is frozen: release freeze/);
});

test("a port already in use is said plainly; a first deploy says nothing was there before", {
  skip: !available && "no Docker",
}, async (t) => {
  if (ready()) return t.skip(String(ready()));
  const busy = net.createServer().listen(0, "0.0.0.0");
  await new Promise((resolve) => busy.once("listening", resolve));
  const taken = (busy.address() as net.AddressInfo).port;
  try {
    const created = await call(cookies.owner, "POST", team("/pipelines"), {
      source: `name: Port taken
runs-on: local
source:
  app: Shop
stages:
  - name: Ship
    steps:
      - checkout: true
      - deploy:
          to: staging
          app: ${app}-other
          port: 3000
          host-port: ${taken}
`,
    });
    await writeApp("5");
    const { run, log } = await runToEnd(created.json().pipeline.id);
    assert.equal(run.status, "failed");
    assert.match(log, new RegExp(`Port ${taken} on deploy-box is already used by something else`));
    assert.match(log, /Nothing was running here before it/);
    assert.doesNotMatch(log, /Rolled back automatically/);
  } finally {
    busy.close();
  }
});

/** What the app answers at its name, through the proxy (its own certificate, so -k). */
function viaProxy(host: string, port: number): { version: string } | null {
  try {
    return JSON.parse(
      execFileSync("curl", [
        "-sk",
        "--max-time",
        "3",
        "--resolve",
        `${host}:${port}:127.0.0.1`,
        `https://${host}:${port}/`,
      ]).toString(),
    );
  } catch {
    return null;
  }
}

test("a domain: apps behind the proxy, HTTPS, new versions without downtime", {
  skip: !available && "no Docker",
}, async (t) => {
  if (ready()) return t.skip(String(ready()));
  const [httpPort, httpsPort] = [await freePort(), await freePort()];
  const created = await call(cookies.owner, "POST", team("/environments"), {
    name: "web",
    runnerId,
    address: "127.0.0.1",
    domain: "Apps.Test",
    https: "internal",
    httpPort,
    httpsPort,
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().environment.domain, "apps.test");
  // One proxy per machine: another environment there must use the same ports.
  const clash = await call(cookies.owner, "POST", team("/environments"), {
    name: "web2",
    runnerId,
    domain: "other.test",
    httpPort: httpPort + 1,
    httpsPort,
  });
  assert.equal(clash.statusCode, 400, clash.body);

  await writeApp("10");
  const id = await pipeline("Ship to web", "web");
  const first = await runToEnd(id);
  assert.equal(first.run.status, "passed", first.log);
  const host = `${app}.apps.test`;
  assert.match(first.log, /host-port and url are not used/);
  // apps.test leads nowhere: the deploy says so instead of claiming people can open it.
  assert.match(
    first.log,
    new RegExp(`is running on deploy-box, but https://${host}:${httpsPort} cannot be opened yet`),
  );
  assert.match(first.log, /does not lead to this machine yet/);
  assert.equal(viaProxy(host, httpsPort)?.version, "10");
  // The page shows why, and Check again asks once more (the proxy is reloaded first).
  const live = (await environments()).find((e) => e.name === "web")?.live[0] as unknown as {
    id: string;
    error: string | null;
  };
  assert.match(live.error ?? "", /does not lead to this machine yet/);
  const checked = await call(cookies.editor, "POST", team(`/deployments/${live.id}/check`));
  assert.equal(checked.statusCode, 200, checked.body);
  assert.match(checked.json().deployment.error ?? "", /does not lead to this machine yet/);
  assert.equal(viaProxy(host, httpsPort)?.version, "10", "the reload keeps it serving");
  // Reached by its name on the machine's address, it answers.
  assert.equal(
    await reachProblem(host, "127.0.0.1", { https: "internal", httpPort, httpsPort }, "deploy-box"),
    null,
  );
  // A port nobody listens on is said plainly.
  assert.match(
    (await reachProblem(
      host,
      "127.0.0.1",
      { https: "off", httpPort: await freePort(), httpsPort },
      "deploy-box",
    )) ?? "",
    /Nothing answers on port \d+ on 127\.0\.0\.1\. Open port/,
  );

  // A new version, while people keep asking: none of them notices the switch.
  await writeApp("11");
  let asked = 0;
  let failed = 0;
  let stop = false;
  const traffic = (async () => {
    while (!stop) {
      asked += 1;
      if (!viaProxy(host, httpsPort)) failed += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  const second = await runToEnd(id);
  stop = true;
  await traffic;
  assert.equal(second.run.status, "passed", second.log);
  assert.match(second.log, /beside the running version/);
  assert.equal(viaProxy(host, httpsPort)?.version, "11");
  assert.ok(asked > 20, `only ${asked} requests`);
  assert.equal(failed, 0, `${failed} of ${asked} requests failed during the deploy`);

  // A broken version never reaches anyone.
  await writeApp("12", true);
  const broken = await runToEnd(id);
  assert.equal(broken.run.status, "failed");
  assert.match(broken.log, /The running version was not touched/);
  assert.equal(viaProxy(host, httpsPort)?.version, "11");
  const running = execFileSync("docker", [
    "ps",
    "--format",
    "{{.Names}}",
    "--filter",
    `label=zelyq.app=${app}`,
    "--filter",
    "label=zelyq.environment=web",
  ])
    .toString()
    .trim()
    .split("\n");
  assert.deepEqual(running, [`zelyq-${app}-web-2`], "only the live version is left");

  // Roll back to the first version: same name, same proxy.
  const web = (await environments()).find((e) => e.name === "web");
  const history = (
    await call(cookies.owner, "GET", team(`/environments/${web?.id}/deployments?app=${app}`))
  ).json().deployments;
  const one = history.find((d: { number: number }) => d.number === 1);
  const rolled = await call(cookies.owner, "POST", team(`/deployments/${one.id}/roll-back`));
  assert.equal(rolled.statusCode, 200, rolled.body);
  let detail = rolled.json().deployment;
  for (let i = 0; i < 120 && detail.status === "deploying"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    detail = (await call(cookies.owner, "GET", team(`/deployments/${detail.id}`))).json()
      .deployment;
  }
  assert.equal(detail.status, "live", JSON.stringify(detail.log));
  assert.equal(detail.url, `https://${host}:${httpsPort}`);
  assert.equal(viaProxy(host, httpsPort)?.version, "10");

  // Another app cannot take a name that is already used.
  const thief = await call(cookies.owner, "POST", team("/pipelines"), {
    source: `name: Thief\nruns-on: local\nsource:\n  app: Shop\nstages:\n  - name: Ship\n    steps:\n      - checkout: true\n      - deploy: {to: web, app: ${app}x, port: 3000, domain: ${host}}\n`,
  });
  assert.equal(thief.statusCode, 201, thief.body);
  await writeApp("13");
  const stolen = await runToEnd(thief.json().pipeline.id);
  assert.equal(stolen.run.status, "failed");
  assert.match(stolen.log, /is already used by another app/);
  assert.equal(viaProxy(host, httpsPort)?.version, "10");
});

test("no Dockerfile: Zelyq writes one for the kind of app, shows it, and deploys", {
  skip: !available && "no Docker",
}, async (t) => {
  if (ready()) return t.skip(String(ready()));
  await server.runtime.deleteFile(projectId, "Dockerfile");
  await server.runtime.writeFile(
    projectId,
    "package.json",
    JSON.stringify({ name: "shop", scripts: { start: "node server.js" } }),
  );
  await server.runtime.writeFile(
    projectId,
    "server.js",
    'require("http").createServer((q, s) => s.end(JSON.stringify({ version: "20", port: process.env.PORT }))).listen(process.env.PORT);\n',
  );
  const id = await pipeline("No Dockerfile", "web");
  const { run, log } = await runToEnd(id);
  assert.equal(run.status, "passed", log);
  assert.match(log, /There is no Dockerfile: this is Node 22 \(npm\), started with npm run start/);
  assert.match(log, /^FROM node:22-alpine$/m);
  assert.match(log, /^CMD \["sh","-c","npm run start"\]$/m);
  const web = (await environments()).find((e) => e.name === "web");
  const host = new URL(web?.live.find((d) => d.app === app)?.url ?? "https://x").host;
  const [name, port] = host.split(":");
  const answer = viaProxy(name ?? "", Number(port)) as { version: string; port?: string } | null;
  assert.equal(answer?.version, "20");
  assert.equal(answer?.port, "3000", "PORT is the deploy step's port");
});

test("when the app changes, its pipelines start by themselves", async () => {
  const id = (
    await call(cookies.owner, "POST", team("/pipelines"), {
      source:
        "name: On change\nruns-on: local\nsource:\n  app: Shop\nstages:\n  - name: A\n    steps:\n      - run: echo changed\n",
    })
  ).json().pipeline.id;
  const added = await call(cookies.editor, "POST", team(`/pipelines/${id}/triggers`), {
    kind: "app",
  });
  assert.equal(added.statusCode, 201, added.body);
  const project = await server.store.projects.findById(projectId);
  assert.ok(project);
  assert.equal(await server.pipelineTriggers.appChanged(project), 1);
  const runs = (await call(cookies.owner, "GET", team(`/pipelines/${id}/runs`))).json().runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trigger, "app");
});

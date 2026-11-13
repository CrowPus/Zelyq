/**
 * Step 7, run by hand (not part of the test suite): Ops, on a real model,
 * launches a real app with a database on a real machine (an SSH container
 * using this host's Docker). Talks the way a person would: approves when
 * asked, says "go on", and checks the result from outside at the end.
 * Usage: node --import tsx test/helpers/launch-live.mts <server url> <state dir>
 */
import fs from "node:fs";
import { startDockerSsh } from "./docker-ssh.js";

const BASE = process.argv[2] ?? "http://127.0.0.1:8093";
const DIR = process.argv[3] ?? "/tmp";
let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(BASE + url, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const set = res.headers.get("set-cookie");
  if (set?.includes("zelyq_session=")) cookie = set.split(";")[0] as string;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}
const log = (line: string) => {
  console.log(line);
  fs.appendFileSync(`${DIR}/launch-transcript.txt`, `${line}\n`);
};

await call("POST", "/api/auth/register", { email: "founder@example.com", name: "Founder", password: "correct-horse-battery" });
const teamId = (await call("GET", "/api/teams")).teams[0].id as string;
await call("PUT", "/api/settings", { provider: "google", pipelineLocalRunner: "host" });
await call("POST", `/api/teams/${teamId}/ops`);

// The machine: SSH, sharing this host's Docker.
const keys = (await call("GET", `/api/teams/${teamId}/ssh-keys`)).keys;
const machine = await startDockerSsh(keys[0].publicKey);
if (!machine) throw new Error("no test machine");
fs.writeFileSync(`${DIR}/machine.json`, JSON.stringify(machine));
const runner = (await call("POST", `/api/teams/${teamId}/runners`, { name: "launch-box", host: machine.host, port: machine.port, username: machine.username })).runner;
const tested = await call("POST", `/api/teams/${teamId}/runners/${runner.id}/test`);
await call("POST", `/api/teams/${teamId}/runners/${runner.id}/confirm`, { fingerprint: tested.hostKeyFingerprint });

// The app: answers with its version, whether it reaches its database, and whether its update ran.
const project = (await call("POST", "/api/projects", { name: "Shop", teamId })).project;
const files: Record<string, string> = {
  "package.json": JSON.stringify({ name: "shop", version: "1.0.0", scripts: { start: "node server.js", migrate: "node migrate.js", test: "node --test" } }, null, 2),
  Dockerfile: 'FROM node:22-bookworm\nWORKDIR /app\nCOPY *.js package.json ./\nRUN mkdir -p /app/data\nCMD ["node", "server.js"]\n',
  "server.js": `const net = require("net"); const fs = require("fs");
require("http").createServer((q, s) => {
  const url = new URL(process.env.DATABASE_URL || "postgres://none:0/none");
  const socket = net.connect(Number(url.port || 5432), url.hostname);
  const done = (database) => { socket.destroy(); s.end(JSON.stringify({ app: "shop", database, migrated: fs.existsSync("/app/data/migrated") })); };
  socket.once("connect", () => done(true)); socket.once("error", () => done(false));
}).listen(process.env.PORT || 3000);
`,
  "migrate.js": 'require("fs").mkdirSync("/app/data", { recursive: true }); require("fs").writeFileSync("/app/data/migrated", new Date().toISOString());\n',
  "test.test.js": 'require("node:test")("it adds", () => require("node:assert").equal(1 + 1, 2));\n',
};
for (const [path, content] of Object.entries(files)) {
  await call("PUT", `/api/projects/${project.id}/files/${path}`, { content });
}
log(`set up: team ${teamId}, machine launch-box at ${machine.host}:${machine.port}, app Shop`);

// The conversation.
let jobId: string | undefined;
async function say(text: string) {
  log(`\n>>> Founder: ${text}`);
  const job = (await call("POST", `/api/teams/${teamId}/ops/talk`, { text, ...(jobId ? { jobId } : {}) })).job;
  jobId = job.id;
  const seen = new Set<string>(job.messages.map((m: { id: string }) => m.id));
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const view = (await call("GET", `/api/teams/${teamId}/ops/jobs/${jobId}`)).job;
    for (const m of view.messages) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        log(`<<< ${m.role === "ops" ? "Ops" : m.role}: ${m.text}`);
      }
    }
    if (!view.working) {
      log(`    [stage ${view.stage}, ${view.tokens} tokens, ${Math.round((Date.now() - started) / 1000)}s; did: ${view.activity.join(" | ")}]`);
      for (const step of view.steps) log(`    step ${step.position + 1} [${step.status}${step.needsApproval ? ", needs approval" : ""}] ${step.words}${step.proof ? ` — checked: ${step.proof.ok} (${step.proof.detail})` : ""}`);
      return view;
    }
    if (Date.now() - started > 25 * 60_000) throw new Error("Ops still working after 25 minutes");
  }
}

let view = await say(
  "Put the app Shop online on the machine launch-box: a staging environment and a protected production environment. It needs a Postgres database, and its migrate script must run on every deploy. There is no domain yet, so use the machine's address with ports.",
);
for (let round = 0; round < 8 && !["done", "failed", "stopped"].includes(view.stage); round += 1) {
  if (view.stage === "approve") {
    for (const step of view.steps) {
      if (step.risk === "always-ask" && step.status === "planned") {
        // Approve first, then confirm such steps one by one, as a person reads them.
      }
    }
    await call("POST", `/api/teams/${teamId}/ops/jobs/${jobId}/plan`, { decision: "approve", planHash: view.planHash });
    log("    [Founder pressed Approve]");
    const after = (await call("GET", `/api/teams/${teamId}/ops/jobs/${jobId}`)).job;
    for (const step of after.steps) {
      if (step.risk === "always-ask" && step.status === "planned") {
        await call("POST", `/api/teams/${teamId}/ops/jobs/${jobId}/steps/${step.id}/confirm`);
        log(`    [Founder confirmed: ${step.words}]`);
      }
    }
    view = await say("Approved. Go on.");
  } else {
    view = await say("Go on. Use your judgment for anything you need to choose.");
  }
}

// From outside: what is live, and does it answer?
const environments = (await call("GET", `/api/teams/${teamId}/environments`)).environments;
for (const env of environments) {
  for (const live of env.live ?? []) {
    const answer = await fetch(live.url, { signal: AbortSignal.timeout(5000) }).then((r) => r.text()).catch((e) => `no answer: ${e.message}`);
    log(`OUTSIDE CHECK ${env.name}: ${live.app} #${live.number} at ${live.url} → ${answer}`);
  }
}
const memory = await call("GET", `/api/teams/${teamId}/ops/memory`);
log(`memory: ${memory.sheets.length} sheets (${memory.sheets.map((s: { subject: string }) => s.subject).join(", ")}), ${memory.lessons.length} lessons`);
log(`final stage: ${view.stage}`);

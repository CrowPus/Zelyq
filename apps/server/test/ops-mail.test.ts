import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { User } from "@zelyq/core";
import { runMigrations, type Store } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { addressOf, MailService } from "../src/services/mail.js";
import { OpsMailer } from "../src/services/ops/mailer.js";
import type { OpsService } from "../src/services/ops/service.js";

/**
 * Ops, step 10: email. A small mail server inside the test receives what
 * Zelyq really sends over SMTP; the three launch messages go to the right
 * people, only while something still waits for them.
 */

const tmp = path.join(os.tmpdir(), `zelyq-ops-mail-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "ops-mail.db")}`,
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
    previewPortRange: [4960, 4963],
    previewHost: "127.0.0.1",
  },
};

interface Received {
  from: string;
  to: string[];
  data: string;
}

/** Just enough SMTP to take messages in: no TLS, no sign-in, everything kept. */
function smtpSink(): Promise<{ server: Server; port: number; inbox: Received[] }> {
  const inbox: Received[] = [];
  const server = createServer((socket) => {
    let mail: Received = { from: "", to: [], data: "" };
    let inData = false;
    let buffer = "";
    socket.write("220 sink ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          mail.data += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          // Quoted-printable, as nodemailer sends long lines: read it as a person would.
          mail.data = mail.data
            .replace(/=\r\n/g, "")
            .replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            );
          inbox.push(mail);
          mail = { from: "", to: [], data: "" };
          socket.write("250 queued\r\n");
          continue;
        }
        const line = buffer.indexOf("\r\n");
        if (line < 0) return;
        const command = buffer.slice(0, line);
        buffer = buffer.slice(line + 2);
        const verb = command.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") socket.write("250-sink\r\n250 OK\r\n");
        else if (verb === "MAIL") {
          mail.from = /<([^>]*)>/.exec(command)?.[1] ?? "";
          socket.write("250 OK\r\n");
        } else if (verb === "RCPT") {
          mail.to.push(/<([^>]*)>/.exec(command)?.[1] ?? "");
          socket.write("250 OK\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 go on\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
          return;
        } else socket.write("250 OK\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0, inbox });
    });
  });
}

let server: ZelyqServer;
let store: Store;
let ops: OpsService;
let owner: User;
let editor: User;
let teamId: string;
let sink: Awaited<ReturnType<typeof smtpSink>>;
let mail: MailService;
let mailer: OpsMailer;
let ownerCookie: string;

const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const inboxFor = (address: string) => sink.inbox.filter((item) => item.to.includes(address));

async function register(email: string, name: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  store = server.store;
  ops = server.ops;
  sink = await smtpSink();
  ownerCookie = await register("owner@example.com", "Owner");
  await register("editor@example.com", "Editor");
  const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
    server.app.inject({
      method,
      url,
      headers: { cookie: ownerCookie },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  teamId = (await call("GET", "/api/teams")).json().teams[0].id;
  await call("POST", `/api/teams/${teamId}/members`, {
    email: "editor@example.com",
    role: "editor",
  });
  owner = (await store.users.findByEmail("owner@example.com")) as unknown as User;
  editor = (await store.users.findByEmail("editor@example.com")) as unknown as User;
  const saved = await call("PUT", "/api/settings", {
    mailHost: "127.0.0.1",
    mailPort: String(sink.port),
    mailSecurity: "none",
    mailFrom: "Zelyq <ops@zelyq.test>",
  });
  assert.equal(saved.statusCode, 200, saved.body);
  await call("POST", `/api/teams/${teamId}/ops`);
  await store.pipelines.runners.create({
    id: "rnr_mail_box",
    teamId,
    kind: "ssh",
    name: "box",
    host: "203.0.113.9",
    port: 22,
    username: "zelyq",
    labels: "[]",
    description: null,
    enabled: true,
    maxConcurrent: 0,
    cpus: 2,
    memoryMb: 4096,
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  mail = new MailService(server.settings);
  mailer = new OpsMailer(store, mail, "https://zelyq.test/", 60);
  ops.events = (event) => mailer.handle(event);
});

after(async () => {
  mailer?.close();
  await server?.close();
  sink?.server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("the admin's test message goes through the real SMTP path", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/settings/mail/test",
    headers: { cookie: ownerCookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  const [message] = inboxFor("owner@example.com");
  assert.ok(message, "the test message arrived");
  assert.equal(message.from, "ops@zelyq.test");
  assert.match(message.data, /Subject: Zelyq can send email/);
  assert.equal(addressOf("Zelyq <ops@zelyq.test>"), "ops@zelyq.test");
  assert.equal(addressOf("not an address"), null);
});

test("a plan still waiting is emailed once, with a link that only opens the page", async () => {
  const job = await ops.startJob(editor, teamId, { request: "Make a staging environment" });
  const plan = await ops.proposePlan(job.id, {
    steps: [{ action: "create_environment", inputs: { name: "staging", machine: "box" } }],
  });
  assert.equal(plan.job?.stage, "approve");
  await settle();
  const sent = inboxFor("editor@example.com");
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.data, /Subject: Ops needs your approval/);
  assert.match(sent[0]!.data, /Create the environment staging on box/);
  assert.match(sent[0]!.data, new RegExp(`https://zelyq.test/ops\\?job=${job.id}`));
  assert.match(sent[0]!.data, /only pressing Approve there does/);
  // An editor may approve this one: the owner is not bothered.
  assert.equal(inboxFor("owner@example.com").length, 1);

  // Approved before the wait is over: no email.
  const quick = await ops.startJob(editor, teamId, { request: "Make a qa environment" });
  const quickPlan = await ops.proposePlan(quick.id, {
    steps: [{ action: "create_environment", inputs: { name: "qa", machine: "box" } }],
  });
  await ops.decidePlan(editor, teamId, quick.id, {
    decision: "approve",
    planHash: quickPlan.job?.planHash as string,
  });
  await settle();
  assert.equal(inboxFor("editor@example.com").length, 1);
});

test("a plan only an admin may approve also goes to the admins", async () => {
  // The owner makes a protected production first.
  const setup = await ops.startJob(owner, teamId, { request: "Make production" });
  const made = await ops.proposePlan(setup.id, {
    steps: [
      {
        action: "create_environment",
        inputs: { name: "production", machine: "box", protected: true },
      },
    ],
  });
  await ops.decidePlan(owner, teamId, setup.id, {
    decision: "approve",
    planHash: made.job?.planHash as string,
  });
  const created = await ops.perform(setup.id, "create_environment", {
    name: "production",
    machine: "box",
    protected: true,
  });
  assert.equal(created.step?.status, "done", JSON.stringify(created));
  await settle();

  const before = inboxFor("owner@example.com").length;
  const job = await ops.startJob(editor, teamId, { request: "Give production a domain" });
  const plan = await ops.proposePlan(job.id, {
    steps: [
      {
        action: "update_environment",
        inputs: { environment: "production", domain: "shop.example.com" },
      },
    ],
  });
  assert.equal(plan.job?.stage, "approve");
  await settle();
  const toOwner = inboxFor("owner@example.com");
  assert.equal(toOwner.length, before + 1);
  assert.match(toOwner.at(-1)!.data, /a team admin approves it/);
  // The editor who asked hears of it too, though they cannot approve it.
  assert.match(inboxFor("editor@example.com").at(-1)!.data, /Give production a domain/);
});

test("a secret request is emailed only while the secret is still missing", async () => {
  const job = await ops.startJob(editor, teamId, { request: "Wire Stripe" });
  const asked = await ops.perform(job.id, "request_secret", {
    name: "STRIPE_KEY",
    why: "The app takes payments.",
  });
  assert.equal(asked.outcome?.ok, true, JSON.stringify(asked));
  await settle();
  const sent = inboxFor("editor@example.com").filter((item) => /STRIPE_KEY/.test(item.data));
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.data, /Vault/);
  assert.doesNotMatch(sent[0]!.data, /sk_/);

  // Added in time: no email.
  await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/vault`,
    headers: { cookie: ownerCookie },
    payload: { name: "SENDGRID_KEY", value: "a-value-nobody-emails" },
  });
  const other = await ops.startJob(editor, teamId, { request: "Wire mail" });
  await ops.perform(other.id, "request_secret", { name: "SENDGRID_KEY", why: "Mail." });
  await settle();
  assert.equal(
    inboxFor("editor@example.com").filter((item) => /SENDGRID_KEY/.test(item.data)).length,
    0,
  );
});

test("how a job ended: emailed when it shipped or failed, not for a note", async () => {
  const count = () => inboxFor("editor@example.com").length;
  const quiet = await ops.startJob(editor, teamId, { request: "Write down how qa runs" });
  await ops.proposePlan(quiet.id, {
    steps: [{ action: "write_sheet", inputs: { subject: "environment:qa", body: "qa: tests." } }],
  });
  await ops.perform(quiet.id, "write_sheet", { subject: "environment:qa", body: "qa: tests." });
  const before = count();
  await ops.finish(quiet.id, { outcome: "Written down." });
  await settle();
  assert.equal(count(), before, "a note is not news");

  const shipped = await ops.startJob(editor, teamId, { request: "Ship Shop" });
  await ops.proposePlan(shipped.id, {
    steps: [{ action: "write_sheet", inputs: { subject: "app:shop", body: "shop: v2." } }],
  });
  await ops.perform(shipped.id, "write_sheet", { subject: "app:shop", body: "shop: v2." });
  // Stands in for a pipeline run that went out (one needs a machine; the launch run proves that).
  const [step] = await store.ops.steps.listForJob(shipped.id);
  await store.ops.steps.update(step!.id, { action: "run_pipeline" });
  await ops.finish(shipped.id, { outcome: "Shop 2.0 is live on staging and production." });
  await settle();
  assert.equal(count(), before + 1);
  assert.match(inboxFor("editor@example.com").at(-1)!.data, /Subject: Done: Ship Shop/);

  const broken = await ops.startJob(editor, teamId, { request: "Break things" });
  await ops.proposePlan(broken.id, {
    steps: [{ action: "write_sheet", inputs: { subject: "app:x", body: "x." } }],
  });
  await ops.finish(broken.id, { outcome: "The machine did not answer.", failed: true });
  await settle();
  assert.equal(count(), before + 2);
  assert.match(inboxFor("editor@example.com").at(-1)!.data, /Ops could not finish/);
});

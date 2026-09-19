import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import { type ServerConfig, trustProxyFromEnv } from "../src/config.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const PASSWORD = "correct-horse-battery";
const started: ZelyqServer[] = [];
const dirs: string[] = [];

after(async () => {
  await Promise.all(started.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function serverWith(trustProxy: ServerConfig["trustProxy"]): Promise<ZelyqServer> {
  const tmp = path.join(os.tmpdir(), `zelyq-trust-proxy-${randomBytes(6).toString("hex")}`);
  dirs.push(tmp);
  await fs.mkdir(tmp, { recursive: true });
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    trustProxy,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "trust-proxy.db")}`,
    agentUrl: "http://127.0.0.1:59998",
    provider: "anthropic",
    model: "claude-opus-5",
    effort: "high",
    allowRegistration: true,
    sessionTtlDays: 30,
    templatesDir: path.join(repoRoot, "templates"),
    webDir: null,
    secretKey: randomBytes(32).toString("base64"),
    secretKeyFile: path.join(tmp, "secret.key"),
    attachmentsDir: path.join(tmp, "attachments"),
    uploadedSkillsDir: path.join(tmp, "skills"),
    runtime: {
      kind: "local",
      workspaceDir: path.join(tmp, "workspace"),
      execTimeoutMs: 30_000,
      previewPortRange: [4981, 4984],
      previewHost: "127.0.0.1",
    },
  };
  await runMigrations(config.databaseUrl);
  const server = await buildServer(config);
  started.push(server);
  return server;
}

/** Sign up over a plain-HTTP hop that claims, as a TLS-terminating proxy
 * does, that the browser arrived over HTTPS. */
async function sessionCookieBehindProxy(server: ZelyqServer): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "x-forwarded-proto": "https" },
    payload: { email: "owner@example.com", name: "Owner", password: PASSWORD },
  });
  assert.equal(response.statusCode, 201, response.body);
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : [header ?? ""];
  const session = cookies.find((value) => value.startsWith("zelyq_session="));
  assert.ok(session, "expected a session cookie");
  return session;
}

test("behind a trusted proxy the session cookie is marked Secure", async () => {
  const server = await serverWith(true);
  assert.match(await sessionCookieBehindProxy(server), /;\s*Secure/i);
});

test("without trust configured, a forwarded scheme header changes nothing", async () => {
  // Anyone can send this header to a directly-exposed instance. Believing it
  // by default would let a caller decide how our own cookie is flagged.
  const server = await serverWith(undefined);
  assert.doesNotMatch(await sessionCookieBehindProxy(server), /;\s*Secure/i);
});

test("ZELYQ_TRUST_PROXY reads as boolean, hop count, or a list of proxies", () => {
  assert.equal(trustProxyFromEnv(undefined), false);
  assert.equal(trustProxyFromEnv(""), false);
  assert.equal(trustProxyFromEnv("false"), false);
  assert.equal(trustProxyFromEnv("true"), true);
  assert.equal(trustProxyFromEnv(" true "), true);
  // A number is hops, never a boolean — "2" means the two proxies nearest
  // this server, expressed as the predicate Fastify's types accept.
  const twoHops = trustProxyFromEnv("2");
  assert.equal(typeof twoHops, "function");
  assert.ok(typeof twoHops === "function");
  assert.equal(twoHops("10.0.0.1", 0), true);
  assert.equal(twoHops("10.0.0.1", 1), true);
  assert.equal(twoHops("203.0.113.9", 2), false);
  assert.deepEqual(trustProxyFromEnv("10.0.0.1, 192.168.1.0/24"), ["10.0.0.1", "192.168.1.0/24"]);
  assert.throws(() => trustProxyFromEnv("0"), /at least 1/);
});

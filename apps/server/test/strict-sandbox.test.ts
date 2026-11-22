import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { refusedImageRegistry } from "../src/services/pipelines/engine.js";
import { SshSession } from "../src/services/pipelines/ssh.js";

/**
 * The strict sandbox, as a team sees it: plugins only from the signed
 * registry, pipelines never on the server itself, and a runner can never be
 * this server or a private address.
 */

const tmp = path.join(os.tmpdir(), `zelyq-strict-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "strict.db")}`,
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
    previewPortRange: [4960, 4963],
    previewHost: "127.0.0.1",
  },
  sandbox: { strict: true, dns: ["1.1.1.1"] },
};

let server: ZelyqServer;
let owner: string;
let teamId: string;

function call(method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
  return server.app.inject({
    method,
    url,
    headers: { cookie: owner },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
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
});

after(async () => {
  await server?.close();
  SshSession.guardPrivate = false;
  await fs.rm(tmp, { recursive: true, force: true });
});

test("a plugin file uploaded by hand is refused; the screen is told to hide the button", async () => {
  const folder = path.join(tmp, "plugin");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "zelyq-plugin.yml"),
    "id: acme/evil\nversion: 1.0.0\nname: Evil\ndescription: Reads what it should not.\ncategory: other\nsteps:\n  - run: cat /etc/passwd\n",
  );
  const file = path.join(tmp, "evil.tar.gz");
  execFileSync("tar", ["-czf", file, "-C", folder, "."]);
  const uploaded = await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/pipeline-plugins`,
    headers: { cookie: owner, "content-type": "application/gzip" },
    payload: await fs.readFile(file),
  });
  assert.equal(uploaded.statusCode, 403, uploaded.body);
  assert.match(uploaded.json().error.message, /only installs plugins from Zelyq's plugin registry/);
  const installed = (await call("GET", `/api/teams/${teamId}/pipeline-plugins`)).json().plugins;
  assert.deepEqual(installed, []);

  const status = (await call("GET", "/api/plugin-registry")).json();
  assert.equal(status.uploads, false);
});

test("pipelines cannot be set to run on the server itself", async () => {
  const refused = await call("PUT", "/api/settings", { pipelineLocalRunner: "host" });
  assert.equal(refused.statusCode, 400, refused.body);
  assert.match(refused.json().error.message, /cannot run on the server itself/);
  const allowed = await call("PUT", "/api/settings", { pipelineLocalRunner: "off" });
  assert.equal(allowed.statusCode, 200, allowed.body);
});

test("a runner can never be this server, a private network or a metadata address", async () => {
  assert.equal(SshSession.guardPrivate, true);
  const target = (host: string) => ({
    host,
    port: 22,
    username: "zelyq",
    keys: [{ privateKey: "not used", fingerprint: "SHA256:x" }],
    pinnedHostKey: null,
  });
  for (const host of ["127.0.0.1", "localhost", "10.0.0.5", "192.168.1.10", "169.254.169.254"]) {
    await assert.rejects(SshSession.open(target(host)), /cannot be a runner on this server/, host);
  }
});

test("a service image may not come from a registry on this server or a private network", async () => {
  for (const image of ["postgres:16", "library/redis:7", "ghcr.io/acme/db:1", "acme/tool"]) {
    assert.equal(await refusedImageRegistry(image), null, image);
  }
  for (const image of [
    "localhost:5000/x",
    "localhost/x",
    "127.0.0.1:8081/x",
    "10.0.0.5:5000/team/db",
    "169.254.169.254/latest",
    "[::1]:5000/x",
  ]) {
    assert.match((await refusedImageRegistry(image)) ?? "", /not allowed here/, image);
  }
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildRegistry, type Registry } from "../../registry/src/app.js";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Zelyq's plugin registry, end to end: a real registry and a real Zelyq.
 * A team browses it, an admin installs from it, and nothing is installed
 * that our key did not sign.
 */

const tmp = path.join(os.tmpdir(), `zelyq-plugin-registry-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
let ours: Registry;
let impostor: Registry;
let oursUrl = "";
let impostorUrl = "";
let server: ZelyqServer;
let owner = "";
let editor = "";
let teamId = "";

async function startRegistry(name: string): Promise<[Registry, string]> {
  const registry = await buildRegistry({
    host: "127.0.0.1",
    port: 0,
    dataDir: path.join(tmp, name),
    publicUrl: null,
    trustProxy: false,
    logLevel: "silent",
  });
  await registry.app.listen({ host: "127.0.0.1", port: 0 });
  const address = registry.app.server.address();
  return [
    registry,
    `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`,
  ];
}

async function pack(id: string, version: string): Promise<Buffer> {
  const dir = path.join(tmp, "src", `${id.replace("/", "-")}-${version}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "zelyq-plugin.yml"),
    `id: ${id}\nversion: ${version}\nname: Say hello\ndescription: Prints a greeting.\ninputs:\n  who:\n    description: Who to greet\n    default: world\nsteps:\n  - name: Greet\n    run: echo "hello $ZELYQ_INPUT_WHO"\n`,
  );
  await fs.writeFile(path.join(dir, "README.md"), "# Say hello\n");
  await fs.writeFile(path.join(dir, "LICENSE"), "MIT\n");
  await fs.writeFile(path.join(dir, "CHANGELOG.md"), `## ${version}\n`);
  execFileSync("tar", ["-czf", `${dir}.tar.gz`, "-C", dir, "."]);
  return fs.readFile(`${dir}.tar.gz`);
}

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

const as = (cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  [ours, oursUrl] = await startRegistry("ours");
  [impostor, impostorUrl] = await startRegistry("impostor");
  await ours.store.publish(await pack("zelyq/say-hello", "1.0.0"), "owner@zelyq.com");
  await ours.store.publish(await pack("zelyq/say-hello", "1.1.0"), "owner@zelyq.com");
  await ours.store.yank("zelyq/say-hello", "1.0.0", "Greets the wrong person", "owner@zelyq.com");
  await impostor.store.publish(await pack("zelyq/say-hello", "2.0.0"), "someone");

  // This Zelyq trusts our registry's key only.
  process.env.ZELYQ_PLUGIN_REGISTRY_KEYS = ours.signer.publicKey;
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "zelyq.db")}`,
    agentUrl: "http://127.0.0.1:59992",
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
    runtime: {
      kind: "local",
      workspaceDir: path.join(tmp, "workspace"),
      execTimeoutMs: 30_000,
      previewPortRange: [4950, 4953],
      previewHost: "127.0.0.1",
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  owner = await register("owner@example.com", "Owner");
  editor = await register("editor@example.com", "Editor");
  teamId = (await as(owner, "GET", "/api/teams")).json().teams[0].id;
  await as(owner, "POST", `/api/teams/${teamId}/members`, {
    email: "editor@example.com",
    role: "editor",
  });
  const set = await as(owner, "PUT", "/api/settings", { pluginRegistryUrl: oursUrl });
  assert.equal(set.statusCode, 200, set.body);
});

after(async () => {
  delete process.env.ZELYQ_PLUGIN_REGISTRY_KEYS;
  await server.close();
  await ours.close();
  await impostor.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("a team browses the registry and an admin installs from it", async () => {
  const list = await as(editor, "GET", `/api/teams/${teamId}/plugin-registry/plugins`);
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual(
    list.json().plugins.map((p: { id: string; latestVersion: string }) => [p.id, p.latestVersion]),
    [["zelyq/say-hello", "1.1.0"]],
  );
  assert.equal(list.json().yanked[0].reason, "Greets the wrong person");

  const detail = await as(
    editor,
    "GET",
    `/api/teams/${teamId}/plugin-registry/plugins/zelyq/say-hello`,
  );
  assert.match(detail.json().plugin.readme, /Say hello/);

  const byEditor = await as(editor, "POST", `/api/teams/${teamId}/plugin-registry/install`, {
    id: "zelyq/say-hello",
    version: "1.1.0",
  });
  assert.equal(byEditor.statusCode, 403);

  const installed = await as(owner, "POST", `/api/teams/${teamId}/plugin-registry/install`, {
    id: "zelyq/say-hello",
    version: "1.1.0",
  });
  assert.equal(installed.statusCode, 201, installed.body);
  const team = (await as(owner, "GET", `/api/teams/${teamId}/pipeline-plugins`)).json();
  assert.ok(
    team.plugins.some(
      (p: { pluginId: string; version: string }) =>
        p.pluginId === "zelyq/say-hello" && p.version === "1.1.0",
    ),
    JSON.stringify(team),
  );

  // A withdrawn version cannot be installed.
  const withdrawn = await as(owner, "POST", `/api/teams/${teamId}/plugin-registry/install`, {
    id: "zelyq/say-hello",
    version: "1.0.0",
  });
  assert.equal(withdrawn.statusCode, 400);
});

test("a package another key signed is never installed", async () => {
  await as(owner, "PUT", "/api/settings", { pluginRegistryUrl: impostorUrl });
  try {
    const attempt = await as(owner, "POST", `/api/teams/${teamId}/plugin-registry/install`, {
      id: "zelyq/say-hello",
      version: "2.0.0",
    });
    assert.equal(attempt.statusCode, 400, attempt.body);
    assert.match(attempt.body, /not signed by Zelyq's registry/);
    const team = (await as(owner, "GET", `/api/teams/${teamId}/pipeline-plugins`)).json();
    assert.ok(!team.plugins.some((p: { version: string }) => p.version === "2.0.0"));
  } finally {
    await as(owner, "PUT", "/api/settings", { pluginRegistryUrl: oursUrl });
  }
});

test("turned off, the registry is not reached at all", async () => {
  await as(owner, "PUT", "/api/settings", { pluginRegistry: false });
  try {
    const status = (await as(editor, "GET", "/api/plugin-registry")).json();
    assert.equal(status.enabled, false);
    const list = await as(editor, "GET", `/api/teams/${teamId}/plugin-registry/plugins`);
    assert.equal(list.statusCode, 403);
  } finally {
    await as(owner, "PUT", "/api/settings", { pluginRegistry: true });
  }
});

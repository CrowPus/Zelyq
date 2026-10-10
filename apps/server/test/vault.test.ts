import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const tmp = path.join(os.tmpdir(), `zelyq-vault-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "vault.db")}`,
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
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4986, 4989],
    previewHost: "127.0.0.1",
  },
};

/** Distinctive enough that finding it anywhere it should not be is unambiguous. */
const VALUE = "sk_live_7f3a9c-never-in-a-list";

let server: ZelyqServer;
let owner: string;
let editor: string;
let viewer: string;
let outsider: string;
let teamId: string;
let projectId: string;

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, `register ${email}: ${response.body}`);
  const cookie = response.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(cookie);
  return `zelyq_session=${cookie.value}`;
}

function call(
  cookie: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
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

const vaultUrl = (suffix = "") => `/api/projects/${projectId}/vault${suffix}`;

async function auditEntries() {
  const response = await call(owner, "GET", `/api/teams/${teamId}/audit-log`);
  return response.json().entries as { action: string; detail: Record<string, unknown> }[];
}

async function create(name: string, value = VALUE, environment = "development") {
  const response = await call(owner, "POST", vaultUrl(), { name, environment, value });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().secret as { id: string; version: number };
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);

  owner = await register("owner@example.com", "Owner");
  editor = await register("editor@example.com", "Editor");
  viewer = await register("viewer@example.com", "Viewer");
  outsider = await register("outsider@example.com", "Outsider");
  teamId = (await call(owner, "GET", "/api/teams")).json().teams[0].id;
  for (const [email, role] of [
    ["editor@example.com", "editor"],
    ["viewer@example.com", "viewer"],
  ]) {
    const added = await call(owner, "POST", `/api/teams/${teamId}/members`, { email, role });
    assert.equal(added.statusCode, 201, added.body);
  }
  projectId = (await call(owner, "POST", "/api/projects", { name: "Vault app", teamId })).json()
    .project.id;
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("a value is stored encrypted and is never in a list, a write response, or the audit log", async () => {
  const created = await call(owner, "POST", vaultUrl(), {
    name: "STRIPE_KEY",
    environment: "development",
    value: VALUE,
    description: "Payments",
  });
  assert.equal(created.statusCode, 201);
  const updated = await call(owner, "PATCH", vaultUrl(`/${created.json().secret.id}`), {
    value: `${VALUE}-2`,
  });
  assert.equal(updated.statusCode, 200);

  for (const body of [created.body, updated.body, (await call(owner, "GET", vaultUrl())).body]) {
    assert.ok(!body.includes(VALUE), "a value leaked into a response");
  }
  assert.ok(!JSON.stringify(await auditEntries()).includes(VALUE), "a value leaked into the log");

  // What is on disk is ciphertext — both the current value and its history.
  const raw = await server.store.vault.findById(created.json().secret.id);
  assert.ok(raw);
  assert.match(raw.value, /^v1\./);
  assert.ok(!raw.value.includes(VALUE));
  assert.equal(
    await server.store.vault.versionValue(raw.id, 1).then((v) => v?.includes(VALUE)),
    false,
  );
});

test("viewers see names, editors change and reveal, outsiders see nothing", async () => {
  const secret = await create("ROLE_CHECK");

  const listed = await call(viewer, "GET", vaultUrl());
  assert.equal(listed.statusCode, 200);
  assert.ok(listed.json().secrets.some((s: { name: string }) => s.name === "ROLE_CHECK"));

  assert.equal(
    (await call(viewer, "POST", vaultUrl(), { name: "NOPE", environment: "test", value: "x" }))
      .statusCode,
    403,
  );
  assert.equal((await call(viewer, "POST", vaultUrl(`/${secret.id}/reveal`))).statusCode, 403);
  assert.equal((await call(viewer, "DELETE", vaultUrl(`/${secret.id}`))).statusCode, 403);
  assert.equal((await call(viewer, "GET", vaultUrl(`/${secret.id}/versions`))).statusCode, 200);

  const revealed = await call(editor, "POST", vaultUrl(`/${secret.id}/reveal`));
  assert.equal(revealed.statusCode, 200);
  assert.equal(revealed.json().value, VALUE);
  assert.equal(revealed.headers["cache-control"], "no-store");

  // A non-member cannot tell this project exists.
  assert.equal((await call(outsider, "GET", vaultUrl())).statusCode, 404);
  assert.equal((await call(outsider, "POST", vaultUrl(`/${secret.id}/reveal`))).statusCode, 404);
});

test("every reveal is recorded with who, which secret and which environment", async () => {
  const secret = await create("AUDITED_REVEAL", VALUE, "production");
  await call(editor, "POST", vaultUrl(`/${secret.id}/reveal`));

  const entry = (await auditEntries()).find(
    (e) => e.action === "vault.secret.revealed" && e.detail.name === "AUDITED_REVEAL",
  );
  assert.ok(entry, "no audit entry for the reveal");
  assert.equal(entry.detail.environment, "production");
  assert.equal((entry as unknown as { actorName: string }).actorName, "Editor");
});

test("restoring an old version writes it again as the newest", async () => {
  const secret = await create("ROTATED", "first");
  await call(owner, "PATCH", vaultUrl(`/${secret.id}`), { value: "second" });

  const rolledBack = await call(owner, "POST", vaultUrl(`/${secret.id}/rollback`), { version: 1 });
  assert.equal(rolledBack.statusCode, 200, rolledBack.body);
  assert.equal(rolledBack.json().secret.version, 3);
  assert.equal((await call(owner, "POST", vaultUrl(`/${secret.id}/reveal`))).json().value, "first");

  const versions = (await call(owner, "GET", vaultUrl(`/${secret.id}/versions`))).json().versions;
  assert.deepEqual(
    versions.map((v: { version: number; current: boolean }) => [v.version, v.current]),
    [
      [3, true],
      [2, false],
      [1, false],
    ],
  );
  assert.equal(versions[0].createdBy.name, "Owner");
  assert.equal("value" in versions[0], false);
});

test("names are validated, reserved names refused, duplicates rejected", async () => {
  const bad = async (name: string) =>
    (await call(owner, "POST", vaultUrl(), { name, environment: "development", value: "x" }))
      .statusCode;
  assert.equal(await bad("lower_case"), 400);
  assert.equal(await bad("VITE_PUBLIC_KEY"), 400, "VITE_ would reach the browser bundle");
  assert.equal(await bad("DATABASE_URL"), 400, "set by the backend configuration");

  await create("ONCE");
  assert.equal(await bad("ONCE"), 409);
  // The same name in another environment is a different secret.
  assert.equal(
    (await call(owner, "POST", vaultUrl(), { name: "ONCE", environment: "production", value: "p" }))
      .statusCode,
    201,
  );
});

test("a secret from another project answers as not found", async () => {
  const secret = await create("MINE_ONLY");
  const other = (await call(owner, "POST", "/api/projects", { name: "Other", teamId })).json()
    .project.id;
  const response = await call(owner, "POST", `/api/projects/${other}/vault/${secret.id}/reveal`);
  assert.equal(response.statusCode, 404);
});

test("importing a .env creates, skips, and with overwrite updates", async () => {
  await create("EXISTING", "old");
  const content = [
    "# comment",
    "export NEW_ONE=alpha",
    'QUOTED="two words"',
    "EXISTING=new",
    "VITE_EXPOSED=nope",
    "not a line",
  ].join("\n");

  const first = await call(owner, "POST", vaultUrl("/import"), {
    environment: "development",
    content,
  });
  assert.equal(first.statusCode, 200, first.body);
  const result = first.json().result;
  assert.deepEqual(result.created.sort(), ["NEW_ONE", "QUOTED"]);
  assert.deepEqual(result.updated, []);
  assert.deepEqual(result.skipped.map((s: { name: string }) => s.name).sort(), [
    "EXISTING",
    "VITE_EXPOSED",
    "not a line",
  ]);

  const second = await call(owner, "POST", vaultUrl("/import"), {
    environment: "development",
    content: "EXISTING=new",
    overwrite: true,
  });
  assert.deepEqual(second.json().result.updated, ["EXISTING"]);

  const quoted = (await call(owner, "GET", vaultUrl("?environment=development")))
    .json()
    .secrets.find((s: { name: string }) => s.name === "QUOTED");
  assert.equal(
    (await call(owner, "POST", vaultUrl(`/${quoted.id}/reveal`))).json().value,
    "two words",
  );
  assert.ok((await auditEntries()).some((e) => e.action === "vault.imported"));
});

test("deleting a secret is recorded by name", async () => {
  const secret = await create("TO_DELETE");
  assert.equal((await call(editor, "DELETE", vaultUrl(`/${secret.id}`))).statusCode, 200);
  assert.equal((await call(owner, "POST", vaultUrl(`/${secret.id}/reveal`))).statusCode, 404);
  assert.ok(
    (await auditEntries()).some(
      (e) => e.action === "vault.secret.deleted" && e.detail.name === "TO_DELETE",
    ),
  );
});

test("the agent's Vault tool sees names and environments, never a value", async () => {
  await create("AGENT_VISIBLE", VALUE, "production");
  const ownerId = (await call(owner, "GET", "/api/auth/me")).json().user.id;
  const token = server.previewGrants.mint("ses_agent", projectId, ownerId);

  const response = await server.app.inject({
    method: "GET",
    url: "/api/internal/vault/names",
    headers: { "x-zelyq-preview-bridge": token },
  });
  assert.equal(response.statusCode, 200, response.body);
  const listed = response.json().secrets as { name: string; environments: string[] }[];
  assert.deepEqual(listed.find((s) => s.name === "AGENT_VISIBLE")?.environments, ["production"]);
  assert.ok(!response.body.includes(VALUE));
  // Many secrets in this project share VALUE; none may come back.
  assert.ok(!response.body.includes("sk_live"));

  const forged = await server.app.inject({
    method: "GET",
    url: "/api/internal/vault/names",
    headers: { "x-zelyq-preview-bridge": "not-a-grant" },
  });
  assert.equal(forged.statusCode, 401);

  // A grant minted for someone who has since left the team stops working.
  const outsiderId = (await call(outsider, "GET", "/api/auth/me")).json().user.id;
  const strangerToken = server.previewGrants.mint("ses_stranger", projectId, outsiderId);
  const stranger = await server.app.inject({
    method: "GET",
    url: "/api/internal/vault/names",
    headers: { "x-zelyq-preview-bridge": strangerToken },
  });
  assert.equal(stranger.statusCode, 404);
});

test("a description edit leaves the running preview alone; a value change stops it", async () => {
  const secret = await create("RESTART_CHECK");
  const stopped: string[] = [];
  const original = server.runtime.stopPreview.bind(server.runtime);
  server.runtime.stopPreview = async (id: string) => {
    stopped.push(id);
    return original(id);
  };
  try {
    await call(owner, "PATCH", vaultUrl(`/${secret.id}`), { description: "Just a note" });
    assert.deepEqual(stopped, []);
    await call(owner, "PATCH", vaultUrl(`/${secret.id}`), { value: "new" });
    assert.deepEqual(stopped, [projectId]);
  } finally {
    server.runtime.stopPreview = original;
  }
});

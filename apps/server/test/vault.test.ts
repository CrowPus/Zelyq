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
const users: Record<"owner" | "admin" | "editor" | "viewer" | "outsider", string> = {
  owner: "",
  admin: "",
  editor: "",
  viewer: "",
  outsider: "",
};
let teamId: string;
let otherTeamId: string;
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

const vault = (suffix = "", team = teamId) => `/api/teams/${team}/vault${suffix}`;
const vars = (suffix = "", project = projectId) => `/api/projects/${project}/variables${suffix}`;

async function addSecret(name: string, value = VALUE, extra: Record<string, unknown> = {}) {
  const response = await call(users.owner, "POST", vault(), { name, value, ...extra });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().secret as { id: string; version: number };
}

async function activity() {
  return (await call(users.owner, "GET", vault("/activity"))).json().entries as {
    action: string;
    actorName: string;
    detail: Record<string, unknown>;
  }[];
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  users.owner = await register("owner@example.com", "Owner");
  for (const role of ["admin", "editor", "viewer", "outsider"] as const) {
    users[role] = await register(`${role}@example.com`, role[0]?.toUpperCase() + role.slice(1));
  }
  teamId = (await call(users.owner, "GET", "/api/teams")).json().teams[0].id;
  otherTeamId = (await call(users.outsider, "GET", "/api/teams")).json().teams[0].id;
  for (const role of ["admin", "editor", "viewer"] as const) {
    const added = await call(users.owner, "POST", `/api/teams/${teamId}/members`, {
      email: `${role}@example.com`,
      role,
    });
    assert.equal(added.statusCode, 201, added.body);
  }
  projectId = (await call(users.owner, "POST", "/api/projects", { name: "Shop", teamId })).json()
    .project.id;
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------------------ Vault

test("a value is stored encrypted and is never in a list, a write response, or the activity", async () => {
  const created = await call(users.owner, "POST", vault(), {
    name: "STRIPE_KEY_LIVE",
    value: VALUE,
    description: "Payments",
  });
  assert.equal(created.statusCode, 201, created.body);
  const updated = await call(users.owner, "PATCH", vault(`/${created.json().secret.id}`), {
    value: `${VALUE}-2`,
  });
  assert.equal(updated.statusCode, 200);
  for (const body of [created.body, updated.body, (await call(users.owner, "GET", vault())).body]) {
    assert.ok(!body.includes(VALUE), "a value leaked into a response");
  }
  assert.ok(!JSON.stringify(await activity()).includes(VALUE), "a value leaked into the log");
  const raw = await server.store.vault.findById(created.json().secret.id);
  assert.match(raw?.value ?? "", /^v1\./);
  assert.ok(!raw?.value.includes(VALUE));
});

test("viewers read names, editors write and reveal, only admins delete, outsiders see nothing", async () => {
  const secret = await addSecret("ROLE_CHECK");
  assert.equal((await call(users.viewer, "GET", vault())).statusCode, 200);
  assert.equal(
    (await call(users.viewer, "POST", vault(), { name: "NOPE", value: "x" })).statusCode,
    403,
  );
  assert.equal((await call(users.viewer, "POST", vault(`/${secret.id}/reveal`))).statusCode, 403);

  const revealed = await call(users.editor, "POST", vault(`/${secret.id}/reveal`));
  assert.equal(revealed.json().value, VALUE);
  assert.equal(revealed.headers["cache-control"], "no-store");
  assert.equal(
    (await call(users.editor, "POST", vault(), { name: "BY_EDITOR", value: "x" })).statusCode,
    201,
  );
  assert.equal((await call(users.editor, "DELETE", vault(`/${secret.id}`))).statusCode, 403);
  assert.equal((await call(users.admin, "DELETE", vault(`/${secret.id}`))).statusCode, 200);

  // A non-member cannot tell this team's Vault exists.
  assert.equal((await call(users.outsider, "GET", vault())).statusCode, 404);
});

test("a Protected secret is for admins and owners only", async () => {
  assert.equal(
    (
      await call(users.editor, "POST", vault(), {
        name: "EDITOR_PROT",
        value: "x",
        protected: true,
      })
    ).statusCode,
    403,
    "an editor cannot create a Protected secret",
  );
  const live = await addSecret("LIVE_ONLY", VALUE, { protected: true });
  assert.equal((await call(users.editor, "POST", vault(`/${live.id}/reveal`))).statusCode, 403);
  assert.equal(
    (await call(users.editor, "PATCH", vault(`/${live.id}`), { value: "y" })).statusCode,
    403,
  );
  const plain = await addSecret("UNPROTECT_ME");
  assert.equal(
    (await call(users.editor, "PATCH", vault(`/${plain.id}`), { protected: true })).statusCode,
    403,
    "an editor cannot change whether a secret is Protected",
  );
  assert.equal((await call(users.admin, "POST", vault(`/${live.id}/reveal`))).json().value, VALUE);
  // The list still shows it to everyone in the team, as Protected.
  const listed = (await call(users.viewer, "GET", vault()))
    .json()
    .secrets.find((s: { name: string }) => s.name === "LIVE_ONLY");
  assert.equal(listed.protected, true);
});

test("every reveal is recorded with who and which secret", async () => {
  const secret = await addSecret("AUDITED_REVEAL");
  await call(users.editor, "POST", vault(`/${secret.id}/reveal`));
  const entry = (await activity()).find(
    (e) => e.action === "vault.secret.revealed" && e.detail.name === "AUDITED_REVEAL",
  );
  assert.equal(entry?.actorName, "Editor");
});

test("restoring an old version writes it again as the newest", async () => {
  const secret = await addSecret("ROTATED", "first");
  await call(users.owner, "PATCH", vault(`/${secret.id}`), { value: "second" });
  const back = await call(users.owner, "POST", vault(`/${secret.id}/rollback`), { version: 1 });
  assert.equal(back.json().secret.version, 3);
  assert.equal(
    (await call(users.owner, "POST", vault(`/${secret.id}/reveal`))).json().value,
    "first",
  );
});

test("names are validated and duplicates rejected; another team may use the same name", async () => {
  assert.equal(
    (await call(users.owner, "POST", vault(), { name: "has space", value: "x" })).statusCode,
    400,
  );
  await addSecret("ONCE");
  assert.equal(
    (await call(users.owner, "POST", vault(), { name: "ONCE", value: "x" })).statusCode,
    409,
  );
  assert.equal(
    (await call(users.outsider, "POST", vault("", otherTeamId), { name: "ONCE", value: "x" }))
      .statusCode,
    201,
  );
});

test("the instance Vault is for instance administrators only, and separate from teams", async () => {
  // The first account registered administers the instance.
  const created = await call(users.owner, "POST", "/api/instance/vault", {
    name: "OPENAI_PLATFORM",
    value: "sk-instance",
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal((await call(users.admin, "GET", "/api/instance/vault")).statusCode, 403);
  const teamNames = (await call(users.owner, "GET", vault()))
    .json()
    .secrets.map((s: { name: string }) => s.name);
  assert.equal(teamNames.includes("OPENAI_PLATFORM"), false);
});

test("importing a .env into Vault creates, skips, and with overwrite updates", async () => {
  await addSecret("EXISTING", "old");
  const first = await call(users.editor, "POST", vault("/import"), {
    content: "# c\nexport NEW_ONE=alpha\nEXISTING=new\nnot a line",
  });
  assert.deepEqual(first.json().result.created, ["NEW_ONE"]);
  assert.deepEqual(
    first
      .json()
      .result.skipped.map((s: { name: string }) => s.name)
      .sort(),
    ["EXISTING", "not a line"],
  );
  const second = await call(users.editor, "POST", vault("/import"), {
    content: "EXISTING=new",
    overwrite: true,
  });
  assert.deepEqual(second.json().result.updated, ["EXISTING"]);
});

// ------------------------------------------------------- project variables

test("a project variable is typed, or taken from Vault — and the app gets both", async () => {
  await addSecret("STRIPE_KEY_TEST", "sk_test_from_vault");
  const typed = await call(users.editor, "POST", vars(), { name: "MAIL_TOKEN", value: "typed-1" });
  assert.equal(typed.statusCode, 201, typed.body);
  assert.equal(typed.json().variable.source, "direct");
  const fromVault = await call(users.editor, "POST", vars(), {
    name: "STRIPE_KEY",
    vaultName: "STRIPE_KEY_TEST",
  });
  assert.equal(fromVault.statusCode, 201, fromVault.body);
  assert.equal(fromVault.json().variable.source, "vault");

  const listed = await call(users.viewer, "GET", vars());
  assert.ok(!listed.body.includes("typed-1") && !listed.body.includes("sk_test_from_vault"));

  const env = await server.projectVariables.environmentFor(projectId);
  assert.equal(env.MAIL_TOKEN, "typed-1");
  assert.equal(env.STRIPE_KEY, "sk_test_from_vault");

  // Vault shows where its secret is used.
  const used = (await call(users.viewer, "GET", vault()))
    .json()
    .secrets.find((s: { name: string }) => s.name === "STRIPE_KEY_TEST");
  assert.deepEqual(used.usedBy, [
    { kind: "project", projectId, projectName: "Shop", variable: "STRIPE_KEY" },
  ]);
});

test("a change in Vault reaches every app that uses it, and restarts its preview", async () => {
  const secret = await addSecret("SHARED_TOKEN", "one");
  await call(users.editor, "POST", vars(), { name: "SHARED", vaultName: "SHARED_TOKEN" });
  const before = await server.projectVariables.fingerprint(projectId);

  const stopped: string[] = [];
  const original = server.runtime.stopPreview.bind(server.runtime);
  server.runtime.stopPreview = async (id: string) => {
    stopped.push(id);
    return original(id);
  };
  try {
    await call(users.editor, "PATCH", vault(`/${secret.id}`), { value: "two" });
    assert.ok(stopped.includes(projectId), "the app using it was not restarted");
    stopped.length = 0;
    await call(users.editor, "PATCH", vault(`/${secret.id}`), { description: "only a note" });
    assert.deepEqual(stopped, [], "a new note must not restart anything");
  } finally {
    server.runtime.stopPreview = original;
  }
  assert.equal((await server.projectVariables.environmentFor(projectId)).SHARED, "two");
  assert.notEqual(await server.projectVariables.fingerprint(projectId), before);
});

test("a deleted Vault secret shows as missing and does not reach the app", async () => {
  const secret = await addSecret("SOON_GONE", "x");
  await call(users.editor, "POST", vars(), { name: "SOON", vaultName: "SOON_GONE" });
  await call(users.admin, "DELETE", vault(`/${secret.id}`));
  const variable = (await call(users.viewer, "GET", vars()))
    .json()
    .variables.find((v: { name: string }) => v.name === "SOON");
  assert.equal(variable.missing, true);
  assert.equal("SOON" in (await server.projectVariables.environmentFor(projectId)), false);
});

test("pointing a variable at a Protected secret needs an admin; revealing it too", async () => {
  await addSecret("STRIPE_KEY_LIVE_SHOP", "sk_live_x", { protected: true });
  assert.equal(
    (await call(users.editor, "POST", vars(), { name: "LIVE", vaultName: "STRIPE_KEY_LIVE_SHOP" }))
      .statusCode,
    403,
  );
  const created = await call(users.admin, "POST", vars(), {
    name: "LIVE",
    vaultName: "STRIPE_KEY_LIVE_SHOP",
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().variable.id;
  assert.equal((await call(users.editor, "POST", vars(`/${id}/reveal`))).statusCode, 403);
  assert.equal((await call(users.admin, "POST", vars(`/${id}/reveal`))).json().value, "sk_live_x");
});

test("a project can only use its own team's Vault", async () => {
  await call(users.outsider, "POST", vault("", otherTeamId), { name: "THEIRS", value: "x" });
  const response = await call(users.owner, "POST", vars(), { name: "THEIRS", vaultName: "THEIRS" });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /not in Vault/);
});

test("switching a typed variable to Vault and back restores the typed value", async () => {
  await addSecret("SWITCH_TARGET", "from-vault");
  const created = await call(users.editor, "POST", vars(), { name: "SWITCH", value: "typed" });
  const id = created.json().variable.id;
  await call(users.editor, "PATCH", vars(`/${id}`), { vaultName: "SWITCH_TARGET" });
  assert.equal((await server.projectVariables.environmentFor(projectId)).SWITCH, "from-vault");
  const versions = (await call(users.viewer, "GET", vars(`/${id}/versions`))).json().versions;
  assert.equal(versions[0].version, 1);
  await call(users.editor, "POST", vars(`/${id}/rollback`), { version: 1 });
  assert.equal((await server.projectVariables.environmentFor(projectId)).SWITCH, "typed");
});

test("variable names are refused when Zelyq sets them or the browser would publish them", async () => {
  for (const name of ["VITE_KEY", "DATABASE_URL", "lower"]) {
    assert.equal(
      (await call(users.owner, "POST", vars(), { name, value: "x" })).statusCode,
      400,
      name,
    );
  }
});

test("viewers cannot change variables; outsiders cannot see them", async () => {
  assert.equal(
    (await call(users.viewer, "POST", vars(), { name: "V", value: "x" })).statusCode,
    403,
  );
  assert.equal((await call(users.outsider, "GET", vars())).statusCode, 404);
});

test("the agent sees variable names and missing ones, never a value", async () => {
  const ownerId = (await call(users.owner, "GET", "/api/auth/me")).json().user.id;
  const token = server.previewGrants.mint("ses_agent", projectId, ownerId);
  const response = await server.app.inject({
    method: "GET",
    url: "/api/internal/project-variables/names",
    headers: { "x-zelyq-preview-bridge": token },
  });
  assert.equal(response.statusCode, 200, response.body);
  const names = response.json().variables as { name: string; missing: boolean }[];
  assert.ok(names.some((v) => v.name === "MAIL_TOKEN" && !v.missing));
  assert.ok(names.some((v) => v.name === "SOON" && v.missing));
  assert.ok(!response.body.includes("typed-1") && !response.body.includes("sk_"));

  const outsiderId = (await call(users.outsider, "GET", "/api/auth/me")).json().user.id;
  const stranger = server.previewGrants.mint("ses_stranger", projectId, outsiderId);
  assert.equal(
    (
      await server.app.inject({
        method: "GET",
        url: "/api/internal/project-variables/names",
        headers: { "x-zelyq-preview-bridge": stranger },
      })
    ).statusCode,
    404,
  );
});

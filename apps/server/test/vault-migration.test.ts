import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { backendConfigurationSchema, LOCAL_DEVELOPMENT_DATABASE } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { AccessControl } from "../src/services/access.js";
import { ProjectBackendService } from "../src/services/project-backend.js";
import { ProjectVariableService } from "../src/services/project-variables.js";
import { resolveSecretKey, SecretBox } from "../src/services/secrets.js";
import { VaultService } from "../src/services/vault.js";

/**
 * The upgrade path: secrets saved in a backend configuration before Vault
 * existed must reach the running app exactly as they did, from Vault, after
 * one restart — with no one doing anything.
 */

const tmp = path.join(os.tmpdir(), `zelyq-vault-move-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "move.db")}`,
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
    previewPortRange: [4976, 4979],
    previewHost: "127.0.0.1",
  },
};

/** A runtime whose project declares the Python backend, so it gets a backendEnv. */
const pythonRuntime = {
  kind: "local",
  async readFile(_id: string, file: string) {
    if (file !== "zelyq.runtime.json") throw Object.assign(new Error("nf"), { code: "not_found" });
    return {
      path: file,
      encoding: "utf8",
      content: JSON.stringify({
        version: 1,
        stack: "react-fastapi",
        install: [{ command: "npm ci" }],
        services: [
          { id: "backend", cwd: "backend", argv: ["uv"], healthPath: "/api/health/ready" },
          { id: "frontend", argv: ["npm"], healthPath: "/" },
        ],
        checks: [{ name: "tests", command: "pytest" }],
      }),
    };
  },
  async stopPreview() {
    return { status: "stopped" };
  },
} as unknown as RuntimeDriver;

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function backendFor(server: ZelyqServer, box: SecretBox) {
  const access = new AccessControl(server.store);
  const vault = new VaultService(server.store, box, access);
  const variables = new ProjectVariableService(server.store, box, access, vault, pythonRuntime);
  return {
    variables,
    backend: new ProjectBackendService(server.store, box, pythonRuntime, variables),
  };
}

test("backend secrets saved before Vault move into it on start, and the app sees the same values", async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);

  // --- The instance as it was before Vault -------------------------------
  let server = await buildServer(config);
  const register = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  const cookie = `zelyq_session=${register.cookies.find((c) => c.name === "zelyq_session")?.value}`;
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Old app" },
    })
  ).json().project as { id: string; teamId: string };

  const box = new SecretBox(
    resolveSecretKey({ envKey: undefined, keyFilePath: config.secretKeyFile }),
  );
  const oldShape = (secrets: Record<string, string | null>, revision: string) =>
    box.encrypt(
      JSON.stringify({
        config: { ...backendConfigurationSchema.parse(LOCAL_DEVELOPMENT_DATABASE), secrets },
        revision,
      }),
    );

  // What the app received before the upgrade, computed the old way.
  const before = {
    DATABASE_ENGINE: "sqlite",
    STRIPE_KEY: "sk_old_stripe",
    ALREADY_IN_VAULT: "old-value",
  };
  await server.store.settings.set(
    `project-backend:${project.id}:development`,
    oldShape(
      { STRIPE_KEY: before.STRIPE_KEY, ALREADY_IN_VAULT: "old-value", CLEARED: null },
      "rev-1",
    ),
  );
  await server.store.settings.set(
    `project-backend:${project.id}:production`,
    oldShape({ PROD_ONLY: "prod-value" }, "rev-p"),
  );
  // Someone already set a newer value for one of the names.
  await server.store.vault.variables.create({
    projectId: project.id,
    name: "ALREADY_IN_VAULT",
    source: "direct",
    value: box.encrypt("newer-value"),
    vaultName: null,
    description: null,
    userId: null,
    now: new Date().toISOString(),
  });
  await server.close();

  // --- Upgrade: start the new server -------------------------------------
  server = await buildServer(config);
  await server.app.ready();
  try {
    const { variables, backend } = backendFor(server, box);

    // Development values reached the app before: they are its variables now.
    assert.deepEqual(await variables.environmentFor(project.id), {
      STRIPE_KEY: "sk_old_stripe",
      ALREADY_IN_VAULT: "newer-value",
    });
    // A production value reached nothing: it is kept, Protected, in the team
    // Vault — and the app is not given it.
    const kept = await server.store.vault.list(project.teamId);
    assert.equal(kept.length, 1);
    assert.match(kept[0]?.name ?? "", /^PROD_ONLY__PRODUCTION__/);
    assert.equal(kept[0]?.protected, true);

    // The old configuration no longer holds them…
    for (const environment of ["development", "production"]) {
      const raw = box.decrypt(
        (await server.store.settings.get(`project-backend:${project.id}:${environment}`)) ?? "",
      );
      assert.ok(raw);
      assert.equal("secrets" in JSON.parse(raw).config, false, `${environment} still has secrets`);
    }

    // …and the running app gets what it got before, with Vault's newer value.
    const env = (await backend.previewOptions(project.id)).backendEnv ?? {};
    assert.equal(env.STRIPE_KEY, before.STRIPE_KEY);
    assert.equal(env.DATABASE_ENGINE, before.DATABASE_ENGINE);
    assert.equal(env.ALREADY_IN_VAULT, "newer-value");
    assert.equal("CLEARED" in env, false);

    // One audit entry per environment that moved something, naming no value.
    const entries = (
      await server.app.inject({
        method: "GET",
        url: `/api/teams/${project.teamId}/audit-log`,
        headers: { cookie },
      })
    ).json().entries as { action: string; detail: { names: string[] } }[];
    const moved = entries.filter((entry) => entry.action === "project.variables_migrated");
    assert.equal(moved.length, 2);
    const movedNames = moved.flatMap((entry) => entry.detail.names).sort();
    assert.equal(movedNames.length, 2);
    assert.equal(movedNames[1], "STRIPE_KEY");
    assert.match(movedNames[0] ?? "", /^PROD_ONLY__PRODUCTION__/);
    assert.equal(JSON.stringify(entries).includes("sk_old_stripe"), false);
  } finally {
    await server.close();
  }

  // --- A second start has nothing to move --------------------------------
  server = await buildServer(config);
  await server.app.ready();
  try {
    assert.equal((await server.store.vault.variables.list(project.id)).length, 2);
    assert.equal((await server.store.vault.list(project.teamId)).length, 1);
    const { variables } = backendFor(server, box);
    assert.equal(await variables.moveBackendSecrets({ warn: () => undefined }), 0);
  } finally {
    await server.close();
  }
});

test("a secret not yet moved still reaches the app, and survives a backend save", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-vault-pending-"));
  const url = `file:${dir}/pending.db`;
  await runMigrations(url);
  const server = await buildServer({ ...config, databaseUrl: url, secretKeyFile: `${dir}/k` });
  try {
    const box = new SecretBox(resolveSecretKey({ envKey: undefined, keyFilePath: `${dir}/k` }));
    const { backend } = backendFor(server, box);
    // Written after start, so the move has not seen it — as if it had failed.
    await server.store.settings.set(
      "project-backend:prj_pending:development",
      box.encrypt(
        JSON.stringify({
          config: {
            ...backendConfigurationSchema.parse(LOCAL_DEVELOPMENT_DATABASE),
            secrets: { PENDING: "still-here" },
          },
          revision: "r",
        }),
      ),
    );
    assert.equal((await backend.previewOptions("prj_pending")).backendEnv?.PENDING, "still-here");

    await backend.save("prj_pending", { ...LOCAL_DEVELOPMENT_DATABASE, tables: ["notes"] });
    assert.equal(
      (await backend.previewOptions("prj_pending")).backendEnv?.PENDING,
      "still-here",
      "a save must not lose a secret that has not moved yet",
    );
    assert.equal(JSON.stringify(await backend.get("prj_pending")).includes("still-here"), false);
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

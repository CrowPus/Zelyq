import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createStore, runMigrations } from "@zelyq/db";
import { loadAgentConfig } from "../src/config.js";

/**
 * `previewHost` must reach the agent's own config, not just be stored in
 * the database. Tested against a real, migrated database, not a mock,
 * because the bug this covers was "the real database is never even
 * consulted."
 */
const tmp = path.join(os.tmpdir(), `zelyq-agent-config-${Date.now()}`);
const dbUrl = `file:${path.join(tmp, "config.db")}`;

/** Everything `loadAgentConfig` needs besides what each test sets itself. */
const BASE_ENV = {
  ZELYQ_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "test-key",
};

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(dbUrl);
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** Runs `body` with exactly `env` set, restoring the real environment after. */
async function withEnv<T>(
  env: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const keys = [
    ...new Set([
      ...Object.keys(BASE_ENV),
      ...Object.keys(env),
      "DATABASE_URL",
      "ZELYQ_PREVIEW_HOST",
      "ZELYQ_CONTAINER_EGRESS_ALLOWLIST",
    ]),
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, BASE_ENV, env);
  try {
    return await body();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("a preview host stored in the database reaches the agent's own config", async () => {
  const store = createStore(dbUrl);
  await store.settings.set("previewHost", "10.20.30.40");
  await store.close();

  await withEnv({ DATABASE_URL: dbUrl }, async () => {
    const config = await loadAgentConfig();
    assert.equal(config.runtime.previewHost, "10.20.30.40");
  });
});

test("ZELYQ_PREVIEW_HOST still wins over whatever is stored", async () => {
  const store = createStore(dbUrl);
  await store.settings.set("previewHost", "10.20.30.40");
  await store.close();

  await withEnv({ DATABASE_URL: dbUrl, ZELYQ_PREVIEW_HOST: "192.168.0.1" }, async () => {
    const config = await loadAgentConfig();
    assert.equal(config.runtime.previewHost, "192.168.0.1");
  });
});

test("an unreachable database falls back to the default instead of failing startup", async () => {
  // Mirrors what the shipped docker-compose.yml actually does: the agent
  // starts before the server, which is what runs migrations — so a fresh
  // install can have the agent reach for a database that is not ready yet.
  await withEnv({ DATABASE_URL: `file:${path.join(tmp, "never-migrated.db")}` }, async () => {
    const config = await loadAgentConfig();
    assert.equal(config.runtime.previewHost, "127.0.0.1");
    assert.deepEqual(config.runtime.container.egressAllowlist, undefined);
  });
});

test("a container egress allowlist stored in the database reaches the agent's own config", async () => {
  // The setting someone actually needed live: unblocking a host a project's
  // container needs, without a terminal and a restart command memorised.
  const store = createStore(dbUrl);
  await store.settings.set("containerEgressAllowlist", "crowpus.dev, registry.npmjs.org");
  await store.close();

  await withEnv({ DATABASE_URL: dbUrl }, async () => {
    const config = await loadAgentConfig();
    assert.deepEqual(config.runtime.container.egressAllowlist, [
      "crowpus.dev",
      "registry.npmjs.org",
    ]);
  });
});

test("ZELYQ_CONTAINER_EGRESS_ALLOWLIST still wins over whatever is stored", async () => {
  const store = createStore(dbUrl);
  await store.settings.set("containerEgressAllowlist", "crowpus.dev");
  await store.close();

  await withEnv(
    { DATABASE_URL: dbUrl, ZELYQ_CONTAINER_EGRESS_ALLOWLIST: "github.com" },
    async () => {
      const config = await loadAgentConfig();
      assert.deepEqual(config.runtime.container.egressAllowlist, ["github.com"]);
    },
  );
});

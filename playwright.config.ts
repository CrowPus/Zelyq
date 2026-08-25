import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Layout and behaviour regressions are the one class of bug the unit tests
 * cannot see, and this project has shipped several: a chat panel that spilled
 * under the preview, a delete button on top of a timestamp, a focus ring sliced
 * off by the window. All of them are measurable — boxes either overlap or they
 * do not.
 *
 * These boot their own server, agent and database on their own ports. An
 * earlier version pointed at whatever instance happened to be running, which
 * meant the tests wrote throwaway accounts into a real database and stopped
 * working the moment registration was closed on it. A test suite should not be
 * a guest in somebody's live instance.
 */
const root = path.resolve(import.meta.dirname);
const scratch = path.join(root, ".playwright");

const shared = {
  NODE_ENV: "production",
  DATABASE_URL: `file:${path.join(scratch, "zelyq.db")}`,
  ZELYQ_WORKSPACE_DIR: path.join(scratch, "workspace"),
  ZELYQ_SECRET_KEY_FILE: path.join(scratch, "secret.key"),
  ZELYQ_RUNTIME: "local",
  ZELYQ_ALLOW_REGISTRATION: "true",
  ZELYQ_AGENT_URL: "http://127.0.0.1:8798",
  ZELYQ_AGENT_PORT: "8798",
  ZELYQ_PREVIEW_PORT_MIN: "4500",
  ZELYQ_PREVIEW_PORT_MAX: "4599",
  ZELYQ_PREVIEW_HOST: "127.0.0.1",
  // Pinned explicitly, not left to whatever .env happens to say — found
  // live: a real instance's .env set ZELYQ_SERVER_HOST to its own external
  // IP, which this process can't actually bind() to (that address isn't a
  // local interface, just how the machine is reached from outside), and
  // this suite silently inherited it instead of staying isolated the way
  // the comment above already promises it does.
  ZELYQ_SERVER_HOST: "127.0.0.1",
  ZELYQ_AGENT_HOST: "127.0.0.1",
};

export default defineConfig({
  testDir: "./apps/web/e2e",
  timeout: 15 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8091",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node apps/agent/dist/index.js",
      port: 8798,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      env: shared,
    },
    {
      // Migrations first: a fresh database file has no tables.
      command:
        "pnpm --filter @zelyq/db migrate && ZELYQ_SERVER_PORT=8091 node apps/server/dist/index.js",
      port: 8091,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      env: { ...shared, ZELYQ_WEB_DIR: path.join(root, "apps/web/dist") },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

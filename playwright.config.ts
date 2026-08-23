import { defineConfig, devices } from "@playwright/test";

/**
 * Layout regressions are the one class of bug the unit tests cannot see, and
 * this project has shipped two of them: a chat panel that spilled under the
 * preview, and a delete button sitting on top of a timestamp. Both are
 * measurable — bounding boxes either overlap or they do not.
 *
 * These run against a Zelyq that is already up, because the interesting
 * failures involve real projects and a real agent. Point ZELYQ_E2E_URL at one.
 */
export default defineConfig({
  testDir: "./apps/web/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.ZELYQ_E2E_URL ?? "http://127.0.0.1:8081",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

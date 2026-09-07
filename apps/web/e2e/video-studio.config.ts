import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "video-studio.spec.ts",
  workers: 1,
  timeout: 180000,
  use: {
    baseURL: "http://127.0.0.1:8095",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx apps/server/test/fixtures/video-studio-server.ts",
    cwd: "../../../",
    url: "http://127.0.0.1:8095/api/auth/status",
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

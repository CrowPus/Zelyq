import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The page-quality gate CI runs on every change (the "Page quality" job):
 * accessibility (axe), how the main pages look (screenshots compared with the
 * committed ones) and how fast they load (Lighthouse against budgets).
 *
 * Same isolated server, agent and database as the e2e suite. Screenshots
 * depend on fonts and the browser build, so they are taken and compared in
 * one container image, here and in CI: see scripts/quality.sh.
 */
export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: ["accessibility.spec.ts", "performance.spec.ts", "visual.spec.ts"],
  timeout: 10 * 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: {
    ...base.expect,
    toHaveScreenshot: {
      // A real change moves far more than this; anti-aliasing moves less.
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
});

import fs from "node:fs";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import lighthouse from "lighthouse";

/**
 * How fast the main pages load, measured by Lighthouse the way it measures a
 * mid-range phone on 4G, against the budgets in scripts/perf-budget.json.
 * Each page is measured three times and the middle result counts, because a
 * shared CI machine is not always as fast as itself.
 *
 * A failure names the page, the measure, the result and the budget. The full
 * results are written to test-results/performance.json.
 */

const PASSWORD = "e2e-Passw0rd!23";
const budgets = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "../../../scripts/perf-budget.json"), "utf8"),
) as {
  pages: Record<
    string,
    { js: number; lcp: number; tbt: number; cls: number; accessibility: number }
  >;
};

type Measure = { js: number; lcp: number; tbt: number; cls: number; accessibility: number };
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

test("main pages load within their budgets", async ({ page, baseURL }) => {
  test.setTimeout(10 * 60_000);
  const email = `e2e-perf-${Date.now()}@example.invalid`;
  const registered = await page.request.post("/api/auth/register", {
    data: { email, name: "Pat Perf", password: PASSWORD },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const me = await (await page.request.get("/api/auth/me")).json();
  const team = me.teams[0] as { id: string; slug: string };

  const app = await page.request.post("/api/projects", {
    data: { name: "Speed check", template: "vite-react", teamId: team.id },
  });
  expect(app.status(), await app.text()).toBe(201);
  const appId = (await app.json()).project.id as string;

  const created = await page.request.post(`/api/teams/${team.id}/pipelines`, {
    data: {
      source:
        "name: Speed\nruns-on: local\nstages:\n  - name: Build\n    steps:\n      - run: echo built\n",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const pipelineId = (await created.json()).pipeline.id as string;
  const started = await page.request.post(`/api/teams/${team.id}/pipelines/${pipelineId}/runs`, {
    data: {},
  });
  expect(started.ok(), await started.text()).toBe(true);
  const runId = ((await started.json()).run?.id ?? "") as string;

  const pages: Record<string, string> = {
    home: `/${team.slug}`,
    apps: `/${team.slug}/apps`,
    "app-builder": `/${team.slug}/apps/${appId}`,
    "pipeline-run": `/${team.slug}/pipelines/${pipelineId}/runs/${runId}`,
  };
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  // Lighthouse drives its own Chrome over the debugging port.
  const port = 9300 + Math.floor(Math.random() * 500);
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  const results: Record<string, Measure> = {};
  const problems: string[] = [];
  try {
    for (const [name, route] of Object.entries(pages)) {
      const runs: Measure[] = [];
      for (let i = 0; i < 3; i++) {
        const result = await lighthouse(`${baseURL}${route}`, {
          port,
          output: "json",
          logLevel: "error",
          onlyCategories: ["performance", "accessibility"],
          extraHeaders: { Cookie: cookie },
        });
        if (!result) throw new Error(`Lighthouse returned nothing for ${name}`);
        const { audits, categories } = result.lhr;
        const summary = audits["resource-summary"]?.details as
          | { items?: { resourceType: string; transferSize: number }[] }
          | undefined;
        const scripts = summary?.items?.find((item) => item.resourceType === "script");
        runs.push({
          js: Math.round((scripts?.transferSize ?? 0) / 1024),
          lcp: Math.round(audits["largest-contentful-paint"]?.numericValue ?? 0),
          tbt: Math.round(audits["total-blocking-time"]?.numericValue ?? 0),
          cls: Number((audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
          accessibility: categories.accessibility?.score ?? 0,
        });
      }
      const measured: Measure = {
        js: median(runs.map((r) => r.js)),
        lcp: median(runs.map((r) => r.lcp)),
        tbt: median(runs.map((r) => r.tbt)),
        cls: median(runs.map((r) => r.cls)),
        accessibility: median(runs.map((r) => r.accessibility)),
      };
      results[name] = measured;
      const budget = budgets.pages[name];
      if (!budget) throw new Error(`No budget for ${name} in scripts/perf-budget.json`);
      for (const key of ["js", "lcp", "tbt", "cls"] as const) {
        if (measured[key] > budget[key])
          problems.push(`${name}: ${key} ${measured[key]} is over the budget of ${budget[key]}`);
      }
      if (measured.accessibility < budget.accessibility)
        problems.push(
          `${name}: accessibility ${measured.accessibility} is under ${budget.accessibility}`,
        );
    }
  } finally {
    await browser.close();
  }

  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync("test-results/performance.json", `${JSON.stringify(results, null, 2)}\n`);
  console.table(results);
  expect(problems, problems.join("\n")).toEqual([]);

  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

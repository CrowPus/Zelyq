import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * WCAG 2.2 AA is the floor. Every main page, in both themes and on a phone,
 * must have no serious or critical axe findings. A failure names the rule,
 * the page and the element, so the fix is obvious.
 */

const PASSWORD = "e2e-Passw0rd!23";

async function signUp(page: Page) {
  const email = `e2e-a11y-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    data: { email, name: "E2E Access", password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(201);
  const me = await (await page.request.get("/api/auth/me")).json();
  return me.teams[0] as { id: string; slug: string };
}

async function createProject(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/projects", {
    data: { name, template: "vite-react" },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).project.id;
}

test.afterEach(async ({ page }) => {
  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`no serious accessibility problems · ${theme} · ${width}px`, async ({ page }) => {
      test.setTimeout(5 * 60_000);
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("zelyq.theme", t);
        } catch {
          // The theme falls back to the system's; the check still runs.
        }
      }, theme);
      const team = await signUp(page);
      const app = await createProject(page, "Accessibility check");
      const base = `/${team.slug}`;

      const pages = [
        base,
        `${base}/apps`,
        `${base}/apps/${app}`,
        `${base}/apps/${app}/overview`,
        `${base}/apps/${app}/settings`,
        `${base}/pipelines`,
        `${base}/deployments`,
        `${base}/vault`,
        `${base}/agents`,
        `${base}/members`,
        `${base}/settings`,
        `${base}/studio/image`,
        "/account",
        "/admin",
      ];

      const problems: string[] = [];
      for (const path of pages) {
        await page.goto(path);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        for (const violation of result.violations) {
          if (violation.impact !== "serious" && violation.impact !== "critical") continue;
          for (const node of violation.nodes.slice(0, 3)) {
            problems.push(`${path} · ${violation.id} · ${node.target.join(" ")}`);
          }
        }
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
}

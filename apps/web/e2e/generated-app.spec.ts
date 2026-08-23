import { expect, type Page, test } from "@playwright/test";

/**
 * What the eval suite cannot see.
 *
 * `pnpm eval` proves every module compiles and the dev server answers. Neither
 * says the app renders: a component that throws on mount still returns 200 for
 * its own source, and React swallows the failure into an empty #root. These
 * tests load the preview like a person would and watch for that.
 */
const PASSWORD = "e2e-Passw0rd!23";
test.describe.configure({ mode: "serial" });

async function signUp(page: Page): Promise<void> {
  const email = `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    data: { email, name: "Render", password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test.afterEach(async ({ page }) => {
  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

test("what the agent builds actually renders, without console errors", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await signUp(page);
  const created = await page.request.post("/api/projects", {
    data: { name: "render-check", template: "vite-react" },
  });
  const projectId = (await created.json()).project.id;

  await page.goto(`/projects/${projectId}`);
  await page.getByLabel("Message the agent").fill("add a pricing section with three tiers");
  await page.getByRole("button", { name: "Send message" }).click();

  // The turn is done when the stop control goes away.
  await expect(page.getByRole("button", { name: "Stop the current turn" })).toBeHidden({
    timeout: 12 * 60_000,
  });

  const preview = await page.request
    .post(`/api/projects/${projectId}/preview/start`)
    .then((r) => r.json());
  expect(preview.preview.status, JSON.stringify(preview)).toBe("running");
  const url = preview.preview.url.replace(/^https?:\/\/[^:]+/, "http://127.0.0.1");

  // A second page, loaded exactly as a visitor would load it.
  const errors: string[] = [];
  const viewer = await page.context().newPage();
  viewer.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  viewer.on("pageerror", (error) => errors.push(String(error)));
  await viewer.goto(url, { waitUntil: "networkidle" });

  const root = viewer.locator("#root");
  await expect(root).toBeVisible();

  // React mounts an empty #root when a component throws, so "the page loaded"
  // is not the same as "the app rendered".
  const text = ((await root.textContent()) ?? "").trim();
  expect(text.length, `#root is empty — the app rendered nothing`).toBeGreaterThan(40);
  expect(await root.locator("button").count(), "no interactive controls rendered").toBeGreaterThan(
    0,
  );
  expect(errors, `console errors on load:\n${errors.join("\n")}`).toEqual([]);

  // Nothing should push the page sideways on a phone.
  await viewer.setViewportSize({ width: 390, height: 844 });
  const overflow = await viewer.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls horizontally at 390px").toBeLessThanOrEqual(1);

  await viewer.screenshot({ path: "test-results/generated-app.png", fullPage: true });
  await viewer.close();
});

import { expect, type Page, test } from "@playwright/test";

/**
 * The agent's body, against a real turn.
 *
 * Everything else about this feature is covered by unit tests on the reducer,
 * which is where the logic lives. What they cannot see is the thing that
 * matters: whether the body is actually on screen while the agent works, and
 * whether it moves. A pose that never renders is worth nothing.
 */
const PASSWORD = "e2e-Passw0rd!23";

async function signUp(page: Page): Promise<void> {
  const email = `body-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    data: { email, name: "Body", password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test.afterEach(async ({ page }) => {
  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

test("the body is on screen while the agent works, and it changes", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await signUp(page);
  const created = await page.request.post("/api/projects", {
    data: { name: "body-check", template: "vite-react" },
  });
  const projectId = (await created.json()).project.id;

  await page.goto(`/projects/${projectId}`);
  await page
    .getByLabel("Message the agent")
    .fill("List the files in this project and read package.json. Change nothing.");
  await page.getByRole("button", { name: "Send message" }).click();

  const body = page.locator("svg.agent-body");
  await expect(body).toBeVisible({ timeout: 60_000 });

  // Sample while the turn runs. A body that renders once and then holds one
  // pose for the whole turn is a logo, not a body.
  const stop = page.getByRole("button", { name: "Stop the current turn" });
  const seen = new Set<string>();
  while ((await stop.count()) > 0 && (await stop.isVisible().catch(() => false))) {
    const posture = await body.getAttribute("data-posture").catch(() => null);
    if (posture) seen.add(posture);
    if (seen.size >= 3) break;
    await page.waitForTimeout(120);
  }
  await expect(stop).toBeHidden({ timeout: 12 * 60_000 });

  expect([...seen].join(","), "the body never changed posture during the turn").not.toEqual(
    "thinking",
  );
  expect(seen.size, `only saw ${[...seen].join(", ")}`).toBeGreaterThan(1);

  // And it goes away when the turn does, rather than being left mid-pose.
  await expect(body).toBeHidden();
});

import { expect, type Page, test } from "@playwright/test";

/**
 * The transcript should follow the agent while it works — and stop following
 * the moment the reader scrolls up to look at something.
 */
const PASSWORD = "e2e-Passw0rd!23";
test.describe.configure({ mode: "serial" });

async function start(page: Page): Promise<string> {
  const email = `scroll-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  await page.request.post("/api/auth/register", {
    data: { email, name: "Scroll", password: PASSWORD },
  });
  const created = await page.request.post("/api/projects", {
    data: { name: "scrolling", template: "vite-react" },
  });
  return (await created.json()).project.id;
}

const distanceFromBottom = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("section .overflow-y-auto");
    if (!scroller) return -1;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  });

test.afterEach(async ({ page }) => {
  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

test("the transcript follows the agent while it works", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const projectId = await start(page);
  await page.goto(`/projects/${projectId}`);

  await page.getByLabel("Message the agent").fill("add a pricing section with three tiers");
  await page.getByRole("button", { name: "Send message" }).click();

  // Sampled all the way through, not once: the failure is a stretch where tool
  // calls pile up and nothing scrolls, and a single reading lands wherever it
  // happens to land.
  const busy = page.getByRole("button", { name: "Stop the current turn" });
  await expect(page.getByText("list_files").first()).toBeVisible({ timeout: 3 * 60_000 });

  let worst = 0;
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    if (!(await busy.isVisible().catch(() => false))) break;
    worst = Math.max(worst, await distanceFromBottom(page));
    await page.waitForTimeout(400);
  }

  await expect(busy).toBeHidden({ timeout: 12 * 60_000 });
  expect(worst, `fell ${Math.round(worst)}px behind at some point during the turn`).toBeLessThan(
    150,
  );

  // The last thing a finished turn renders is its footer, which arrives a frame
  // after the turn ends. Reading the position once, right then, measures the gap
  // before it closes rather than whether it closes.
  await expect
    .poll(() => distanceFromBottom(page), {
      timeout: 5000,
      message: "did not settle at the bottom after the turn ended",
    })
    .toBeLessThan(150);
});

test("scrolling up to read stops it dragging you back", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const projectId = await start(page);
  await page.goto(`/projects/${projectId}`);

  await page.getByLabel("Message the agent").fill("add a pricing section with three tiers");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("list_files").first()).toBeVisible({ timeout: 3 * 60_000 });

  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("section .overflow-y-auto");
    if (scroller) scroller.scrollTop = 0;
  });
  await page.waitForTimeout(3000);

  expect(
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>("section .overflow-y-auto");
      return scroller?.scrollTop ?? -1;
    }),
    "it dragged the reader back to the bottom",
  ).toBeLessThan(120);
});

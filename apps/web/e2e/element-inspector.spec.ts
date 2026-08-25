import { expect, type Page, test } from "@playwright/test";

/**
 * Click something in the running preview, and the agent finds out what you
 * clicked — see `038` in the council notes. The unit tests already cover
 * the pure message-parsing and text-rendering logic
 * (`apps/web/test/inspector.test.ts`); what only a real browser can prove
 * is the actual cross-origin bridge — the bit that broke silently would be
 * easy to write and hard to notice was broken without loading a real
 * preview and actually clicking into it.
 */
const PASSWORD = "e2e-Passw0rd!23";
const HEADING_MARKUP = /<h1[^>]*>Your app starts here\.<\/h1>/;
test.describe.configure({ mode: "serial" });

async function signUp(page: Page): Promise<void> {
  const email = `inspector-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    data: { email, name: "Inspector", password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(201);
}

async function createAndOpenProject(page: Page, name: string): Promise<void> {
  const created = await page.request.post("/api/projects", {
    data: { name, template: "vite-react" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const projectId = (await created.json()).project.id;
  await page.goto(`/projects/${projectId}`);
}

/**
 * Waits for a real dev server: dependency install plus Vite's own cold
 * start. Returns the composer's own chip-remove button — its presence *is*
 * the chip; scoping to it instead of matching the chip's text avoids
 * colliding with the same text once it also appears in a sent message.
 */
async function startPreviewAndSelectHeading(page: Page) {
  await page.getByRole("button", { name: "Start preview" }).first().click();

  const inspectButton = page.getByRole("button", { name: "Point at something in the preview" });
  await expect(inspectButton).toBeVisible({ timeout: 3 * 60_000 });

  const frame = page.frameLocator('iframe[title="Project preview"]');
  await expect(frame.locator("h1")).toBeVisible({ timeout: 30_000 });

  await inspectButton.click();
  await frame.locator("h1").click();

  return {
    inspectButton,
    chipButton: page.getByRole("button", { name: "Stop pointing at this" }),
  };
}

test.afterEach(async ({ page }) => {
  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

test("clicking an element in the preview points the composer at it, and sending includes it", async ({
  page,
}) => {
  test.setTimeout(5 * 60_000);
  await signUp(page);
  await createAndOpenProject(page, "inspector-test");
  const { inspectButton, chipButton } = await startPreviewAndSelectHeading(page);

  // The chip: proof the bridge script's click, this test's own postMessage,
  // and the parent's event.source check all actually worked end to end.
  await expect(chipButton).toBeVisible();
  const composer = page.locator("form");
  await expect(composer).toContainText(HEADING_MARKUP);

  // Toggling back off is a real control, not just decoration.
  await expect(inspectButton).not.toHaveClass(/bg-surface-active/);

  await page.getByLabel("Message the agent").fill("make this smaller");
  await page.getByRole("button", { name: "Send message" }).click();

  // The local echo appears immediately, before any turn completes — proof
  // of what was actually sent, without needing a live model call.
  const transcript = page.locator("main");
  await expect(transcript).toContainText(
    /Regarding <h1[^>]*>Your app starts here\.<\/h1> in the preview:/,
  );
  await expect(transcript).toContainText("make this smaller");

  // The chip clears once sent — nothing left pointing at a stale element.
  await expect(chipButton).toBeHidden();
});

test("the remove button clears a pointed element without sending anything", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await signUp(page);
  await createAndOpenProject(page, "inspector-clear-test");
  const { chipButton } = await startPreviewAndSelectHeading(page);

  await expect(chipButton).toBeVisible();
  await expect(page.locator("form")).toContainText(HEADING_MARKUP);

  await chipButton.click();
  await expect(chipButton).toBeHidden();

  // Nothing shows up in the transcript from a selection that was cleared.
  await expect(page.locator("main")).not.toContainText(/Regarding <h1/);
});

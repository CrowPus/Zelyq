import { expect, type Page, test } from "@playwright/test";

/**
 * A `/` command has to work where the `/` menu offered it.
 *
 * The menu opens wherever `/` follows a space, so it offered `/clone`
 * mid-sentence — and the submit path, which required the command to open the
 * message, then ignored it. The user saw the menu, picked the command, sent,
 * and nothing happened. There was also no chip, so a picked command looked
 * exactly like text somebody had typed.
 */
const PASSWORD = "e2e-Passw0rd!23";

async function signUp(page: Page): Promise<void> {
  const email = `slash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    data: { email, name: "Slash", password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test.afterEach(async ({ page }) => {
  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

test("a command picked mid-sentence arms, and says so", async ({ page }) => {
  await signUp(page);
  const created = await page.request.post("/api/projects", {
    data: { name: "slash-check", template: "vite-react" },
  });
  const projectId = (await created.json()).project.id;
  await page.goto(`/projects/${projectId}`);

  const box = page.getByLabel("Message the agent");

  // Half typed, at the start: the command is picked but the URL is missing.
  await box.fill("/clone ");
  await expect(page.getByText("add a URL")).toBeVisible();

  // Armed, and naming the site it will actually hit.
  await box.fill("/clone https://www.noth.in/");
  await expect(page.getByText("clone noth.in")).toBeVisible();
  await expect(page.getByText("add a URL")).toBeHidden();

  // The case that was broken: the command in the middle of a sentence.
  await box.fill("i think we should now /clone https://www.noth.in/ starting with the hero");
  await expect(
    page.getByText("clone noth.in"),
    "a command picked mid-sentence has to arm — the menu offered it there",
  ).toBeVisible();

  // And talking *about* the command still arms nothing.
  await box.fill("the /clone is not working for me");
  await expect(page.getByText("clone noth.in")).toBeHidden();
  await expect(page.getByText("add a URL")).toBeHidden();
});

test("the chip cancels the command without clearing the message", async ({ page }) => {
  await signUp(page);
  const created = await page.request.post("/api/projects", {
    data: { name: "slash-cancel", template: "vite-react" },
  });
  const projectId = (await created.json()).project.id;
  await page.goto(`/projects/${projectId}`);

  const box = page.getByLabel("Message the agent");
  await box.fill("please /clone https://example.com and keep the copy");
  await expect(page.getByText("clone example.com")).toBeVisible();

  await page.getByRole("button", { name: /Cancel the clone/ }).click();
  await expect(page.getByText("clone example.com")).toBeHidden();
  await expect(box).toHaveValue("please https://example.com and keep the copy");
});

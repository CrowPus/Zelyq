import { expect, type Page, test } from "@playwright/test";

/**
 * Creating a project from a repository, through the screen.
 *
 * The endpoint has existed since it was merged; nothing on screen reached it,
 * which is the fifth time on this project that a capability was finished
 * everywhere except the one place a person could use it.
 */
const PASSWORD = "e2e-Passw0rd!23";
test.describe.configure({ mode: "serial" });

async function signUp(page: Page): Promise<void> {
  const email = `clone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    data: { email, name: "Clone", password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test.afterEach(async ({ page }) => {
  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

test("a project can be started from a repository address", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await signUp(page);
  await page.goto("/");

  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill("from-a-repo");
  await page.getByLabel("Repository URL").fill("https://github.com/octocat/Hello-World.git");
  await page.getByRole("button", { name: "Create" }).click();

  // Lands in the editor, on the repository's own files rather than a template.
  await expect(page.getByLabel("Message the agent")).toBeVisible({ timeout: 3 * 60_000 });
  await page.getByRole("button", { name: "Code" }).click();
  await expect(page.getByText("README", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("App.tsx", { exact: false })).toHaveCount(0);
});

test("leaving the address empty still starts a new app", async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await signUp(page);
  await page.goto("/");

  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill("blank-one");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByLabel("Message the agent")).toBeVisible({ timeout: 2 * 60_000 });
  await page.getByRole("button", { name: "Code" }).click();
  await expect(page.getByText("App.tsx", { exact: false }).first()).toBeVisible();
});

test("the token field appears only when a repository address is given", async ({ page }) => {
  await signUp(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).first().click();

  // Nothing to authenticate against until there is an address.
  await expect(page.getByLabel("Repository access token")).toHaveCount(0);

  await page.getByLabel("Repository URL").fill("https://example.com/owner/repo.git");
  const token = page.getByLabel("Repository access token");
  await expect(token).toBeVisible();
  await expect(token).toHaveAttribute("type", "password");

  // The promise made next to the field, because it is the reason somebody
  // is willing to paste a credential at all.
  await expect(page.getByText(/read-only token is enough/i)).toBeVisible();
  await expect(page.getByText(/used once and never stored/i)).toBeVisible();
});

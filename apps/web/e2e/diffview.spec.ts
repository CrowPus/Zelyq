import { expect, type Page, test } from "@playwright/test";

/**
 * Seeing what a turn changed. A list of filenames says a file was touched; it
 * does not say whether a word changed or the component was replaced, and that
 * is the only question worth asking before undoing anything.
 */
const PASSWORD = "e2e-Passw0rd!23";
test.describe.configure({ mode: "serial" });

async function signUp(page: Page): Promise<void> {
  const email = `diff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    data: { email, name: "Diff", password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test.afterEach(async ({ page }) => {
  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

test("clicking a changed file shows the lines added and removed", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await signUp(page);
  const created = await page.request.post("/api/projects", {
    data: { name: "diff-me", template: "vite-react" },
  });
  const projectId = (await created.json()).project.id;

  await page.goto(`/projects/${projectId}`);
  await page.getByLabel("Message the agent").fill("change the heading to Diff Test Heading");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Stop the current turn" })).toBeHidden({
    timeout: 12 * 60_000,
  });

  // The filenames in the transcript are the way in.
  const fileLink = page.getByRole("button", { name: /^src\// }).first();
  await expect(fileLink).toBeVisible();
  await fileLink.click();

  // Counts, and colour-coded lines with a marker in the margin.
  await expect(page.getByText(/\+\d+ added/)).toBeVisible();
  await expect(page.getByText(/−\d+ removed/)).toBeVisible();
  await expect(page.getByText("Diff Test Heading").first()).toBeVisible();

  // Long code lines must scroll inside the pane, not shove the page sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the diff pushed the page sideways").toBeLessThanOrEqual(1);

  // And a way back to the plain file.
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByText(/\+\d+ added/)).toBeHidden();
});

test("opening a file from the tree shows the file, not a diff", async ({ page }) => {
  await signUp(page);
  const created = await page.request.post("/api/projects", {
    data: { name: "tree-open", template: "vite-react" },
  });
  const projectId = (await created.json()).project.id;

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Code" }).click();
  await page.getByText("App.tsx", { exact: false }).first().click();

  await expect(page.getByLabel("Edit src/App.tsx")).toBeVisible();
  await expect(page.getByText(/\+\d+ added/)).toHaveCount(0);
});

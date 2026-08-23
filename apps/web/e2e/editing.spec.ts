import { expect, type Page, test } from "@playwright/test";

/**
 * Editing files from the browser. Read-only files were the single thing
 * standing between "watch an agent work" and "work on it yourself", so this
 * covers the whole path: open, change, save, and read it back from the API.
 */
const PASSWORD = "e2e-Passw0rd!23";
test.describe.configure({ mode: "serial" });

async function signUp(page: Page, tag: string): Promise<string> {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    data: { email, name: tag, password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(201);
  return email;
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

test("an editor can change a file in the browser and it lands on disk", async ({ page }) => {
  await signUp(page, "edit");
  const projectId = await createProject(page, "edit-me");

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Code" }).click();
  await page.getByText("App.tsx", { exact: false }).first().click();

  const editor = page.getByLabel("Edit src/App.tsx");
  await expect(editor).toBeVisible();

  const marker = `edited-in-browser-${Date.now()}`;
  await editor.fill(`// ${marker}\n${await editor.inputValue()}`);

  // Unsaved work is announced before it is saved, and only then.
  await expect(page.getByText("unsaved")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("unsaved")).toBeHidden();

  // The claim that matters: it reached the file, not just the textarea.
  const onDisk = await page.request
    .get(`/api/projects/${projectId}/files/src/App.tsx`)
    .then((r) => r.json());
  expect(onDisk.content).toContain(marker);
});

test("cmd+s saves without reaching for the button", async ({ page }) => {
  await signUp(page, "shortcut");
  const projectId = await createProject(page, "shortcut");

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Code" }).click();
  await page.getByText("App.tsx", { exact: false }).first().click();

  const editor = page.getByLabel("Edit src/App.tsx");
  await expect(editor).toBeVisible();
  const marker = `saved-by-keyboard-${Date.now()}`;
  await editor.fill(`// ${marker}\n${await editor.inputValue()}`);
  await editor.press("ControlOrMeta+s");

  await expect(page.getByText("unsaved")).toBeHidden();
  const onDisk = await page.request
    .get(`/api/projects/${projectId}/files/src/App.tsx`)
    .then((r) => r.json());
  expect(onDisk.content).toContain(marker);
});

test("a viewer is offered no way to edit", async ({ page, browser }) => {
  const ownerEmail = await signUp(page, "owner");
  expect(ownerEmail).toBeTruthy();
  const projectId = await createProject(page, "read-only");
  const teamId = await page.request
    .get("/api/teams")
    .then(async (r) => (await r.json()).teams[0].id);

  // A second browser context, so the two sessions do not share a cookie jar.
  const guest = await browser.newContext({ baseURL: page.context()._options?.baseURL });
  const guestPage = await guest.newPage();
  const guestEmail = await signUp(guestPage, "guest");
  await page.request.post(`/api/teams/${teamId}/members`, {
    data: { email: guestEmail, role: "viewer" },
  });

  await guestPage.goto(`/projects/${projectId}`);
  await guestPage.getByRole("button", { name: "Code" }).click();
  await guestPage.getByText("App.tsx", { exact: false }).first().click();

  await expect(guestPage.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(guestPage.getByLabel("Edit src/App.tsx")).toHaveCount(0);

  // And the server refuses even if the UI is bypassed.
  const refused = await guestPage.request.put(`/api/projects/${projectId}/files/src/App.tsx`, {
    data: { content: "// sneaked in" },
  });
  expect(refused.status()).toBe(403);

  await guestPage.request.delete("/api/auth/me", { data: { password: PASSWORD } });
  await guest.close();
});

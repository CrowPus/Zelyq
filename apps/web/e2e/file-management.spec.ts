import { expect, type Page, test } from "@playwright/test";

/**
 * Creating and deleting files from the browser file tree. Editing was already
 * covered; this is the other half — a "New file" / "New folder" control in the
 * tree header and a per-row delete. The claim that matters each time is that
 * the change reached disk (or left it), not just that the tree re-rendered.
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

test("an editor can create a file from the tree and it lands on disk", async ({ page }) => {
  await signUp(page, "create-file");
  const projectId = await createProject(page, "create-file");

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Code" }).click();
  await expect(page.getByText("App.tsx", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "New file" }).click();
  const input = page.getByPlaceholder("path/to/new-file.tsx");
  await expect(input).toBeFocused();
  await input.fill("src/components/Badge.tsx");
  await input.press("Enter");

  // It shows in the tree as a new row.
  await expect(page.getByRole("button", { name: "Badge.tsx", exact: true })).toBeVisible();

  const onDisk = await page.request.get(
    `/api/projects/${projectId}/files/src/components/Badge.tsx`,
  );
  expect(onDisk.status()).toBe(200);
  expect((await onDisk.json()).content).toBe("");
});

test("an editor can create a folder and it exists on disk", async ({ page }) => {
  await signUp(page, "create-folder");
  const projectId = await createProject(page, "create-folder");

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Code" }).click();
  await expect(page.getByText("App.tsx", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "New folder" }).click();
  const input = page.getByPlaceholder("path/to/new-folder");
  await input.fill("src/lib");
  await input.press("Enter");

  // A folder is an empty `.gitkeep` under it.
  const keep = await page.request.get(`/api/projects/${projectId}/files/src/lib/.gitkeep`);
  expect(keep.status()).toBe(200);

  const listing = await page.request.get(`/api/projects/${projectId}/files`).then((r) => r.json());
  expect((listing.entries as { path: string }[]).some((e) => e.path === "src/lib")).toBe(true);
});

test("an editor can delete a file from the tree", async ({ page }) => {
  await signUp(page, "delete-file");
  const projectId = await createProject(page, "delete-file");

  // Seed a file to remove.
  await page.request.put(`/api/projects/${projectId}/files/src/Doomed.tsx`, {
    data: { content: "// bye" },
  });

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Code" }).click();
  const row = page.getByRole("button", { name: "Doomed.tsx", exact: true });
  await expect(row).toBeVisible();

  // The delete guard is a window.confirm.
  page.on("dialog", (dialog) => dialog.accept());
  await row.hover();
  await page.getByRole("button", { name: "Delete Doomed.tsx" }).click();

  await expect(page.getByRole("button", { name: "Doomed.tsx", exact: true })).toHaveCount(0);
  const gone = await page.request.get(`/api/projects/${projectId}/files/src/Doomed.tsx`);
  expect(gone.status()).toBe(404);
});

test("a viewer is offered no create or delete controls", async ({ page, browser, baseURL }) => {
  await signUp(page, "fm-owner");
  const projectId = await createProject(page, "fm-read-only");
  const teamId = await page.request
    .get("/api/teams")
    .then(async (r) => (await r.json()).teams[0].id);

  const guest = await browser.newContext({ baseURL });
  const guestPage = await guest.newPage();
  const guestEmail = await signUp(guestPage, "fm-guest");
  await page.request.post(`/api/teams/${teamId}/members`, {
    data: { email: guestEmail, role: "viewer" },
  });

  await guestPage.goto(`/projects/${projectId}`);
  await guestPage.getByRole("button", { name: "Code" }).click();
  await expect(guestPage.getByText("App.tsx", { exact: false }).first()).toBeVisible();

  await expect(guestPage.getByRole("button", { name: "New file" })).toHaveCount(0);
  await expect(guestPage.getByRole("button", { name: "New folder" })).toHaveCount(0);

  // And the server refuses a delete even if the UI is bypassed.
  const refused = await guestPage.request.delete(`/api/projects/${projectId}/files/src/App.tsx`);
  expect(refused.status()).toBe(403);

  await guestPage.request.delete("/api/auth/me", { data: { password: PASSWORD } });
  await guest.close();
});

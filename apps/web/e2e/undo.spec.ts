import { expect, type Page, test } from "@playwright/test";

/**
 * Undoing a turn. The whole point is that when the agent does something you did
 * not want, it costs a click rather than an afternoon — so this drives a real
 * turn, then puts the project back and checks the files on disk really moved.
 */
const PASSWORD = "e2e-Passw0rd!23";
test.describe.configure({ mode: "serial" });

async function signUp(page: Page): Promise<void> {
  const email = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    data: { email, name: "Undo", password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test.afterEach(async ({ page }) => {
  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

test("a turn can be undone and the files really go back", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await signUp(page);
  const created = await page.request.post("/api/projects", {
    data: { name: "undo-me", template: "vite-react" },
  });
  const projectId = (await created.json()).project.id;

  const readApp = async (): Promise<string> =>
    (await (await page.request.get(`/api/projects/${projectId}/files/src/App.tsx`)).json()).content;

  const before = await readApp();
  expect(before).toContain("Your app starts here");

  await page.goto(`/projects/${projectId}`);
  await page.getByLabel("Message the agent").fill("change the heading to Undo Test Heading");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Stop the current turn" })).toBeHidden({
    timeout: 12 * 60_000,
  });

  // The turn really changed the file, otherwise undo proves nothing.
  const after = await readApp();
  expect(after, "the agent did not change App.tsx, so there is nothing to undo").not.toEqual(
    before,
  );

  // The transcript says what it touched, and offers a way back.
  await expect(page.getByText(/file(s)? changed/).first()).toBeVisible();
  await page.getByRole("button", { name: "Undo this turn" }).first().click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();

  await expect
    .poll(readApp, { timeout: 30_000, message: "App.tsx did not go back to its original contents" })
    .toEqual(before);
});

test("a viewer is not offered a way to undo", async ({ page, browser, baseURL }) => {
  await signUp(page);
  const created = await page.request.post("/api/projects", {
    data: { name: "undo-readonly", template: "vite-react" },
  });
  const projectId = (await created.json()).project.id;
  const teamId = (await (await page.request.get("/api/teams")).json()).teams[0].id;

  // Take the base URL from the runner rather than hardcoding a port: an earlier
  // version pointed at whatever instance happened to be running locally.
  const guest = await browser.newContext({ baseURL });
  const guestPage = await guest.newPage();
  const guestEmail = `undo-guest-${Date.now()}@example.invalid`;
  await guestPage.request.post("/api/auth/register", {
    data: { email: guestEmail, name: "guest", password: PASSWORD },
  });
  await page.request.post(`/api/teams/${teamId}/members`, {
    data: { email: guestEmail, role: "viewer" },
  });

  await guestPage.goto(`/projects/${projectId}`);
  await expect(guestPage.getByLabel("Message the agent")).toBeVisible();
  await expect(guestPage.getByRole("button", { name: "Undo this turn" })).toHaveCount(0);

  await guestPage.request.delete("/api/auth/me", { data: { password: PASSWORD } });
  await guest.close();
});

import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "e2e-Passw0rd!23";

/** A throwaway account per run: its own team, so it can never see real data. */
async function signUp(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    data: { email, name: "E2E", password: PASSWORD },
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
  // Take the account with us; the team, its projects and their files go too.
  await page.request
    .delete("/api/auth/me", { data: { password: PASSWORD } })
    .catch(() => undefined);
});

test("the delete control never sits on top of the timestamp", async ({ page }) => {
  await signUp(page);
  await createProject(page, "layout-delete");

  await page.goto("/");
  const row = page.locator("li", { hasText: "layout-delete" }).first();
  await expect(row).toBeVisible();

  const trash = row.getByRole("button", { name: /^Delete layout-delete$/ });
  const stamp = row.locator("time");
  await expect(trash).toBeVisible();
  await expect(stamp).toBeVisible();

  const [button, time] = [await trash.boundingBox(), await stamp.boundingBox()];
  expect(button).not.toBeNull();
  expect(time).not.toBeNull();
  if (!button || !time) return;

  // The whole bug in one assertion: the timestamp must end before the
  // delete control begins.
  expect(
    time.x + time.width,
    `timestamp ends at ${time.x + time.width}, delete starts at ${button.x}`,
  ).toBeLessThanOrEqual(button.x + 0.5);
});

test("the chat panel never spills under the preview", async ({ page }) => {
  await signUp(page);
  const projectId = await createProject(page, "layout-overflow");

  await page.goto(`/projects/${projectId}`);
  const composer = page.getByLabel("Message the agent");
  await expect(composer).toBeVisible();

  // The overflow only appears once the transcript holds something wide — tool
  // rows carry a monospace name and a duration that cannot shrink. An empty
  // project cannot reproduce it, which is why the first version of this test
  // passed against the bug it was written for.
  // A path long enough to have a min-content width of its own. The transcript
  // has to actually contain something wide: an empty project cannot reproduce
  // this, which is why the first version of this test passed against the bug.
  const longPath = "src/components/dashboard/AnalyticsOverviewPanelContainer.stories.tsx";
  await composer.fill(longPath);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(longPath, { exact: false }).first()).toBeVisible();

  // The grid item is sized correctly by the track; it is the section inside it
  // that used to overflow, spilling under the preview. Measure the section.
  const fit = await composer.evaluate((node) => {
    const section = node.closest("section");
    const item = section?.parentElement;
    if (!section || !item) return null;
    return {
      section: section.getBoundingClientRect().width,
      column: item.getBoundingClientRect().width,
    };
  });

  expect(fit).not.toBeNull();
  if (!fit) return;
  expect(
    fit.section,
    `chat panel renders ${fit.section}px inside a ${fit.column}px column — it spills under the preview`,
  ).toBeLessThanOrEqual(fit.column + 0.5);
});

test("a long message does not move the send button", async ({ page }) => {
  await signUp(page);
  const projectId = await createProject(page, "layout-growth");

  await page.goto(`/projects/${projectId}`);
  const composer = page.getByLabel("Message the agent");
  const send = page.getByRole("button", { name: "Send message" });
  await expect(composer).toBeVisible();

  const before = await send.boundingBox();
  await composer.fill("word ".repeat(120));
  const after = await send.boundingBox();

  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  if (!before || !after) return;
  expect(Math.abs(after.y - before.y), "the send button moved vertically").toBeLessThanOrEqual(1);
  expect(Math.abs(after.x - before.x), "the send button moved horizontally").toBeLessThanOrEqual(1);
});

test("the editor's focus ring is not clipped by the window", async ({ page }) => {
  // Reported from a screenshot: the editor fills its pane to the window edge,
  // and the global focus ring is drawn 1px *outside* the element, so the
  // viewport sliced it and it read as a box cut in half.
  await page.setViewportSize({ width: 1512, height: 901 });
  await signUp(page);
  const projectId = await createProject(page, "focus-ring");

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Code" }).click();
  await page.getByText("index.html", { exact: false }).first().click();

  const editor = page.getByLabel("Edit index.html");
  await expect(editor).toBeVisible();
  await editor.click();

  const ring = await editor.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const offset = Number.parseFloat(style.outlineOffset) || 0;
    const width = Number.parseFloat(style.outlineWidth) || 0;
    return {
      right: box.right + offset + width,
      bottom: box.bottom + offset + width,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  expect(ring.right, "the focus ring runs off the right of the window").toBeLessThanOrEqual(
    ring.viewportWidth + 0.5,
  );
  expect(ring.bottom, "the focus ring runs off the bottom of the window").toBeLessThanOrEqual(
    ring.viewportHeight + 0.5,
  );
});

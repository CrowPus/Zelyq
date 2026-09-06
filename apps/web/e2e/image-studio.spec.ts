import { expect, test } from "@playwright/test";
import { imageFixture } from "../../server/test/helpers/image-fixture";

test("Studio generates, survives refresh, downloads, and deletes without a project", async ({
  page,
}) => {
  const registered = await page.request.post("/api/auth/register", {
    data: {
      email: `image-${Date.now()}@example.com`,
      name: "Image maker",
      password: "correct-horse-battery",
    },
  });
  expect(registered.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("link", { name: "Image Studio", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Image Studio." })).toBeVisible();
  await page.getByRole("link", { name: "Image generation settings", exact: true }).click();
  const settings = page.getByRole("region", { name: "Image generation settings", exact: true });
  await expect(
    settings.getByRole("heading", { name: "Image generation", exact: true }),
  ).toBeVisible();
  await settings
    .getByLabel("Google image API key", { exact: true })
    .fill("google-browser-test-key");
  await settings.getByLabel("xAI image API key", { exact: true }).fill("xai-browser-test-key");
  await settings.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(settings.getByRole("status")).toHaveText("Saved");
  await page.screenshot({ path: "/tmp/zelyq-image-settings.png", fullPage: true });
  await settings.getByRole("link", { name: "Open Image Studio", exact: true }).click();
  await page.screenshot({ path: "/tmp/zelyq-image-studio-empty.png", fullPage: true });
  await page
    .getByLabel("Your imagination, in words")
    .fill("A warm abstract composition for the Studio test");
  await page.getByRole("button", { name: "3:2", exact: true }).click();
  await page.getByRole("button", { name: "Generate image", exact: true }).click();
  await expect(page).toHaveURL(/image=img_/);
  await page.reload();
  const preview = page.getByRole("region", { name: "Image preview" });
  await expect(preview.getByRole("link", { name: "Download PNG" })).toBeVisible({ timeout: 15000 });
  await expect(preview.locator("img")).toHaveJSProperty("naturalWidth", 1536);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    preview.getByRole("link", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await preview.getByRole("button", { name: "Use prompt" }).click();
  await expect(page.getByLabel("Your imagination, in words")).toHaveValue(
    "A warm abstract composition for the Studio test",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/zelyq-image-studio-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole("link", { name: "Image Studio", exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Delete generation", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Your first image is waiting to happen.")).toBeVisible();
  await page.getByLabel("Image provider", { exact: true }).selectOption("openai");
  await page.getByLabel("Reference images", { exact: true }).setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: imageFixture(),
  });
  await expect(page.getByText("1/3")).toBeVisible();
  await page.getByRole("button", { name: "Generate image", exact: true }).click();
  await expect(preview.getByRole("link", { name: "Download PNG" })).toBeVisible({
    timeout: 15000,
  });
  await expect(preview.getByText("1 reference")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Remove reference", exact: true }).click();
  for (const provider of ["google", "xai"]) {
    await page.getByLabel("Image provider", { exact: true }).selectOption(provider);
    if (provider === "google")
      await expect(page.getByRole("combobox", { name: "Quality", exact: true })).toBeDisabled();
    else {
      await expect(page.getByRole("combobox", { name: "Quality", exact: true })).toBeEnabled();
      await expect(
        page.getByRole("combobox", { name: "Quality", exact: true }).locator("option"),
      ).toHaveCount(2);
    }
    const previousUrl = page.url();
    await page.getByRole("button", { name: "Generate image", exact: true }).click();
    await expect(page).not.toHaveURL(previousUrl);
    await expect(preview.getByRole("link", { name: "Download PNG" })).toBeVisible({
      timeout: 15000,
    });
    await expect(preview.locator("img")).toHaveJSProperty(
      "naturalWidth",
      provider === "google" ? 1248 : 1024,
    );
    const png = await page.request.get(
      (await preview.getByRole("link", { name: "Download PNG" }).getAttribute("href")) ?? "",
    );
    expect(png.headers()["content-type"]).toContain("image/png");
    expect((await png.body()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }
  const projects = await page.request.get("/api/projects");
  expect((await projects.json()).projects).toHaveLength(0);
});

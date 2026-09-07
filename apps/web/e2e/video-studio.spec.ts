import { expect, test } from "@playwright/test";
import { largeImageFixture } from "../../server/test/helpers/image-fixture";

test("standalone video settings, both providers, references, refresh, playback, seeking and deletion", async ({
  page,
}) => {
  const registered = await page.request.post("/api/auth/register", {
    data: {
      email: `video-${Date.now()}@example.com`,
      name: "Video maker",
      password: "correct-horse-battery",
    },
  });
  expect(registered.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("link", { name: "Video Studio", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Video Studio", exact: true })).toBeVisible();
  // AppShell's <main> is overflow-hidden on purpose: a page that forgets its own
  // scroll container renders with everything below the fold clipped and no way
  // to reach it. Shipped exactly that way once — assert the page actually
  // scrolls and that the library at the very bottom is reachable.
  await page.setViewportSize({ width: 1280, height: 720 });
  const scroll = await page.evaluate(() => {
    const scroller = document.querySelector("main")!.firstElementChild as HTMLElement;
    return {
      canScroll: scroller.scrollHeight > scroller.clientHeight + 1,
      overflowsX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(scroll.canScroll, "Video Studio must scroll; its content is taller than the pane").toBe(
    true,
  );
  expect(scroll.overflowsX, "Video Studio must not scroll horizontally").toBe(false);
  await page.evaluate(() => {
    const scroller = document.querySelector("main")!.firstElementChild as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
  });
  await expect(page.getByRole("heading", { name: "Your films", exact: true })).toBeInViewport();

  await page.getByRole("link", { name: "Video settings" }).click();
  const settings = page.getByRole("region", { name: "Video generation settings" });
  await settings
    .getByLabel("Google video API key", { exact: true })
    .fill("google-browser-test-key");
  await settings.getByLabel("xAI video API key", { exact: true }).fill("xai-browser-test-key");
  await settings.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(settings.getByRole("status")).toHaveText("Saved");
  await settings.getByRole("link", { name: "Open Video Studio" }).click();
  await page.screenshot({ path: "/tmp/zelyq-video-studio-empty.png", fullPage: true });
  const preview = page.getByRole("region", { name: "Video preview" });
  for (const provider of ["google", "xai"] as const) {
    await page.getByLabel("Video model", { exact: true }).selectOption(provider);
    await page
      .getByLabel("Video prompt", { exact: true })
      .fill(`A ceramic vase in gentle motion, ${provider} test`);
    await page.getByRole("button", { name: "Generate video", exact: true }).click();
    await expect(page).toHaveURL(/video=vid_/);
    await page.reload();
    await expect(preview.getByRole("link", { name: "Download MP4" })).toBeVisible({
      timeout: 45000,
    });
    const video = page.getByLabel("Generated video", { exact: true });
    await expect(video).toHaveJSProperty("videoWidth", 320);
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0.1);
    await video.evaluate((element: HTMLVideoElement) => {
      element.pause();
      element.currentTime = 1.2;
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThanOrEqual(1.2);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      preview.getByRole("link", { name: "Download MP4" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  }
  await page.getByRole("button", { name: "Animate image", exact: true }).click();
  await page.getByLabel("Video model", { exact: true }).selectOption("xai");
  await page.getByLabel("Upload starting image", { exact: true }).setInputFiles({
    name: "starting-image.png",
    mimeType: "image/png",
    buffer: largeImageFixture(1024 * 1024),
  });
  await expect(page.getByAltText("Starting frame preview")).toBeVisible();
  await page.getByRole("button", { name: "9:16", exact: true }).click();
  await page
    .getByLabel("Video prompt", { exact: true })
    .fill("Gently animate this starting image, preserve its colors");
  await page.getByRole("button", { name: "Generate video", exact: true }).click();
  await expect(preview.getByRole("status")).not.toHaveText("Ready to play");
  await expect(preview.getByRole("link", { name: "Download MP4" })).toBeVisible({ timeout: 45000 });
  await page.screenshot({ path: "/tmp/zelyq-video-studio-result.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/zelyq-video-studio-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await preview.getByRole("button", { name: "Delete video", exact: true }).click();
  await preview.getByRole("button", { name: "Confirm delete", exact: true }).click();
  const history = await page.request.get("/api/videos/generations");
  expect(history.ok()).toBe(true);
  expect((await history.json()).generations).toHaveLength(2);
  // An owned Image Studio output is snapshotted into video storage. Deleting
  // its original image must not break the accepted video reference.
  const source = await page.request.post("/api/images/generations", {
    data: {
      provider: "openai",
      prompt: "A starting image from Image Studio",
      size: "1024x1024",
      quality: "medium",
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(source.status()).toBe(202);
  const imageId = (await source.json()).generation.id;
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/images/generations/${imageId}`)).json()).generation
          .status,
    )
    .toBe("succeeded");
  await page.getByRole("button", { name: "Remove starting image", exact: true }).click();
  await page.getByRole("button", { name: "Choose from Image Studio", exact: true }).click();
  await page
    .getByRole("button", { name: "Use image: A starting image from Image Studio", exact: true })
    .click();
  await expect(page.getByAltText("Starting frame preview")).toBeVisible();
  expect((await page.request.delete(`/api/images/generations/${imageId}`)).status()).toBe(204);
  await page
    .getByLabel("Video prompt", { exact: true })
    .fill("Animate the saved Image Studio reference");
  await page.getByRole("button", { name: "Generate video", exact: true }).click();
  await expect(preview.getByRole("status")).not.toHaveText("Ready to play");
  await expect(preview.getByRole("link", { name: "Download MP4" })).toBeVisible({ timeout: 45000 });
  const projects = await page.request.get("/api/projects");
  expect((await projects.json()).projects).toHaveLength(0);
});

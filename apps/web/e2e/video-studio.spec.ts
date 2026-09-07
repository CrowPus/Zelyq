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
  // Settings is a menu, not one long column: every section is one click away
  // and the page does not scroll to reach the navigation itself.
  const sectionNav = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sectionNav).toBeVisible();
  await expect(sectionNav.getByRole("button", { name: "Model", exact: true })).toBeVisible();
  await expect(sectionNav.getByRole("button", { name: "Users", exact: true })).toBeVisible();
  // A deep link selects its section rather than scrolling to it.
  await expect(
    sectionNav.getByRole("button", { name: "Video generation", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  // Only the chosen section is on screen, so switching genuinely swaps the
  // content rather than scrolling a single long column.
  await expect(page.getByRole("heading", { name: "Model", exact: true })).toHaveCount(0);
  await sectionNav.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Model", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Video generation settings" })).toHaveCount(0);
  await sectionNav.getByRole("button", { name: "Video generation", exact: true }).click();

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
  const videoId = new URL(page.url()).searchParams.get("video") as string;
  // Frame export: split the finished clip into the numbered sequence a
  // scroll-scrubbed hero reads, and prove the files are really there.
  const frameSection = page.getByRole("region", { name: "Frame export" });
  await expect(frameSection).toBeVisible();
  // A half-typed number must never reach the server. Typing toward "120"
  // passes through "1", and clearing the field reads as NaN; both used to be
  // sent verbatim and came back as a bare "Request validation failed".
  const countField = frameSection.getByLabel("Frame count", { exact: true });
  await countField.fill("1");
  await expect(frameSection.getByRole("alert")).toContainText("between");
  await expect(frameSection.getByRole("button", { name: "Extract", exact: true })).toBeDisabled();
  await countField.fill("");
  await expect(frameSection.getByRole("button", { name: "Extract", exact: true })).toBeDisabled();
  // Leaving the field snaps it back into range rather than stranding the user.
  await countField.blur();
  await expect(countField).not.toHaveValue("");
  await expect(frameSection.getByRole("button", { name: "Extract", exact: true })).toBeEnabled();

  await countField.fill("12");
  await frameSection.getByLabel("Frame width", { exact: true }).fill("320");
  await frameSection.getByRole("button", { name: "Extract", exact: true }).click();
  await expect(frameSection.getByRole("link", { name: "Download frames" })).toBeVisible({
    timeout: 60000,
  });
  await expect(frameSection.getByAltText("Frame sample 1")).toBeVisible();
  const set = await (await page.request.get(`/api/videos/generations/${videoId}/frames`)).json();
  expect(set.frames.count).toBeGreaterThan(1);
  const manifest = await (
    await page.request.get(`/api/videos/generations/${videoId}/frames/manifest.json`)
  ).json();
  expect(manifest.frames[0]).toBe("frame_0001.webp");
  expect(manifest.poster).toBe("poster.webp");
  expect(manifest.frames).toHaveLength(set.frames.count);
  const zip = await page.request.get(`/api/videos/generations/${videoId}/frames.zip`);
  expect(zip.status()).toBe(200);
  expect((await zip.body()).length).toBeGreaterThan(1000);

  // A text-to-video clip has no starting image; its library card must still
  // show a real frame rather than a grey placeholder icon.
  const card = page.locator("button", { hasText: "A ceramic vase in gentle motion" }).first();
  await card.scrollIntoViewIfNeeded();
  const thumb = card.locator("img").first();
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveJSProperty("naturalWidth", 640);

  await page.evaluate(() => {
    const sc = document.querySelector("main")!.firstElementChild as HTMLElement;
    sc.scrollTop = sc.scrollHeight;
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: "/tmp/zelyq-library.png" });
  await frameSection.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/zelyq-frames-desktop.png" });
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

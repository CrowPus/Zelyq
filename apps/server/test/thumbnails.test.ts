import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { newId, type Project } from "@zelyq/core";
import sharp from "sharp";
import { ThumbnailStore } from "../src/services/thumbnails.js";

const quiet = { warn: () => undefined };

/** A 1280x800 page screenshot, as the agent sends one. */
function screenshot(): Promise<Buffer> {
  return sharp({
    create: { width: 1280, height: 800, channels: 3, background: { r: 30, g: 90, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "zelyq-thumbnails-"));
}

test("a capture stores a card-sized picture the list then carries", async () => {
  const root = await tempDir();
  const id = newId("project");
  const store = new ThumbnailStore(root, screenshot, quiet);

  assert.equal(await store.takenAt(id), null);
  await store.capture(id);

  const image = await store.read(id);
  assert.ok(image);
  const meta = await sharp(image).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 500);

  const [stamped] = await store.stamp([{ id } as Project]);
  assert.equal(stamped?.thumbnailAt, await store.takenAt(id));
  assert.ok(stamped?.thumbnailAt);

  await store.remove(id);
  assert.equal(await store.read(id), null);
});

test("a failed capture leaves no picture and does not throw", async () => {
  const root = await tempDir();
  const id = newId("project");
  const store = new ThumbnailStore(
    root,
    async () => {
      throw new Error("preview not running");
    },
    quiet,
  );
  await store.capture(id);
  assert.equal(await store.takenAt(id), null);
});

test("captures of one app at the same time share one screenshot", async () => {
  const root = await tempDir();
  const id = newId("project");
  let shots = 0;
  const store = new ThumbnailStore(
    root,
    async () => {
      shots += 1;
      return screenshot();
    },
    quiet,
  );
  await Promise.all([store.capture(id), store.capture(id), store.capture(id)]);
  assert.equal(shots, 1);
});

test("an app without a picture is captured once, not on every preview poll", async () => {
  const root = await tempDir();
  const id = newId("project");
  let shots = 0;
  const store = new ThumbnailStore(
    root,
    async () => {
      shots += 1;
      throw new Error("blank page");
    },
    quiet,
  );
  await store.captureIfMissing(id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await store.captureIfMissing(id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(shots, 1);
});

test("a project ID cannot reach outside the thumbnails folder", async () => {
  const store = new ThumbnailStore(await tempDir(), screenshot, quiet);
  assert.equal(await store.read("../../secret"), null);
  await assert.rejects(store.remove("../../secret"));
});

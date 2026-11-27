import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { ImageAssetStore } from "../src/services/image-assets.js";
import type { StorageConfig } from "../src/services/storage/app-sleep.js";
import { MediaSleep } from "../src/services/storage/media-sleep.js";
import { VideoAssetStore } from "../src/services/video-assets.js";

/** Images and videos nobody opened for a while move to storage and come back when read. */

const tmp = path.join(os.tmpdir(), `zelyq-media-${Date.now()}`);
after(() => fs.rm(tmp, { recursive: true, force: true }));

const OWNER = `usr_${"a".repeat(32)}`;
const IMG = `img_${"b".repeat(32)}`;
const VID = `vid_${"c".repeat(32)}`;
const img = (c: string) => `img_${c.repeat(32)}`;

function setup(name: string) {
  const dir = path.join(tmp, name);
  const settings = new Map<string, string>();
  const store = {
    settings: {
      get: async (k: string) => settings.get(k) ?? null,
      set: async (k: string, v: string) => void settings.set(k, v),
      remove: async (k: string) => void settings.delete(k),
    },
  } as unknown as ConstructorParameters<typeof MediaSleep>[0]["store"];
  let config: StorageConfig = {
    kind: "folder",
    folder: path.join(dir, "storage"),
    endpoint: "",
    region: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    prefix: "zelyq",
    pathStyle: false,
  };
  const images = new ImageAssetStore(path.join(dir, "images"));
  images.media = new MediaSleep({
    store,
    kind: "images",
    root: images.root,
    config: async () => config,
  });
  const videos = new VideoAssetStore(path.join(dir, "videos"));
  videos.media = new MediaSleep({
    store,
    kind: "videos",
    root: videos.root,
    config: async () => config,
  });
  const stored = async (where = "storage") =>
    (await fs.readdir(path.join(dir, where), { recursive: true }).catch(() => [] as string[]))
      .map(String)
      .filter((f) => /\.(png|mp4)$/.test(f))
      .sort();
  /** Last touched a day ago: idle, as far as "now" is concerned. */
  const age = async (...files: string[]) => {
    const then = new Date(Date.now() - 86_400_000);
    for (const file of files) await fs.utimes(file, then, then);
  };
  const imageFile = (id: string) => path.join(images.root, OWNER, `${id}.png`);
  return {
    dir,
    images,
    videos,
    stored,
    age,
    imageFile,
    set: (next: Partial<StorageConfig>) => {
      config = { ...config, ...next };
    },
  };
}
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

test("an idle image moves to storage, and reading it brings it back exactly; then the stored copy goes", async () => {
  const s = setup("image");
  const bytes = Buffer.from("a png, more or less");
  await s.images.save(OWNER, IMG, bytes);
  await s.images.saveReference(OWNER, IMG, 0, Buffer.from("reference"));
  assert.equal(await s.images.media!.sweep(0), 0, 'just written: in use, even for "now"');
  await s.age(s.imageFile(IMG), path.join(s.images.root, OWNER, `${IMG}.ref-0.png`));
  assert.equal(await s.images.media!.sweep(7), 0, "a day old: not idle for 7 days");
  assert.equal(await s.images.media!.sweep(0), 2);
  assert.equal(await exists(s.imageFile(IMG)), false);
  assert.deepEqual(await s.stored(), [
    `zelyq/media/images/${OWNER}/${IMG}.png`,
    `zelyq/media/images/${OWNER}/${IMG}.ref-0.png`,
  ]);
  assert.deepEqual(await s.images.read(OWNER, IMG), bytes);
  assert.deepEqual((await s.images.readReferences(OWNER, IMG, 1))[0], Buffer.from("reference"));
  assert.equal(await exists(s.imageFile(IMG)), true);
  assert.equal(await exists(`${s.imageFile(IMG)}.stored`), false);
  assert.deepEqual(await s.stored(), [], "storage is paid by what it holds");
});

test("a video moves too; streaming and its checks get it back first; frames stay", async () => {
  const s = setup("video");
  const file = s.videos.file(OWNER, VID);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.alloc(4096, 1));
  await fs.mkdir(path.join(s.videos.root, OWNER, `${VID}.frames`), { recursive: true });
  await fs.writeFile(path.join(s.videos.root, OWNER, `${VID}.frames`, "0.jpg"), "frame");
  await s.age(file);
  assert.equal(await s.videos.media!.sweep(0), 1);
  assert.equal(await exists(file), false);
  assert.equal(await exists(path.join(s.videos.root, OWNER, `${VID}.frames`, "0.jpg")), true);
  await s.videos.prepare(OWNER, VID);
  assert.equal((await fs.readFile(file)).length, 4096);
  assert.equal((await s.videos.readVideo(OWNER, VID)).length, 4096);
});

test("deleting an image, or a person, deletes the stored copies too", async () => {
  const s = setup("delete");
  await s.images.save(OWNER, IMG, Buffer.from("x"));
  await s.images.save(OWNER, img("d"), Buffer.from("y"));
  await s.age(s.imageFile(IMG), s.imageFile(img("d")));
  assert.equal(await s.images.media!.sweep(0), 2);
  await s.images.remove(OWNER, IMG);
  assert.deepEqual(await s.stored(), [`zelyq/media/images/${OWNER}/${img("d")}.png`]);
  assert.equal(await exists(`${s.imageFile(IMG)}.stored`), false);
  await s.images.removeUser(OWNER);
  assert.deepEqual(await s.stored(), []);
});

test("read lately: it stays; files that are not Zelyq's own never move", async () => {
  const s = setup("recent");
  await s.images.save(OWNER, IMG, Buffer.from("x"));
  await fs.writeFile(path.join(s.images.root, OWNER, "notes.txt"), "not an image of ours");
  await fs.writeFile(path.join(s.images.root, OWNER, `${IMG}.png.123.tmp`), "being written");
  await s.age(s.imageFile(IMG));
  await s.images.read(OWNER, IMG); // opened a moment ago
  assert.equal(await s.images.media!.sweep(0), 0, "read in the last minutes: in use");
  assert.equal(await exists(path.join(s.images.root, OWNER, "notes.txt")), true);
  assert.equal(await exists(path.join(s.images.root, OWNER, `${IMG}.png.123.tmp`)), true);
  assert.deepEqual(await s.stored(), []);
});

test("storage changed: each moved file comes back from where it went; new moves use the new storage", async () => {
  const s = setup("moved");
  await s.images.save(OWNER, IMG, Buffer.from("x"));
  await s.age(s.imageFile(IMG));
  assert.equal(await s.images.media!.sweep(0), 1);
  const first = path.join(s.dir, "storage");
  s.set({ folder: path.join(s.dir, "other") });
  await assert.rejects(s.images.read(OWNER, IMG), /storage this server used before/);
  // A file that never moved and is missing is simply missing, storage or not.
  await assert.rejects(s.images.read(OWNER, img("f")), /ENOENT/);
  await s.images.save(OWNER, img("e"), Buffer.from("z"));
  await s.age(s.imageFile(img("e")));
  assert.equal(await s.images.media!.sweep(0), 1, "new moves go to the storage set now");
  assert.deepEqual(await s.stored("other"), [`zelyq/media/images/${OWNER}/${img("e")}.png`]);
  s.set({ folder: first });
  assert.deepEqual(await s.images.read(OWNER, IMG), Buffer.from("x"));
});

test("deleted while its storage is not the one set: the stored copy is deleted later, not left behind", async () => {
  const s = setup("later");
  await s.images.save(OWNER, IMG, Buffer.from("x"));
  await s.age(s.imageFile(IMG));
  assert.equal(await s.images.media!.sweep(0), 1);
  const first = path.join(s.dir, "storage");
  s.set({ folder: path.join(s.dir, "other") });
  await s.images.remove(OWNER, IMG);
  assert.deepEqual(
    await s.stored(),
    [`zelyq/media/images/${OWNER}/${IMG}.png`],
    "not reachable now",
  );
  s.set({ folder: first });
  await s.images.media!.sweep(0);
  assert.deepEqual(await s.stored(), [], "deleted on the next round");
});

test("deleted while it was being uploaded: no copy is left in storage", async () => {
  const s = setup("racing");
  await s.images.save(OWNER, IMG, Buffer.from("x".repeat(1024)));
  await s.age(s.imageFile(IMG));
  const media = s.images.media!;
  const storage = await media.storage();
  const store = storage!.store;
  const put = store.putFile.bind(store);
  // The person's folder goes while the upload is under way.
  store.putFile = async (key, file) => {
    const done = await put(key, file);
    await fs.rm(path.join(s.images.root, OWNER), { recursive: true, force: true });
    return done;
  };
  assert.equal(await media.sweep(0), 0);
  assert.deepEqual(await s.stored(), []);
});

test("with storage off, nothing moves and a missing file is just missing", async () => {
  const s = setup("off");
  s.set({ kind: "off" });
  await s.images.save(OWNER, IMG, Buffer.from("x"));
  await s.age(s.imageFile(IMG));
  assert.equal(await s.images.media!.sweep(0), 0);
  await assert.rejects(s.images.read(OWNER, img("f")), /ENOENT/);
});

test("a delete waiting to be retried never takes the copy of a file that moved again since", async () => {
  const s = setup("retry");
  await s.images.save(OWNER, IMG, Buffer.from("keep me"));
  await s.age(s.imageFile(IMG));
  const media = s.images.media!;
  const storage = (await media.storage())!;
  const realDelete = storage.store.delete.bind(storage.store);
  const failing = async () => {
    throw new Error("storage hiccup");
  };
  assert.equal(await media.sweep(0), 1);
  // Read back while deletes fail: the stored copy's key waits on the list.
  storage.store.delete = failing;
  await s.images.read(OWNER, IMG);
  // Still failing at the next round, which moves the file again to that same key.
  await s.age(s.imageFile(IMG));
  (media as unknown as { lastRead: Map<string, number> }).lastRead.clear();
  assert.equal(await media.sweep(0), 1);
  // Storage recovers; the round after retries the list.
  storage.store.delete = realDelete;
  await media.sweep(0);
  assert.deepEqual(await s.images.read(OWNER, IMG), Buffer.from("keep me"));
});

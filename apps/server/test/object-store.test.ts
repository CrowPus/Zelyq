import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { CreateBucketCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { AppSleep } from "../src/services/storage/app-sleep.js";
import {
  FolderObjectStore,
  S3ObjectStore,
  type S3Settings,
} from "../src/services/storage/object-store.js";

/**
 * The storage drivers. The bucket kind runs against a real S3-compatible server when one is given:
 *   ZELYQ_TEST_S3_ENDPOINT=http://127.0.0.1:59700 ZELYQ_TEST_S3_KEY=… ZELYQ_TEST_S3_SECRET=…
 * (MinIO, SeaweedFS, or a real provider's test bucket). Without it, only the folder kind runs.
 */

const endpoint = process.env.ZELYQ_TEST_S3_ENDPOINT;
const s3: S3Settings | null = endpoint
  ? {
      endpoint,
      region: process.env.ZELYQ_TEST_S3_REGION ?? "us-east-1",
      bucket: `zelyq-test-${Date.now()}`,
      accessKeyId: process.env.ZELYQ_TEST_S3_KEY ?? "",
      secretAccessKey: process.env.ZELYQ_TEST_S3_SECRET ?? "",
      prefix: "zelyq",
      pathStyle: true,
    }
  : null;
const tmp = path.join(os.tmpdir(), `zelyq-objects-${Date.now()}`);
const sha = async (file: string) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  if (s3) {
    const client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
    await client.send(new CreateBucketCommand({ Bucket: s3.bucket }));
  }
});
after(() => fs.rm(tmp, { recursive: true, force: true }));

test("a folder store copies in and out, under its own folder name, and refuses odd keys", async () => {
  const store = new FolderObjectStore(path.join(tmp, "folder"), "zelyq");
  const file = path.join(tmp, "a.bin");
  await fs.writeFile(file, randomBytes(4096));
  assert.equal((await store.putFile("apps/x/1/app.tar.gz", file)).bytes, 4096);
  assert.equal(await store.size("apps/x/1/app.tar.gz"), 4096);
  assert.equal(
    await fs
      .stat(path.join(tmp, "folder", "zelyq", "apps", "x", "1", "app.tar.gz"))
      .then(() => true),
    true,
  );
  await store.getFile("apps/x/1/app.tar.gz", path.join(tmp, "back.bin"));
  assert.equal(await sha(path.join(tmp, "back.bin")), await sha(file));
  await store.delete("apps/x/1/app.tar.gz");
  assert.equal(await store.size("apps/x/1/app.tar.gz"), null);
  for (const bad of ["../escape", "a/../../b", "/abs", "a//b", "a b"])
    await assert.rejects(store.putFile(bad, file), /Not a storage key/);
  await store.check();
});

test("a bucket: large files go up in parts and come back the same", {
  skip: !s3 && "no ZELYQ_TEST_S3_ENDPOINT",
}, async () => {
  const store = new S3ObjectStore(s3!);
  await store.check();
  const file = path.join(tmp, "big.bin");
  await fs.writeFile(file, randomBytes(40 * 1024 * 1024));
  assert.equal((await store.putFile("apps/y/1/app.tar.gz", file)).bytes, 40 * 1024 * 1024);
  assert.equal(await store.size("apps/y/1/app.tar.gz"), 40 * 1024 * 1024);
  await store.getFile("apps/y/1/app.tar.gz", path.join(tmp, "big-back.bin"));
  assert.equal(await sha(path.join(tmp, "big-back.bin")), await sha(file));
  // Under the folder name set, nowhere else.
  const client = new S3Client({
    endpoint: s3!.endpoint,
    region: s3!.region,
    forcePathStyle: true,
    credentials: { accessKeyId: s3!.accessKeyId, secretAccessKey: s3!.secretAccessKey },
  });
  const keys = (
    (await client.send(new ListObjectsV2Command({ Bucket: s3!.bucket }))).Contents ?? []
  ).map((o) => o.Key);
  assert.deepEqual(keys, ["zelyq/apps/y/1/app.tar.gz"]);
  await store.delete("apps/y/1/app.tar.gz");
  assert.equal(await store.size("apps/y/1/app.tar.gz"), null);
});

test("a bucket: wrong keys and a wrong name are said plainly", {
  skip: !s3 && "no ZELYQ_TEST_S3_ENDPOINT",
}, async () => {
  await assert.rejects(
    new S3ObjectStore({ ...s3!, secretAccessKey: "wrong-secret-wrong" }).check(),
    /refused these keys/,
  );
  await assert.rejects(
    new S3ObjectStore({ ...s3!, bucket: "no-such-bucket-zelyq" }).check(),
    /no bucket called "no-such-bucket-zelyq"/,
  );
});

test("a bucket: an app sleeps there and wakes the same", {
  skip: !s3 && "no ZELYQ_TEST_S3_ENDPOINT",
}, async () => {
  const settings = new Map<string, string>();
  const store = {
    settings: {
      get: async (k: string) => settings.get(k) ?? null,
      set: async (k: string, v: string) => void settings.set(k, v),
      remove: async (k: string) => void settings.delete(k),
    },
  } as unknown as ConstructorParameters<typeof AppSleep>[0]["store"];
  const ws = path.join(tmp, "ws");
  const sleep = new AppSleep({
    store,
    workspaceDir: ws,
    attachmentsDir: path.join(tmp, "att"),
    config: async () => ({ kind: "s3", folder: "", ...s3! }),
  });
  await fs.mkdir(path.join(ws, "app_9", "src"), { recursive: true });
  await fs.writeFile(path.join(ws, "app_9", "src", "index.ts"), "export const x = 1;\n");
  const record = await sleep.sleep("app_9", { stillIdle: async () => true });
  assert.ok(record);
  assert.match(record.where, /bucket zelyq-test-/);
  assert.deepEqual(await fs.readdir(path.join(ws, "app_9")), [], "its folder stays, empty");
  await sleep.ensureAwake("app_9");
  assert.equal(
    await fs.readFile(path.join(ws, "app_9", "src", "index.ts"), "utf8"),
    "export const x = 1;\n",
  );
  assert.equal(
    await new S3ObjectStore(s3!).size(record.keys.app!),
    null,
    "the stored copy is gone once woken",
  );
});

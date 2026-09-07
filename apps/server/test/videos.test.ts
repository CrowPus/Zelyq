import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  maxVideoBytes,
  maxVideoReferenceBytes,
  newId,
  type VideoGenerationInput,
  videoGenerationInputSchema,
  videoModelCapability,
  ZelyqError,
} from "@zelyq/core";
import { createStore, runMigrations } from "@zelyq/db";
import Fastify from "fastify";
import { registerVideoRoutes, videoRange } from "../src/routes/videos.js";
import { AccessControl } from "../src/services/access.js";
import type { ImageGenerationService } from "../src/services/image-generation.js";
import { VideoAssetStore } from "../src/services/video-assets.js";
import { VideoGenerationService } from "../src/services/video-generation.js";
import { downloadVideo, videoProviders } from "../src/services/video-providers/index.js";
import { imageFixture, largeImageFixture } from "./helpers/image-fixture.js";
import { videoFixture, videoProviderFixture } from "./helpers/video-provider-fixture.js";

const input = (provider: "google" | "xai" = "google"): VideoGenerationInput =>
  videoGenerationInputSchema.parse({
    provider,
    model: videoModelCapability(provider).model,
    mode: "text-to-video",
    prompt: "A slow camera orbit around a ceramic vase",
    aspectRatio: "16:9",
    durationSeconds: 8,
    resolution: "720p",
    audio: true,
    idempotencyKey: randomUUID(),
  });
async function harness(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-video-test-"));
  const database = `file:${root}/test.db`;
  await runMigrations(database);
  const store = createStore(database);
  const owner = await store.users.create({
    id: newId("user"),
    email: "owner@example.com",
    name: "Owner",
    passwordHash: "unused",
  });
  const other = await store.users.create({
    id: newId("user"),
    email: "other@example.com",
    name: "Other",
    passwordHash: "unused",
  });
  const values: Record<string, string> = {
    videoProvider: "google",
    videoGoogleApiKey: "google-test-key",
    videoXaiApiKey: "xai-test-key",
    videoGoogleModel: videoModelCapability("google").model,
    videoXaiModel: videoModelCapability("xai").model,
    videoHourlyLimit: "5",
    videoConcurrency: "2",
  };
  const settings = {
    value: async (key: string) => values[key] ?? "",
    numberValue: async (key: string) => Number(values[key] ?? "0"),
  };
  const fixture = videoProviderFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  const assets = new VideoAssetStore(`${root}/videos`);
  const videos = new VideoGenerationService(store, settings, assets, videoProviders, 20);
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    const user = request.headers["test-user"];
    if (typeof user === "string")
      request.zelyqUser = (await store.users.findById(user)) ?? undefined;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZelyqError)
      return reply
        .code(
          error.code === "unauthorized"
            ? 401
            : error.code === "not_found"
              ? 404
              : error.code === "rate_limited"
                ? 429
                : error.code === "conflict"
                  ? 409
                  : 400,
        )
        .send(error.toJSON());
    return reply
      .code((error as { statusCode?: number }).statusCode ?? 500)
      .send({ error: String(error) });
  });
  const images = {
    read: async (ownerId: string) => {
      if (ownerId !== owner.id) throw ZelyqError.notFound("Image", "test");
      return imageFixture();
    },
  } as unknown as ImageGenerationService;
  await registerVideoRoutes(app, { videos, images, access: new AccessControl(store) });
  await app.ready();
  videos.start();
  t.after(async () => {
    await videos.close();
    await app.close();
    await store.close();
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  });
  const wait = async (id: string, status: string) => {
    for (let i = 0; i < 300; i++) {
      const row = await store.videos.find(id);
      if (row?.status === status) return row;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Expected ${status}: ${JSON.stringify(await store.videos.find(id))}`);
  };
  return {
    root,
    database,
    store,
    owner,
    other,
    values,
    settings,
    fixture,
    assets,
    videos,
    app,
    wait,
  };
}

test("both providers generate durable playable video with authenticated ranges and downloads", async (t) => {
  const h = await harness(t);
  for (const provider of ["google", "xai"] as const) {
    const response = await h.app.inject({
      method: "POST",
      url: "/api/videos/generations",
      headers: { "test-user": h.owner.id },
      payload: input(provider),
    });
    assert.equal(response.statusCode, 202, response.body);
    const id = response.json().generation.id;
    await h.wait(id, "succeeded");
    const generation = await h.videos.get(h.owner.id, id);
    assert.equal(generation.asset?.hasAudio, true);
    assert.equal(generation.asset?.width, 320);
    assert.equal(generation.asset?.durationSeconds, 2);
    const asset = `/api/videos/assets/${id}`;
    assert.equal((await h.app.inject({ url: asset })).statusCode, 401);
    assert.equal(
      (
        await h.app.inject({
          url: asset,
          headers: { "test-user": h.other.id, range: "bytes=0-20" },
        })
      ).statusCode,
      404,
    );
    const head = await h.app.inject({
      method: "HEAD",
      url: asset,
      headers: { "test-user": h.owner.id },
    });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, "");
    const range = await h.app.inject({
      url: asset,
      headers: { "test-user": h.owner.id, range: "bytes=10-29" },
    });
    assert.equal(range.statusCode, 206);
    assert.equal(range.rawPayload.length, 20);
    assert.deepEqual(range.rawPayload, (await videoFixture()).subarray(10, 30));
    assert.equal(
      (
        await h.app.inject({
          url: asset,
          headers: { "test-user": h.owner.id, range: "bytes=9999999-" },
        })
      ).statusCode,
      416,
    );
    assert.equal(
      (await h.app.inject({ url: `${asset}?download=1`, headers: { "test-user": h.owner.id } }))
        .headers["content-type"],
      "video/mp4",
    );
  }
  assert.equal(h.fixture.counts().calls, 2);
  assert.equal(
    h.fixture.requests[0].parameters && (h.fixture.requests[0].parameters as any).durationSeconds,
    8,
  );
  assert.equal(h.fixture.requests[1].generate_audio, true);
});

test("near-limit multipart starting image is private and both adapters receive it", async (t) => {
  const h = await harness(t);
  const bytes = largeImageFixture(maxVideoReferenceBytes);
  const boundary = "video-test-boundary";
  const response = await h.app.inject({
    method: "POST",
    url: "/api/videos/references",
    headers: {
      "test-user": h.owner.id,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  assert.equal(response.statusCode, 201, response.body);
  const reference = response.json().reference;
  assert.equal(
    (await h.app.inject({ url: reference.url, headers: { "test-user": h.other.id } })).statusCode,
    404,
  );
  for (const provider of ["google", "xai"] as const) {
    const request = {
      ...input(provider),
      mode: "image-to-video" as const,
      referenceId: reference.id,
    };
    const result = await h.videos.submit(h.owner.id, request);
    await h.wait(result.id, "succeeded");
  }
  assert.ok((h.fixture.requests[0].instances as any[])[0].image.bytesBase64Encoded);
  assert.match((h.fixture.requests[1].image as any).url, /^data:image\/png;base64,/);
  await assert.rejects(
    h.videos.removeReference(h.owner.id, reference.id),
    /belongs to a saved video/,
  );
  await assert.rejects(
    h.videos.submit(h.other.id, { ...input(), mode: "image-to-video", referenceId: reference.id }),
    /not found/i,
  );
});

test("idempotency, invalid combinations and quota checks prevent replacement submissions", async (t) => {
  const h = await harness(t);
  const request = input();
  const first = await h.videos.submit(h.owner.id, request);
  const replay = await h.videos.submit(h.owner.id, request);
  assert.equal(first.id, replay.id);
  await assert.rejects(
    h.videos.submit(h.owner.id, { ...request, prompt: "Changed" }),
    /request key/,
  );
  await h.wait(first.id, "succeeded");
  await assert.rejects(
    h.videos.submit(h.owner.id, { ...input(), resolution: "1080p", durationSeconds: 4 }),
    /8-second/,
  );
  h.values.videoHourlyLimit = "1";
  await assert.rejects(h.videos.submit(h.owner.id, input()), /requests per hour/);
  await h.videos.remove(h.owner.id, first.id, false);
  await assert.rejects(h.videos.submit(h.owner.id, request), /deleted video/);
  assert.equal(h.fixture.counts().calls, 1);
});

test("accepted jobs resume polling after restart without a new provider request", async (t) => {
  const h = await harness(t);
  h.fixture.state.mode = "pending";
  const job = await h.videos.submit(h.owner.id, input());
  await h.wait(job.id, "generating");
  await h.videos.close();
  h.fixture.state.mode = "ok";
  const resumed = new VideoGenerationService(h.store, h.settings, h.assets, videoProviders, 20);
  resumed.start();
  try {
    await h.wait(job.id, "succeeded");
    assert.equal(h.fixture.counts().calls, 1);
  } finally {
    await resumed.close();
  }
});

test("ambiguous submission retains capacity until explicitly dismissed and never resubmits", async (t) => {
  const h = await harness(t);
  h.fixture.state.mode = "ambiguous";
  const job = await h.videos.submit(h.owner.id, input());
  const row = await h.wait(job.id, "unknown");
  assert.equal(row.activeOwner, h.owner.id);
  assert.notEqual(row.workerSlot, null);
  await assert.rejects(h.videos.submit(h.owner.id, input()), /outstanding/);
  await assert.rejects(h.videos.remove(h.owner.id, job.id, false), /acknowledge/);
  await h.videos.remove(h.owner.id, job.id, true);
  assert.equal((await h.store.videos.find(job.id))?.workerSlot, null);
  assert.equal(h.fixture.counts().calls, 1);
});

test("failed storage retrieval retries the original result and can be reconciled", async (t) => {
  const h = await harness(t);
  h.fixture.state.mode = "download-fails";
  const job = await h.videos.submit(h.owner.id, input());
  await h.wait(job.id, "unknown");
  h.fixture.state.mode = "ok";
  await h.videos.reconcile(h.owner.id, job.id);
  await h.wait(job.id, "succeeded");
  assert.equal(h.fixture.counts().calls, 1);
  assert.ok(h.fixture.counts().downloads > 1);
});

test("lease fencing and provider slots arbitrate independent database connections", async (t) => {
  const h = await harness(t);
  await h.videos.close();
  const makeRow = (ownerId: string) => ({
    id: `vid_${randomUUID().replaceAll("-", "")}`,
    ownerId,
    idempotencyKey: randomUUID(),
    requestDigest: "test",
    input: JSON.stringify(input()),
    provider: "google",
    model: videoModelCapability("google").model,
    credentialDigest: createHash("sha256").update("google-test-key").digest("hex"),
    activeOwner: ownerId,
    storageBytes: maxVideoBytes,
    createdAt: new Date().toISOString(),
    nextPollAt: new Date().toISOString(),
  });
  const one = await h.store.videos.create(makeRow(h.owner.id), 5);
  const two = await h.store.videos.create(makeRow(h.other.id), 5);
  const second = createStore(h.database);
  try {
    const until = new Date(Date.now() + 60000).toISOString();
    const results = await Promise.all([
      h.store.videos.claim(one, "worker-a", until, 0),
      second.videos.claim(two, "worker-b", until, 0),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const winner = results.find(Boolean)!;
    assert.equal(await second.videos.patch(winner.id, "stale-worker", { status: "failed" }), null);
  } finally {
    await second.close();
  }
});

test("account deletion during generation discards its pending work and references", async (t) => {
  const h = await harness(t);
  h.fixture.state.mode = "pending";
  const ref = await h.videos.addReference(h.owner.id, imageFixture());
  const job = await h.videos.submit(h.owner.id, {
    ...input(),
    mode: "image-to-video",
    referenceId: ref.id,
  });
  await h.wait(job.id, "generating");
  await h.store.users.remove(h.owner.id);
  await h.assets.removeUser(h.owner.id);
  h.fixture.state.mode = "ok";
  await h.videos.tick();
  assert.equal(await h.store.videos.find(job.id), null);
  await assert.rejects(fs.stat(h.assets.directory(h.owner.id)), /ENOENT/);
});

test("cancelling is atomic: it wins before submission and is refused afterwards", async (t) => {
  const h = await harness(t);
  // The worker claims queued jobs on a timer, so this races it deliberately.
  // Either answer is correct; what must never happen is a job that is both
  // cancelled and submitted to a provider.
  const queued = await h.app.inject({
    method: "POST",
    url: "/api/videos/generations",
    headers: { "test-user": h.owner.id },
    payload: input(),
  });
  assert.equal(queued.statusCode, 202, queued.body);
  const id = queued.json().generation.id;
  const cancel = await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${id}/cancel`,
    headers: { "test-user": h.owner.id },
  });
  assert.ok(
    cancel.statusCode === 200 || cancel.statusCode === 409,
    `expected cancel to win or be refused, got ${cancel.statusCode}: ${cancel.body}`,
  );

  let terminal: string;
  if (cancel.statusCode === 200) {
    // Cancelling won the race: the job stays cancelled and is never picked up
    // afterwards, and no provider operation was ever recorded against it.
    assert.equal((await h.store.videos.find(id))?.status, "cancelled");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settled = await h.store.videos.find(id);
    assert.equal(settled?.status, "cancelled", "a cancelled job must not be claimed later");
    assert.equal(settled?.operation, null, "a cancelled job must never reach a provider");
    const done = await h.app.inject({
      method: "POST",
      url: "/api/videos/generations",
      headers: { "test-user": h.owner.id },
      payload: input("xai"),
    });
    assert.equal(done.statusCode, 202, done.body);
    terminal = done.json().generation.id;
  } else {
    // The worker won: the job must be genuinely running, not cancelled.
    assert.notEqual(
      (await h.store.videos.find(id))?.status,
      "cancelled",
      "a refused cancel must not have cancelled anything",
    );
    terminal = id;
  }
  await h.wait(terminal, "succeeded");

  // Cancelling a finished job is refused rather than pretending the provider
  // was stopped and the money returned.
  const late = await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${terminal}/cancel`,
    headers: { "test-user": h.owner.id },
  });
  assert.equal(late.statusCode, 409, late.body);

  // And nobody else can cancel it at all.
  const stranger = await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${terminal}/cancel`,
    headers: { "test-user": h.other.id },
  });
  assert.equal(stranger.statusCode, 404, stranger.body);
});

test("history is private, newest first, and pages with a cursor", async (t) => {
  const h = await harness(t);
  const mine: string[] = [];
  for (let n = 0; n < 3; n++) {
    const response = await h.app.inject({
      method: "POST",
      url: "/api/videos/generations",
      headers: { "test-user": h.owner.id },
      payload: input(n % 2 ? "xai" : "google"),
    });
    assert.equal(response.statusCode, 202, response.body);
    const id = response.json().generation.id;
    await h.wait(id, "succeeded");
    mine.push(id);
  }

  const listed = await h.app.inject({
    method: "GET",
    url: "/api/videos/generations",
    headers: { "test-user": h.owner.id },
  });
  assert.equal(listed.statusCode, 200, listed.body);
  const body = listed.json();
  assert.deepEqual(
    body.generations.map((row: { id: string }) => row.id),
    [...mine].reverse(),
    "history is newest first",
  );
  // Only a full page promises another one; three rows do not.
  assert.equal(body.nextCursor, null);

  // Another user's history is their own, and cannot be paged into by passing
  // someone else's id as a cursor.
  const others = await h.app.inject({
    method: "GET",
    url: "/api/videos/generations",
    headers: { "test-user": h.other.id },
  });
  assert.equal(others.json().generations.length, 0);
  const stolen = await h.app.inject({
    method: "GET",
    url: `/api/videos/generations?cursor=${mine[0]}`,
    headers: { "test-user": h.other.id },
  });
  assert.equal(stolen.statusCode, 404, stolen.body);
});

test("download destinations and byte ranges reject unsafe or invalid input", async () => {
  for (const url of [
    "http://vidgen.x.ai/a.mp4",
    "https://127.0.0.1/a.mp4",
    "https://vidgen.x.ai.evil.test/a",
    "https://name:secret@vidgen.x.ai/a",
  ])
    await assert.rejects(
      downloadVideo("xai", url, "test", AbortSignal.timeout(1000)),
      /unsupported/,
    );
  assert.deepEqual(videoRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(videoRange("bytes=90-999", 100), { start: 90, end: 99 });
  assert.equal(videoRange("bytes=-0", 100), null);
  assert.equal(videoRange("bytes=0-2,4-6", 100), null);
});

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
import { ZodError } from "zod";
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
    // Mirrors the real app's handler: a validation failure is a 400, not a
    // 500. Without this the harness would let a broken contract look like a
    // server fault.
    if (error instanceof ZodError)
      return reply.code(400).send({ error: { code: "bad_request", message: "invalid" } });
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

// ---------------------------------------------------------------------------
// Frame export. The output must match what skills/cinematic-web already reads:
// frame_%04d.<ext>, a poster, and a manifest.
// ---------------------------------------------------------------------------

async function succeededVideo(h: Awaited<ReturnType<typeof harness>>) {
  const response = await h.app.inject({
    method: "POST",
    url: "/api/videos/generations",
    headers: { "test-user": h.owner.id },
    payload: input(),
  });
  assert.equal(response.statusCode, 202, response.body);
  const id = response.json().generation.id;
  await h.wait(id, "succeeded");
  return id;
}

test("every finished video has a poster, including one with no starting image", async (t) => {
  const h = await harness(t);
  // Text-to-video: no reference at all, which is exactly the case that used to
  // show a grey film icon in the library instead of a thumbnail.
  const id = await succeededVideo(h);
  const generation = (
    await h.app.inject({
      method: "GET",
      url: `/api/videos/generations/${id}`,
      headers: { "test-user": h.owner.id },
    })
  ).json().generation;
  assert.equal(generation.reference, null, "this fixture must have no starting image");
  assert.ok(generation.asset.posterUrl, "a finished video must offer a poster");

  const poster = await h.app.inject({
    method: "GET",
    url: generation.asset.posterUrl,
    headers: { "test-user": h.owner.id },
  });
  assert.equal(poster.statusCode, 200, poster.body);
  assert.equal(poster.headers["content-type"], "image/webp");
  const bytes = poster.rawPayload;
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", "the poster is not a WebP");
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");

  // Made once and kept: a second request serves the same bytes.
  const again = await h.app.inject({
    method: "GET",
    url: generation.asset.posterUrl,
    headers: { "test-user": h.owner.id },
  });
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.rawPayload, bytes, "the cached poster should be identical");

  // And it belongs to its owner.
  const stolen = await h.app.inject({
    method: "GET",
    url: generation.asset.posterUrl,
    headers: { "test-user": h.other.id },
  });
  assert.equal(stolen.statusCode, 404, stolen.body);
});

test("frames come out as a numbered sequence with a poster and a manifest", async (t) => {
  const h = await harness(t);
  const id = await succeededVideo(h);

  const made = await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${id}/frames`,
    headers: { "test-user": h.owner.id },
    payload: { format: "webp", count: 12, width: 320 },
  });
  assert.equal(made.statusCode, 201, made.body);
  const set = made.json().frames;
  assert.equal(set.format, "webp");
  assert.ok(set.count > 1, `expected a sequence, got ${set.count} frame(s)`);
  assert.ok(set.sizeBytes > 0);
  assert.equal(set.frameUrls.length, set.count);

  // The exact names the scroll-scrub recipe builds its URL list from.
  assert.match(set.frameUrls[0], /\/frames\/frame_0001\.webp$/);
  assert.match(set.posterUrl, /\/frames\/poster\.webp$/);

  const manifest = await h.app.inject({
    method: "GET",
    url: `/api/videos/generations/${id}/frames/manifest.json`,
    headers: { "test-user": h.owner.id },
  });
  assert.equal(manifest.statusCode, 200, manifest.body);
  const body = manifest.json();
  assert.equal(body.count, set.count);
  assert.equal(body.frames.length, set.count);
  assert.equal(body.frames[0], "frame_0001.webp");
  assert.equal(body.poster, "poster.webp");
  assert.ok(body.width > 0 && body.height > 0);
  assert.equal(body.height % 2, 0, "an odd height would be rejected by the encoders");

  // Every frame is a real WebP, not one animated file pretending to be many.
  for (const name of [body.frames[0], body.frames.at(-1), "poster.webp"]) {
    const frame = await h.app.inject({
      method: "GET",
      url: `/api/videos/generations/${id}/frames/${name}`,
      headers: { "test-user": h.owner.id },
    });
    assert.equal(frame.statusCode, 200, `${name}: ${frame.body}`);
    assert.equal(frame.headers["content-type"], "image/webp");
    const bytes = frame.rawPayload;
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", `${name} is not a WebP`);
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", `${name} is not a WebP`);
  }
});

test("each format produces its own extension and media type", async (t) => {
  const h = await harness(t);
  const id = await succeededVideo(h);
  for (const [format, ext, type, signature] of [
    ["jpeg", "jpg", "image/jpeg", [0xff, 0xd8]],
    ["png", "png", "image/png", [0x89, 0x50, 0x4e, 0x47]],
  ] as const) {
    const made = await h.app.inject({
      method: "POST",
      url: `/api/videos/generations/${id}/frames`,
      headers: { "test-user": h.owner.id },
      payload: { format, count: 8, width: 320 },
    });
    assert.equal(made.statusCode, 201, made.body);
    assert.equal(made.json().frames.format, format);
    const frame = await h.app.inject({
      method: "GET",
      url: `/api/videos/generations/${id}/frames/frame_0001.${ext}`,
      headers: { "test-user": h.owner.id },
    });
    assert.equal(frame.statusCode, 200, frame.body);
    assert.equal(frame.headers["content-type"], type);
    assert.deepEqual([...frame.rawPayload.subarray(0, signature.length)], [...signature]);
  }
});

test("re-extracting replaces the previous set rather than accumulating", async (t) => {
  const h = await harness(t);
  const id = await succeededVideo(h);
  const first = await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${id}/frames`,
    headers: { "test-user": h.owner.id },
    payload: { format: "webp", count: 20, width: 320 },
  });
  assert.equal(first.statusCode, 201, first.body);
  const second = await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${id}/frames`,
    headers: { "test-user": h.owner.id },
    payload: { format: "jpeg", count: 8, width: 320 },
  });
  assert.equal(second.statusCode, 201, second.body);

  const current = await h.app.inject({
    method: "GET",
    url: `/api/videos/generations/${id}/frames`,
    headers: { "test-user": h.owner.id },
  });
  assert.equal(current.json().frames.format, "jpeg", "the newer set must win");
  // The old set's files are gone, not merely unreferenced.
  const stale = await h.app.inject({
    method: "GET",
    url: `/api/videos/generations/${id}/frames/frame_0001.webp`,
    headers: { "test-user": h.owner.id },
  });
  assert.equal(stale.statusCode, 404, stale.body);
});

test("the zip download is a readable archive of the whole set", async (t) => {
  const h = await harness(t);
  const id = await succeededVideo(h);
  await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${id}/frames`,
    headers: { "test-user": h.owner.id },
    payload: { format: "webp", count: 8, width: 320 },
  });
  const set = (
    await h.app.inject({
      method: "GET",
      url: `/api/videos/generations/${id}/frames`,
      headers: { "test-user": h.owner.id },
    })
  ).json().frames;

  const zip = await h.app.inject({
    method: "GET",
    url: `/api/videos/generations/${id}/frames.zip`,
    headers: { "test-user": h.owner.id },
  });
  assert.equal(zip.statusCode, 200, zip.body);
  assert.equal(zip.headers["content-type"], "application/zip");
  assert.match(String(zip.headers["content-disposition"]), /attachment; filename=".*\.zip"/);

  // Parse the central directory back rather than trusting the writer.
  const buffer = zip.rawPayload;
  assert.equal(buffer.readUInt32LE(0), 0x04034b50, "must start with a local file header");
  const eocd = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(eocd), 0x06054b50, "must end with an end-of-central-directory");
  const entries = buffer.readUInt16LE(eocd + 10);
  assert.equal(entries, set.count + 2, "manifest + poster + every frame");
  // Walk the central directory and confirm each entry is stored, not deflated.
  let offset = buffer.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < entries; n++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    assert.equal(buffer.readUInt16LE(offset + 10), 0, "entries must be stored, not compressed");
    const nameLength = buffer.readUInt16LE(offset + 28);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("ascii"));
    offset += 46 + nameLength;
  }
  assert.ok(names.includes("manifest.json"));
  assert.ok(names.includes("poster.webp"));
  assert.ok(names.includes("frame_0001.webp"));
});

test("frame routes are owner-scoped and reject traversal", async (t) => {
  const h = await harness(t);
  const id = await succeededVideo(h);
  await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${id}/frames`,
    headers: { "test-user": h.owner.id },
    payload: { format: "webp", count: 8, width: 320 },
  });

  // Another user cannot read the set, a frame, or the archive.
  for (const url of [
    `/api/videos/generations/${id}/frames`,
    `/api/videos/generations/${id}/frames/frame_0001.webp`,
    `/api/videos/generations/${id}/frames.zip`,
  ]) {
    const stolen = await h.app.inject({ method: "GET", url, headers: { "test-user": h.other.id } });
    assert.equal(stolen.statusCode, 404, `${url}: ${stolen.body}`);
  }
  // Nor delete it.
  const stolenDelete = await h.app.inject({
    method: "DELETE",
    url: `/api/videos/generations/${id}/frames`,
    headers: { "test-user": h.other.id },
  });
  assert.equal(stolenDelete.statusCode, 404, stolenDelete.body);

  // A name that is not one of the permitted shapes is refused, however encoded.
  for (const name of ["..%2F..%2Fsecret.key", "frame_1.webp", "frame_0001.png", "poster.gif"]) {
    const bad = await h.app.inject({
      method: "GET",
      url: `/api/videos/generations/${id}/frames/${name}`,
      headers: { "test-user": h.owner.id },
    });
    assert.equal(bad.statusCode, 404, `${name} should not resolve: ${bad.statusCode}`);
  }
});

test("no frame name can escape its own directory", async (t) => {
  const h = await harness(t);
  const id = await succeededVideo(h);
  await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${id}/frames`,
    headers: { "test-user": h.owner.id },
    payload: { format: "webp", count: 8, width: 320 },
  });
  const directory = path.resolve(h.videos.frames.directory(h.owner.id, id));

  // Straight at the guard, not through the router — the router's own decoding
  // would mask whether this holds for any other caller of `file()`.
  const attacks = [
    "../../../../etc/passwd",
    "..%2F..%2Fsecret.key",
    "frame_0001.webp/../../../escape.webp",
    "./../../frame_0001.webp",
    "/etc/passwd",
    "\\..\\..\\windows",
    "frame_0001.webp\u0000.txt",
    "....//frame_0001.webp",
  ];
  for (const name of attacks) {
    assert.throws(
      () => h.videos.frames.file(h.owner.id, id, name, "webp"),
      /not found/i,
      `"${name}" must be refused`,
    );
  }

  // A permitted name still resolves, and stays inside the directory.
  const good = h.videos.frames.file(h.owner.id, id, "frame_0001.webp", "webp");
  assert.ok(
    good.startsWith(`${directory}${path.sep}`),
    `a valid frame resolved outside its directory: ${good}`,
  );
  assert.equal(path.basename(good), "frame_0001.webp");
});

test("only a finished video can be split, and deleting it takes the frames", async (t) => {
  const h = await harness(t);
  const id = await succeededVideo(h);
  await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${id}/frames`,
    headers: { "test-user": h.owner.id },
    payload: { format: "webp", count: 8, width: 320 },
  });
  const directory = h.videos.frames.directory(h.owner.id, id);
  assert.ok(
    (await fs.readdir(directory)).length > 0,
    "the set should exist on disk before deletion",
  );

  await h.app.inject({
    method: "DELETE",
    url: `/api/videos/generations/${id}`,
    headers: { "test-user": h.owner.id },
  });
  await assert.rejects(() => fs.readdir(directory), "deleting the video must take its frames");

  // An unfinished job cannot be split at all.
  const queued = await h.app.inject({
    method: "POST",
    url: "/api/videos/generations",
    headers: { "test-user": h.owner.id },
    payload: input("xai"),
  });
  const pending = queued.json().generation.id;
  const refused = await h.app.inject({
    method: "POST",
    url: `/api/videos/generations/${pending}/frames`,
    headers: { "test-user": h.owner.id },
    payload: { format: "webp", count: 8, width: 320 },
  });
  assert.ok(
    refused.statusCode === 409 || refused.statusCode === 201,
    `expected a refusal or a finished job, got ${refused.statusCode}`,
  );
  if (refused.statusCode === 409) assert.match(refused.body, /finished video/i);
});

test("frame counts and widths outside the supported range are refused", async (t) => {
  const h = await harness(t);
  const id = await succeededVideo(h);
  for (const payload of [
    { count: 0 },
    { count: 1000 },
    { width: 10 },
    { width: 4000 },
    { format: "gif" },
    { count: 12, unexpected: true },
  ]) {
    const bad = await h.app.inject({
      method: "POST",
      url: `/api/videos/generations/${id}/frames`,
      headers: { "test-user": h.owner.id },
      payload,
    });
    assert.equal(bad.statusCode, 400, `${JSON.stringify(payload)} -> ${bad.statusCode}`);
  }
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

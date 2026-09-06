import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { maxImageReferenceBytes, maxImageReferences, newId } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { ImageAssetStore } from "../src/services/image-assets.js";
import { ImageGenerationService } from "../src/services/image-generation.js";
import { imageFixture, largeImageFixture } from "./helpers/image-fixture.js";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-images-test-"));
const config = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: [],
  databaseUrl: `file:${tmp}/test.db`,
  agentUrl: "http://127.0.0.1:59999",
  serverInternalUrl: "http://127.0.0.1:59998",
  provider: "anthropic",
  model: "",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  figmaEnabled: false,
  templatesDir: path.resolve("../../templates"),
  webDir: null,
  secretKey: randomBytes(32).toString("base64"),
  secretKeyFile: `${tmp}/secret.key`,
  attachmentsDir: `${tmp}/attachments`,
  uploadedSkillsDir: `${tmp}/skills`,
  runtime: {
    kind: "local",
    workspaceDir: `${tmp}/workspace`,
    execTimeoutMs: 30000,
    previewPortRange: [4960, 4965],
    previewHost: "127.0.0.1",
  },
} satisfies ServerConfig;
let server: ZelyqServer;
let owner: { cookie: string; id: string };
let other: { cookie: string; id: string };
const originalFetch = globalThis.fetch;
const originalKey = process.env.ZELYQ_IMAGE_API_KEY;
let lastProvider = "";
let calls = 0;
let mode: "ok" | "reject" | "timeout" | "bad-image" = "ok";
const png = imageFixture();
const input = (): import("@zelyq/core").ImageGenerationInput => ({
  prompt: "A quiet forest in watercolor",
  size: "1024x1024",
  quality: "medium",
  idempotencyKey: randomUUID(),
});
async function register(email: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: "Image test", password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, response.body);
  return {
    cookie: `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")!.value}`,
    id: response.json().user.id,
  };
}
async function post(payload = input(), cookie = owner.cookie) {
  return server.app.inject({
    method: "POST",
    url: "/api/images/generations",
    headers: { cookie },
    payload,
  });
}
async function finished(id: string) {
  for (let n = 0; n < 150; n++) {
    const row = await server.store.images.find(id);
    if (row && ["succeeded", "failed", "unknown"].includes(row.status)) return row;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Generation did not finish");
}
before(async () => {
  process.env.ZELYQ_IMAGE_API_KEY = "sk-test-image-only";
  globalThis.fetch = (async (url, init) => {
    const address = String(url);
    if (address.startsWith("https://generativelanguage.googleapis.com/")) {
      calls++;
      lastProvider = "google";
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "google-test-image-key");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.generationConfig.responseFormat.image, {
        aspectRatio: "ASPECT_RATIO_ONE_BY_ONE",
        imageSize: "IMAGE_SIZE_ONE_K",
      });
      assert.equal(body.generationConfig.quality, undefined);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    thought: true,
                    inlineData: { mimeType: "image/png", data: "invalid-thought-image" },
                  },
                  { inlineData: { mimeType: "image/png", data: png.toString("base64") } },
                ],
              },
            },
          ],
        }),
      );
    }
    if (address === "https://api.openai.com/v1/images/edits") {
      lastProvider = "openai-edit";
      calls++;
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-test-image-only");
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("model"), "gpt-image-2");
      assert.equal(init.body.get("prompt"), "A quiet forest in watercolor");
      assert.equal(init.body.get("size"), "1024x1024");
      assert.equal(init.body.get("quality"), "medium");
      assert.equal(init.body.getAll("image[]").length, 1);
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), {
        headers: { "x-request-id": "test-edit-request" },
      });
    }
    if (address === "https://api.x.ai/v1/images/generations") {
      calls++;
      lastProvider = "xai";
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer xai-test-image-key");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.aspect_ratio, "1:1");
      assert.equal(body.resolution, "1k");
      assert.equal(body.response_format, "b64_json");
      assert.equal(body.quality, "medium");
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
    }
    lastProvider = "openai";
    assert.equal(String(url), "https://api.openai.com/v1/images/generations");
    calls++;
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.model, "gpt-image-2");
    assert.equal(sent.output_format, "png");
    assert.equal(sent.n, 1);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-test-image-only");
    if (mode === "timeout") throw new Error("secret provider network detail");
    if (mode === "reject") return new Response('{"secret":"must not be exposed"}', { status: 400 });
    return new Response(
      JSON.stringify({
        data: [
          {
            b64_json:
              mode === "bad-image"
                ? Buffer.from("not an image").toString("base64")
                : png.toString("base64"),
          },
        ],
        usage: { total_tokens: 42 },
      }),
      { headers: { "x-request-id": "test-request" } },
    );
  }) as typeof fetch;
  await runMigrations(config.databaseUrl);
  await runMigrations(config.databaseUrl); // Repeat migration is safe.
  server = await buildServer(config);
  owner = await register(`owner-${randomUUID()}@example.com`);
  other = await register(`other-${randomUUID()}@example.com`);
});
after(async () => {
  await server.close();
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ZELYQ_IMAGE_API_KEY;
  else process.env.ZELYQ_IMAGE_API_KEY = originalKey;
  await fs.rm(tmp, { recursive: true, force: true });
});

test("generation is standalone, durable, private, downloadable, and idempotent", async () => {
  const request = input();
  const beforeCalls = calls;
  const [a, b] = await Promise.all([post(request), post(request)]);
  assert.equal(a.statusCode, 202, a.body);
  assert.equal(b.statusCode, 202, b.body);
  const id = a.json().generation.id;
  assert.equal(id, b.json().generation.id);
  assert.equal((await finished(id)).status, "succeeded");
  assert.equal(calls - beforeCalls, 1);
  await server.close();
  server = await buildServer(config);
  const result = await server.app.inject({
    url: `/api/images/assets/${id}?download=1`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.rawPayload, png);
  assert.match(result.headers["content-disposition"] as string, /attachment/);
  assert.equal(result.headers["cache-control"], "private, no-store");
  for (const url of [`/api/images/generations/${id}`, `/api/images/assets/${id}`]) {
    assert.equal(
      (await server.app.inject({ url, headers: { cookie: other.cookie } })).statusCode,
      404,
    );
    assert.equal((await server.app.inject({ url })).statusCode, 401);
  }
  assert.equal(
    (
      await server.app.inject({
        method: "DELETE",
        url: `/api/images/generations/${id}`,
        headers: { cookie: other.cookie },
      })
    ).statusCode,
    404,
  );
  const history = await server.app.inject({
    url: "/api/images/generations",
    headers: { cookie: owner.cookie },
  });
  assert.equal(history.json().generations[0].id, id);
  assert.equal((await post({ ...request, prompt: "different" })).statusCode, 409);
  const deleted = await server.app.inject({
    method: "DELETE",
    url: `/api/images/generations/${id}`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(deleted.statusCode, 204);
  assert.equal((await post(request)).statusCode, 409);
  assert.equal(
    (
      await server.app.inject({
        url: `/api/images/assets/${id}`,
        headers: { cookie: owner.cookie },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    await server.store.images.countRecent(owner.id, "2000"),
    1,
    "deleting does not reset quota",
  );
});

test("unsupported inputs and missing configuration never reach the provider", async () => {
  const beforeCalls = calls;
  assert.equal((await post({ ...input(), size: "999x999" as never })).statusCode, 400);
  assert.equal((await post({ ...input(), prompt: "  " })).statusCode, 400);
  process.env.ZELYQ_IMAGE_API_KEY = "";
  assert.equal((await post()).statusCode, 502);
  process.env.ZELYQ_IMAGE_API_KEY = "sk-test-image-only";
  assert.equal(calls, beforeCalls);
});

test("rejections and invalid images fail; uncertain submissions are not retried", async () => {
  for (const failure of ["reject", "bad-image", "timeout"] as const) {
    mode = failure;
    const beforeCalls = calls;
    const response = await post();
    assert.equal(response.statusCode, 202, response.body);
    const row = await finished(response.json().generation.id);
    assert.equal(row.status, failure === "timeout" ? "unknown" : "failed");
    assert.doesNotMatch(row.error ?? "", /secret/);
    assert.equal(calls, beforeCalls + 1);
  }
  mode = "ok";
});

test("expired submissions become unknown; complete saved images recover without provider calls", async () => {
  const assets = new ImageAssetStore(`${tmp}/images`);
  const service = new ImageGenerationService(server.store, { value: async () => "unused" }, assets);
  const beforeCalls = calls;
  for (const saving of [false, true]) {
    const id = newId("imageGeneration");
    await server.store.images.create(id, other.id, input(), "gpt-image-2");
    await server.store.images.claim(id, 0, "2000-01-01T00:00:00.000Z");
    if (saving) {
      await server.store.images.saving(id, {
        width: 1024,
        height: 1024,
        sizeBytes: png.length,
        providerRequestId: null,
        usage: null,
      });
      await assets.save(other.id, id, png);
    }
    await service.tick();
    assert.equal((await server.store.images.find(id))?.status, saving ? "succeeded" : "unknown");
  }
  assert.equal(calls, beforeCalls);
  await service.close();
});

test("storage failures retry saving, not the billable provider operation", async () => {
  let saves = 0;
  let generations = 0;
  class BrokenAssets extends ImageAssetStore {
    override async save() {
      saves++;
      throw new Error("disk full");
    }
  }
  const service = new ImageGenerationService(
    server.store,
    { value: async () => "test" },
    new BrokenAssets(tmp),
    {
      generate: async () => {
        generations++;
        return { bytes: png, width: 1024, height: 1024, requestId: null, usage: null };
      },
    },
  );
  const id = newId("imageGeneration");
  await server.store.images.create(id, other.id, input(), "gpt-image-2");
  await service.tick();
  const row = await finished(id);
  assert.equal(row.status, "failed");
  assert.match(row.error ?? "", /could not be saved/);
  assert.equal(generations, 1);
  assert.equal(saves, 3);
  await service.close();
});

test("the durable hourly limit is enforced even after deleting history", async () => {
  const limited = await register(`limited-${randomUUID()}@example.com`);
  // Read the limit rather than hardcoding it: it is an operator setting now,
  // and a copy of the number here would silently stop testing the real one.
  const capabilities = await server.app.inject({
    method: "GET",
    url: "/api/images/capabilities",
    headers: { cookie: limited.cookie },
  });
  const { hourlyLimit } = capabilities.json();
  for (let n = 0; n < hourlyLimit; n++) {
    const id = newId("imageGeneration");
    await server.store.images.create(id, limited.id, input(), "gpt-image-2");
    await server.store.images.finish(id, "failed");
    await server.store.images.remove(id);
  }
  const beforeCalls = calls;
  const response = await post(input(), limited.cookie);
  assert.equal(response.statusCode, 429, response.body);
  assert.equal(calls, beforeCalls);
});

test("image settings expose all three providers and route each request with the right credential", async () => {
  const response = await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie: owner.cookie },
    payload: { imageGoogleApiKey: "google-test-image-key", imageXaiApiKey: "xai-test-image-key" },
  });
  assert.equal(response.statusCode, 200, response.body);
  const group = response
    .json()
    .groups.find((group: { name: string }) => group.name === "Image Studio");
  assert.ok(group);
  assert.deepEqual(
    group.fields
      .find((field: { key: string }) => field.key === "imageProvider")
      .options.map((option: { value: string }) => option.value),
    ["openai", "google", "xai"],
  );
  assert.doesNotMatch(response.body, /google-test-image-key|xai-test-image-key/);
  for (const provider of ["google", "xai"] as const) {
    const response = await post({ ...input(), provider });
    assert.equal(response.statusCode, 202, response.body);
    const row = await finished(response.json().generation.id);
    assert.equal(row.status, "succeeded", row.error ?? "");
    assert.equal(row.provider, provider);
    assert.equal(lastProvider, provider);
  }
  const beforeCalls = calls;
  assert.equal((await post({ ...input(), provider: "google", quality: "high" })).statusCode, 400);
  assert.equal((await post({ ...input(), provider: "xai", quality: "high" })).statusCode, 400);
  assert.equal(calls, beforeCalls);
});

test("reference images are private, durable, and routed only to providers that support them", async () => {
  const reference = { mimeType: "image/png" as const, data: png.toString("base64") };
  const openai = await post({ ...input(), provider: "openai", references: [reference] });
  assert.equal(openai.statusCode, 202, openai.body);
  const openaiRow = await finished(openai.json().generation.id);
  assert.equal(openaiRow.status, "succeeded", openaiRow.error ?? "");
  assert.equal(openaiRow.referenceCount, 1);
  assert.equal(lastProvider, "openai-edit");
  const google = await post({ ...input(), provider: "google", references: [reference] });
  assert.equal(google.statusCode, 202, google.body);
  const googleRow = await finished(google.json().generation.id);
  assert.equal(googleRow.status, "succeeded", googleRow.error ?? "");
  assert.equal(googleRow.referenceCount, 1);
  const beforeCalls = calls;
  const xai = await post({ ...input(), provider: "xai", references: [reference] });
  assert.equal(xai.statusCode, 400, xai.body);
  assert.equal(calls, beforeCalls);
});

test("a full-size set of references is accepted rather than rejected as too large", async () => {
  // The tiny fixture PNG fits any limit, so it never proved the route accepts a
  // real photograph. The route's body limit was 64 KB — sized for a prompt-only
  // request — and every genuine upload failed with "request body too large".
  // Submit the largest payload the schema permits: three references at the
  // documented 8 MiB ceiling.
  const full = largeImageFixture(maxImageReferenceBytes);
  assert.ok(full.length > 4 * 1024 * 1024, `fixture too small: ${full.length}`);
  const references = Array.from({ length: maxImageReferences }, () => ({
    mimeType: "image/png" as const,
    data: full.toString("base64"),
  }));
  const response = await post({ ...input(), provider: "google", references });
  assert.notEqual(response.statusCode, 413, "route rejected a permitted reference payload");
  assert.equal(response.statusCode, 202, response.body);
  const row = await finished(response.json().generation.id);
  assert.equal(row.referenceCount, maxImageReferences);
});

// ---------------------------------------------------------------------------
// The agent's path in. Same service, same library, same limits as Studio; what
// differs is who asked and what is recorded about it.
// ---------------------------------------------------------------------------

async function agentProject(user: { id: string }, enabled = true) {
  const team = await server.store.teams.create({
    id: newId("team"),
    name: `t-${randomUUID()}`,
    slug: `t-${randomUUID()}`,
  });
  await server.store.teams.addMember(team.id, user.id, "owner");
  const project = await server.store.projects.create({
    id: newId("project"),
    teamId: team.id,
    name: "Landing page",
    slug: `p-${randomUUID()}`,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
    imageGenerationEnabled: enabled,
  });
  const token = await server.imageBridge.mint(newId("session"), project.id, user.id);
  return { project, token };
}

function bridged(token: string, method: "GET" | "POST", url: string, payload?: unknown) {
  return server.app.inject({
    method,
    url,
    headers: { "x-zelyq-image-bridge": token },
    ...(payload === undefined ? {} : { payload }),
  });
}

test("an agent generation is owned by the user and appears in their Studio library", async () => {
  const { project, token } = await agentProject(owner);
  assert.ok(token, "an allowed project should get a bridge token");
  const submit = await bridged(token!, "POST", "/api/internal/images/generations", {
    prompt: "An abstract hero gradient",
    size: "1024x1024",
    quality: "medium",
    idempotencyKey: randomUUID(),
  });
  assert.equal(submit.statusCode, 202, submit.body);
  const id = submit.json().generation.id;
  const row = await finished(id);
  assert.equal(row.status, "succeeded", row.error ?? "");

  // Owned by the person, not the project or the agent — this is what puts it
  // in their Studio rather than somewhere only the agent can see.
  assert.equal(row.ownerId, owner.id);
  assert.equal(row.source, "agent");
  assert.equal(row.projectId, project.id);
  assert.equal(row.projectName, "Landing page");

  const history = await server.app.inject({
    method: "GET",
    url: "/api/images/generations",
    headers: { cookie: owner.cookie },
  });
  assert.equal(history.statusCode, 200, history.body);
  const listed = history.json().generations.find((item: { id: string }) => item.id === id);
  assert.ok(listed, "the agent's image should be in the user's Studio history");
  assert.equal(listed.source, "agent");
  assert.equal(listed.projectName, "Landing page");
});

test("the bytes endpoint returns the full PNG and a smaller preview", async () => {
  const { token } = await agentProject(owner);
  const submit = await bridged(token!, "POST", "/api/internal/images/generations", {
    prompt: "A soft paper texture",
    idempotencyKey: randomUUID(),
  });
  const id = submit.json().generation.id;
  await finished(id);
  const bytes = await bridged(token!, "GET", `/api/internal/images/generations/${id}/bytes`);
  assert.equal(bytes.statusCode, 200, bytes.body);
  const body = bytes.json();
  const png = Buffer.from(body.png, "base64");
  const preview = Buffer.from(body.preview, "base64");
  assert.equal(png.subarray(0, 4).toString("hex"), "89504e47", "png should be a real PNG");
  assert.equal(preview.subarray(0, 4).toString("hex"), "89504e47");
  assert.ok(
    preview.length < png.length,
    `the preview (${preview.length}) should be smaller than the image (${png.length})`,
  );
});

test("a project without permission is given no token at all", async () => {
  const { token } = await agentProject(owner, false);
  assert.equal(token, null, "no permission means no capability to give the agent");
});

test("one user's bridge cannot read another user's image", async () => {
  const mine = await post(input(), owner.cookie);
  const id = mine.json().generation.id;
  await finished(id);
  const { token } = await agentProject(other);
  const stolen = await bridged(token!, "GET", `/api/internal/images/generations/${id}`);
  assert.equal(stolen.statusCode, 404, stolen.body);
  const stolenBytes = await bridged(token!, "GET", `/api/internal/images/generations/${id}/bytes`);
  assert.equal(stolenBytes.statusCode, 404, stolenBytes.body);
});

test("an invalid or absent bridge token is refused", async () => {
  const none = await server.app.inject({
    method: "GET",
    url: "/api/internal/images/library",
  });
  assert.equal(none.statusCode, 401, none.body);
  const bogus = await bridged("not-a-token", "GET", "/api/internal/images/library");
  assert.equal(bogus.statusCode, 401, bogus.body);
});

test("the per-conversation cap stops a runaway agent", async () => {
  const capped = await register(`capped-${randomUUID()}@example.com`);
  const team = await server.store.teams.create({
    id: newId("team"),
    name: `c-${randomUUID()}`,
    slug: `c-${randomUUID()}`,
  });
  await server.store.teams.addMember(team.id, capped.id, "owner");
  const project = await server.store.projects.create({
    id: newId("project"),
    teamId: team.id,
    name: "Capped",
    slug: `c-${randomUUID()}`,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
    imageGenerationEnabled: true,
  });
  const sessionId = newId("session");
  const token = (await server.imageBridge.mint(sessionId, project.id, capped.id))!;
  const limit = Number(process.env.ZELYQ_IMAGE_SESSION_LIMIT ?? 6);

  for (let n = 0; n < limit; n++) {
    const response = await bridged(token, "POST", "/api/internal/images/generations", {
      prompt: `Image ${n}`,
      idempotencyKey: randomUUID(),
    });
    assert.equal(response.statusCode, 202, response.body);
    await finished(response.json().generation.id);
  }
  const overflow = await bridged(token, "POST", "/api/internal/images/generations", {
    prompt: "One too many",
    idempotencyKey: randomUUID(),
  });
  assert.equal(overflow.statusCode, 429, overflow.body);
});

test("account deletion removes private images and generation metadata", async () => {
  const id = newId("imageGeneration");
  await server.store.images.create(id, other.id, input(), "gpt-image-2");
  await server.store.images.finish(id, "failed");
  await new ImageAssetStore(`${tmp}/images`).save(other.id, id, png);
  const response = await server.app.inject({
    method: "DELETE",
    url: `/api/users/${other.id}`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(response.statusCode, 204, response.body);
  assert.equal(await server.store.images.find(id), null);
  await assert.rejects(fs.stat(`${tmp}/images/${other.id}`));
});

import assert from "node:assert/strict";
import http from "node:http";
import { after, afterEach, before, test } from "node:test";
import { ALL_TOOLS } from "../src/index.js";
import { __setReferenceImageFetch, fetchReferenceImageTool } from "../src/reference-image.js";
import type { ToolContext } from "../src/types.js";

/**
 * fetch_reference_image fetches from the agent process through the SSRF
 * guard, not with curl inside the project runtime, so it works wherever the
 * agent runs. The network is replaced here; the last test keeps the real one
 * to show the guard is in the path.
 */

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

type Reply = { status: number; body: Buffer };
const ok = (body: Buffer | string): Reply => ({ status: 200, body: Buffer.from(body) });

function context() {
  const files = new Map<string, Buffer | string>();
  const changed: string[] = [];
  const value = {
    projectId: "prj_img",
    signal: new AbortController().signal,
    log: () => undefined,
    onFileChanged: (p: string) => changed.push(p),
    runtime: {
      async writeFile(_id: string, path: string, content: string, encoding?: string) {
        files.set(path, encoding === "base64" ? Buffer.from(content, "base64") : content);
      },
    },
  } as unknown as ToolContext;
  return { value, files, changed };
}

let requests: Array<{ url: string; headers: Record<string, string> }> = [];
let original: ReturnType<typeof __setReferenceImageFetch>;
const savedEnv = { ...process.env };

function network(answer: (url: string) => Reply | Error) {
  __setReferenceImageFetch(async (url, headers) => {
    requests.push({ url, headers });
    const reply = answer(url);
    if (reply instanceof Error) throw reply;
    return { ...reply, headers: {}, finalUrl: url };
  });
}

before(() => {
  original = __setReferenceImageFetch(async () => {
    throw new Error("no network in this test");
  });
});
afterEach(() => {
  requests = [];
  process.env = { ...savedEnv };
  delete process.env.ZELYQ_IMAGE_PROVIDER;
  delete process.env.ZELYQ_IMAGE_PROVIDER_KEY;
});
after(() => {
  __setReferenceImageFetch(original);
});

const run = (ctx: ReturnType<typeof context>, input: Record<string, unknown>) =>
  fetchReferenceImageTool.run(ctx.value, fetchReferenceImageTool.schema.parse(input));

test("it is a built-in tool, present without any plugin", () => {
  assert.ok(ALL_TOOLS.some((tool) => tool.name === "fetch_reference_image"));
});

test("an Openverse hit is downloaded into the project and shown back", async () => {
  delete process.env.ZELYQ_IMAGE_PROVIDER;
  network((url) =>
    new URL(url).hostname === "api.openverse.org"
      ? ok(
          JSON.stringify({
            results: [
              {
                url: "https://cdn.example/kyoto.jpg",
                creator: "A. Photographer",
                license: "by",
                license_version: "4.0",
                foreign_landing_url: "https://openverse.org/i/1",
              },
            ],
          }),
        )
      : ok(JPEG),
  );
  const ctx = context();
  const result = await run(ctx, { query: "kyoto temple", output_path: "src/assets/kyoto.jpg" });

  assert.notEqual(result.isError, true, result.output);
  assert.equal(result.images?.[0]?.mimeType, "image/jpeg");
  assert.match(result.output, /from openverse/);
  assert.match(result.output, /A\. Photographer · BY 4\.0/);
  assert.deepEqual(ctx.changed, ["src/assets/kyoto.jpg"]);
  assert.deepEqual(ctx.files.get("src/assets/kyoto.jpg"), JPEG);
  assert.match(requests[0]?.url ?? "", /api\.openverse\.org.*q=kyoto%20temple/);
  assert.equal(requests[1]?.url, "https://cdn.example/kyoto.jpg");
});

test("a result that is not an image is skipped for the next one", async () => {
  network((url) => {
    if (url.includes("openverse")) {
      return ok(
        JSON.stringify({
          results: [{ url: "https://a.example/error.jpg" }, { url: "https://b.example/ok.jpg" }],
        }),
      );
    }
    return url.includes("error") ? ok("<html>Not found</html>") : ok(JPEG);
  });
  const ctx = context();
  const result = await run(ctx, { query: "harbour", output_path: "public/harbour.jpg" });
  assert.equal(result.images?.[0]?.mimeType, "image/jpeg");
  assert.deepEqual(ctx.files.get("public/harbour.jpg"), JPEG);
});

test("no results gives a labelled SVG placeholder at the same path, never a guess", async () => {
  network(() => ok(JSON.stringify({ results: [] })));
  const ctx = context();
  const result = await run(ctx, { query: "nowhere in particular", output_path: "public/hero.jpg" });

  assert.match(result.output, /PLACEHOLDER/);
  assert.match(result.output, /do NOT write copy/);
  // No picture of the grey box: OpenAI and Claude refuse an SVG outright.
  assert.equal(result.images, undefined);
  assert.ok(ctx.files.has("public/hero.svg"));
  assert.ok(!ctx.files.has("public/hero.jpg"));
});

test("a long query that finds nothing is tried again shorter before a placeholder", async () => {
  // What a real GPT turn asked for, which Openverse matched with nothing.
  network((url) => {
    if (!url.includes("openverse")) return ok(JPEG);
    const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
    return ok(
      JSON.stringify({
        results: q === "restaurant table" ? [{ url: "https://cdn.example/table.jpg" }] : [],
      }),
    );
  });
  const ctx = context();
  const result = await run(ctx, {
    query: "restaurant table dinner plates glasses warm elegant dining",
    output_path: "src/assets/table.jpg",
  });
  assert.equal(result.images?.[0]?.mimeType, "image/jpeg", result.output);
  assert.match(result.output, /Query was "restaurant table"/);
  const searches = requests.filter((r) => r.url.includes("openverse")).length;
  assert.equal(searches, 3, "the full query, then three words, then two");
});

test("unsplash without a key writes a placeholder and makes no request", async () => {
  process.env.ZELYQ_IMAGE_PROVIDER = "unsplash";
  network(() => ok(JPEG));
  const ctx = context();
  const result = await run(ctx, { query: "santorini", output_path: "a.png" });
  assert.match(result.output, /ZELYQ_IMAGE_PROVIDER_KEY is not set/);
  assert.equal(requests.length, 0);
});

test("an unsplash key goes in the search request's header only", async () => {
  process.env.ZELYQ_IMAGE_PROVIDER = "unsplash";
  process.env.ZELYQ_IMAGE_PROVIDER_KEY = "secret-key-123";
  network((url) =>
    new URL(url).hostname === "api.unsplash.com"
      ? ok(
          JSON.stringify({
            results: [{ urls: { regular: "https://images.unsplash.com/x" }, user: { name: "U" } }],
          }),
        )
      : ok(JPEG),
  );
  const ctx = context();
  const result = await run(ctx, { query: "fjord", output_path: "c.jpg" });
  assert.notEqual(result.isError, true, result.output);
  assert.equal(requests[0]?.headers.authorization, "Client-ID secret-key-123");
  assert.doesNotMatch(requests[0]?.url ?? "", /secret-key-123/);
  assert.equal(requests[1]?.headers.authorization, undefined, "not sent to the image host");
  assert.doesNotMatch(result.output, /secret-key-123/);
});

test("a failed search gives a placeholder that says why", async () => {
  network(() => new Error("getaddrinfo ENOTFOUND api.openverse.org"));
  const ctx = context();
  const result = await run(ctx, { query: "amalfi coast", output_path: "b.webp" });
  assert.match(result.output, /PLACEHOLDER/);
  assert.match(result.output, /ENOTFOUND/);
  assert.ok(ctx.files.has("b.svg"));
});

test("the real fetch goes through the guard: an internal address is refused", async () => {
  // A search result pointing at a service on this machine, as a poisoned
  // index could. The guard must refuse it; the server must see nothing.
  let hits = 0;
  const internal = http.createServer((_req, res) => {
    hits += 1;
    res.end(JPEG);
  });
  await new Promise<void>((resolve) => internal.listen(0, "127.0.0.1", resolve));
  const port = (internal.address() as { port: number }).port;
  try {
    // The search answer is scripted; the download is the real, guarded fetch.
    let first = true;
    __setReferenceImageFetch(async (url, headers) => {
      if (!first) return original(url, headers);
      first = false;
      return {
        status: 200,
        headers: {},
        body: Buffer.from(JSON.stringify({ results: [{ url: `http://127.0.0.1:${port}/x.jpg` }] })),
        finalUrl: url,
      };
    });
    const ctx = context();
    const result = await run(ctx, { query: "anything", output_path: "x.jpg" });
    assert.match(result.output, /PLACEHOLDER/);
    assert.equal(hits, 0, "the internal service was reached");
    assert.ok(!ctx.files.has("x.jpg"));
  } finally {
    await new Promise<void>((resolve) => internal.close(() => resolve()));
  }
});

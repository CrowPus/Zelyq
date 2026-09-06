import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateImageTool,
  listGeneratedImagesTool,
  placeGeneratedImageTool,
} from "../src/images.js";
import type { ToolContext } from "../src/types.js";

/**
 * The image tools call the Zelyq server through the session bridge, which the
 * server mints only when the project has permission. These cover the refusals,
 * the path rules, and that a placed image is written as real bytes rather than
 * as text.
 */

const ID = "img_0123456789abcdef0123456789abcdef";

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    projectId: "prj_x",
    runtime: {
      readFile: async () => ({
        path: "src/assets/ref.png",
        content: Buffer.from("fake-png-bytes").toString("base64"),
        encoding: "base64",
      }),
      writeFile: async () => undefined,
    } as unknown as ToolContext["runtime"],
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
    ...over,
  };
}

const bridge = { url: "http://server.local", token: "img_bridge_secret" };

test("generate_image refuses when the project has no permission", async () => {
  // No bridge on the context is exactly what "the user has not switched this
  // on" looks like from inside a tool.
  await assert.rejects(
    () => generateImageTool.run(ctx(), { prompt: "a hero image" }),
    /not switched on for this project/,
  );
});

test("list_generated_images refuses without a bridge too", async () => {
  await assert.rejects(
    () => listGeneratedImagesTool.run(ctx(), {}),
    /not switched on for this project/,
  );
});

test("an output path must be a relative .png inside the project", async () => {
  const cases = [
    ["src/assets/hero.jpg", /must end in \.png/],
    ["/etc/passwd.png", /must be relative/],
    ["../../escape.png", /must not contain/],
  ] as const;
  for (const [path, expected] of cases) {
    const result = await generateImageTool.run(ctx({ imageBridge: bridge }), {
      prompt: "x",
      output_path: path,
    });
    assert.equal(result.isError, true, `${path} should be refused`);
    assert.match(result.output, expected);
  }
});

test("place_generated_image validates the id before calling anything", async () => {
  const result = await placeGeneratedImageTool.run(ctx({ imageBridge: bridge }), {
    image_id: "not-an-id",
    output_path: "src/assets/hero.png",
  });
  assert.equal(result.isError, true);
  assert.match(result.output, /not a valid image id/);
});

test("place_generated_image writes real bytes through the runtime and reports the path", async () => {
  const writes: Array<{ path: string; content: string; encoding?: string }> = [];
  const changed: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    assert.match(String(url), /\/api\/internal\/images\/generations\/img_.*\/bytes$/);
    assert.equal(
      new Headers(init?.headers).get("x-zelyq-image-bridge"),
      "img_bridge_secret",
      "the bridge token authenticates the call",
    );
    return new Response(
      JSON.stringify({
        png: Buffer.from("full-image").toString("base64"),
        preview: Buffer.from("small").toString("base64"),
        width: 1024,
        height: 1024,
        sizeBytes: 10,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const result = await placeGeneratedImageTool.run(
      ctx({
        imageBridge: bridge,
        onFileChanged: (path) => changed.push(path),
        runtime: {
          writeFile: async (_p: string, path: string, content: string, encoding?: string) => {
            writes.push({ path, content, encoding });
          },
        } as unknown as ToolContext["runtime"],
      }),
      { image_id: ID, output_path: "src/assets/hero.png" },
    );
    assert.equal(result.isError, undefined);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "src/assets/hero.png");
    assert.equal(writes[0].encoding, "base64", "a PNG must not be written as utf8 text");
    assert.equal(Buffer.from(writes[0].content, "base64").toString(), "full-image");
    assert.deepEqual(changed, ["src/assets/hero.png"], "the UI is told the file changed");
    // The model is shown the small preview, never the full image.
    assert.equal(result.images?.[0]?.data, Buffer.from("small").toString("base64"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("list_generated_images reports an empty library plainly", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ generations: [], nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const result = await listGeneratedImagesTool.run(ctx({ imageBridge: bridge }), {});
    assert.match(result.output, /empty/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("list_generated_images hides unfinished work and labels who made each image", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        generations: [
          {
            id: ID,
            prompt: "A hero gradient",
            status: "succeeded",
            size: "1024x1024",
            source: "agent",
            projectName: "Landing page",
            createdAt: "2026-09-06T00:00:00.000Z",
          },
          {
            id: "img_ffffffffffffffffffffffffffffffff",
            prompt: "still going",
            status: "generating",
            size: "1024x1024",
            source: "studio",
            projectName: "",
            createdAt: "2026-09-06T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  try {
    const result = await listGeneratedImagesTool.run(ctx({ imageBridge: bridge }), {});
    assert.match(result.output, /1 image\(s\) available/);
    assert.match(result.output, /made by the agent in Landing page/);
    assert.doesNotMatch(result.output, /still going/, "an unfinished image is not offered for use");
  } finally {
    globalThis.fetch = realFetch;
  }
});

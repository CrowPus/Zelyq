import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolContext } from "../src/types.js";
import {
  generateVideoTool,
  listGeneratedVideosTool,
  placeVideoFramesTool,
  placeVideoTool,
} from "../src/videos.js";

/**
 * The video tools call the server over a session bridge that only exists when
 * the project has been given permission — a separate permission from images.
 */

const ID = "vid_0123456789abcdef0123456789abcdef";
const bridge = { url: "http://server.local", token: "vid_bridge_secret" };

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    projectId: "prj_x",
    runtime: { writeFile: async () => undefined } as unknown as ToolContext["runtime"],
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
    ...over,
  };
}

test("every video tool refuses when the project has no permission", async () => {
  // No bridge on the context is what "the user has not switched video on"
  // looks like from inside a tool.
  await assert.rejects(
    () => generateVideoTool.run(ctx(), { prompt: "drifting particles" }),
    /not switched on for this project/,
  );
  await assert.rejects(() => listGeneratedVideosTool.run(ctx(), {}), /not switched on/);
  await assert.rejects(
    () => placeVideoTool.run(ctx(), { video_id: ID, output_path: "public/media/hero.mp4" }),
    /not switched on/,
  );
});

test("place_video refuses a bad id or an unsafe path", async () => {
  const cases = [
    [{ video_id: "nope", output_path: "public/media/hero.mp4" }, /not a valid video id/],
    [{ video_id: ID, output_path: "public/media/hero.webm" }, /must end in \.mp4/],
    [{ video_id: ID, output_path: "/etc/hero.mp4" }, /must be relative/],
    [{ video_id: ID, output_path: "../../hero.mp4" }, /must not contain/],
  ] as const;
  for (const [input, expected] of cases) {
    const result = await placeVideoTool.run(ctx({ videoBridge: bridge }), input);
    assert.equal(result.isError, true, `${input.output_path} should be refused`);
    assert.match(result.output, expected);
  }
});

test("place_video writes the clip and its poster as bytes, not text", async () => {
  const writes: Array<{ path: string; encoding?: string; content: string }> = [];
  const changed: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("x-zelyq-video-bridge"), "vid_bridge_secret");
    assert.match(String(url), /\/generations\/vid_.*\/bytes$/);
    return new Response(
      JSON.stringify({
        mp4: Buffer.from("mp4-bytes").toString("base64"),
        poster: Buffer.from("poster-bytes").toString("base64"),
        width: 1280,
        height: 720,
        durationSeconds: 8,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const result = await placeVideoTool.run(
      ctx({
        videoBridge: bridge,
        onFileChanged: (p) => changed.push(p),
        runtime: {
          writeFile: async (_p: string, path: string, content: string, encoding?: string) => {
            writes.push({ path, content, encoding });
          },
        } as unknown as ToolContext["runtime"],
      }),
      { video_id: ID, output_path: "public/media/hero.mp4" },
    );
    assert.equal(result.isError, undefined, result.output);
    assert.deepEqual(
      writes.map((w) => w.path),
      ["public/media/hero.mp4", "public/media/hero.webp"],
      "the poster is written beside the clip",
    );
    for (const write of writes)
      assert.equal(write.encoding, "base64", "media must not be written as utf8 text");
    assert.equal(Buffer.from(writes[0].content, "base64").toString(), "mp4-bytes");
    assert.deepEqual(changed, ["public/media/hero.mp4", "public/media/hero.webp"]);
    // The result must steer the caller to a loop, not a scrub.
    assert.match(result.output, /muted \+ loop/);
    assert.match(result.output, /prefers-reduced-motion/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("place_video_frames writes the sequence where the scroll-scrub recipe reads it", async () => {
  const writes: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    assert.match(String(url), /\/generations\/vid_.*\/frames$/);
    return new Response(
      JSON.stringify({
        frames: { count: 2, width: 1600, height: 900, fps: 24, format: "webp" },
        files: [
          { name: "manifest.json", data: Buffer.from("{}").toString("base64") },
          { name: "poster.webp", data: Buffer.from("p").toString("base64") },
          { name: "frame_0001.webp", data: Buffer.from("a").toString("base64") },
          { name: "frame_0002.webp", data: Buffer.from("b").toString("base64") },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const result = await placeVideoFramesTool.run(
      ctx({
        videoBridge: bridge,
        runtime: {
          writeFile: async (_p: string, path: string) => {
            writes.push(path);
          },
        } as unknown as ToolContext["runtime"],
      }),
      { video_id: ID, slug: "hero" },
    );
    assert.equal(result.isError, undefined, result.output);
    assert.deepEqual(writes, [
      "public/cinematic/hero/manifest.json",
      "public/cinematic/hero/poster.webp",
      "public/cinematic/hero/frame_0001.webp",
      "public/cinematic/hero/frame_0002.webp",
    ]);
    assert.match(result.output, /manifest\.json/);
    assert.match(result.output, /Do not hardcode the frame count/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("place_video_frames refuses a slug that is not a plain folder name", async () => {
  for (const slug of ["../escape", "Hero", "a/b", ""]) {
    const parsed = placeVideoFramesTool.schema.safeParse({ video_id: ID, slug });
    assert.equal(parsed.success, false, `"${slug}" should be refused by the schema`);
  }
  assert.equal(placeVideoFramesTool.schema.safeParse({ video_id: ID, slug: "hero" }).success, true);
});

test("an unconfirmed generation is reported as such, never as done", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith("/generations"))
      return new Response(JSON.stringify({ generation: { id: ID }, used: 1, limit: 2 }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    return new Response(JSON.stringify({ generation: { id: ID, status: "unknown" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await generateVideoTool.run(ctx({ videoBridge: bridge }), {
      prompt: "abstract light",
    });
    assert.equal(result.isError, true);
    assert.match(result.output, /could not be confirmed/);
    assert.match(result.output, /NOT resubmitted automatically/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import type { Preview } from "@zelyq/core";
import { executeTool } from "../src/index.js";
import type { ToolContext } from "../src/types.js";

/**
 * `view_preview`. The page here is served
 * over a real HTTP server and captured by a real headless Chromium, the same
 * standard `apps/agent/test/renders-check.test.ts` already holds for
 * `renderReport`: what's under test is whether a real browser produces a
 * real image, and a stub would only prove the stub agrees with itself.
 */

let server: http.Server;
let base: string;
const requestedPaths: string[] = [];

before(async () => {
  server = http.createServer((request, response) => {
    requestedPaths.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/html" }).end(
      `<!doctype html><html><body style="margin:0;background:#1a2b3c">
         <h1 style="color:#fff">hello from the preview</h1>
       </body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function stubContext(preview: Partial<Preview>): ToolContext {
  return {
    projectId: "prj_test",
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
    runtime: {
      previewStatus: async () => ({
        projectId: "prj_test",
        status: "running",
        url: null,
        port: null,
        pid: null,
        startedAt: null,
        lastError: null,
        ...preview,
      }),
    } as unknown as ToolContext["runtime"],
  };
}

test("view_preview returns a real JPEG screenshot of a running preview", async () => {
  const result = await executeTool(
    stubContext({ status: "running", url: base }),
    "view_preview",
    {},
  );

  assert.notEqual(result.isError, true, result.output);
  assert.equal(result.images?.length, 1);
  const image = result.images![0]!;
  assert.equal(image.mimeType, "image/jpeg");

  // FF D8 is a real JPEG's own magic bytes — proof this is an actual encoded
  // image, not a stand-in string dressed up as one.
  const bytes = Buffer.from(image.data, "base64");
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
  assert.ok(bytes.length > 500, "a real screenshot is more than a few hundred bytes");
});

test("view_preview loads the given path, not just the preview root", async () => {
  requestedPaths.length = 0;
  const result = await executeTool(stubContext({ status: "running", url: base }), "view_preview", {
    path: "/#/destination/kyoto",
  });

  assert.notEqual(result.isError, true, result.output);
  assert.equal(result.images?.length, 1);
  // The server records what the browser actually asked for. The hash is
  // client-side so the HTTP path is "/", but the full navigated URL is
  // echoed back in the tool output.
  assert.match(result.output, /#\/destination\/kyoto/);
});

test("view_preview rejects a malformed path instead of navigating to the root", async () => {
  const result = await executeTool(stubContext({ status: "running", url: base }), "view_preview", {
    path: "http://example.com:99999999999/x",
  });

  assert.equal(result.isError, true);
  assert.match(result.output, /Not a valid path/);
});

test("view_preview fails cleanly, without touching a browser, when nothing is running", async () => {
  const result = await executeTool(
    stubContext({ status: "stopped", url: null }),
    "view_preview",
    {},
  );

  assert.equal(result.isError, true);
  assert.match(result.output, /isn't running/);
  assert.equal(result.images, undefined);
});

test("view_preview reports a clear error rather than throwing when the page can't be reached", async () => {
  // A believable status/url pair the browser still can't actually load —
  // the preview crashed the instant after previewStatus was asked, or the
  // port never really opened. Either way this must come back as a normal
  // tool error, the same shape every other tool failure takes.
  const result = await executeTool(
    stubContext({ status: "running", url: "http://127.0.0.1:1" }),
    "view_preview",
    {},
  );

  assert.equal(result.isError, true);
  assert.match(result.output, /Could not capture the preview/);
});

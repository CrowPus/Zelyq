import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { executeTool } from "../src/index.js";
import type { ToolContext } from "../src/types.js";

/**
 * The browser checks against a real Chromium and a real page. The case that
 * mattered: an app that throws while it loads. The old plugin attached its
 * exception listener after the page had loaded and reported no errors.
 */

const pages: Record<string, string> = {
  "/": `<!doctype html><html lang="en"><body><main><h1>Shop</h1><button>Buy</button></main></body></html>`,
  "/crash": `<!doctype html><html lang="en"><body><div id="root"></div>
    <script>throw new Error("Cannot read properties of undefined (reading 'map')")</script></body></html>`,
  "/missing": `<!doctype html><html><body><p>x</p><img src="/nope.png"></body></html>`,
  "/wide": `<!doctype html><html lang="en"><body style="margin:0"><div style="width:900px">wide</div></body></html>`,
};

let server: http.Server;
let url = "";

before(async () => {
  server = http.createServer((request, response) => {
    const body = pages[request.url ?? "/"];
    if (body === undefined) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function context(status: "running" | "stopped" = "running"): ToolContext {
  return {
    projectId: "prj_qa",
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
    runtime: {
      previewStatus: async () => (status === "running" ? { status, url } : { status }),
    } as unknown as ToolContext["runtime"],
  };
}

describe("built-in browser checks", () => {
  it("check_console_errors catches an exception thrown while the page loads", async () => {
    const result = await executeTool(context(), "check_console_errors", { path: "/crash" });
    assert.equal(result.isError, undefined, result.output);
    const report = JSON.parse(result.output);
    assert.equal(report.pageErrors.length, 1);
    assert.match(report.pageErrors[0], /reading 'map'/);
    assert.equal(report.blankPage, true);
  });

  it("a clean page reports nothing wrong", async () => {
    const report = JSON.parse((await executeTool(context(), "check_console_errors", {})).output);
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.httpErrors, []);
    assert.equal(report.blankPage, false);
  });

  it("a missing asset shows up as a 404", async () => {
    const report = JSON.parse(
      (await executeTool(context(), "check_network_failures", { path: "/missing" })).output,
    );
    assert.ok(report.httpErrors.some((e: { status: number }) => e.status === 404));
  });

  it("inspect_page reads the structure", async () => {
    const report = JSON.parse((await executeTool(context(), "inspect_page", {})).output);
    assert.deepEqual(report.headings, ["Shop"]);
    assert.deepEqual(report.buttons, ["Buy"]);
  });

  it("accessibility_audit finds a missing lang and alt text", async () => {
    const report = JSON.parse(
      (await executeTool(context(), "accessibility_audit", { path: "/missing" })).output,
    );
    const rules = report.issues.map((i: { rule: string }) => i.rule);
    assert.ok(rules.includes("html-lang"));
    assert.ok(rules.includes("image-alt"));
  });

  it("test_responsive_layout reports sideways scrolling at phone width only", async () => {
    const report = JSON.parse(
      (
        await executeTool(context(), "test_responsive_layout", {
          path: "/wide",
          widths: [375, 1280],
        })
      ).output,
    );
    assert.equal(report[0].horizontalOverflow, true);
    assert.equal(report[1].horizontalOverflow, false);
  });

  it("a stopped preview is a clear error", async () => {
    const result = await executeTool(context("stopped"), "check_console_errors", {});
    assert.equal(result.isError, true);
    assert.match(result.output, /isn't running/);
  });

  it("a path outside the preview is refused", async () => {
    const result = await executeTool(context(), "inspect_page", { path: "https://example.com/" });
    assert.equal(result.isError, true);
  });
});

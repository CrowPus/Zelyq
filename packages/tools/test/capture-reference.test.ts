import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CaptureSummary,
  captureReferenceTool,
  guessFramework,
  hostSlug,
  isAssetType,
  isDisallowed,
  normalizePath,
  parseRobots,
  pathToDir,
  pickExtension,
  summarize,
} from "../src/capture-reference.ts";

test("hostSlug lowercases, drops www., and sanitises", () => {
  assert.equal(hostSlug("www.Example.com"), "example.com");
  assert.equal(hostSlug("shop.example.co.uk"), "shop.example.co.uk");
  assert.equal(hostSlug("EXAMPLE.com:8080"), "example.com-8080");
});

test("normalizePath keeps same-origin paths and rejects the rest", () => {
  const base = new URL("https://example.com/");
  assert.equal(normalizePath("/about/", base), "/about");
  assert.equal(normalizePath("https://example.com/blog/post?x=1#h", base), "/blog/post");
  assert.equal(normalizePath("/", base), "/");
  assert.equal(normalizePath("https://other.com/x", base), null);
  assert.equal(normalizePath("mailto:a@b.com", base), null);
  assert.equal(normalizePath("/files/report.pdf", base), null);
});

test("pathToDir maps root to index and keeps nesting", () => {
  assert.equal(pathToDir("/"), "index");
  assert.equal(pathToDir("/about"), "about");
  assert.equal(pathToDir("/blog/my-post"), "blog/my-post");
});

test("parseRobots only takes Disallow under User-agent: *", () => {
  const txt = [
    "User-agent: Googlebot",
    "Disallow: /nope",
    "",
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /private/",
    "Allow: /",
  ].join("\n");
  assert.deepEqual(parseRobots(txt), ["/admin", "/private/"]);
});

test("isDisallowed matches by prefix, and '/' blocks everything", () => {
  assert.equal(isDisallowed("/admin/users", ["/admin"]), true);
  assert.equal(isDisallowed("/about", ["/admin"]), false);
  assert.equal(isDisallowed("/anything", ["/"]), true);
});

test("pickExtension prefers content-type, falls back to the URL", () => {
  assert.equal(pickExtension("image/png", "https://x/y"), "png");
  assert.equal(pickExtension("image/svg+xml; charset=utf-8", "https://x/y"), "svg");
  assert.equal(pickExtension(undefined, "https://x/logo.WEBP?v=2"), "webp");
  assert.equal(pickExtension(undefined, "https://x/no-ext"), "bin");
});

test("isAssetType recognises image / font / video content types", () => {
  assert.equal(isAssetType("image/avif"), true);
  assert.equal(isAssetType("font/woff2"), true);
  assert.equal(isAssetType("text/html"), false);
  assert.equal(isAssetType(undefined), false);
});

test("guessFramework spots the common generators", () => {
  assert.equal(guessFramework('<script id="__NEXT_DATA__">'), "Next.js");
  assert.equal(guessFramework('<div id="root"></div>'), "React (SPA)");
  assert.equal(guessFramework('<link href="/wp-content/themes/x/style.css">'), "WordPress");
  assert.equal(guessFramework("<html><body>plain</body></html>"), "unknown / hand-rolled");
});

test("summarize stays compact and never dumps the DOM", () => {
  const s: CaptureSummary = {
    host: "example.com",
    entryUrl: "https://example.com/",
    mode: "site",
    pages: [
      { path: "/", title: "Home", widths: [390, 1440] },
      { path: "/about", title: "About", widths: [390, 1440] },
    ],
    widths: [390, 1440],
    framework: "Next.js",
    fonts: ["Inter 400 normal"],
    assets: { copied: 12, failed: 1, skipped: 0 },
    robotsSkipped: ["/admin"],
    bundleDir: "clone/example.com",
    notes: ["hit the 6-minute wall-clock budget"],
  };
  const text = summarize(s);
  assert.ok(text.length < 4096, "summary must be under 4 KB");
  assert.match(text, /REPLICA\.md/);
  assert.match(text, /12 copied, 1 failed/);
  assert.match(text, /robots\.txt skipped: \/admin/);
});

test("the tool refuses a non-http(s) URL before launching a browser", async () => {
  const result = await captureReferenceTool.run(
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake context, never reached
    { projectId: "p", signal: new AbortController().signal, log() {}, onFileChanged() {} } as any,
    { url: "file:///etc/passwd" },
  );
  assert.equal(result.isError, true);
  assert.match(result.output, /Refusing to capture/);
});

test("the tool honours ZELYQ_CLONE_ENABLED=false", async () => {
  const prev = process.env.ZELYQ_CLONE_ENABLED;
  process.env.ZELYQ_CLONE_ENABLED = "false";
  try {
    const result = await captureReferenceTool.run(
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake context, never reached
      { projectId: "p", signal: new AbortController().signal, log() {}, onFileChanged() {} } as any,
      { url: "https://example.com/" },
    );
    assert.equal(result.isError, true);
    assert.match(result.output, /disabled/);
  } finally {
    if (prev === undefined) delete process.env.ZELYQ_CLONE_ENABLED;
    else process.env.ZELYQ_CLONE_ENABLED = prev;
  }
});

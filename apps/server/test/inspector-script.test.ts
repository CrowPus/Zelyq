import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { LocalRuntimeDriver } from "@zelyq/runtime";
import {
  ensureInspectorScript,
  extractInspectorJs,
  extractInspectorScript,
} from "../src/services/inspector-script.js";

/**
 * A project made before the element inspector shipped, or not started from
 * Zelyq's own template at all, should still get the bridge script. Deliberately
 * tested against a real LocalRuntimeDriver, not a fake — the file operations
 * this goes through (readFile/writeFile) are exactly what a real project's
 * preview start already uses.
 */
const workspaceDir = path.join(os.tmpdir(), `zelyq-inspector-script-${Date.now()}`);
const driver = new LocalRuntimeDriver({
  kind: "local",
  workspaceDir,
  execTimeoutMs: 15_000,
  previewPortRange: [4960, 4970],
  previewHost: "127.0.0.1",
});

const templatesDir = path.join(os.tmpdir(), `zelyq-inspector-templates-${Date.now()}`);
const IIFE = "(function () {\n  var ACTIVATE = 'zelyq:inspector:activate';\n})();\n";
const BLOCK = [
  "<!-- zelyq:inspector:start -->",
  "<script>",
  IIFE.trimEnd(),
  "</script>",
  "<!-- zelyq:inspector:end -->",
].join("\n");

before(async () => {
  await fs.mkdir(path.join(templatesDir, "_shared"), { recursive: true });
  await fs.writeFile(path.join(templatesDir, "_shared", "inspector.html"), `${BLOCK}\n`);
  await fs.writeFile(path.join(templatesDir, "_shared", "inspector.js"), IIFE);
});

after(async () => {
  await driver.dispose();
  await fs.rm(workspaceDir, { recursive: true, force: true });
  await fs.rm(templatesDir, { recursive: true, force: true });
});

test("extractInspectorScript: returns exactly the block between the sentinels", async () => {
  const block = await extractInspectorScript(templatesDir);
  assert.ok(block);
  assert.ok(block.startsWith("<!-- zelyq:inspector:start -->"));
  assert.ok(block.endsWith("<!-- zelyq:inspector:end -->"));
  assert.match(block, /zelyq:inspector:activate/);
});

test("extractInspectorScript: null when _shared has no sentinels", async () => {
  const dir = path.join(os.tmpdir(), `zelyq-inspector-templates-empty-${Date.now()}`);
  await fs.mkdir(path.join(dir, "_shared"), { recursive: true });
  await fs.writeFile(path.join(dir, "_shared", "inspector.html"), "<div>nope</div>");
  try {
    assert.equal(await extractInspectorScript(dir), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("extractInspectorScript: null when there is no _shared file at all", async () => {
  assert.equal(await extractInspectorScript(path.join(os.tmpdir(), "zelyq-does-not-exist")), null);
});

test("extractInspectorJs: returns the raw IIFE from _shared/inspector.js", async () => {
  const js = await extractInspectorJs(templatesDir);
  assert.equal(js, IIFE);
});

test("ensureInspectorScript: patches a project's index.html that is missing the script", async () => {
  await driver.ensureProject("prj_old");
  await driver.scaffold("prj_old", [
    {
      path: "index.html",
      content: '<!doctype html>\n<html>\n<body>\n  <div id="root"></div>\n</body>\n</html>\n',
    },
  ]);

  await ensureInspectorScript(driver, templatesDir, "prj_old");

  const file = await driver.readFile("prj_old", "index.html");
  assert.match(file.content, /zelyq:inspector:activate/);
  assert.match(file.content, /<div id="root">/, "the rest of the file survives untouched");
  assert.equal(
    file.content.match(/<\/body>/g)?.length,
    1,
    "still exactly one closing body tag, not duplicated",
  );
});

test("ensureInspectorScript: a project that already has the script is left byte-for-byte unchanged", async () => {
  await driver.ensureProject("prj_already");
  const original = [
    "<!doctype html>",
    "<html>",
    "<body>",
    "  <!-- zelyq:inspector:start -->",
    "  <script>zelyq:inspector:activate</script>",
    "  <!-- zelyq:inspector:end -->",
    "</body>",
    "</html>",
  ].join("\n");
  await driver.scaffold("prj_already", [{ path: "index.html", content: original }]);

  await ensureInspectorScript(driver, templatesDir, "prj_already");

  const file = await driver.readFile("prj_already", "index.html");
  assert.equal(file.content, original, "no re-injection when the marker is already present");
});

test("ensureInspectorScript: a project with no index.html at all does not throw", async () => {
  await driver.ensureProject("prj_no_html");
  await driver.scaffold("prj_no_html", [{ path: "package.json", content: "{}" }]);

  await assert.doesNotReject(() => ensureInspectorScript(driver, templatesDir, "prj_no_html"));
});

test("ensureInspectorScript: an index.html with no </body> is left unchanged, not corrupted", async () => {
  await driver.ensureProject("prj_weird");
  const original = "<div>not a real page</div>";
  await driver.scaffold("prj_weird", [{ path: "index.html", content: original }]);

  await ensureInspectorScript(driver, templatesDir, "prj_weird");

  const file = await driver.readFile("prj_weird", "index.html");
  assert.equal(file.content, original);
});

// ---------------------------------------------------------------------------
// 066 — the Expo web shape: app/+html.tsx + public/zelyq-inspector.js.
// ---------------------------------------------------------------------------

test("ensureInspectorScript: patches an Expo project's app/+html.tsx and writes the asset", async () => {
  await driver.ensureProject("prj_expo_old");
  await driver.scaffold("prj_expo_old", [
    { path: "package.json", content: '{"dependencies":{"expo":"~52.0.0"}}' },
    {
      path: "app/+html.tsx",
      content:
        "export default function Root({ children }) {\n" +
        "  return (\n    <html>\n      <body>{children}</body>\n    </html>\n  );\n}\n",
    },
  ]);

  await ensureInspectorScript(driver, templatesDir, "prj_expo_old");

  const shell = await driver.readFile("prj_expo_old", "app/+html.tsx");
  assert.match(shell.content, /<script src="\/zelyq-inspector\.js" defer><\/script>/);
  assert.equal(shell.content.match(/<\/body>/g)?.length, 1, "one closing body tag");

  const asset = await driver.readFile("prj_expo_old", "public/zelyq-inspector.js");
  assert.equal(asset.content, IIFE, "the static asset is the raw IIFE from _shared");
});

test("ensureInspectorScript: an Expo project that already references the asset is untouched", async () => {
  await driver.ensureProject("prj_expo_has");
  const original =
    "export default function Root({ children }) {\n" +
    "  return (\n    <html>\n      <body>\n        {children}\n" +
    '        <script src="/zelyq-inspector.js" defer />\n' +
    "      </body>\n    </html>\n  );\n}\n";
  await driver.scaffold("prj_expo_has", [{ path: "app/+html.tsx", content: original }]);

  await ensureInspectorScript(driver, templatesDir, "prj_expo_has");

  const shell = await driver.readFile("prj_expo_has", "app/+html.tsx");
  assert.equal(shell.content, original);
});

// ---------------------------------------------------------------------------
// The real templates on disk must stay consistent — one source of truth.
// ---------------------------------------------------------------------------

const repoTemplates = path.resolve(import.meta.dirname, "..", "..", "..", "templates");

test("the real _shared block is valid and extractable", async () => {
  const block = await extractInspectorScript(repoTemplates);
  assert.ok(block, "templates/_shared/inspector.html must have an extractable block");
  assert.match(block, /zelyq:inspector:activate/);
  assert.match(block, /zelyq:inspector:deactivate/);
  assert.match(block, /zelyq:inspector:selected/);
});

test("templates/vite-react/index.html carries the _shared block verbatim", async () => {
  const shared = (
    await fs.readFile(path.join(repoTemplates, "_shared", "inspector.html"), "utf8")
  ).trim();
  const vite = await fs.readFile(path.join(repoTemplates, "vite-react", "index.html"), "utf8");
  const start = vite.indexOf("<!-- zelyq:inspector:start -->");
  const end = vite.indexOf("<!-- zelyq:inspector:end -->") + "<!-- zelyq:inspector:end -->".length;
  const inline = vite
    .slice(start, end)
    .split("\n")
    .map((l) => (l.startsWith("    ") ? l.slice(4) : l))
    .join("\n")
    .trim();
  assert.equal(
    inline,
    shared,
    "the Vite template's inline inspector block has drifted from _shared",
  );
});

test("templates/_shared/inspector.html embeds _shared/inspector.js verbatim", async () => {
  const js = (
    await fs.readFile(path.join(repoTemplates, "_shared", "inspector.js"), "utf8")
  ).trim();
  const html = await fs.readFile(path.join(repoTemplates, "_shared", "inspector.html"), "utf8");
  assert.ok(html.includes(js), "inspector.html must contain inspector.js verbatim");
});

test("templates/expo-react-native ships the _shared IIFE as its public asset", async () => {
  const shared = await fs.readFile(path.join(repoTemplates, "_shared", "inspector.js"), "utf8");
  const asset = await fs.readFile(
    path.join(repoTemplates, "expo-react-native", "public", "zelyq-inspector.js"),
    "utf8",
  );
  assert.equal(
    asset,
    shared,
    "the Expo template's public/zelyq-inspector.js has drifted from _shared",
  );
});

test("templates/expo-react-native/app/+html.tsx references the inspector asset", async () => {
  const shell = await fs.readFile(
    path.join(repoTemplates, "expo-react-native", "app", "+html.tsx"),
    "utf8",
  );
  assert.match(shell, /zelyq-inspector\.js/);
});

test("ensureInspectorScript: a missing templatesDir never blocks a preview from starting", async () => {
  await driver.ensureProject("prj_no_templates");
  await driver.scaffold("prj_no_templates", [
    { path: "index.html", content: "<html><body></body></html>" },
  ]);

  await assert.doesNotReject(() =>
    ensureInspectorScript(driver, path.join(os.tmpdir(), "zelyq-nope"), "prj_no_templates"),
  );
});

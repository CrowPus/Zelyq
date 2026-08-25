import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { LocalRuntimeDriver } from "@zelyq/runtime";
import { ensureInspectorScript, extractInspectorScript } from "../src/services/inspector-script.js";

/**
 * A project made before the element inspector shipped, or not started from
 * Zelyq's own template at all, should still get the bridge script — see
 * `039` in the council notes. Deliberately tested against a real
 * LocalRuntimeDriver, not a fake — the file operations this goes through
 * (readFile/writeFile) are exactly what a real project's preview start
 * already uses.
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

before(async () => {
  await fs.mkdir(path.join(templatesDir, "vite-react"), { recursive: true });
  await fs.writeFile(
    path.join(templatesDir, "vite-react", "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "<body>",
      '  <div id="root"></div>',
      "  <!-- zelyq:inspector:start -->",
      "  <script>/* zelyq:inspector:activate */</script>",
      "  <!-- zelyq:inspector:end -->",
      "</body>",
      "</html>",
    ].join("\n"),
  );
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
  assert.ok(!block.includes('<div id="root">'), "only the block itself, not the surrounding page");
});

test("extractInspectorScript: null when the template has no sentinels", async () => {
  const dir = path.join(os.tmpdir(), `zelyq-inspector-templates-empty-${Date.now()}`);
  await fs.mkdir(path.join(dir, "vite-react"), { recursive: true });
  await fs.writeFile(path.join(dir, "vite-react", "index.html"), "<html><body></body></html>");
  try {
    assert.equal(await extractInspectorScript(dir), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("extractInspectorScript: null when there is no template file at all", async () => {
  assert.equal(await extractInspectorScript(path.join(os.tmpdir(), "zelyq-does-not-exist")), null);
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

test("extractInspectorScript: the real template ships a valid, extractable block", async () => {
  // Guards the one thing that would let this quietly drift: if a future
  // edit to templates/vite-react/index.html loses the sentinel comments or
  // the marker itself, this fails immediately instead of silently making
  // every retrofit-patched project a no-op.
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const block = await extractInspectorScript(path.join(repoRoot, "templates"));
  assert.ok(block, "the real template must have an extractable inspector block");
  assert.match(block, /zelyq:inspector:activate/);
  assert.match(block, /zelyq:inspector:deactivate/);
  assert.match(block, /zelyq:inspector:selected/);
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

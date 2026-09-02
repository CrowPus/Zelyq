import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSkillUploadFiles,
  inlineImageMimeType,
  MAX_UPLOAD_BYTES,
  uploadTargetPath,
} from "../src/lib/files.js";

/**
 * `buildSkillUploadFiles`. Extracted out
 * of `SkillUploadControl` specifically because of a real live bug: passing
 * a *live* `FileList` across the async boundary into a mutation function
 * meant it could be read back empty, since the input's own reset (right
 * after `mutate` was called, so the same folder could be picked twice in a
 * row) clears `.files` immediately. Every upload silently sent zero files
 * and failed schema validation with no indication why — found only by
 * reproducing the exact browser flow live. These tests exercise the
 * *fixed* shape: a plain `File[]`, captured before any reset can touch it.
 */

/** Node's own `File` never carries `webkitRelativePath` — a real browser's
 * directory-picker sets it, so it's added here the same way, to build a
 * fixture that actually looks like one. */
function fileWithPath(relativePath: string, content: string): File {
  const name = relativePath.split("/").at(-1)!;
  const file = new File([content], name);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath, configurable: true });
  return file;
}

test("strips the top-level folder name every browser directory-picker prefixes", async () => {
  const files = [
    fileWithPath("my-skill/SKILL.md", "---\nname: my-skill\n---\n\nbody"),
    fileWithPath("my-skill/references/detail.md", "the detail"),
  ];

  const result = await buildSkillUploadFiles(files);

  assert.deepEqual(
    result.map((f) => f.path),
    ["SKILL.md", "references/detail.md"],
  );
});

test("a plain file with no webkitRelativePath falls back to its own name", async () => {
  // What a browser without directory-picker support hands back — a single
  // loose file, `webkitRelativePath` empty. Must still produce something
  // usable rather than an empty path the server would reject.
  const file = new File(["content"], "SKILL.md");
  const result = await buildSkillUploadFiles([file]);
  assert.deepEqual(result, [{ path: "SKILL.md", data: Buffer.from("content").toString("base64") }]);
});

test("every file's data round-trips as real base64 of its actual bytes", async () => {
  const files = [fileWithPath("skill/SKILL.md", "hello world")];
  const result = await buildSkillUploadFiles(files);
  assert.equal(Buffer.from(result[0]!.data, "base64").toString("utf8"), "hello world");
});

test("an empty file list produces an empty result — never throws, never invents a file", async () => {
  const result = await buildSkillUploadFiles([]);
  assert.deepEqual(result, []);
});

/**
 * Upload path building. This value is used to write to a project's disk, and
 * its inputs come from the browser — a dropped entry's relative path is
 * whatever the OS handed over. So the traversal cases matter more than the
 * happy path.
 */

test("a loose file lands in the folder it was dropped on", () => {
  assert.equal(uploadTargetPath("public", "logo.png"), "public/logo.png");
  assert.equal(uploadTargetPath("", "logo.png"), "logo.png");
  assert.equal(uploadTargetPath("src/assets", "icon.svg"), "src/assets/icon.svg");
});

test("a dropped folder keeps its internal shape", () => {
  assert.equal(uploadTargetPath("public", "icons/logo.svg"), "public/icons/logo.svg");
  assert.equal(uploadTargetPath("", "brand/logo/mark.png"), "brand/logo/mark.png");
});

test("traversal segments are dropped, not escaped and hoped for", () => {
  assert.equal(uploadTargetPath("public", "../../etc/passwd"), "public/etc/passwd");
  assert.equal(uploadTargetPath("../..", "logo.png"), "logo.png");
  assert.equal(uploadTargetPath("public", "./logo.png"), "public/logo.png");
});

test("separators and stray slashes are normalised", () => {
  assert.equal(uploadTargetPath("public/", "/logo.png"), "public/logo.png");
  assert.equal(uploadTargetPath("public", "icons\\logo.svg"), "public/icons/logo.svg");
  assert.equal(uploadTargetPath("//public//img//", "a//b.png"), "public/img/a/b.png");
});

test("an entry with no usable name is skipped rather than written to the folder itself", () => {
  // "" is the caller's signal to drop the entry — writing to `destDir` would
  // clobber the folder with a file of the same name.
  assert.equal(uploadTargetPath("public", ""), "");
  assert.equal(uploadTargetPath("public", "../.."), "");
  assert.equal(uploadTargetPath("", "   "), "");
});

test("the size cap leaves room for base64 inside the server's body limit", () => {
  // The server accepts 16 MiB. base64 costs 4 bytes per 3, so the raw ceiling
  // is ~12 MiB before the JSON wrapper — the cap must sit under that.
  const serverBodyLimit = 16 * 1024 * 1024;
  assert.ok(
    MAX_UPLOAD_BYTES * (4 / 3) < serverBodyLimit,
    "a file at the cap must fit once encoded",
  );
});

/**
 * Image preview. The bytes for a binary file already reach the browser as
 * base64 — an image was being discarded at the last step and shown as "not
 * text, so there is nothing to show".
 */

test("common image formats render inline", () => {
  for (const [file, mime] of [
    ["logo.png", "image/png"],
    ["photo.JPG", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["anim.gif", "image/gif"],
    ["shot.webp", "image/webp"],
    ["icon.ico", "image/x-icon"],
    ["src/hooks/6641d2ad_shutterstock_1886429491.jpg", "image/jpeg"],
  ] as const) {
    assert.equal(inlineImageMimeType(file), mime, file);
  }
});

test("SVG is deliberately NOT rendered inline", () => {
  // A data:image/svg+xml is a script execution context, and a project's own
  // uploaded SVG is exactly the untrusted input not to run in the editor origin.
  assert.equal(inlineImageMimeType("logo.svg"), null);
});

test("non-images are left to the binary-file message", () => {
  for (const file of ["notes.pdf", "archive.zip", "font.woff2", "App.tsx", "noext"]) {
    assert.equal(inlineImageMimeType(file), null, file);
  }
});

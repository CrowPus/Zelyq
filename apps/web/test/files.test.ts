import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSkillUploadFiles } from "../src/lib/files.js";

/**
 * `buildSkillUploadFiles` — see `043` in the council notes. Extracted out
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

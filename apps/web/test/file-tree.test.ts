import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileEntry } from "@zelyq/core";
import { buildTree, rowActionsWidth, uploadDirFor } from "../src/components/FileExplorer";

const entry = (path: string, type: "file" | "directory" = "file"): FileEntry => ({
  path,
  name: path.split("/").pop()!,
  type,
  ...(type === "file" ? { size: 10 } : {}),
});

test("nests files under their directories", () => {
  const tree = buildTree([entry("src", "directory"), entry("src/App.tsx"), entry("package.json")]);

  assert.equal(tree.length, 2);
  assert.equal(tree[0]?.name, "src");
  assert.equal(tree[0]?.type, "directory");
  assert.deepEqual(
    tree[0]?.children.map((child) => child.name),
    ["App.tsx"],
  );
  assert.equal(tree[1]?.name, "package.json");
});

test("directories sort before files, each alphabetically", () => {
  const tree = buildTree([
    entry("vite.config.ts"),
    entry("src", "directory"),
    entry("README.md"),
    entry("public", "directory"),
  ]);

  assert.deepEqual(
    tree.map((node) => node.name),
    ["public", "src", "README.md", "vite.config.ts"],
  );
});

test("creates intermediate directories the listing did not mention", () => {
  // A deep path must still render even when its parents were not listed,
  // otherwise the file silently disappears from the tree.
  const tree = buildTree([entry("src/components/ui/Button.tsx")]);

  assert.equal(tree[0]?.name, "src");
  const components = tree[0]?.children[0];
  assert.equal(components?.name, "components");
  assert.equal(components?.type, "directory");
  assert.equal(components?.children[0]?.name, "ui");
  assert.equal(components?.children[0]?.children[0]?.name, "Button.tsx");
});

test("every node keeps its full path, not just its name", () => {
  // Selection and expansion are keyed by path; a bare name would collide
  // between src/index.css and public/index.css.
  const tree = buildTree([entry("src/index.css"), entry("public/index.css")]);
  const paths = tree.flatMap((node) => node.children.map((child) => child.path)).sort();
  assert.deepEqual(paths, ["public/index.css", "src/index.css"]);
});

test("an empty listing produces an empty tree", () => {
  assert.deepEqual(buildTree([]), []);
});

/**
 * Upload destination. Clicking a folder only expands it — it never becomes a
 * selection — so the header Upload button had nothing to aim at and quietly
 * used the selected FILE's folder instead. A real image ended up in
 * `src/hooks/` because a hook file happened to be open.
 */

test("a selected file targets the folder it lives in", () => {
  assert.equal(uploadDirFor("src/hooks/usePointerTracking.ts"), "src/hooks");
  assert.equal(uploadDirFor("App.tsx"), "");
});

test("a selected folder targets itself, not its parent", () => {
  const entries = [
    { path: "public", type: "directory" as const },
    { path: "public/hero", type: "directory" as const },
  ];
  assert.equal(uploadDirFor("public/hero", entries), "public/hero");
});

test("no selection means the project root", () => {
  assert.equal(uploadDirFor(null), "");
});

/**
 * Row actions. The delete button was `absolute right-1` on its own, so a
 * second action rendered underneath it rather than beside it. Both now sit in
 * one flex strip, and the row reserves matching padding so a long filename
 * truncates before reaching the icons instead of running under them.
 */

test("reserved action width grows with the number of actions", () => {
  assert.equal(rowActionsWidth(0), 8, "no actions still needs ordinary right padding");
  assert.equal(rowActionsWidth(1), 32, "one 24px button plus the 4px inset and a gap");
  assert.equal(rowActionsWidth(2), 58, "two buttons must not sit on top of each other");
  assert.ok(rowActionsWidth(2) > rowActionsWidth(1), "more actions must reserve more room");
});

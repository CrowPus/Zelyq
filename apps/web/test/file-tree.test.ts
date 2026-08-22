import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileEntry } from "@zelyq/core";
import { buildTree } from "../src/components/FileExplorer";

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

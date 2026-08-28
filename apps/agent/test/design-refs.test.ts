import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildUseDesignRefTool, designRefCatalogText, loadDesignRefs } from "../src/design-refs.js";

const silent = { info() {}, warn() {} };

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "zelyq-designrefs-"));
}

async function writeRef(dir: string, slug: string, contents: string) {
  await fs.mkdir(path.join(dir, slug), { recursive: true });
  await fs.writeFile(path.join(dir, slug, "DESIGN.md"), contents);
}

test("loadDesignRefs builds a catalog and reads Agent.md", async () => {
  const dir = await tmpDir();
  await writeRef(
    dir,
    "calm-saas",
    `---\nname: Calm-SaaS\ndescription: "A quiet analytics product on a near-white canvas."\n---\n# Calm SaaS\nprose\n`,
  );
  await writeRef(
    dir,
    "editorial",
    "# Design System Inspired by Editorial\n\nAn editorial content system, ink on paper.\n",
  );
  await fs.writeFile(
    path.join(dir, "Agent.md"),
    "MUST: visible focus rings\nNEVER: outline: none\n",
  );

  const r = await loadDesignRefs(dir, undefined, silent);
  assert.equal(r.refs.length, 2);
  assert.equal(r.skipped.length, 0);
  assert.match(r.agentMd ?? "", /visible focus rings/);

  const calm = r.refs.find((x) => x.slug === "calm-saas");
  assert.equal(calm?.description, "A quiet analytics product on a near-white canvas.");
  // No front matter → first prose line becomes the description.
  const ed = r.refs.find((x) => x.slug === "editorial");
  assert.match(ed?.description ?? "", /An editorial content system/);

  const catalog = designRefCatalogText(r.refs);
  assert.match(catalog, /- calm-saas: A quiet analytics/);
  assert.match(catalog, /- editorial: An editorial content system/);
});

test("a block-scalar description (description: |) is parsed", async () => {
  const dir = await tmpDir();
  await writeRef(
    dir,
    "raycast-like",
    `---\nname: X\ndescription: |\n  A dark-canvas developer tool that reads like\n  an extended product screenshot.\ncolors:\n  primary: "#fff"\n---\n# body\n`,
  );
  const r = await loadDesignRefs(dir, undefined, silent);
  assert.equal(
    r.refs[0]?.description,
    "A dark-canvas developer tool that reads like an extended product screenshot.",
  );
});

test("a directory without DESIGN.md is skipped, not fatal", async () => {
  const dir = await tmpDir();
  await fs.mkdir(path.join(dir, "empty-one"), { recursive: true });
  await writeRef(dir, "real-one", "---\nname: R\ndescription: real\n---\nbody\n");
  const r = await loadDesignRefs(dir, undefined, silent);
  assert.equal(r.refs.length, 1);
  assert.equal(r.refs[0]?.slug, "real-one");
  assert.equal(r.skipped[0]?.file, "empty-one");
});

test("the operator dir overrides a built-in slug", async () => {
  const builtIn = await tmpDir();
  const operator = await tmpDir();
  await writeRef(builtIn, "shared", "---\nname: A\ndescription: built-in version\n---\nb\n");
  await writeRef(operator, "shared", "---\nname: A\ndescription: operator version\n---\nb\n");
  await writeRef(operator, "extra", "---\nname: E\ndescription: only in operator\n---\nb\n");

  const r = await loadDesignRefs(builtIn, operator, silent);
  assert.equal(r.refs.length, 2);
  assert.equal(r.refs.find((x) => x.slug === "shared")?.description, "operator version");
  assert.equal(r.refs.find((x) => x.slug === "shared")?.source, "operator");
  assert.ok(r.refs.some((x) => x.slug === "extra"));
});

test("use_design_ref returns a body for a known slug and errors otherwise", async () => {
  const dir = await tmpDir();
  await writeRef(
    dir,
    "linearish",
    "---\nname: L\ndescription: near-black tool\n---\n# Linearish\nthe whole body\n",
  );
  const { refs } = await loadDesignRefs(dir, undefined, silent);
  const tool = buildUseDesignRefTool(refs);

  const ok = await tool.run({} as never, { slug: "linearish" });
  assert.equal(ok.isError ?? false, false);
  assert.match(ok.output, /the whole body/);

  const bad = await tool.run({} as never, { slug: "nope" });
  assert.equal(bad.isError, true);
  assert.match(bad.output, /No design reference "nope"/);

  const escape = await tool.run({} as never, { slug: "../secrets" });
  assert.equal(escape.isError, true);
  assert.match(escape.output, /not a valid reference slug/);
});

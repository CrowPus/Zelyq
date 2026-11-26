import assert from "node:assert/strict";
import { test } from "node:test";
import { condense, findSection, headings, splitFrontMatter } from "../src/sections.js";

const long = (n: number) => "word ".repeat(n / 5);
const doc = [
  "Intro line.",
  "## Mission",
  "Short mission.",
  "## Required workflow",
  "### 1. Inspect",
  long(2000),
  "### 2. Build",
  "```md\n## not a heading inside a fence\n```",
  long(2000),
  "## Definition of done",
  "Done means verified.",
].join("\n");

test("a short document comes back as it is", () => {
  assert.equal(condense("## A\nshort"), "## A\nshort");
});

test("a long section is folded to its heading and parts; short ones stay whole", () => {
  const out = condense(doc, { threshold: 1000, maxSection: 1500 });
  assert.match(out, /Intro line\./);
  assert.match(out, /## Mission\nShort mission\./);
  assert.match(out, /## Definition of done\nDone means verified\./);
  assert.match(
    out,
    /## Required workflow\n\(\d+ characters, folded\. Read it with section: "Required workflow"/,
  );
  assert.match(out, / {2}- 1\. Inspect\n {2}- 2\. Build/);
  assert.ok(out.length < doc.length / 2);
  assert.doesNotMatch(out, /not a heading inside a fence/);
});

test("a section is found by its heading at any level, exactly or by its words", () => {
  assert.match(
    findSection(doc, "Required workflow") ?? "",
    /^## Required workflow[\s\S]*2\. Build/,
  );
  assert.match(findSection(doc, "inspect") ?? "", /^### 1\. Inspect/);
  assert.doesNotMatch(findSection(doc, "1. Inspect") ?? "", /2\. Build/);
  assert.equal(findSection(doc, "not a heading inside a fence"), null);
  assert.equal(findSection(doc, "nothing like it"), null);
  assert.deepEqual(headings(doc), [
    "Mission",
    "Required workflow",
    "  1. Inspect",
    "  2. Build",
    "Definition of done",
  ]);
});

test("front matter is split off the top only", () => {
  assert.deepEqual(splitFrontMatter("---\na: 1\n---\nbody\n---\n"), {
    frontMatter: "---\na: 1\n---\n",
    rest: "body\n---\n",
  });
});

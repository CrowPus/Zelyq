import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildSkillsBlock } from "../src/session.js";

/**
 * A dispatched specialist has no `use_skill` tool, so whatever is not inlined
 * into its prompt it never learns. The budget used to be one slice over the
 * concatenation of every named skill, which meant the Designer's second skill
 * was cut in full while the config went on listing it.
 */

const body = (chars: number) => "x".repeat(chars);
const resolver = (map: Record<string, string>) => (name: string) =>
  map[name] ? { body: map[name] } : undefined;

test("every named skill appears — none is silently erased by the one before it", () => {
  // The real sizes that caused this: 14,944 + 15,307 exceeded the old 14,000
  // shared budget on their own, before a third was even considered.
  const block = buildSkillsBlock(
    ["a", "b", "c"],
    resolver({ a: body(14_944), b: body(15_307), c: body(10_462) }),
  );
  for (const name of ["a", "b", "c"]) {
    assert.ok(block.includes(`### Skill: ${name}`), `${name} missing from the block`);
  }
});

test("an over-budget skill is trimmed and says so, rather than stopping mid-sentence", () => {
  const block = buildSkillsBlock(["big"], resolver({ big: body(20_000) }));
  assert.match(block, /more characters of this skill were not included/);
  assert.ok(block.length < 20_000, "the body must actually be trimmed");
});

test("a skill that fits is passed through whole", () => {
  const block = buildSkillsBlock(["small"], resolver({ small: body(500) }));
  assert.ok(!block.includes("not included"), "a short skill must not be marked as trimmed");
  assert.ok(block.includes(body(500)));
});

test("an unresolvable name is dropped without breaking the others", () => {
  const block = buildSkillsBlock(["known", "ghost"], resolver({ known: body(100) }));
  assert.ok(block.includes("### Skill: known"));
  assert.ok(!block.includes("ghost"));
});

test("nothing resolvable produces no header at all", () => {
  assert.equal(buildSkillsBlock(["ghost"], resolver({})), "");
  assert.equal(buildSkillsBlock([], resolver({ a: body(10) })), "");
});

/**
 * The wiring the founder asked for: motion is part of designing, so the
 * Designer carries it, and it must survive the budget rather than be the third
 * name that gets cut.
 */
test("the Designer's three real skills all survive the budget", () => {
  const root = path.resolve(import.meta.dirname, "..", "..", "..", "skills");
  const dirs: Record<string, string> = {
    "ui-ux-design-intelligence": "ui-ux-design-intelligence",
    "frontend-ui-engineering": "frontend_ui_skill",
    "web-motion-engineering": "web-motion-engineering",
  };
  const real = (name: string) => {
    const file = path.join(root, dirs[name]!, "SKILL.md");
    return fs.existsSync(file) ? { body: fs.readFileSync(file, "utf8") } : undefined;
  };
  const block = buildSkillsBlock(Object.keys(dirs), real);
  for (const name of Object.keys(dirs)) {
    assert.ok(block.includes(`### Skill: ${name}`), `${name} is not reaching the Designer`);
  }
  // web-motion-engineering is the one that had to fit whole: it carries the
  // timing figures and the reduced-motion obligation.
  assert.ok(
    !block.split("### Skill: web-motion-engineering")[1]?.includes("not included"),
    "the motion skill should fit inside the per-skill budget without trimming",
  );
});

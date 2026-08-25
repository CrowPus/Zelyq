import assert from "node:assert/strict";
import { test } from "node:test";
import { matchSlashSkills } from "../src/lib/skills.js";

/** `matchSlashSkills` — see `044` in the council notes. */

const SKILLS = [
  { name: "shadcn-ui-setup", description: "Install shadcn/ui components." },
  { name: "stripe-checkout", description: "Wire a Stripe Checkout flow." },
  { name: "cinematic-web", description: "Immersive, scroll-driven WebGL." },
];

test("a draft not starting with / matches nothing — the menu stays closed", () => {
  assert.deepEqual(matchSlashSkills("design my website", SKILLS, []), []);
  assert.deepEqual(matchSlashSkills("", SKILLS, []), []);
});

test("a bare / matches every skill — the full list, before any filtering", () => {
  const result = matchSlashSkills("/", SKILLS, []);
  assert.deepEqual(
    result.map((s) => s.name),
    ["shadcn-ui-setup", "stripe-checkout", "cinematic-web"],
  );
});

test("typing after / filters by name prefix, case-insensitively", () => {
  assert.deepEqual(
    matchSlashSkills("/strip", SKILLS, []).map((s) => s.name),
    ["stripe-checkout"],
  );
  assert.deepEqual(
    matchSlashSkills("/SHAD", SKILLS, []).map((s) => s.name),
    ["shadcn-ui-setup"],
  );
});

test("a query matching nothing returns an empty list — never falls back to showing everything", () => {
  assert.deepEqual(matchSlashSkills("/zzz-nonexistent", SKILLS, []), []);
});

test("a query matching nothing means the draft is just ordinary text starting with /", () => {
  // The actual guarantee this exists for: a real message that happens to
  // start with "/" (a path, a command someone is describing) must never be
  // trapped behind a menu with nothing in it.
  const result = matchSlashSkills("/etc/hosts needs updating", SKILLS, []);
  assert.deepEqual(result, []);
});

test("a skill already selected is excluded from further matches", () => {
  const result = matchSlashSkills("/", SKILLS, [{ name: "stripe-checkout" }]);
  assert.deepEqual(
    result.map((s) => s.name),
    ["shadcn-ui-setup", "cinematic-web"],
  );
});

test("a space after the slash ends the command — no longer a menu trigger", () => {
  // "/design my website" — the founder's own example of a real message,
  // not a command. Only a bare word right after "/", no space yet, opens
  // the menu; once a space appears the whole thing is ordinary text again.
  assert.deepEqual(matchSlashSkills("/design my website", SKILLS, []), []);
});

test("no skills loaded at all means the menu never opens, even for a bare /", () => {
  assert.deepEqual(matchSlashSkills("/", [], []), []);
});

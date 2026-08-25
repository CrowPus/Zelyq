import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt, withSkills } from "../src/prompt.js";

/** See `042` in the council notes — the catalog is the cheap, always-present
 * tier; these are the fast, direct checks the live-turn test in
 * `skills.test.ts` doesn't need to re-prove at HTTP-server cost. */

test("no skills means no <skills> section at all — unchanged prompt for a checkout with none loaded", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.doesNotMatch(prompt, /<skills>/);
});

test("an empty skills array behaves the same as omitting it entirely", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", skills: [] });
  assert.doesNotMatch(prompt, /<skills>/);
});

test("loaded skills appear as a name: description catalog, not their full bodies", () => {
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    skills: [
      { name: "stripe-checkout", description: "Wire a Stripe Checkout redirect flow." },
      { name: "shadcn-ui-setup", description: "Install shadcn/ui components correctly." },
    ],
  });

  assert.match(prompt, /<skills>/);
  assert.match(prompt, /- stripe-checkout: Wire a Stripe Checkout redirect flow\./);
  assert.match(prompt, /- shadcn-ui-setup: Install shadcn\/ui components correctly\./);
  assert.match(prompt, /use_skill/, "the prompt must tell the model how to actually load one");
});

// ---------------------------------------------------------------------------
// withSkills — 044's guaranteed weaving, distinct from the catalog above:
// this is content, not a description the model might act on.
// ---------------------------------------------------------------------------

test("no names selected leaves the message completely untouched", () => {
  const result = withSkills("design my website", [], () => undefined);
  assert.equal(result, "design my website");
});

test("a resolved skill's full body is woven ahead of the message", () => {
  const result = withSkills("design my website", ["shadcn-ui-setup"], (name) =>
    name === "shadcn-ui-setup" ? { body: "THE REAL SKILL BODY" } : undefined,
  );
  assert.match(result, /THE REAL SKILL BODY/);
  assert.match(result, /shadcn-ui-setup/);
  // The message itself must still be there, and last — the model reads the
  // instructions, then what it was actually asked to do.
  assert.ok(result.endsWith("design my website"));
});

test("multiple selected skills each get their own block, in the order given", () => {
  const bodies: Record<string, string> = { first: "FIRST BODY", second: "SECOND BODY" };
  const result = withSkills("go", ["first", "second"], (name) =>
    bodies[name] ? { body: bodies[name] } : undefined,
  );
  assert.ok(result.indexOf("FIRST BODY") < result.indexOf("SECOND BODY"));
});

test("a name that doesn't resolve — stale picker data — is skipped, not an error", () => {
  const result = withSkills("go", ["deleted-skill"], () => undefined);
  assert.equal(result, "go", "an unresolvable name must fall back to the plain message");
});

test("one resolving and one not still weaves the one that does", () => {
  const result = withSkills("go", ["deleted-skill", "real-skill"], (name) =>
    name === "real-skill" ? { body: "REAL BODY" } : undefined,
  );
  assert.match(result, /REAL BODY/);
  assert.doesNotMatch(result, /deleted-skill/);
});

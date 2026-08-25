import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt } from "../src/prompt.js";

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

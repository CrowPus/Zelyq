import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSystemPrompt,
  ENGINEER_MODE_PURPOSE_MARKER,
  withPlugins,
  withSkills,
} from "../src/prompt.js";

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
// Engineer Mode addendum — ZED-0001, Phase 1. Built once into the system
// prompt itself, distinct from both the catalog and withSkills' per-message
// weaving above — see the entry's Proposed decision for why that distinction
// is load-bearing.
// ---------------------------------------------------------------------------

test("engineer mode off (the default) adds nothing to the prompt", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.doesNotMatch(prompt, /<engineer_mode>/);
});

test("engineer mode off produces byte-identical output to omitting the option entirely", () => {
  // Found by independent review: a stray newline before the addendum's
  // interpolation slot survived even with an empty string in it, so the
  // presence-only check above passed while the actual bytes still
  // differed from what this function returned before Phase 1 existed. A
  // genuinely unchanged default-mode prompt has to be checked as bytes,
  // not just "the new section isn't there".
  const withoutOption = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  const withOptionOff = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    engineerMode: undefined,
  });
  assert.equal(withOptionOff, withoutOption);
  assert.ok(
    withoutOption.endsWith("</communication>"),
    "the prompt must end exactly at </communication> — no trailing newline from the addendum's conditional slot",
  );
});

test("engineer mode on adds the addendum with all four directives", () => {
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    engineerMode: {},
  });
  assert.match(prompt, /<engineer_mode>/);
  assert.match(prompt, new RegExp(ENGINEER_MODE_PURPOSE_MARKER.replace(":", "\\:")));
  assert.match(prompt, /Epistemic labeling/);
  assert.match(prompt, /Decision responsibility/);
  assert.match(prompt, /Stop-and-ask boundary/);
  // The default prompt's own scope discipline must still be present and
  // uncontradicted — Engineer Mode is additive, never a replacement. See
  // ZED-0001, Implementation boundary → Excluded.
  assert.match(prompt, /Build what was asked, then stop/);
});

test("engineer mode names an exploratory, scope-undecided request as its own stop-and-ask trigger", () => {
  // Added after a live incident — see ZED-0001's incident addendum. A
  // request that opens a conversation, not a spec, must be named
  // explicitly, not left to be inferred from the generic shapeless-request
  // rule that already failed to catch it once.
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", engineerMode: {} });
  assert.match(prompt, /opens a conversation rather than gives you a spec/);
  assert.match(prompt, /talking to an engineer, not filing a ticket/);
});

test("engineer mode's addendum names the new-file checkpoint as a real backstop, not just a suggestion", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", engineerMode: {} });
  assert.match(prompt, /more than six new files in one turn is refused outright/);
});

test("a turn that touches nothing, or only answers a question, is exempted in the addendum's own text", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", engineerMode: {} });
  assert.match(prompt, /exempt from all four/);
});

test("engineer mode with no skill found still gets the four directives, degraded rather than refused", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", engineerMode: {} });
  assert.doesNotMatch(prompt, /<engineer_mode_skill>/);
  assert.match(prompt, /Purpose framing/);
});

test("a resolved skill's body and resource listing both land in the addendum", () => {
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    engineerMode: {
      skill: { body: "THE SENIOR ENGINEERING SKILL BODY", resources: ["references/security.md"] },
    },
  });
  assert.match(prompt, /<engineer_mode_skill>/);
  assert.match(prompt, /THE SENIOR ENGINEERING SKILL BODY/);
  // This is the whole point of carrying the listing at all — see ZED-0001's
  // third validation round: baking only the body in leaves the model with
  // no way to know a deeper file like this one exists.
  assert.match(prompt, /references\/security\.md/);
  assert.match(prompt, /use_skill\("senior-software-engineering", path\)/);
});

test("the addendum lands after <scope>, <quality>, and <communication>, not before — its own 'above' claim depends on this", () => {
  // Found by independent implementation review: the addendum used to sit
  // above those sections while its own text said they were "above" it —
  // backwards. This locks the actual position in, not just the wording.
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", engineerMode: {} });
  const communicationEnd = prompt.indexOf("</communication>");
  const addendumStart = prompt.indexOf("<engineer_mode>");
  assert.ok(communicationEnd > 0 && addendumStart > 0);
  assert.ok(
    addendumStart > communicationEnd,
    'the addendum must come after <communication>, so its own "above" claim is actually true',
  );
});

test("a resolved skill with no deeper files omits the (otherwise empty) listing line", () => {
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    engineerMode: { skill: { body: "JUST A BODY", resources: [] } },
  });
  assert.doesNotMatch(prompt, /Other files this skill has/);
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

// ---------------------------------------------------------------------------
// withPlugins — 044's follow-up: an instruction naming a tool, honestly
// weaker than withSkills' guarantee since a plugin has no body to weave.
// ---------------------------------------------------------------------------

test("no plugin names selected leaves the message completely untouched", () => {
  const result = withPlugins("design my website", []);
  assert.equal(result, "design my website");
});

test("one plugin name becomes a single-tool instruction ahead of the message", () => {
  const result = withPlugins("roll a d20", ["roll_dice"]);
  assert.match(result, /Use the roll_dice tool for this task\./);
  assert.ok(result.endsWith("roll a d20"), "the original message must still be last");
});

test("multiple plugin names are named together in one instruction line", () => {
  const result = withPlugins("go", ["roll_dice", "flip_coin"]);
  assert.match(result, /Use these tools for this task: roll_dice, flip_coin\./);
});

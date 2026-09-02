import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_HINT_NAMES,
  buildSystemPrompt,
  designReferencesBlock,
  ENGINEER_MODE_PURPOSE_MARKER,
  withAgents,
  withPlugins,
  withSkills,
} from "../src/prompt.js";
import { SPECIALIST_KINDS } from "../src/session.js";

/** The catalog is the cheap, always-present tier; these are the fast,
 * direct checks the live-turn test in `skills.test.ts` doesn't need to
 * re-prove at HTTP-server cost. */

test("no skills means no <skills> section at all — unchanged prompt for a checkout with none loaded", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.doesNotMatch(prompt, /<skills>/);
});

test("how_to_work tells the model a loaded plugin tool is not a reason to use it on its own", () => {
  // A separate, much larger surface than skills — a plugin tool has no
  // catalog entry of its own in the prompt at all, only its function
  // definition, so this generic principle is the only place a decision
  // rule about the whole category can live. Present even with no skills
  // and no engineerMode, since plugin tools are loaded independently of
  // both.
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.match(prompt, /A tool being available is not a reason to reach for it/);
  assert.match(prompt, /no backend or deployment pipeline of its own/);
});

test("how_to_work tells the model to read and build to an architecture/ package if one exists", () => {
  // So a user who plans in Architect Mode and then switches to the Engineer
  // (or default mode) to finish can point it at the folder and have it
  // follow the design instead of treating it as scratch.
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.match(prompt, /it is a design package the Architect wrote/);
  assert.match(prompt, /architecture\/build-plan\.md/);
  assert.match(prompt, /mark each one done/);
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

test("the skills catalog tells the model a task can match more than one, and how to pick among overlapping ones", () => {
  // The library grew past two obviously-distinct skills to several that
  // genuinely overlap on frontend work — "skip what doesn't apply" alone
  // stopped being enough once picking wrong had real alternatives to pick
  // wrong between.
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    skills: [{ name: "x", description: "y" }],
  });
  assert.match(prompt, /can genuinely match more than one/);
  assert.match(prompt, /Load each that does/);
});

test("the skills catalog states plainly that projects here have no backend of their own", () => {
  // A skill written for backend services or release
  // engineering, sitting in the same catalog as the frontend-only
  // template's actual stack, with nothing in the prompt saying so —
  // exactly the shape of thing that talks a model into inventing
  // infrastructure this product does not have.
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    skills: [{ name: "x", description: "y" }],
  });
  assert.match(prompt, /no backend, database, or deployment pipeline of its own/);
});

// ---------------------------------------------------------------------------
// Engineer Mode addendum. Built once into the system prompt itself,
// distinct from both the catalog and withSkills' per-message weaving above.
// ---------------------------------------------------------------------------

test("engineer mode off (the default) adds nothing to the prompt", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.doesNotMatch(prompt, /<engineer_mode>/);
});

test("engineer mode off produces byte-identical output to omitting the option entirely", () => {
  // A stray newline before the addendum's interpolation slot would survive
  // even with an empty string in it, so the presence-only check above would
  // pass while the actual bytes still differed from what this function
  // produced before the addendum existed. A genuinely unchanged
  // default-mode prompt has to be checked as bytes, not just "the new
  // section isn't there".
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
  // uncontradicted — Engineer Mode is additive, never a replacement.
  assert.match(prompt, /Build what was asked, then stop/);
});

test("engineer mode names an exploratory, scope-undecided request as its own stop-and-ask trigger", () => {
  // A request that opens a conversation, not a spec, must be named
  // explicitly, not left to be inferred from the generic shapeless-request
  // rule that already failed to catch it once.
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", engineerMode: {} });
  assert.match(prompt, /opens a conversation rather than gives you a spec/);
  assert.match(prompt, /talking to an engineer, not filing a ticket/);
});

test("engineer mode's addendum names the new-file checkpoint as a real backstop, not just a suggestion", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react", engineerMode: {} });
  assert.match(
    prompt,
    /after six new files in one turn, no NEW file and no delete runs for the rest of it/,
  );
  // An earlier version of this text implied reaching the checkpoint was
  // itself a failure, which pushed the model toward cramming remaining
  // work into whatever file it could still touch instead of actually
  // stopping — this reassurance is the fix.
  assert.match(prompt, /Reaching it is not a failure on real, larger work/);
  // The finish-phase opening: once a verification tool has run, edits and
  // run_command on existing files come back so a scoped pass can be
  // finished and verified in the same turn — new files stay refused.
  assert.match(prompt, /There is one deliberate opening/);
  assert.match(prompt, /finish phase/);
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
  // This is the whole point of carrying the listing at all: baking only
  // the body in leaves the model with
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
// withSkills — the guaranteed weaving, distinct from the catalog above:
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
// withPlugins — an instruction naming a tool, honestly
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

test("056: the design reference catalog is listed in the Architect prompt and told to adapt, not skin", () => {
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    architectMode: {},
    designRefCatalogText:
      "- linear-like: a near-black developer tool canvas\n- editorial: ink on paper",
  });
  assert.match(prompt, /<design_references>/);
  assert.match(prompt, /- linear-like: a near-black developer tool canvas/);
  assert.match(prompt, /use_design_ref\("<slug>"\)/);
  assert.match(prompt, /never skin the app as that brand/i);
});

test("056: Agent.md is inlined as <ui_guidelines> in both the Architect and Engineer prompts", () => {
  const agentMd = "MUST: visible focus rings\nNEVER: outline: none without a visible replacement";
  const arch = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    architectMode: {},
    agentMd,
  });
  const eng = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    engineerMode: {},
    agentMd,
  });
  for (const prompt of [arch, eng]) {
    assert.match(prompt, /<ui_guidelines>/);
    assert.match(prompt, /MUST: visible focus rings/);
  }
});

test("056: no catalog and no agentMd leaves the Architect/Engineer prompts unchanged", () => {
  const withArgs = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    architectMode: {},
  });
  assert.doesNotMatch(withArgs, /\n<design_references>\nReal product/);
  assert.doesNotMatch(withArgs, /\n<ui_guidelines>\nThe UI-quality bar/);
});

// ---------------------------------------------------------------------------
// WithAgents (the `/agent` menu's hint weaving)
// ---------------------------------------------------------------------------

test("062: withAgents leaves the message untouched when nothing is named", () => {
  assert.equal(withAgents("build me a landing page", []), "build me a landing page");
});

test("062: withAgents drops names it does not recognise rather than failing the turn", () => {
  assert.equal(withAgents("do the thing", ["not-a-specialist"]), "do the thing");
});

test("064: withAgents weaves a dispatch instruction naming the pass tool", () => {
  // 062 shipped this as a pointer — "not a command to run that specialist
  // now" — because default mode had no pass tool to command. 064 grants the
  // tool before this runs, so the hint must now tell the model to call it.
  // A user who picks "Designer" from a menu asked for a Designer.
  const woven = withAgents("polish the hero", ["designer"]);
  assert.match(woven, /pointed at a specialist/);
  assert.match(woven, /Designer/);
  assert.match(woven, /You have `design_pass` this turn/);
  assert.doesNotMatch(woven, /not a command to run that specialist now/);
  assert.ok(woven.endsWith("polish the hero"));
});

test("064: withAgents forbids the three ways the agent faked a pass", () => {
  // The logged slop session did all three: applied "the Designer lens"
  // itself, substituted use_skill, and hand-wrote DESIGN.md.
  const woven = withAgents("make it look designed", ["designer"]);
  assert.match(woven, /do not apply the lens yourself/);
  assert.match(woven, /do not substitute a skill/);
  assert.match(woven, /do not write that specialist's file by hand/);
  assert.match(woven, /rather than claiming you did one/);
});

test("064: withAgents handles more than one specialist and names every tool", () => {
  const woven = withAgents("ship it", ["designer", "security"]);
  assert.match(woven, /pointed at specialists/);
  assert.match(woven, /Designer/);
  assert.match(woven, /Security\/QA agent/);
  assert.match(woven, /`design_pass` and `qa_pass`/);
});

test("064: every specialist kind maps to a pass tool in the woven hint", () => {
  // A name in the menu with no tool behind it is exactly the 062 bug.
  for (const kind of SPECIALIST_KINDS) {
    assert.match(withAgents("go", [kind]), /You have `\w+_pass` this turn/);
  }
});

test("062: withAgents' hint table covers exactly the specialist kinds, no drift", () => {
  assert.deepEqual([...AGENT_HINT_NAMES].sort(), [...SPECIALIST_KINDS].sort());
});

// ---------------------------------------------------------------------------
// The art-direction floor. Default mode used to get four generic lines
// ("sensible visual design"), which every model resolves to the same
// near-black page with one purple gradient. These assert the floor is in the
// DEFAULT prompt — not only behind Architect or Engineer Mode, which is where
// all the design machinery lived when the founder hit this.
// ---------------------------------------------------------------------------

test("064: the default prompt points at the design reference library", () => {
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.match(prompt, /use_design_ref/);
  assert.match(prompt, /Pick the \s*one closest to this product's category/s);
  assert.match(prompt, /ADAPT it/);
});

test("064: the default prompt names the slop it must not default to", () => {
  // A model avoids a described anti-pattern far more reliably than it invents
  // an unnamed alternative, so the failure mode is spelled out.
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.match(prompt, /near-black background/);
  assert.match(prompt, /indigo-to-violet accent gradient/);
  assert.match(prompt, /NEVER emoji as iconography/);
  assert.match(prompt, /hand-drawn SVG "screenshot"/);
  assert.match(prompt, /Colour is an identity decision/);
});

test("064: the default prompt forbids claiming a specialist pass that never ran", () => {
  // Turn 3 of the logged session wrote DESIGN.md by hand and reported
  // "Applying the Designer lens, I have crafted and documented the design
  // system" — with no Designer anywhere in the run.
  const prompt = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.match(prompt, /Writing a DESIGN\.md is writing a document; it is not a design pass/);
  assert.match(prompt, /unless that \s*specialist actually ran/s);
});

test("064: the art-direction floor is in every mode, not just Architect/Engineer", () => {
  const modes = [
    buildSystemPrompt({ projectName: "p", template: "vite-react" }),
    buildSystemPrompt({ projectName: "p", template: "vite-react", engineerMode: {} }),
    buildSystemPrompt({ projectName: "p", template: "vite-react", architectMode: {} }),
  ];
  for (const prompt of modes) {
    assert.match(prompt, /use_design_ref/);
    assert.match(prompt, /NEVER emoji as iconography/);
  }
});

// ---------------------------------------------------------------------------
// DesignReferencesBlock: one renderer, so the top-level prompt and a
// specialist child's prompt cannot drift. They did drift, and the Designer
// child spent every pass without the library it was told to use.
// ---------------------------------------------------------------------------

test("064: designReferencesBlock renders nothing for an empty catalog", () => {
  assert.equal(designReferencesBlock(undefined), "");
  assert.equal(designReferencesBlock(""), "");
});

test("064: designReferencesBlock renders the catalog inside the tagged block", () => {
  const block = designReferencesBlock("- linear: a calm, dense product surface");
  assert.match(block, /<design_references>/);
  assert.match(block, /- linear: a calm, dense product surface/);
  assert.match(block, /<\/design_references>/);
});

test("064: the top-level prompt renders the catalog through the same helper", () => {
  // If these two ever diverge, a child and a top-level session are being told
  // different things about the same library — the 063 bug class.
  const catalog = "- stripe: precise, restrained, trust-forward";
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    architectMode: {},
    designRefCatalogText: catalog,
  });
  assert.ok(prompt.includes(designReferencesBlock(catalog).trim()));
});

// ---------------------------------------------------------------------------
// The <project> stack line and the woven <stack_guide>.
// ---------------------------------------------------------------------------

test("066: no stack option keeps the built-in Vite stack line, byte-identical", () => {
  const withoutStack = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  const withUndefined = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    stack: undefined,
    stackSkill: undefined,
  });
  assert.equal(withUndefined, withoutStack);
  assert.match(withoutStack, /Stack: React 19 \+ TypeScript \+ Vite \+ Tailwind CSS/);
  assert.doesNotMatch(withoutStack, /<stack_guide>/);
});

test("066: a stack string replaces the Stack line and does not add a guide on its own", () => {
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "expo-react-native",
    stack: "React Native on Expo, previewed via Expo web.",
  });
  assert.match(prompt, /Stack: React Native on Expo, previewed via Expo web\./);
  assert.doesNotMatch(prompt, /Vite \+ Tailwind CSS/);
  assert.doesNotMatch(prompt, /<stack_guide>/);
});

test("066: a stackSkill body is woven as <stack_guide> right after <skills>", () => {
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "expo-react-native",
    stack: "RN on Expo",
    skills: [{ name: "x", description: "y" }],
    stackSkill: { body: "Use View and Text, never div.\nRoutes live under app/." },
  });
  assert.match(prompt, /<stack_guide>/);
  assert.match(prompt, /Use View and Text, never div\./);
  assert.match(
    prompt,
    /building against the wrong primitives here produces something that\nrenders nothing/,
  );
  assert.ok(
    prompt.indexOf("</skills>") < prompt.indexOf("<stack_guide>"),
    "the stack guide comes after the skills catalog",
  );
  assert.ok(
    prompt.indexOf("<stack_guide>") < prompt.indexOf("<how_to_work>"),
    "and before how_to_work",
  );
});

test("066: an empty stackSkill body renders no guide", () => {
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    stackSkill: { body: "   " },
  });
  assert.doesNotMatch(prompt, /<stack_guide>/);
});

test("D1: a projectGuide renders as <project_guide> after <stack_guide>, before <how_to_work>", () => {
  const prompt = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    stackSkill: { body: "expo rules here" },
    projectGuide: "Components live in src/ui. No default exports.",
  });
  assert.match(prompt, /<project_guide>/);
  assert.match(prompt, /Components live in src\/ui\. No default exports\./);
  assert.match(prompt, /They do NOT override <scope>/);
  assert.ok(
    prompt.indexOf("</stack_guide>") < prompt.indexOf("<project_guide>"),
    "the project guide comes after the stack guide",
  );
  assert.ok(
    prompt.indexOf("<project_guide>") < prompt.indexOf("<how_to_work>"),
    "and before how_to_work",
  );
});

test("D1: no projectGuide means no <project_guide> block — byte-identical default prompt", () => {
  const withGuide = buildSystemPrompt({
    projectName: "p",
    template: "vite-react",
    projectGuide: "",
  });
  const without = buildSystemPrompt({ projectName: "p", template: "vite-react" });
  assert.doesNotMatch(withGuide, /<project_guide>/);
  assert.equal(withGuide, without);
});

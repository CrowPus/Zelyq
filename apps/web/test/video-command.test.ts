import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCinematicDirective,
  buildVideoDirective,
  CINEMATIC_SKILL,
  parseCinematicCommand,
  parseCinematicMessage,
  parseVideoCommand,
  parseVideoMessage,
} from "../src/lib/video-command";

/**
 * `/video` and `/cinematic` exist as separate commands so the user states
 * which technique they want, instead of the agent inferring it from adjectives.
 */

test("each command matches only itself", () => {
  assert.ok(parseVideoCommand("/video drifting particles"));
  assert.equal(parseCinematicCommand("/video drifting particles"), null);
  assert.ok(parseCinematicCommand("/cinematic the hero turns as you scroll"));
  assert.equal(parseVideoCommand("/cinematic the hero turns as you scroll"), null);
});

test("a bare command is complete — there is nothing missing to error about", () => {
  const video = parseVideoCommand("/video");
  assert.deepEqual(video, { brief: "", rest: "" });
  assert.match(buildVideoDirective(video!.brief, video!.rest), /ambient looping video motion/);

  const cinematic = parseCinematicCommand("/cinematic");
  assert.deepEqual(cinematic, { brief: "", rest: "" });
  assert.match(buildCinematicDirective(cinematic!.brief, cinematic!.rest), /cinematic scroll pass/);
});

test("text on either side of the command is preserved", () => {
  const parsed = parseVideoCommand("keep the copy /video soft light on the pricing section");
  assert.equal(parsed?.brief, "soft light on the pricing section");
  assert.equal(parsed?.rest, "keep the copy");
  const directive = buildVideoDirective(parsed!.brief, parsed!.rest);
  assert.match(directive, /soft light on the pricing section/);
  assert.match(directive, /keep the copy/);
});

test("a slash inside a word or a URL is not a command", () => {
  assert.equal(parseVideoCommand("https://example.com/video"), null);
  assert.equal(parseCinematicCommand("docs/cinematic"), null);
});

test("/video directs to a loop and warns off the scrub", () => {
  const directive = buildVideoDirective("particles behind the hero", "");
  assert.match(directive, /LOOPING treatment/);
  assert.match(directive, /muted, looping/);
  assert.match(directive, /prefers-reduced-motion/);
  assert.match(directive, /list_generated_videos/, "reuse is checked before spending");
  assert.match(directive, /place_video\b/);
  // Points at the other command rather than silently doing the expensive thing.
  assert.match(directive, /ADVANCES AS THE USER SCROLLS/);
  assert.match(directive, /\/cinematic/);
  // The honesty rule survives into the directive.
  assert.match(directive, /not footage of a real place/);
});

test("/cinematic routes to the specialist and removes the footage stall", () => {
  const directive = buildCinematicDirective("the hero — a bottle turning", "");
  assert.match(directive, /SCROLL-DRIVEN treatment/);
  assert.match(directive, /cinematic_pass/);
  assert.match(directive, /place_video_frames/);
  assert.match(directive, /manifest\.json/);
  assert.match(directive, /never\s+hardcode a frame count/i);
  assert.match(directive, /footage is generated/, "the review must not imply real footage");
  // And points back at the cheaper command when scroll coupling is not needed.
  assert.match(directive, /\/video/);
  assert.equal(CINEMATIC_SKILL, "cinematic-web");
});

test("the opening sentence never swallows what the user typed", () => {
  // The bug this guards: `Put ambient video motion into ${brief}` produced
  // "Put ambient video motion into i want you to generate a video and add in
  // to the hero section…" — a broken sentence that ran the instruction and the
  // request together. The prefix must be a complete sentence on its own.
  const brief =
    "i want you to generate a video and add in to the hero section, not wher the image is";
  for (const build of [buildVideoDirective, buildCinematicDirective]) {
    const first = build(brief, "").split("\n")[0];
    assert.ok(first.endsWith("."), `the opening line must be a whole sentence: ${first}`);
    assert.ok(
      !first.includes(brief),
      `the opening line must not interpolate the user's words: ${first}`,
    );
  }
});

test("the transcript shows the command and only what the user typed", () => {
  const brief = "soft light drifting over the blue hero background";
  const sent = buildVideoDirective(brief, "");
  const shown = parseVideoMessage(sent);
  assert.equal(shown?.brief, brief, "the bubble shows the user's words verbatim");
  // And none of the machinery a person did not write.
  assert.ok(!shown?.brief.includes("LOOPING treatment"));
  assert.ok(!shown?.brief.includes("place_video"));
  assert.ok(!shown?.brief.includes("prefers-reduced-motion"));

  const cine = buildCinematicDirective("the hero turning as you scroll", "");
  assert.equal(parseCinematicMessage(cine)?.brief, "the hero turning as you scroll");
  // Each parser matches only its own command.
  assert.equal(parseCinematicMessage(sent), null);
  assert.equal(parseVideoMessage(cine), null);
  // A bare command has nothing to show but the chip.
  assert.equal(parseVideoMessage(buildVideoDirective("", ""))?.brief, "");
});

test("a missing permission is explained where the user can act on it", () => {
  // The agent reported "tools are not enabled" without saying where the switch
  // is, because it never called a tool and so never read a tool description.
  for (const directive of [buildVideoDirective("x", ""), buildCinematicDirective("x", "")]) {
    assert.match(directive, /clapperboard in the chat toolbar/);
  }
  assert.match(buildVideoDirective("x", ""), /Do not build a placeholder/);
});

test("/video forbids the scroll specialist, however the request is worded", () => {
  // Shipped bug: a request that said "so we will get the cinamatic view" made
  // the agent call cinematic_pass — the scroll-scrub treatment — which then
  // stopped to stage assets. The adjective describes the look, not the
  // technique, and the directive now says so.
  const directive = buildVideoDirective(
    "add video in the background of the hero so we will get the cinamatic view",
    "",
  );
  assert.match(directive, /Do NOT call `cinematic_pass`/);
  assert.match(directive, /describe how it should LOOK, not which technique/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCinematicDirective,
  buildVideoDirective,
  CINEMATIC_SKILL,
  parseCinematicCommand,
  parseVideoCommand,
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
  assert.match(buildVideoDirective(video!.brief, video!.rest), /the hero section/);

  const cinematic = parseCinematicCommand("/cinematic");
  assert.deepEqual(cinematic, { brief: "", rest: "" });
  assert.match(
    buildCinematicDirective(cinematic!.brief, cinematic!.rest),
    /the hero of the current screen/,
  );
});

test("text on either side of the command is preserved", () => {
  const parsed = parseVideoCommand("keep the copy /video soft light on the pricing section");
  assert.equal(parsed?.brief, "soft light on the pricing section");
  assert.equal(parsed?.rest, "keep the copy");
  const directive = buildVideoDirective(parsed!.brief, parsed!.rest);
  assert.match(directive, /soft light on the pricing section/);
  assert.match(directive, /The user also said: keep the copy/);
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

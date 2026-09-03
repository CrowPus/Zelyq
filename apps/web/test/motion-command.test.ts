import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMotionDirective,
  motionChip,
  parseMotionCommand,
  parseMotionMessage,
  withoutMotionCommand,
} from "../src/lib/motion-command.ts";

test("/motion on its own is a complete command", () => {
  // Unlike /clone, nothing can be missing: a pass with no reference site is a
  // real thing to ask for, so this never blocks the send.
  const parsed = parseMotionCommand("/motion");
  assert.deepEqual(parsed, { url: null, rest: "" });
  assert.deepEqual(motionChip("/motion"), { plain: true });
});

test("a reference site is picked up and named on the chip", () => {
  const parsed = parseMotionCommand("/motion https://linear.app");
  assert.equal(parsed?.url, "https://linear.app/");
  assert.deepEqual(motionChip("/motion https://linear.app"), { host: "linear.app" });
});

test("it works mid-sentence, like every other command", () => {
  const parsed = parseMotionCommand("now /motion https://stripe.com but keep the hero still");
  assert.equal(parsed?.url, "https://stripe.com/");
  assert.match(parsed?.rest ?? "", /keep the hero still/);
  assert.match(parsed?.rest ?? "", /^now/);
});

test("a message that never says /motion is left alone", () => {
  assert.equal(parseMotionCommand("add some animation to the hero"), null);
  assert.equal(motionChip("add some animation to the hero"), null);
});

test("something URL-shaped that is not a URL stays part of the instruction", () => {
  const parsed = parseMotionCommand("/motion make it feel like apple.com");
  assert.equal(parsed?.url, null, "no protocol, so not a reference site");
  assert.match(parsed?.rest ?? "", /apple\.com/);
});

test("the directive tells the agent to wrap, verify, and stay out of cinematic's lane", () => {
  const directive = buildMotionDirective("https://linear.app/", "start with the pricing grid");
  assert.match(directive, /browse_page against it first/);
  assert.match(directive, /WRAPPING existing markup/);
  assert.match(directive, /walk_preview/);
  assert.match(directive, /if it finds no motion, the pass failed/);
  assert.match(directive, /Do not restructure the page/);
  assert.match(directive, /start with the pricing grid$/);
});

test("without a reference site the directive says so rather than inventing one", () => {
  const directive = buildMotionDirective(null, "");
  assert.match(directive, /No reference site/);
  assert.doesNotMatch(directive, /browse_page against it/);
});

test("dismissing the chip removes the command and keeps the message", () => {
  assert.equal(
    withoutMotionCommand("please /motion https://linear.app and keep the copy"),
    "please https://linear.app and keep the copy",
  );
});

test("a sent motion turn renders back compactly", () => {
  const sent = buildMotionDirective("https://linear.app/", "start with the pricing grid");
  const rendered = parseMotionMessage(sent);
  assert.equal(rendered?.url, "https://linear.app/");
  assert.equal(rendered?.rest, "start with the pricing grid");
  assert.equal(parseMotionMessage("just a normal message"), null);
});

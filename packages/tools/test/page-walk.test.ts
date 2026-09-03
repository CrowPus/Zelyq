import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyMedia,
  describeEasing,
  groupMotions,
  normaliseProps,
  type PageWalk,
  type RawMotion,
  roundMs,
  summarizeWalk,
} from "../src/page-walk.js";

/**
 * The shaping, against values the browser really returned.
 *
 * Every literal here was measured against stripe.com and linear.app while
 * designing this, not invented: the 700-character spring, the duplicated
 * property lists, the 11950.000000000002ms loop.
 */

const motion = (over: Partial<RawMotion> = {}): RawMotion => ({
  target: "div.reveal",
  props: ["transform", "opacity"],
  durationMs: 420,
  delayMs: 0,
  easing: "cubic-bezier(0.33, 1, 0.68, 1)",
  iterations: 1,
  firstSeenAtY: 0,
  ...over,
});

const walk = (over: Partial<PageWalk> = {}): PageWalk => ({
  pageHeight: 9619,
  viewportHeight: 800,
  stops: 8,
  motions: [],
  scriptMotions: [],
  runtime: { libraries: [], inlineTransforms: 0 },
  sticky: [],
  media: [],
  checkpoints: [],
  ...over,
});

test("a spring is named, not carried", () => {
  // linear.app authors springs as a linear() easing with 30 sample points —
  // a little over 700 characters, repeated once per animation. Nobody rebuilds
  // a spring by copying its samples, and 189 copies of it is the whole reason
  // grouping exists.
  // Full precision, the way the browser actually reports it — the percentages
  // are what make it enormous.
  const spring = `linear(0 0%, ${Array.from(
    { length: 29 },
    (_, i) => `${(i / 29).toFixed(4)} ${((i * 100) / 29).toString()}%`,
  ).join(", ")})`;
  assert.ok(spring.length > 700, "the real thing is this big");
  const described = describeEasing(spring);
  assert.match(described, /^spring-like \(linear\(\) with 30 stops\)$/);
  assert.ok(described.length < 40, "and what reaches the model is one short phrase");
});

test("a well-known curve is named and anything else passes through", () => {
  assert.equal(describeEasing("cubic-bezier(0.4, 0, 0.2, 1)"), "standard");
  assert.equal(describeEasing("cubic-bezier(0.33, 1, 0.68, 1)"), "cubic-bezier(0.33, 1, 0.68, 1)");
  assert.equal(describeEasing("linear"), "linear");
});

test("the browser's own float noise is rounded away", () => {
  // A real duration from stripe.com's ambient background loop.
  assert.equal(roundMs(11950.000000000002), 11950);
});

test("a property list is deduplicated but keeps its order", () => {
  // getKeyframes() repeats every property once per keyframe.
  assert.deepEqual(normaliseProps(["transform", "opacity", "transform", "opacity"]), [
    "transform",
    "opacity",
  ]);
  assert.deepEqual(normaliseProps(["opacity", "transform"]), ["opacity", "transform"]);
});

test("164 copies of one reveal collapse to one line", () => {
  // linear.app's actual shape: one dominant reveal, plus a few one-offs.
  const raw = [
    ...Array.from({ length: 164 }, (_, i) => motion({ firstSeenAtY: i * 40 })),
    motion({
      durationMs: 1500,
      easing: "cubic-bezier(0.455, 0.03, 0.515, 0.955)",
      props: ["opacity"],
    }),
  ];
  const groups = groupMotions(raw);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.count, 164);
  assert.equal(groups[0]?.signature, "420ms cubic-bezier(0.33, 1, 0.68, 1) → transform + opacity");
  assert.equal(groups[0]?.firstSeenAtY, 0, "the earliest sighting wins, not the last");
});

test("the design system sorts above the one-off", () => {
  // A cookie banner animates too. If reading order does not say which is which,
  // the agent will reproduce the cookie banner and not the reveal.
  const groups = groupMotions([
    motion({ target: "div.cookie", durationMs: 200, props: ["opacity"] }),
    ...Array.from({ length: 12 }, () => motion()),
  ]);
  assert.equal(groups[0]?.count, 12);
  assert.equal(groups[1]?.example, "div.cookie");
});

test("an infinite animation is marked as a loop, never as a reveal", () => {
  const groups = groupMotions([motion({ iterations: null, durationMs: 11950 })]);
  assert.equal(groups[0]?.kind, "loop");
});

test("a stagger collapses into one entry that keeps its spread", () => {
  // Grouping on the exact delay was the first attempt, and against linear.app
  // it turned one 420ms reveal into fifty near-identical entries — 160ms,
  // 162ms, 164ms — which buried the finding under its own evidence. The ladder
  // *is* the stagger, so it belongs in one line as a range.
  const groups = groupMotions([
    motion({ delayMs: 0 }),
    motion({ delayMs: 160 }),
    motion({ delayMs: 326 }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.count, 3);
  assert.equal(groups[0]?.delayMinMs, 0);
  assert.equal(groups[0]?.delayMaxMs, 326);
  assert.match(summarizeWalk(walk({ motions: groups })), /staggered 0–326ms/);
});

test("a reveal outranks an ambient loop used far more often", () => {
  // linear.app's particle field is 100 looping circles; its reveal is the thing
  // a clone has to reproduce. Sorting on frequency alone put the decoration
  // first and pushed the system below the fold of the summary.
  const groups = groupMotions([
    ...Array.from({ length: 100 }, () => motion({ iterations: null, durationMs: 3200 })),
    motion({ durationMs: 420 }),
  ]);
  assert.equal(groups[0]?.kind, "one-shot");
  assert.equal(groups[1]?.count, 100);
  const text = summarizeWalk(walk({ motions: groups }));
  assert.ok(
    text.indexOf("reveals") < text.indexOf("Ambient"),
    "the system reads before the decoration",
  );
});

test("a static page says so rather than saying nothing", () => {
  const text = summarizeWalk(walk());
  assert.match(text, /Motion: none observed/);
});

test("the summary leads with how often a motion is used", () => {
  const text = summarizeWalk(
    walk({ motions: groupMotions(Array.from({ length: 164 }, () => motion())) }),
  );
  assert.match(text, /×164/);
  assert.match(text, /420ms/);
});

test("the long tail is counted, not printed", () => {
  const many = Array.from({ length: 40 }, (_, i) => motion({ durationMs: 100 + i }));
  const text = summarizeWalk(walk({ motions: groupMotions(many) }));
  assert.match(text, /and 34 more \(full record in motion\.json\)/);
  assert.ok(text.split("\n").length < 16, "a summary that long is not a summary");
});

test("a pinned layer is reported even when nothing about it changes", () => {
  // The first version only reported a sticky layer if its own computed style
  // differed further down the page, and so reported nothing at all for real
  // sticky headers — tailwindcss.com's bar changes on an inner element. That a
  // 57px bar is pinned over the content is the fact a clone needs first.
  const text = summarizeWalk(
    walk({
      sticky: [
        {
          selector: "div.fixed",
          position: "fixed",
          heightPx: 57,
          background: "rgba(0, 0, 0, 0)",
          changes: [],
        },
      ],
    }),
  );
  assert.match(text, /Pinned layers \(1\)/);
  assert.match(text, /57px tall/);
  assert.match(text, /no change on scroll/);
});

test("a header that does react says how", () => {
  const text = summarizeWalk(
    walk({
      sticky: [
        {
          selector: "header",
          position: "sticky",
          heightPx: 64,
          background: "rgba(0, 0, 0, 0)",
          changes: ["background rgba(0, 0, 0, 0) → rgb(255, 255, 255)", "shadow none → set"],
        },
      ],
    }),
  );
  assert.match(text, /changes on scroll: background .* → rgb\(255, 255, 255\); shadow none → set/);
});

test("a full-width muted loop is a background, and the same file with controls is not", () => {
  const base = {
    kind: "video",
    controls: false,
    muted: true,
    loop: true,
    rendered: [1280, 720] as [number, number],
    viewportWidth: 1280,
  };
  assert.equal(classifyMedia(base), "background");
  assert.equal(classifyMedia({ ...base, controls: true }), "feature");
  assert.equal(
    classifyMedia({ ...base, controls: true, rendered: [600, 330], muted: false, loop: false }),
    "inline",
  );
});

test("audio is never a background video", () => {
  assert.equal(
    classifyMedia({
      kind: "audio",
      controls: true,
      muted: false,
      loop: false,
      rendered: [1280, 40],
      viewportWidth: 1280,
    }),
    "inline",
  );
});

test("motion the animation API cannot see is reported, and says so", () => {
  // noth.in is a Webflow site driven by GSAP: `getAnimations()` returns almost
  // nothing while 449 elements carry a JS-written inline transform. Reporting
  // only the first number was true and deeply misleading.
  const text = summarizeWalk(
    walk({
      runtime: { libraries: ["gsap", "Webflow"], inlineTransforms: 449 },
      scriptMotions: [
        {
          selector: "div.line-child",
          kind: "slide",
          detail: "translateY 73.6px → 27.6px",
          count: 81,
          firstSeenAtY: 1359,
        },
      ],
    }),
  );
  assert.match(text, /Driven from script by gsap, Webflow/);
  assert.match(text, /449 elements/);
  assert.match(text, /×81 {2}slide — translateY 73\.6px → 27\.6px/);
  assert.match(text, /the animation API does not see/, "it has to explain the empty section above");
});

test("a page with no script-driven motion says nothing about it", () => {
  assert.doesNotMatch(summarizeWalk(walk()), /Driven from script/);
});

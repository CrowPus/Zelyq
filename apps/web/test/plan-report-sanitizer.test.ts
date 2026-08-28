import assert from "node:assert/strict";
import { test } from "node:test";
import { REPORT_CSP, scrubCss, wrapReportDoc } from "../src/components/planReportSanitizer";

// The CSP <meta> must be parsed before any content the model
// authored, so it wraps the whole document from a trusted skeleton.
test("wrapReportDoc puts the CSP first in <head>, before styles and body", () => {
  const out = wrapReportDoc("body{color:red}", "<p>remote <img></p>");
  const cspAt = out.indexOf('http-equiv="Content-Security-Policy"');
  assert.ok(cspAt > -1, "CSP present");
  assert.ok(cspAt < out.indexOf("<style>"), "CSP before any <style>");
  assert.ok(cspAt < out.indexOf("<body>"), "CSP before <body>");
  assert.ok(cspAt < out.indexOf("<p>"), "CSP before authored markup");
  assert.match(out, /^<!doctype html>/i);
});

test("the CSP denies network and script by default", () => {
  assert.match(REPORT_CSP, /default-src 'none'/);
  assert.doesNotMatch(REPORT_CSP, /script-src/);
  // only data: images and inline styles are allowed
  assert.match(REPORT_CSP, /img-src data:/);
  assert.match(REPORT_CSP, /style-src 'unsafe-inline'/);
});

// Inline CSS is allowed but must not reach the network.
test("scrubCss removes @import and remote url() and expression()", () => {
  const dirty =
    "@import url('https://evil/x.css'); a{background:url(https://evil/bg.png)} b{width:expression(alert(1))}";
  const clean = scrubCss(dirty);
  assert.doesNotMatch(clean, /@import/i);
  assert.doesNotMatch(clean, /https:\/\/evil/);
  assert.doesNotMatch(clean, /expression\(/i);
});

test("scrubCss keeps local styling untouched", () => {
  const css = ".card{padding:1rem;background:#fff;border-radius:8px}";
  assert.equal(scrubCss(css), css);
});

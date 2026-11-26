import assert from "node:assert/strict";
import { test } from "node:test";
import { withModelReadableImages } from "../src/session.js";

const png = { mimeType: "image/png", data: "AAAA" };
const svg = { mimeType: "image/svg+xml", data: "PHN2Zz4=" };

test("an SVG is never sent to the model, and the model is told why", () => {
  const result = withModelReadableImages("Wrote a placeholder.", [svg]);
  assert.equal(result.images, undefined);
  assert.match(result.output, /not shown to you: image\/svg\+xml/);
});

test("photos pass through untouched; a mix keeps only the photos", () => {
  assert.deepEqual(withModelReadableImages("ok", [png]), { output: "ok", images: [png] });
  const mixed = withModelReadableImages("ok", [png, svg]);
  assert.deepEqual(mixed.images, [png]);
  assert.match(mixed.output, /1 picture\(s\) not shown/);
});

test("no pictures, no change", () => {
  assert.deepEqual(withModelReadableImages("ok", undefined), { output: "ok" });
});

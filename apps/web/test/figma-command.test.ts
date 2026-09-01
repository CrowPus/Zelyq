import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFigmaCommand, parseFigmaMessage } from "../src/lib/figma-command.ts";

test("parseFigmaCommand returns null for a normal message", () => {
  assert.equal(parseFigmaCommand("build a landing page"), null);
  assert.equal(parseFigmaCommand("we use figma at work"), null);
});

test("parseFigmaCommand pulls the file key and node id from a design link", () => {
  const result = parseFigmaCommand(
    "/figma https://www.figma.com/design/abc123DEF/My-Site?node-id=12-345&t=xyz",
  );
  assert.deepEqual(result, { fileKey: "abc123DEF", nodeId: "12:345" });
});

test("parseFigmaCommand accepts an older /file/ link with an encoded node-id", () => {
  const result = parseFigmaCommand("/figma https://figma.com/file/KEY9/Proj?node-id=1%3A2");
  assert.deepEqual(result, { fileKey: "KEY9", nodeId: "1:2" });
});

test("parseFigmaCommand errors with no link, a bad URL, or no node-id", () => {
  assert.ok("error" in (parseFigmaCommand("/figma") as object));
  assert.ok("error" in (parseFigmaCommand("/figma make it pop") as object));
  assert.ok(
    "error" in (parseFigmaCommand("/figma https://www.figma.com/design/abc123/My-Site") as object),
  );
});

test("parseFigmaMessage round-trips a sent /figma message and ignores others", () => {
  assert.deepEqual(
    parseFigmaMessage("/figma https://www.figma.com/design/abc/x?node-id=1-1 keep it dark"),
    { fileKey: "abc", nodeId: "1:1" },
  );
  assert.equal(parseFigmaMessage("just a normal message"), null);
  assert.equal(parseFigmaMessage("/figma no-link-here"), null);
});

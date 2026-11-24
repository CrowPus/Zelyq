import assert from "node:assert/strict";
import { test } from "node:test";
import { commandErrorReason } from "../src/command-error.js";

test("a docker run error gives its reason, not Docker's --help hint", () => {
  // Exactly what Docker 29 prints.
  const out =
    "docker: Error response from daemon: unknown or invalid runtime name: runsc\n\nRun 'docker run --help' for more information\n";
  assert.equal(commandErrorReason(out), "unknown or invalid runtime name: runsc");
});

test("the reason after a first run's download is still the reason", () => {
  const out = [
    "Unable to find image 'node:22-bookworm' locally",
    "22-bookworm: Pulling from library/node",
    "Status: Downloaded newer image for node:22-bookworm",
    "docker: Error response from daemon: range of CPUs is from 0.01 to 1.00, as there are only 1 CPUs available",
    "",
    "Run 'docker run --help' for more information",
  ].join("\n");
  assert.equal(
    commandErrorReason(out),
    "range of CPUs is from 0.01 to 1.00, as there are only 1 CPUs available",
  );
});

test("plain output keeps its last line; nothing at all gives the fallback", () => {
  assert.equal(commandErrorReason("one\ntwo\n"), "two");
  assert.equal(commandErrorReason("\n\n", "no output"), "no output");
  assert.equal(commandErrorReason("See 'docker --help'.\n"), "unknown error");
});

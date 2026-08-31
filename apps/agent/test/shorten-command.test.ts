import assert from "node:assert/strict";
import { test } from "node:test";
import { shortenCommand } from "../src/session.js";

// The reconstructed fallback summary (session.ts `synthesizeFallbackSummary`)
// used to paste every `run_command` verbatim. A turn that burned its budget on
// a dozen big inline `node -e "<script>"` probes then dumped tens of KB of
// script into the chat transcript. `shortenCommand` collapses each one.

test("an inline node -e script becomes a runner + size, never its body", () => {
  const script = `node -e "${"const x = 1;\n".repeat(400)}console.log(x)"`;
  const out = shortenCommand(script);
  assert.match(out, /^node -e "<inline script, [\d.]+kb>"$/);
  assert.ok(!out.includes("console.log"), "the script body must not survive");
  assert.ok(out.length < 60);
});

test("python -c and bun/deno inline scripts are collapsed the same way", () => {
  assert.match(
    shortenCommand(`python3 -c "import sys; print(sys.version)"`),
    /^python3 -c "<inline script, \d+b>"$/,
  );
  assert.match(
    shortenCommand(`bun --eval "console.log(1)"`),
    /^bun --eval "<inline script, \d+b>"$/,
  );
});

test("a normal short command is passed through, whitespace flattened", () => {
  assert.equal(shortenCommand("npm run typecheck"), "npm run typecheck");
  assert.equal(shortenCommand("npm  run   build\n"), "npm run build");
});

test("a long plain command is trimmed to one line, ~72 chars", () => {
  const long = `npx --yes some-tool --flag ${"a".repeat(120)}`;
  const out = shortenCommand(long);
  assert.ok(out.length <= 72, `got ${out.length}: ${out}`);
  assert.ok(out.endsWith("…"));
});

test("a heredoc is reduced to its head", () => {
  const cmd = "cat <<'EOF' > file.txt\nlots\nof\nlines\nEOF";
  assert.equal(shortenCommand(cmd), "cat <<'…'");
});

test("does not misfire on a path that merely contains 'node'", () => {
  assert.equal(shortenCommand("./node_modules/.bin/vitest run"), "./node_modules/.bin/vitest run");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCloneDirective, CLONE_SKILL, parseCloneCommand } from "../src/lib/clone-command.ts";

test("parseCloneCommand returns null for a normal message", () => {
  assert.equal(parseCloneCommand("build me a landing page"), null);
  assert.equal(parseCloneCommand("mention /clone in passing but no command"), null);
});

test("parseCloneCommand pulls the URL and the rest", () => {
  const result = parseCloneCommand("/clone https://stripe.com  focus on the hero");
  assert.deepEqual(result, { url: "https://stripe.com/", rest: "focus on the hero" });
});

test("parseCloneCommand tolerates leading whitespace and a bare command", () => {
  assert.deepEqual(parseCloneCommand("   /clone https://example.com"), {
    url: "https://example.com/",
    rest: "",
  });
});

test("parseCloneCommand takes the first URL when several are present", () => {
  const result = parseCloneCommand("/clone https://a.com then also https://b.com");
  assert.equal((result as { url: string }).url, "https://a.com/");
  assert.equal((result as { rest: string }).rest, "then also https://b.com");
});

test("parseCloneCommand errors when the URL is missing", () => {
  assert.deepEqual(parseCloneCommand("/clone"), {
    error: "/clone needs a URL — for example  /clone https://example.com",
  });
  assert.deepEqual(parseCloneCommand("/clone make it pretty"), {
    error: "/clone needs a URL — for example  /clone https://example.com",
  });
});

test("parseCloneCommand rejects a non-http(s) URL", () => {
  const result = parseCloneCommand("/clone ftp://example.com/x");
  assert.ok(result && "error" in result);
});

test("buildCloneDirective wraps the URL and appends the user's own text", () => {
  const msg = buildCloneDirective("https://example.com/", "keep the dark theme");
  assert.match(msg, /<clone_task>/);
  assert.match(msg, /URL: https:\/\/example\.com\//);
  assert.match(msg, /clone\/example\.com\/REPLICA\.md/);
  assert.match(msg, /PUBLIC pages only/);
  assert.match(msg, /keep the dark theme$/);
});

test("buildCloneDirective with no extra text ends at the closing tag", () => {
  const msg = buildCloneDirective("https://example.com/", "");
  assert.match(msg, /<\/clone_task>$/);
});

test("CLONE_SKILL is the replica skill's name", () => {
  assert.equal(CLONE_SKILL, "complete-replica-engineering");
});

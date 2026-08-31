import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCloneDirective,
  CLONE_SKILL,
  parseCloneCommand,
  parseCloneMessage,
} from "../src/lib/clone-command.ts";

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

test("buildCloneDirective is short, names the URL and the skill, and appends the user's text", () => {
  const msg = buildCloneDirective("https://example.com/", "keep the dark theme");
  assert.match(
    msg,
    /^Clone this website into the current project, page for page: https:\/\/example\.com\//,
  );
  assert.match(msg, /complete-replica-engineering skill's "\/clone" workflow/);
  assert.match(msg, /clone\/example\.com\/REPLICA\.md/);
  assert.match(msg, /Public pages only/);
  assert.match(msg, /keep the dark theme$/);
  assert.ok(msg.split("\n").length < 12, "directive should stay compact");
});

test("parseCloneMessage round-trips buildCloneDirective", () => {
  assert.deepEqual(parseCloneMessage(buildCloneDirective("https://example.com/", "")), {
    url: "https://example.com/",
    rest: "",
  });
  assert.deepEqual(parseCloneMessage(buildCloneDirective("https://a.io/x", "make it teal")), {
    url: "https://a.io/x",
    rest: "make it teal",
  });
});

test("parseCloneMessage ignores an ordinary message", () => {
  assert.equal(parseCloneMessage("build me a landing page for https://example.com"), null);
});

test("CLONE_SKILL is the replica skill's name", () => {
  assert.equal(CLONE_SKILL, "complete-replica-engineering");
});

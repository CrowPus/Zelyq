import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCloneDirective,
  CLONE_SKILL,
  cloneChip,
  parseCloneCommand,
  parseCloneMessage,
  withoutCloneCommand,
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

test("the command fires wherever the menu offered it, not only at the start", () => {
  // The `/` menu opens whenever `/` follows a space, so it offered `/clone`
  // mid-sentence — and the submit path, which required the command to open the
  // message, then ignored it silently. The user saw the menu, picked the
  // command, sent, and nothing happened. Real messages, from a real session
  // where this went unnoticed for two days.
  const fired = parseCloneCommand("now i want you to use the /clone https://www.noth.in/");
  assert.ok(fired && !("error" in fired), "a command picked mid-sentence has to fire");
  assert.equal(fired.url, "https://www.noth.in/");
  assert.match(fired.rest, /now i want you to use the/);
});

test("the words either side of the command survive as the instruction", () => {
  const parsed = parseCloneCommand("/clone https://example.com start with the hero");
  assert.ok(parsed && !("error" in parsed));
  assert.equal(parsed.rest, "start with the hero");
});

test("talking about the command mid-sentence neither fires nor blocks", () => {
  // Recognising it anywhere must not make "the /clone isn't working" unsendable.
  // Position decides: opening the message, a missing URL is a hint; buried in a
  // sentence, it is just someone talking about the command.
  assert.equal(parseCloneCommand("the /clone is not working for me"), null);
  assert.ok(
    (() => {
      const bare = parseCloneCommand("/clone");
      return bare && "error" in bare;
    })(),
    "but a bare command at the start still says what is missing",
  );
});

test("a URL only before the command does not make it a clone", () => {
  // The URL has to follow the command, or "https://x was wrong, /clone it
  // properly" would silently start cloning something nobody asked for.
  assert.equal(parseCloneCommand("https://example.com was wrong, /clone it properly"), null);
});

test("a picked command shows a chip, the way a picked skill does", () => {
  // Picking a skill from the `/` menu produces a chip; picking `/clone` only
  // dropped the word into the textarea, so there was nothing to say it had
  // taken and the command looked dead even when it was armed.
  assert.deepEqual(cloneChip("/clone https://www.noth.in/"), { host: "noth.in" });
  assert.deepEqual(cloneChip("/clone "), { needsUrl: true }, "half-typed says what is missing");
  assert.deepEqual(cloneChip("build me a landing page"), null);
});

test("the chip appears exactly when the command would fire", () => {
  // A chip that showed for a command the submit path then ignored would be the
  // same lie in the other direction.
  assert.deepEqual(cloneChip("use the /clone on https://example.com"), { host: "example.com" });
  assert.equal(cloneChip("the /clone is not working"), null, "talking about it arms nothing");
});

test("dismissing the chip takes the command out of the draft", () => {
  assert.equal(withoutCloneCommand("/clone https://example.com"), "https://example.com");
  assert.equal(withoutCloneCommand("please /clone this"), "please this");
});

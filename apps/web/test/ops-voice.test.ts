import assert from "node:assert/strict";
import { test } from "node:test";
import { spokenPart } from "../src/lib/ops-voice.js";

test("only a reply's opening sentence is read aloud, without Markdown marks", () => {
  assert.equal(
    spokenPart("Done: **production** exists on box and is protected. I checked it.\n\nDetails…"),
    "Done: production exists on box and is protected.",
  );
  assert.equal(
    spokenPart("The plan waits for your approval!\nRead it first."),
    "The plan waits for your approval!",
  );
  assert.equal(spokenPart("Run `npm test` first."), "Run npm test first.");
  assert.equal(spokenPart("No full stop here"), "No full stop here");
});

import { listenWith, type Recognition, recognitionError } from "../src/lib/ops-voice.js";

/** A stand-in for the browser's recognition: the test says what it "hears". */
class FakeRecognition implements Recognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  started = false;
  onresult: Recognition["onresult"] = null;
  onerror: Recognition["onerror"] = null;
  onend: Recognition["onend"] = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  say(parts: { text: string; final: boolean }[]) {
    const results = parts.map((part) =>
      Object.assign([{ transcript: part.text }], { isFinal: part.final }),
    );
    this.onresult?.({ resultIndex: 0, results });
  }
}

test("listening in the browser: words show as you speak, and what you said is sent when it ends", () => {
  const heard: string[] = [];
  let sent: string | null = null;
  listenWith(FakeRecognition, {
    lang: "en-GB",
    handsFree: false,
    heard: (text) => heard.push(text),
    failed: () => assert.fail("no error expected"),
    done: (text) => {
      sent = text;
    },
  });
  const rec = FakeRecognition.last as FakeRecognition;
  assert.equal(rec.started, true);
  assert.equal(rec.lang, "en-GB");
  assert.equal(rec.continuous, true, "press to talk listens until pressed again");
  rec.say([{ text: "put shop", final: false }]);
  rec.say([
    { text: "put shop online", final: true },
    { text: " on staging", final: false },
  ]);
  assert.equal(heard.at(-1), "put shop online on staging");
  rec.stop();
  assert.equal(sent, "put shop online");
});

test("hands-free ends when you pause; an error sends nothing and says what to do", () => {
  let sent: string | null = null;
  let failure: string | null = null;
  listenWith(FakeRecognition, {
    lang: "en",
    handsFree: true,
    heard: () => undefined,
    failed: (message) => {
      failure = message;
    },
    done: (text) => {
      sent = text;
    },
  });
  const rec = FakeRecognition.last as FakeRecognition;
  assert.equal(rec.continuous, false);
  rec.say([{ text: "restart the shop", final: true }]);
  rec.onerror?.({ error: "not-allowed" });
  rec.stop();
  assert.equal(sent, "");
  assert.match(failure ?? "", /Microphone access was refused/);
  assert.equal(recognitionError("no-speech"), null, "silence is not an error");
  assert.match(recognitionError("network") ?? "", /could not reach its speech service/);
});

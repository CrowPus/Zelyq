import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { startScreencast } from "../src/screencast.js";

/**
 * Run against a real headless Chromium. The whole feature is a CDP behaviour,
 * so a mocked page would only prove the mock matches the mock.
 */

type Event = { t: string; id: string; bytes?: number };

function recorder() {
  const events: Event[] = [];
  return {
    events,
    sink: {
      open: (id: string) => events.push({ t: "open", id }),
      frame: (id: string, f: { data: string }) =>
        events.push({ t: "frame", id, bytes: f.data.length }),
      close: (id: string) => events.push({ t: "close", id }),
    },
  };
}

/** A page that paints a few times, so Chromium has reason to emit frames. */
async function paint(page: import("playwright").Page) {
  await page.setContent("<body style='margin:0'><h1>hello</h1></body>");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let n = 0;
        const id = setInterval(() => {
          document.body.style.background = `hsl(${n * 60},70%,60%)`;
          if (++n > 5) {
            clearInterval(id);
            resolve();
          }
        }, 110);
      }),
  );
  await new Promise((r) => setTimeout(r, 300));
}

test("streams frames from a headless page, bracketed by open and close", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const { events, sink } = recorder();
    const cast = await startScreencast(page, sink, "call_1", "a page");
    await paint(page);
    await cast.stop();

    assert.equal(events.filter((e) => e.t === "open").length, 1);
    assert.equal(events.filter((e) => e.t === "close").length, 1);
    const frames = events.filter((e) => e.t === "frame");
    assert.ok(frames.length > 0, "a painting page must produce frames");
    assert.ok(
      frames.every((f) => f.id === "call_1"),
      "every frame carries its call id",
    );
    assert.ok(
      frames.every((f) => (f.bytes ?? 0) > 0),
      "frames carry data",
    );
    assert.equal(events[0]?.t, "open", "open comes first");
    assert.equal(events.at(-1)?.t, "close", "close comes last");
  } finally {
    await browser.close();
  }
});

test("no sink means no streaming and no error", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const cast = await startScreencast(page, undefined, "call_2", "a page");
    await paint(page);
    await cast.stop();
    // Nothing to assert but the absence of a throw: a tool must behave
    // identically whether or not anyone is watching.
  } finally {
    await browser.close();
  }
});

test("a sink that throws cannot take the process down", async () => {
  // This runs inside a CDP event listener, where an uncaught throw is fatal —
  // and the real sink pushes onto a stream that may have closed under it.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let called = 0;
    const hostile = {
      open() {
        called++;
        throw new Error("sink exploded");
      },
      frame() {
        called++;
        throw new Error("sink exploded");
      },
      close() {
        called++;
        throw new Error("sink exploded");
      },
    };
    const cast = await startScreencast(page, hostile, "call_3", "a page");
    await paint(page);
    await cast.stop();
    assert.ok(called > 1, "the sink was really called, and really threw");
  } finally {
    await browser.close();
  }
});

test("stop is idempotent and survives a page that closed first", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const { events, sink } = recorder();
    const cast = await startScreencast(page, sink, "call_4", "a page");
    await page.close();
    await cast.stop();
    await cast.stop();
    assert.equal(events.filter((e) => e.t === "close").length, 1, "close fires exactly once");
  } finally {
    await browser.close();
  }
});

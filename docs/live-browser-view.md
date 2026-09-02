# Live browser view

**Status:** built. Written and implemented 2026-09-02.

When the agent drives a browser — `/clone`, `capture_reference`, `inspect_page`, an accessibility
audit — the user sees a spinner and a tool name. The page being visited is invisible until a
screenshot comes back at the end, if one comes back at all. This proposes showing that browser live,
beside the preview, while it navigates.

The mechanism is proven: the measurements below come from running it against real sites with this
repo's own Playwright, not from documentation.

## What already exists

Three places launch a browser. All three run **in the agent process on the host** — not in a project
container — and all use `chromium.launch({ headless: true })`:

| Where | Used by |
|---|---|
| `packages/tools/src/capture-reference.ts` | `/clone`, `capture_reference` |
| `packages/tools/src/preview.ts` | `view_preview` screenshots |
| `plugins/browser-qa.mjs` | `inspect_page`, `check_console_errors`, `accessibility_audit`, `test_responsive_layout` |

Two facts shape everything below.

**A browser lives inside one tool call.** Launch, work, close — seconds to about a minute. There is
no long-lived browser to attach to, so this is a transient overlay during those calls, not a panel
that is always there.

**The UI already has a live channel but it carries no pixels.** The agent streams `tool.start` /
`tool.end` over SSE to the server, which relays to the browser over its WebSocket gateway. That
path is JSON and every event is recorded on the turn. Frames must not go down it.

## How it would work

Chromium's DevTools Protocol has `Page.startScreencast`, which emits a JPEG frame whenever the page
changes visually. Playwright exposes CDP directly, and it works headless:

```
agent: page.context().newCDPSession(page)
       cdp.send("Page.startScreencast", { format: "jpeg", quality, maxWidth, maxHeight })
       cdp.on("Page.screencastFrame", …)   ← base64 JPEG
         ↓ frames-only channel, never the turn stream
server → browser WebSocket
         ↓
       <img src="data:image/jpeg;base64,…">  beside the preview
```

The frame is acknowledged with `Page.screencastFrameAck`; Chromium will not send the next one until
it is, which gives natural backpressure for free.

## Measured, not assumed

Run against this repo's Playwright, headless, 960×600 JPEG:

| | Light page (`example.com`) | Heavy page (Wikipedia article, scrolled) |
|---|---:|---:|
| Frame rate | ~6.2 fps | ~5.7 fps |
| Average frame | 7 KB | 61 KB |
| Bandwidth | ~44 KB/s | ~349 KB/s |
| A 30s clone | ~1.3 MB | ~10 MB |

Two findings worth having before committing to this:

**Frames are emitted on visual change, not on a clock.** An idle page costs nothing. The fps figures
above are what a page doing something actually produces; there is no steady drip to pay for.

**Request interception coexists with screencast.** `/clone` routes every request through
`assertRequestAllowed` for SSRF protection. I checked this specifically, because if the two had
conflicted the whole idea would be dead for the flagship case: 47 requests were intercepted normally
with a screencast running.

10 MB for a heavy 30-second clone is the number to design against. Tuning levers, in order of
effect: `maxWidth` (960 → 640 is roughly half the bytes), `quality` (55 → 40), and `everyNthFrame`.
A 640×400 / q40 / every-3rd-frame stream should land near 100 KB/s worst case, which is a reasonable
default.

## What it costs

**No tokens.** Frames never reach the model. This is the important one: the token work in `#132`
cut uncached input by more than half, and a feature that quietly undid it would not be worth having.
The model's view is unchanged — it still gets the same final screenshot it does today.

**No container work.** The browser already runs in the agent process on the host.

**No new transport, in the end.** This was expected to be most of the work and turned out to be
none of it. The gateway broadcasts *every* agent event to the browser and only *stores* the ones its
switch names — `default: break`. A new event type therefore relays for free and is never written to
the turn. An integration test pins that: it asserts a frame reaches the WebSocket byte-identical and
that neither the frame nor its event type appears anywhere in the stored messages.

## What was decided

**Transport:** the existing event stream, per above.

**Which tools:** `capture_reference` only, for now. It is the `/clone` path, the one with pages
worth watching. `view_preview` screenshots a page already visible in the preview iframe, so
streaming it would be pointless; `inspect_page` lives in a plugin and needs the capability exposed
on `ToolContext` first, which is a public-ish surface worth designing once.

**Shape:** `ScreencastSink` on `ToolContext`, absent by default. A tool behaves identically whether
or not anyone is watching, which is the property that makes this safe to add to more callers later.

## What I would not do

**Not a headful browser with VNC.** It is how some agent products do this, and it would give
interaction as well as viewing. It also means a display server, a much heavier container, and a
second protocol. Screencast gets the "see what it is doing" value for a fraction of that, and
interaction is not what was asked for.

**Not video recording.** Playwright can record a `.webm` per context, but it only lands when the
context closes. That is a replay, not a live view.

**Not always-on.** A browser exists for the duration of a tool call. A panel that is empty 95% of
the time is worse than one that appears when there is something to show.

## What was built

| | |
|---|---|
| `packages/tools/src/screencast.ts` | `startScreencast(page, sink, callId, label)` over CDP |
| `packages/tools/src/types.ts` | `ScreencastSink` and `callId` on `ToolContext` |
| `packages/tools/src/capture-reference.ts` | streams each page it opens |
| `packages/core/src/protocol.ts` | `browser.open` / `browser.frame` / `browser.close` |
| `apps/agent/src/session.ts` | the sink, emitting onto the turn stream |
| `apps/web/src/components/LiveBrowser.tsx` | the panel, under the preview |

Two things only came out of building it.

**A throwing sink killed the process.** The frame handler is a CDP event listener, so an exception
inside it is unhandled — and the sink's job is to push onto a stream that may have closed. Every
call into the sink is now guarded. A dropped frame is nothing; a dead agent is not.

**A capture opens one page per viewport width**, so `open`/`close` repeats several times inside a
single tool call. The panel carried the previous frame across the gap, because blinking empty four
times during one clone looked broken.

## Open questions

- Multi-user: two sessions, two browsers, one server. The frames are scoped by session id and
  relayed on the project's own socket, so the plumbing is right, but it is not exercised by a test.
- Frames are dropped on reconnect. That seems correct — they are ambient, not a record.
- Nothing is persisted, deliberately. The moment a frame is stored it becomes retention and a
  privacy question, and the value was always "watch it happen", not "look at it later".

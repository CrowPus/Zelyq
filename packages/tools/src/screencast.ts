import type { Page } from "playwright";

/**
 * Streams what a headless browser is looking at, so a `/clone` or a page
 * inspection is something the user can watch rather than a spinner.
 *
 * Chromium emits a frame when the page changes visually, not on a clock, so an
 * idle page costs nothing. Each frame must be acknowledged before the next is
 * sent, which is the backpressure: a slow consumer slows the stream instead of
 * queueing behind it.
 *
 * Frames never reach the model and are never stored.
 */

/** Where frames go. Supplied by the session; absent means do not stream. */
export interface ScreencastSink {
  open(callId: string, label: string): void;
  frame(callId: string, frame: { data: string; width: number; height: number }): void;
  close(callId: string): void;
}

/**
 * Defaults chosen from measurement rather than taste. At 960x600/q55 a heavy,
 * image-rich page ran ~349 KB/s; 640x400/q40 on every second frame brings that
 * to roughly a quarter of it, which still reads clearly at panel size. The
 * point is to see where the browser is, not to read the page over its shoulder.
 */
const DEFAULT_OPTIONS = {
  maxWidth: 640,
  maxHeight: 400,
  quality: 40,
  everyNthFrame: 2,
} as const;

export interface Screencast {
  stop(): Promise<void>;
}

/**
 * Starts streaming `page` to `sink`. Returns a handle whose `stop` is safe to
 * call more than once, and safe to call on a page that has already closed.
 *
 * Never throws. A browser that will not screencast — a non-Chromium engine, a
 * page that closed mid-setup — must not fail the tool that was only ever
 * trying to show its work.
 */
export async function startScreencast(
  page: Page,
  sink: ScreencastSink | undefined,
  callId: string,
  label: string,
  options: Partial<typeof DEFAULT_OPTIONS> = {},
): Promise<Screencast> {
  const noop: Screencast = { stop: async () => undefined };
  if (!sink) return noop;

  try {
    const cdp = await page.context().newCDPSession(page);
    let stopped = false;

    // Every call into the sink is guarded. This runs inside a CDP event
    // listener, where a throw is an unhandled exception that takes the whole
    // agent down — and the sink's job is to push onto a stream that may have
    // closed under it. Losing a frame is nothing; losing the process is not.
    const safely = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* a sink that cannot take a frame is not the tool's problem */
      }
    };

    cdp.on("Page.screencastFrame", (frame: unknown) => {
      const f = frame as {
        data: string;
        sessionId: number;
        metadata?: { deviceWidth?: number; deviceHeight?: number };
      };
      if (!stopped) {
        safely(() =>
          sink.frame(callId, {
            data: f.data,
            width: Math.round(f.metadata?.deviceWidth ?? DEFAULT_OPTIONS.maxWidth),
            height: Math.round(f.metadata?.deviceHeight ?? DEFAULT_OPTIONS.maxHeight),
          }),
        );
      }
      // Acknowledge even after stopping: an unacknowledged frame leaves
      // Chromium waiting on a reply that is never coming.
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
    });

    await cdp.send("Page.startScreencast", { format: "jpeg", ...DEFAULT_OPTIONS, ...options });
    safely(() => sink.open(callId, label));

    return {
      stop: async () => {
        if (stopped) return;
        stopped = true;
        // Both of these fail routinely — the page is usually closing already.
        await cdp.send("Page.stopScreencast").catch(() => undefined);
        await cdp.detach().catch(() => undefined);
        safely(() => sink.close(callId));
      },
    };
  } catch {
    return noop;
  }
}

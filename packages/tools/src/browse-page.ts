import { chromium } from "playwright";
import { z } from "zod";
import { assertRequestAllowed, CLONE_USER_AGENT } from "./capture-fetch-guard.js";
import {
  DEFAULT_DWELL_MS,
  DEFAULT_STOPS,
  MAX_STOPS,
  pickCheckpoints,
  summarizeWalk,
  walkPage,
} from "./page-walk.js";
import { startScreencast } from "./screencast.js";
import { defineTool, type ToolResult } from "./types.js";

/**
 * Reading a page instead of photographing one.
 *
 * `capture_reference` records what a site *is* — DOM, geometry, assets, a
 * settled screenshot per width. It says nothing about what a site *does*,
 * deliberately: it screenshots with `animations: "disabled"` so the geometry
 * baseline is deterministic, which also means the only artifact of the page's
 * behaviour is the one that erases it.
 *
 * This is the other half. It scrolls, waits, watches what fires, plays the
 * video, and hands back both a written account and the frames it saw — so the
 * model can look at the page it is about to copy, which until now it never
 * could.
 */

const NAV_TIMEOUT_MS = 30_000;

const schema = z.object({
  url: z.string().describe("Absolute http(s) URL to read."),
  width: z
    .number()
    .int()
    .min(320)
    .max(2560)
    .optional()
    .describe(
      "Viewport width (default 1280). Motion is usually authored once, so one width is enough.",
    ),
  stops: z
    .number()
    .int()
    .min(2)
    .max(MAX_STOPS)
    .optional()
    .describe(`How many places down the page to stop and look (default ${DEFAULT_STOPS}).`),
  images: z
    .boolean()
    .optional()
    .describe(
      "Return what it saw at each stop as pictures (default true). Set false to save context.",
    ),
});

export const browsePageTool = defineTool({
  name: "browse_page",
  description:
    "Read a web page the way a person does: scroll it in stages, wait at each, and record what " +
    "moves. Returns the page's motion system (durations, easings, properties, how often each is " +
    "used), how sticky headers react to scroll, what video and audio are on the page and what " +
    "they are for, and pictures of what it saw at each stop. Use before cloning or taking design " +
    "cues from a site — capture_reference records what a page *is*, this records what it *does*.",
  schema,
  async run(context, input): Promise<ToolResult> {
    let target: URL;
    try {
      target = new URL(input.url);
    } catch {
      return { output: `Not a URL: ${input.url}`, isError: true };
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return { output: `Only http and https are supported, got ${target.protocol}`, isError: true };
    }
    try {
      await assertRequestAllowed(target.href);
    } catch (error) {
      return {
        output: `Refused ${target.href}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    const width = input.width ?? 1280;
    const wantImages = input.images !== false;

    const browser = await chromium.launch({
      headless: true,
      // Without this every autoplaying background video stays on its poster
      // frame, which is exactly the thing worth seeing.
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
    try {
      const ctx = await browser.newContext({
        userAgent: CLONE_USER_AGENT,
        viewport: { width, height: 800 },
        deviceScaleFactor: 1,
      });
      // Same guard the clone path uses, and for the same reason: a page can ask
      // for anything, including addresses only this machine can reach.
      const allowed = new Set<string>();
      const refused = new Set<string>();
      await ctx.route("**/*", async (route) => {
        const url = route.request().url();
        if (!/^https?:/i.test(url)) return route.continue();
        try {
          const host = new URL(url).host;
          if (refused.has(host)) return route.abort();
          if (!allowed.has(host)) {
            await assertRequestAllowed(url);
            allowed.add(host);
          }
          return route.continue();
        } catch {
          try {
            refused.add(new URL(url).host);
          } catch {
            /* not a parseable URL — refuse it anyway */
          }
          return route.abort();
        }
      });

      const page = await ctx.newPage();
      const cast = await startScreencast(
        page,
        context.screencast,
        context.callId ?? "browse_page",
        `${target.host} @ ${width}px`,
      );
      try {
        const response = await page.goto(target.href, {
          waitUntil: "networkidle",
          timeout: NAV_TIMEOUT_MS,
        });
        const status = response?.status() ?? 0;
        if (status >= 400) {
          return { output: `${target.href} responded ${status}.`, isError: true };
        }

        context.log(`Walking ${target.host}…`);
        const walk = await walkPage(page, {
          stops: input.stops,
          dwellMs: DEFAULT_DWELL_MS,
          checkpoints: wantImages,
          playMedia: true,
          signal: context.signal,
        });

        const frames = wantImages ? pickCheckpoints(walk.checkpoints) : [];
        const lines = [`Read ${target.href} at ${width}px.`, summarizeWalk(walk)];
        if (frames.length) {
          lines.push(
            `\nAttached: ${frames.length} frames, from ${frames[0]?.atY}px down to ` +
              `${frames[frames.length - 1]?.atY}px. They are reference, not a target to ` +
              "pixel-match — build the structure, then diff against your own preview.",
          );
        }

        return {
          output: lines.join("\n"),
          ...(frames.length
            ? {
                images: frames.map((frame) => ({
                  mimeType: "image/jpeg",
                  data: frame.jpeg,
                })),
              }
            : {}),
          // Everything above is this tool's own measurement of the page except
          // the selectors and media URLs, which are the page's own strings.
          untrusted: { source: target.host },
        };
      } finally {
        await cast?.stop();
      }
    } catch (error) {
      return {
        output: `Could not read ${target.href}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  },
});

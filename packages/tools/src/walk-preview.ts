import { chromium } from "playwright";
import { z } from "zod";
import {
  DEFAULT_DWELL_MS,
  DEFAULT_STOPS,
  gotoSettled,
  MAX_STOPS,
  pickCheckpoints,
  summarizeWalk,
  walkPage,
} from "./page-walk.js";
import { defineTool, type ToolResult } from "./types.js";

/**
 * Walking the project's own preview.
 *
 * `browse_page` does the same walk, but it takes a URL from the model and so
 * runs behind an SSRF guard that allows only ports 80 and 443 on public
 * addresses — which is correct, and which means it refuses
 * `http://127.0.0.1:4310/`, the project's own preview. Proving the `/motion`
 * stack ran straight into that:
 *
 *     Refused http://127.0.0.1:4399/: only ports 80 and 443 are allowed
 *
 * So this tool takes **no URL**. It asks the runtime where the preview is, the
 * way `view_preview` does, and the model cannot point it anywhere. Nothing is
 * relaxed; the address simply stops coming from the model.
 *
 * What it is for: after writing motion, read back what actually runs. The agent
 * gets the same vocabulary it reads other people's sites in — durations,
 * easings, staggers — measured off its own page. "Motion: none observed" is
 * then a failed pass the agent can see for itself.
 */

const NAV_TIMEOUT_MS = 30_000;

const schema = z.object({
  path: z.string().optional().describe('Route to walk, relative to the preview root. Default "/".'),
  width: z.number().int().min(320).max(2560).optional().describe("Viewport width (default 1280)."),
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
      "Return what it saw at each stop as pictures (default false here — you built this page).",
    ),
});

export const walkPreviewTool = defineTool({
  name: "walk_preview",
  description:
    "Scroll the running preview in stages and report what actually moves: every animation's real " +
    "duration, easing, animated properties and stagger, motion driven from script that the " +
    "animation API cannot see, pinned layers, and video. Use it after adding or changing motion — " +
    "it reads back what the page really does, in the same terms browse_page reports other sites, " +
    "so a claim that the page animates can be checked rather than asserted. Needs the preview " +
    "running; call start_preview first.",
  schema,
  async run(context, input): Promise<ToolResult> {
    const preview = await context.runtime.previewStatus(context.projectId);
    if (preview.status !== "running" || !preview.url) {
      return {
        output: `The preview isn't running (${preview.status}). Start it with start_preview first.`,
        isError: true,
      };
    }

    let target: string;
    try {
      target = input.path ? new URL(input.path, preview.url).href : preview.url;
    } catch {
      return { output: `Not a valid path: "${input.path}".`, isError: true };
    }

    const width = input.width ?? 1280;
    const browser = await chromium.launch({
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
    try {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));

      await gotoSettled(page, target, NAV_TIMEOUT_MS);
      context.log(`Walking the preview at ${width}px…`);
      const walk = await walkPage(page, {
        stops: input.stops,
        dwellMs: DEFAULT_DWELL_MS,
        checkpoints: input.images === true,
        playMedia: true,
        signal: context.signal,
      });

      const frames = input.images === true ? pickCheckpoints(walk.checkpoints) : [];
      const lines = [
        `Walked the preview${input.path ? ` at ${input.path}` : ""}, ${width}px wide.`,
      ];
      lines.push(summarizeWalk(walk));
      if (errors.length) {
        // A page that threw while being walked animates less than it looks
        // like it does, and the reason is right here rather than in a separate
        // console check.
        lines.push(`\nThe page threw while being walked: ${errors.slice(0, 3).join(" | ")}`);
      }
      if (!walk.motions.length && !walk.scriptMotions.length) {
        lines.push(
          "\nNo motion at all. If you have just added some, it is not running — check that the " +
            "components are imported and rendered, and that the page is not the one you left static.",
        );
      }

      return {
        output: lines.join("\n"),
        ...(frames.length
          ? { images: frames.map((frame) => ({ mimeType: "image/jpeg", data: frame.jpeg })) }
          : {}),
      };
    } catch (error) {
      return {
        output: `Could not walk the preview: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  },
});

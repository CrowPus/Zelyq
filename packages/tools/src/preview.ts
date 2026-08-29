import { chromium } from "playwright";
import { z } from "zod";
import { defineTool, type ToolResult, truncate } from "./types.js";

export const startPreviewTool = defineTool({
  name: "start_preview",
  description:
    "Start (or restart) the project's dev server and return its URL. Installs dependencies first " +
    "if needed. Call this after making changes so the user can see the result.",
  schema: z.object({
    restart: z.boolean().optional().describe("Stop a running server first (default false)"),
  }),
  async run(context, input): Promise<ToolResult> {
    if (input.restart) await context.runtime.stopPreview(context.projectId);

    // 058 · Phase C — when a Supabase resource is linked, the running app needs
    // its public URL + publishable key. The runtime restarts the dev server if
    // these differ from what it was last started with.
    const env = context.supabasePreviewEnv;
    const preview = await context.runtime.startPreview(
      context.projectId,
      env && Object.keys(env).length > 0 ? { env } : undefined,
    );
    if (preview.status === "running") {
      return { output: `Preview running at ${preview.url}` };
    }

    const logs = await context.runtime.previewLogs(context.projectId, 40);
    return {
      output: `Preview failed to start (${preview.status}): ${preview.lastError ?? "unknown error"}\n\nRecent output:\n${truncate(logs, 4000)}`,
      isError: true,
    };
  },
});

export const previewLogsTool = defineTool({
  name: "preview_logs",
  description:
    "Read recent dev-server output. Use it when the preview is blank, crashed, or showing a build " +
    "error — the reason is almost always here.",
  schema: z.object({
    lines: z.number().int().min(1).max(500).optional(),
  }),
  async run(context, input): Promise<ToolResult> {
    const logs = await context.runtime.previewLogs(context.projectId, input.lines ?? 80);
    return { output: logs.trim() || "No dev-server output yet." };
  },
});

export const viewPreviewTool = defineTool({
  name: "view_preview",
  description:
    "See a screenshot of the running preview — what a person would actually see in the browser, " +
    "not what the code implies. Use it after a change that could affect what's rendered: a new " +
    "component, a layout or styling change. Skip it for a change that's obviously text- or " +
    "logic-only — this costs real image tokens, so reach for it deliberately, not on every turn. " +
    'Pass `path` to view a route other than the app\'s landing page (e.g. "/#/destination/kyoto" ' +
    'for a hash route, "/settings" for a real one) — never edit routing just to screenshot a ' +
    "screen. Fails cleanly if the preview isn't running; call start_preview first.",
  schema: z.object({
    path: z
      .string()
      .optional()
      .describe('Route to load, relative to the preview root. Default "/". Accepts a hash route.'),
    width: z.number().int().min(320).max(2560).optional().describe("Viewport width (default 1024)"),
    height: z
      .number()
      .int()
      .min(320)
      .max(2000)
      .optional()
      .describe("Viewport height (default 768)"),
  }),
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

    const browser = await chromium.launch();
    try {
      // A fixed viewport bounds the screenshot's resolution directly — no
      // separate resize step needed once JPEG re-encoding already keeps the
      // bytes themselves small.
      const page = await browser.newPage({
        viewport: { width: input.width ?? 1024, height: input.height ?? 768 },
      });
      await page.goto(target, { waitUntil: "load", timeout: 30_000 });
      const screenshot = await page.screenshot({ type: "jpeg", quality: 70 });
      return {
        output: `Screenshot of the running preview at ${target}.`,
        images: [{ mimeType: "image/jpeg", data: screenshot.toString("base64") }],
      };
    } catch (error) {
      return {
        output: `Could not capture the preview: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  },
});

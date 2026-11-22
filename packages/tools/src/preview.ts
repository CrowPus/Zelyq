import { z } from "zod";
import { openBrowser } from "./browser-sandbox.js";
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
    if (context.previewBridge) {
      const response = await fetch(
        `${context.previewBridge.url}/api/internal/project-preview/start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-zelyq-preview-bridge": context.previewBridge.token,
          },
          body: JSON.stringify({ restart: input.restart }),
          signal: context.signal,
        },
      );
      if (!response.ok)
        return {
          output:
            "Preview could not start. Check the project's Backend configuration and runtime logs.",
          isError: true,
        };
      const { preview } = (await response.json()) as {
        preview: { status: string; url: string | null; lastError: string | null };
      };
      return {
        output:
          preview.status === "running"
            ? `Preview running at ${preview.url}`
            : `Preview ${preview.status}: ${preview.lastError ?? "Read preview_logs for details"}`,
        isError: preview.status !== "running",
      };
    }
    if (input.restart) await context.runtime.stopPreview(context.projectId);

    // When a Supabase resource is linked, the running app needs
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

    const target = previewTarget(preview.url, input.path);
    if (!target) {
      return {
        output: `Not a path inside the preview: "${input.path}". Give a path such as /about.`,
        isError: true,
      };
    }

    try {
      const screenshot = await capturePage(target, {
        width: input.width ?? 1024,
        height: input.height ?? 768,
        previewUrl: preview.url,
      });
      return {
        output: `Screenshot of the running preview at ${target}.`,
        images: [{ mimeType: "image/jpeg", data: screenshot.toString("base64") }],
      };
    } catch (error) {
      return {
        output: `Could not capture the preview: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  },
});

/**
 * A JPEG of one page at a fixed viewport. A fixed viewport bounds the
 * screenshot's resolution directly — no separate resize step needed once JPEG
 * re-encoding already keeps the bytes themselves small. `settleMs` waits after
 * `load` for what a person would see a moment later: web fonts, an entrance
 * animation, data the page fetches on mount. The app list's thumbnails use it;
 * the agent's own look at the preview does not need to.
 */
export async function capturePage(
  url: string,
  options: {
    width: number;
    height: number;
    settleMs?: number;
    quality?: number;
    /** The preview `url` belongs to, when `url` is a page inside it. */
    previewUrl?: string;
  },
): Promise<Buffer> {
  // The team's own preview is the one private address the page may load,
  // and its address comes from the runtime, never from the caller.
  const previewUrl = options.previewUrl ?? url;
  if (!previewTarget(previewUrl, url)) throw new Error("Not a page inside the preview.");
  const browser = await openBrowser({ trustedOrigin: new URL(previewUrl).origin });
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    if (options.settleMs) await page.waitForTimeout(options.settleMs);
    return await page.screenshot({ type: "jpeg", quality: options.quality ?? 70 });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * A page inside the running preview, or null. The path is the agent's (or
 * whoever asked it), so an absolute or protocol-relative address that would
 * leave the preview's origin is refused: it could name this server's own
 * services or another team's preview.
 */
export function previewTarget(previewUrl: string, path: string | undefined): string | null {
  if (!path) return previewUrl;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") || path.startsWith("\\")) {
    try {
      // A full address is accepted only when it is the preview itself.
      return new URL(path).origin === new URL(previewUrl).origin ? new URL(path).href : null;
    } catch {
      return null;
    }
  }
  try {
    const target = new URL(path, previewUrl);
    return target.origin === new URL(previewUrl).origin ? target.href : null;
  } catch {
    return null;
  }
}

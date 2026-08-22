import { z } from "zod";
import { type ToolResult, defineTool, truncate } from "./types.js";

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

    const preview = await context.runtime.startPreview(context.projectId);
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

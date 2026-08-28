import { z } from "zod";
import {
  deleteFileTool,
  editFileTool,
  listFilesTool,
  readFileTool,
  searchFilesTool,
  writeFileTool,
} from "./files.js";
import { designPassTool, dispatchTaskTool, opsPassTool, qaPassTool } from "./orchestrate.js";
import { previewLogsTool, startPreviewTool, viewPreviewTool } from "./preview.js";
import { runCommandTool } from "./shell.js";
import type { ToolContext, ToolResult, ZelyqTool } from "./types.js";

export * from "./types.js";
export {
  deleteFileTool,
  designPassTool,
  dispatchTaskTool,
  editFileTool,
  listFilesTool,
  opsPassTool,
  previewLogsTool,
  qaPassTool,
  readFileTool,
  runCommandTool,
  searchFilesTool,
  startPreviewTool,
  viewPreviewTool,
  writeFileTool,
};

/**
 * Order matters a little: the model reads this list top to bottom, and putting
 * navigation before mutation nudges it to look before it writes.
 */
export const ALL_TOOLS: ZelyqTool[] = [
  listFilesTool,
  readFileTool,
  searchFilesTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  runCommandTool,
  startPreviewTool,
  previewLogsTool,
  viewPreviewTool,
];

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Render the suite in the shape a model API expects.
 *
 * zod 4 converts to JSON Schema itself, so no separate library is involved.
 * `$schema` is dropped: Anthropic ignores it and Gemini rejects it, and a tool
 * whose schema is refused simply never gets called.
 */
export function toolDefinitions(tools: ZelyqTool[] = ALL_TOOLS): ToolDefinition[] {
  return tools.map((tool) => {
    const { $schema, ...schema } = z.toJSONSchema(tool.schema, {
      io: "input",
    }) as Record<string, unknown>;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema,
    };
  });
}

export function findTool(name: string, tools: ZelyqTool[] = ALL_TOOLS): ZelyqTool | undefined {
  return tools.find((tool) => tool.name === name);
}

/**
 * Runs a tool by name with validated input. Every failure path returns a
 * `ToolResult` rather than throwing: a tool error is information the model
 * should get and recover from, not a reason to end the turn.
 */
export async function executeTool(
  context: ToolContext,
  name: string,
  rawInput: unknown,
  tools: ZelyqTool[] = ALL_TOOLS,
): Promise<ToolResult> {
  const tool = findTool(name, tools);
  if (!tool) {
    return { output: `Unknown tool: ${name}`, isError: true };
  }

  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      output: `Invalid input for ${name}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`,
      isError: true,
    };
  }

  try {
    return await tool.run(context, parsed.data);
  } catch (error) {
    return { output: `${name} failed: ${(error as Error).message}`, isError: true };
  }
}

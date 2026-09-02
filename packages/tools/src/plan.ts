import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";

export const PLAN_FILE = "PLAN.md";

const planItem = z.object({
  step: z.string().min(1).describe("One concrete step, phrased as a task"),
  status: z.enum(["pending", "in_progress", "done"]),
});

/**
 * Render the plan as a Markdown checklist. Byte-stable for a given input so the
 * session's prompt cache is not disturbed by a no-op update.
 */
function renderPlan(items: z.infer<typeof planItem>[]): string {
  const box = { pending: "[ ]", in_progress: "[~]", done: "[x]" } as const;
  const lines = items.map((item) => `- ${box[item.status]} ${item.step.trim()}`);
  return `# Plan\n\n${lines.join("\n")}\n`;
}

export const updatePlanTool = defineTool({
  name: "update_plan",
  description:
    "Record the steps for a piece of work that spans more than one turn, and mark them done as " +
    "you finish them. Use it when a request needs several steps, or when you are stopping with " +
    "work left so the next turn knows where to resume. Skip it entirely for a single-step " +
    `change — it writes ${PLAN_FILE} and a plan for a one-line edit is just ceremony. The plan ` +
    "does not license extra scope: a plan with eight steps for a three-item request is the same " +
    "mistake as eight files for it.",
  schema: z.object({
    items: z.array(planItem).min(1).max(30),
  }),
  async run(context, input): Promise<ToolResult> {
    const body = renderPlan(input.items);
    await context.runtime.writeFile(context.projectId, PLAN_FILE, body);
    context.onFileChanged(PLAN_FILE);
    const done = input.items.filter((item) => item.status === "done").length;
    return { output: `Plan updated (${done}/${input.items.length} done).\n\n${body}` };
  },
});

import { z } from "zod";
import { defineTool } from "./types.js";

/**
 * 047 Phase 3a/3b/3e/3f — the Architect dispatches one build-plan task to a
 * fresh, bounded builder session.
 *
 * This tool is NOT run through `executeTool`. `AgentSession` intercepts it in
 * the turn loop (it needs the provider, credentials, and skill bodies that a
 * `ToolContext` deliberately does not carry) and runs a child `AgentSession`
 * in Engineer Mode against the same project, with hard caps on turns, tokens,
 * and wall-clock. The `run` here exists only so the tool has a shape; it never
 * executes. Available only when a session is in Architect Mode.
 */
export const dispatchTaskTool = defineTool({
  name: "dispatch_task",
  description:
    "Architect Mode only. Hand ONE build-plan.md task to a fresh builder (a bounded Engineer-Mode " +
    "session on this same project). It writes the code; you do not. Returns the builder's report and " +
    "the files it changed, for you to review before dispatching the next task. Emit several " +
    "dispatch_task calls in one turn to run independent tasks in parallel. Each builder is capped at " +
    "25 turns, 200k tokens, and 5 minutes; the whole orchestration run is capped at 20 builders and " +
    "2M tokens — when a cap is hit the call is refused and you must stop and report. Mark the task " +
    "done in build-plan.md after you have reviewed the result.",
  schema: z.object({
    task: z
      .string()
      .min(1)
      .describe("The task, verbatim or tightened, from build-plan.md — what to build."),
    acceptanceCriteria: z
      .string()
      .min(1)
      .describe("How the builder (and you) will know the task is done. From build-plan.md."),
    files: z
      .array(z.string())
      .optional()
      .describe(
        "The files this task is expected to create or change, if build-plan.md names them.",
      ),
    modelTier: z
      .enum(["strong", "standard", "cheap"])
      .optional()
      .describe(
        "The tier from build-plan.md for this task. 'cheap' for docs/boilerplate, 'strong' for " +
          "hard algorithmic or security-sensitive work. Omitted uses the session's own model.",
      ),
    role: z
      .string()
      .optional()
      .describe(
        "An optional one-line role for the builder, e.g. 'database engineer' or 'frontend " +
          "engineer' — prepended to its instructions to focus it.",
      ),
    skills: z
      .array(z.string())
      .optional()
      .describe(
        "Names of loaded skills whose guidance applies to this task — from the skills catalog. " +
          "Their full text is injected into the builder's instructions (the builder has no " +
          "use_skill tool).",
      ),
    tools: z
      .array(z.string())
      .optional()
      .describe(
        "Names of plugin tools this task or its verification needs (e.g. security_scan, " +
          "accessibility_audit). Only meaningful together with verify; a normal builder gets the " +
          "core file/shell tools regardless.",
      ),
    verify: z
      .boolean()
      .optional()
      .describe(
        "Set true for the ONE final verification dispatch after the last build task. That builder " +
          "additionally gets the preview tools and the named plugin tools, is exempt from the " +
          "runnable-first and file-count gates, runs the build + preview + the named checks, writes " +
          "the finishing files (.env.example, root README, CI config), and returns a completion " +
          "checklist. Do not use it for building.",
      ),
  }),
  async run() {
    return {
      output:
        "dispatch_task is handled by the orchestrator, not this path — this should never run.",
      isError: true,
    };
  },
});

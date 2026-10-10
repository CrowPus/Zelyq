import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";

/**
 * The project's variables, as the agent may see them: names, and whether each
 * will reach the app. Never a value — the server's endpoint cannot return one,
 * so nothing here depends on the model choosing not to look.
 *
 * It rides the preview bridge: the same per-session, per-project, per-user
 * grant that starts the preview with these variables in its environment.
 */
export const listProjectVariablesTool = defineTool({
  name: "list_project_variables",
  description:
    "List the NAMES of the variables this project's app is given (API keys, passwords, tokens). " +
    "Values are never shown. Each is either typed for this project or taken from the team's Vault. " +
    "A Python backend receives them as environment variables when the preview runs; a project " +
    "linked to Supabase also gets them as Edge Function secrets (read with Deno.env.get). Call this before " +
    "writing code that needs a credential: read it on the server from the environment variable of " +
    "that exact name, never hard-code a value, and never ask the user to paste one into the chat. " +
    "If a name the code needs is not listed, build against that environment variable anyway and " +
    "tell the user to add it under Variables in the project header (typed, or from Vault).",
  schema: z.object({}),
  async run(context): Promise<ToolResult> {
    if (!context.previewBridge) {
      return { output: "Project variables are not available in this session.", isError: true };
    }
    const response = await fetch(
      `${context.previewBridge.url}/api/internal/project-variables/names`,
      {
        headers: { "x-zelyq-preview-bridge": context.previewBridge.token },
        signal: context.signal,
      },
    );
    if (!response.ok) {
      return { output: "The project's variables could not be read right now.", isError: true };
    }
    const { variables } = (await response.json()) as {
      variables: { name: string; source: string; missing: boolean }[];
    };
    if (variables.length === 0) {
      return {
        output:
          "This project has no variables yet. Read any credential the code needs from an " +
          "environment variable on the server, and tell the user which names to add.",
      };
    }
    const lines = variables.map(
      (variable) =>
        `- ${variable.name}${variable.source === "vault" ? " (from Vault)" : ""}` +
        (variable.missing ? " — NOT SET: its Vault secret is gone; tell the user" : ""),
    );
    return {
      output:
        `Variables this app is given (names only):\n${lines.join("\n")}\n\n` +
        "They reach server code only. Never put one in browser code: anything there is public.",
    };
  },
});

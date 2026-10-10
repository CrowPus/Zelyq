import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";

/**
 * The project's Vault, as the agent may see it: names, and which environments
 * each is set in. Never a value — the server's endpoint cannot return one, so
 * nothing here depends on the model choosing not to look.
 *
 * It rides the preview bridge: the same per-session, per-project, per-user
 * grant that starts the preview with these secrets in its environment.
 */
export const listVaultSecretsTool = defineTool({
  name: "list_vault_secrets",
  description:
    "List the NAMES of this project's secrets in Vault (API keys, passwords, tokens) and the " +
    "environments each is set in. Values are never shown. Development values reach the project's " +
    "backend as environment variables when the preview runs. Call this before writing code that " +
    "needs a credential: read it from the environment by this exact name, never hard-code a value, " +
    "and never ask the user to paste one into the chat. If a name the code needs is not listed, " +
    "build against the environment variable anyway and tell the user to add it in Vault (the " +
    "Vault button in the project header).",
  schema: z.object({}),
  async run(context): Promise<ToolResult> {
    if (!context.previewBridge) {
      return { output: "Vault is not available in this session.", isError: true };
    }
    const response = await fetch(`${context.previewBridge.url}/api/internal/vault/names`, {
      headers: { "x-zelyq-preview-bridge": context.previewBridge.token },
      signal: context.signal,
    });
    if (!response.ok) {
      return { output: "Vault could not be read right now.", isError: true };
    }
    const { secrets } = (await response.json()) as {
      secrets: { name: string; environments: string[] }[];
    };
    if (secrets.length === 0) {
      return {
        output:
          "Vault has no secrets for this project yet. Read any credential the code needs from an " +
          "environment variable, and tell the user which names to add in Vault.",
      };
    }
    const lines = secrets.map((secret) => `- ${secret.name} (${secret.environments.join(", ")})`);
    return {
      output:
        `Secrets in Vault (names only):\n${lines.join("\n")}\n\n` +
        "Only development values reach the preview's backend.",
    };
  },
});

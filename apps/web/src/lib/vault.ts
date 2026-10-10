import type { VaultEnvironment } from "@zelyq/core";
import { ApiError } from "./api";

/** How long a revealed value stays on screen before it hides itself. */
export const REVEAL_SECONDS = 30;

export const ENVIRONMENT_NOTES: Record<VaultEnvironment, string> = {
  development: "Used by the preview. A change restarts it.",
  test: "Stored securely. Nothing reads test values yet.",
  production: "Stored securely. Nothing reads production values yet; deployment will.",
};

/**
 * The sentence a person should read when a Vault call fails. A validation
 * failure's own envelope only says "Request validation failed"; the reason —
 * "that name is reserved…" — is in the first issue, so that is what is shown.
 */
export function vaultErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const issues = error.details?.issues;
    const first = Array.isArray(issues) ? (issues[0] as { message?: string }) : undefined;
    if (first?.message) return first.message;
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

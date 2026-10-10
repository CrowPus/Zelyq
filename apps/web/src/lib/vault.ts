import { ApiError } from "./api";

/** How long a revealed value stays on screen before it hides itself. */
export const REVEAL_SECONDS = 30;

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

/** Relative for the recent past, absolute once "3 days ago" stops helping. */
export function formatRelative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

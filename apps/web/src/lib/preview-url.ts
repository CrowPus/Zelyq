import type { Preview } from "@zelyq/core";

/**
 * The address a running preview should be shown and loaded at.
 *
 * Prefers the address the browser itself used to reach Zelyq over whatever
 * the server guessed at server-side (`ZELYQ_PREVIEW_HOST`, which defaults to
 * loopback and is wrong the moment the browser is not on the same machine as
 * the server — a VM reached by its real address, for one). The browser's own
 * location is never wrong about how it got here; the server has no way to
 * know which of a machine's several addresses that was.
 *
 * Falls back to the server-supplied `url` when no port is available — not
 * expected to trigger while `status` is `"running"`, but a caller with no
 * `port` has no better address to offer than what the server already sent.
 */
export function resolvePreviewUrl(preview: Preview | null, hostname: string): string | null {
  if (preview?.status !== "running") return null;
  if (preview.port) return `http://${hostname}:${preview.port}`;
  return preview.url;
}

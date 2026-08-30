import type { Preview } from "@zelyq/core";

/**
 * The address a running preview should be shown and loaded at.
 *
 * Two cases:
 *
 * 1. The server produced a real, reachable URL — a reverse-proxy address from
 *    `ZELYQ_PREVIEW_URL_TEMPLATE`, e.g. `https://p4300.preview.example.com`.
 *    The port is already encoded in it and the browser may have no route to a
 *    raw preview port at all, so it is used verbatim.
 *
 * 2. The server only knew a loopback / bind-all host (`ZELYQ_PREVIEW_HOST`
 *    defaults to loopback and is wrong the moment the browser is not on the
 *    same machine as the server). Then the browser's own address is used with
 *    the preview port — the browser's location is never wrong about how it got
 *    here, and the server has no way to know which of a machine's several
 *    addresses that was.
 *
 * Falls back to the server-supplied `url` when no port is available.
 */
const REWRITE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::", "::1", "[::]", "[::1]"]);

export function resolvePreviewUrl(preview: Preview | null, hostname: string): string | null {
  if (preview?.status !== "running") return null;

  // A real host in the server-supplied URL means it was built to be reached as
  // given (case 1) — trust it, port and scheme included.
  if (preview.url) {
    try {
      const parsed = new URL(preview.url);
      if (!REWRITE_HOSTS.has(parsed.hostname)) return preview.url;
    } catch {
      // Not a parseable absolute URL — fall through to the rebuild.
    }
  }

  // Loopback / bind-all host, or no usable URL: rebuild from where the browser
  // actually is (case 2).
  if (preview.port) return `http://${hostname}:${preview.port}`;
  return preview.url;
}

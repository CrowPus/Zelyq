/**
 * Parse a `/figma <share-link>` composer message (proposal 068).
 *
 * A Figma share link looks like
 *   https://www.figma.com/design/<fileKey>/<name>?node-id=1-23&t=…
 * (`/file/` and `/proto/` also appear). `node-id` uses `1-23` in newer links
 * and `1%3A23` in older ones; the API wants `1:23`.
 *
 * `null`      — not a `/figma` command.
 * `{ error }` — it is, but the link is missing or unusable.
 * `{ fileKey, nodeId, rest }` — good; `rest` is any extra text the user added.
 */
export function parseFigmaLink(
  text: string,
): { fileKey: string; nodeId: string; rest: string } | { error: string } | null {
  const trimmed = text.trimStart();
  if (!/^\/figma(\s|$)/i.test(trimmed)) return null;

  const after = trimmed.replace(/^\/figma\s*/i, "");
  const urlMatch = after.match(/https?:\/\/[^\s]*figma\.com\/[^\s]+/i);
  if (!urlMatch) {
    return {
      error:
        "/figma needs a Figma frame link — open the frame in Figma, Copy link, and paste it here.",
    };
  }

  let url: URL;
  try {
    url = new URL(urlMatch[0]);
  } catch {
    return { error: `That doesn't look like a URL: ${urlMatch[0]}` };
  }

  const keyMatch = url.pathname.match(/\/(?:design|file|proto|board)\/([A-Za-z0-9]+)/);
  if (!keyMatch?.[1]) {
    return { error: "Couldn't find a file key in that link — use the frame's Copy link option." };
  }

  const rawNode = url.searchParams.get("node-id");
  if (!rawNode) {
    return {
      error:
        "That link has no node-id — select the frame in Figma first, then Copy link to that frame.",
    };
  }
  const nodeId = decodeURIComponent(rawNode).replace(/-/g, ":");

  const rest = (
    after.slice(0, urlMatch.index) + after.slice((urlMatch.index ?? 0) + urlMatch[0].length)
  )
    .replace(/\s+/g, " ")
    .trim();

  return { fileKey: keyMatch[1], nodeId, rest };
}

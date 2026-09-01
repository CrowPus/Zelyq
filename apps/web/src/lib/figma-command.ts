/**
 * `/figma <share-link>` — proposal 068.
 *
 * Unlike `/clone`, the composer does **not** transform the draft: the server
 * pulls the design from Figma (the OAuth token never touches the browser or the
 * agent), writes the `design/<key>/` bundle, and builds the directive itself.
 * The client only gates the send and renders a compact row for the transcript.
 */

export interface ParsedFigma {
  fileKey: string;
  nodeId: string;
}

/**
 * `null`      — not a `/figma` command.
 * `{ error }` — it is, but the link is missing or unusable.
 * `{ fileKey, nodeId }` — good.
 */
export function parseFigmaCommand(draft: string): ParsedFigma | { error: string } | null {
  const trimmed = draft.trimStart();
  if (!/^\/figma(\s|$)/i.test(trimmed)) return null;

  const after = trimmed.replace(/^\/figma\s*/i, "");
  const urlMatch = after.match(/https?:\/\/[^\s]*figma\.com\/[^\s]+/i);
  if (!urlMatch) {
    return {
      error: "/figma needs a Figma frame link — Copy link to a frame in Figma and paste it.",
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
    return { error: "Select the frame in Figma first, then Copy link — the link needs a node-id." };
  }
  return { fileKey: keyMatch[1], nodeId: decodeURIComponent(rawNode).replace(/-/g, ":") };
}

/**
 * Recognises a sent `/figma` message so the transcript can show a compact row.
 * Returns the file key + node id, or null.
 */
export function parseFigmaMessage(content: string): ParsedFigma | null {
  const parsed = parseFigmaCommand(content);
  return parsed && !("error" in parsed) ? parsed : null;
}

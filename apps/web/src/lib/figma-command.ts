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
  // Recognised anywhere, for the reason `parseCloneCommand` explains: the `/`
  // menu offers it mid-sentence, so accepting it only at the start made the
  // menu a liar.
  const command = draft.match(/(^|\s)\/figma(\s|$)/i);
  if (!command || command.index === undefined) return null;

  const after = draft.slice(command.index + command[0].length);
  const urlMatch = after.match(/https?:\/\/[^\s]*figma\.com\/[^\s]+/i);
  if (!urlMatch) {
    // Same rule as `/clone`: a hint when the command opens the message, and
    // silence when someone is only talking about it.
    return draft.slice(0, command.index).trim() === ""
      ? {
          error: "/figma needs a Figma frame link — Copy link to a frame in Figma and paste it.",
        }
      : null;
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

/** The `/figma` counterpart of `cloneChip`, on the same rule. */
export function figmaChip(draft: string): { ready: true } | { needsLink: true } | null {
  const command = draft.match(/(^|\s)\/figma(\s|$)/i);
  if (!command || command.index === undefined) return null;
  const parsed = parseFigmaCommand(draft);
  if (parsed && !("error" in parsed)) return { ready: true };
  if (parsed && "error" in parsed) return { needsLink: true };
  return null;
}

export function withoutFigmaCommand(draft: string): string {
  return draft
    .replace(/(^|\s)\/figma(\s|$)/i, "$1")
    .replace(/\s{2,}/g, " ")
    .trimStart();
}

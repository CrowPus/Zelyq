/**
 * `/clone <url>` — proposal 067.
 *
 * The composer turns a `/clone https://…` draft into a normal turn: a
 * `<clone_task>` directive as the message, plus the
 * `complete-replica-engineering` skill force-woven (the same mechanism the
 * Expo stack skill uses). No new wire fields — the directive is just message
 * text, the skill is just a name in the existing `skills` array, and the
 * recon / diff work is the `capture_reference` tool the agent already has.
 */

/** The skill `/clone` always force-weaves. */
export const CLONE_SKILL = "complete-replica-engineering";

export interface ParsedClone {
  /** The validated absolute URL. */
  url: string;
  /** Anything else the user typed alongside the command. */
  rest: string;
}

/**
 * `null`   — the draft is not a `/clone` command, leave it alone.
 * `{error}` — it is, but the URL is missing or unusable; block the send.
 * `{url,rest}` — good to go.
 */
export function parseCloneCommand(draft: string): ParsedClone | { error: string } | null {
  const trimmed = draft.trimStart();
  if (!/^\/clone(\s|$)/i.test(trimmed)) return null;

  const after = trimmed.replace(/^\/clone\s*/i, "");
  const match = after.match(/https?:\/\/[^\s]+/i);
  if (!match || match.index === undefined) {
    return { error: "/clone needs a URL — for example  /clone https://example.com" };
  }

  let url: URL;
  try {
    url = new URL(match[0]);
  } catch {
    return { error: `That doesn't look like a URL: ${match[0]}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "/clone only works with an http:// or https:// URL" };
  }

  const rest = (after.slice(0, match.index) + after.slice(match.index + match[0].length))
    .replace(/\s+/g, " ")
    .trim();
  return { url: url.href, rest };
}

/**
 * How a clone message opens. Kept short on purpose: the full workflow lives in
 * the `complete-replica-engineering` skill (force-woven for this turn), and a
 * 40-line directive in the chat transcript reads as noise. This first line is
 * also the marker `parseCloneMessage` matches to render the bubble compactly.
 */
const CLONE_PREFIX = "Clone this website into the current project, page for page:";

/**
 * The message the agent receives for a clone turn — a short instruction that
 * points at the skill's `/clone` workflow, plus whatever else the user typed.
 */
export function buildCloneDirective(url: string, rest: string): string {
  const host = safeHost(url);
  const directive =
    `${CLONE_PREFIX} ${url}\n\n` +
    `Follow the complete-replica-engineering skill's "/clone" workflow exactly: ` +
    `run capture_reference (mode "site") → write clone/${host}/REPLICA.md before any ` +
    `component code → build in this project's own framework, macro geometry first, ` +
    `assets copied in locally (substitutes logged in clone/${host}/asset-gaps.md) → ` +
    `run the screenshot-diff loop (capture_reference mode "single" + diffAgainst) → ` +
    `finish with the audit table and asset provenance, no "pixel-perfect" without the ` +
    `numbers. Public pages only: if it needs a login or blocks automated access, stop ` +
    `and ask whether the user owns this site or has permission to reproduce it.`;
  return rest ? `${directive}\n\n${rest}` : directive;
}

/**
 * Recognises a sent clone message so the transcript can show it as a compact
 * "clone <url>" row instead of the raw instruction. Returns the URL and any
 * extra text the user added, or null for an ordinary message.
 */
export function parseCloneMessage(content: string): { url: string; rest: string } | null {
  if (!content.startsWith(CLONE_PREFIX)) return null;
  const body = content.slice(CLONE_PREFIX.length).trimStart();
  const match = body.match(/^(https?:\/\/\S+)/i);
  if (!match) return null;
  const afterDirective = body.split("\n\n").slice(2).join("\n\n").trim();
  return { url: match[1], rest: afterDirective };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "site";
  }
}

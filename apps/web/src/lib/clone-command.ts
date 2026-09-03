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
/**
 * Where the command may appear.
 *
 * It used to have to open the message. The `/` menu, though, offers the command
 * wherever `/` follows a space — so typing a sentence and reaching for `/clone`
 * partway through pops the menu, the user picks it, sends, and *nothing
 * happens*: the menu promised a command the submit path then ignored, silently.
 * Two days of "the agent is not seeing /clone" were exactly this.
 *
 * So the command is now recognised anywhere, and the URL must follow it. A bare
 * mention with no URL after it — "don't /clone anything" — still does nothing,
 * which is what keeps this from firing on a sentence that merely says the word.
 */
export function parseCloneCommand(draft: string): ParsedClone | { error: string } | null {
  const command = draft.match(/(^|\s)\/clone(\s|$)/i);
  if (!command || command.index === undefined) return null;

  const before = draft.slice(0, command.index);
  const after = draft.slice(command.index + command[0].length);
  const match = after.match(/https?:\/\/[^\s]+/i);
  if (!match || match.index === undefined) {
    // A missing URL means the same thing wherever the command sits: it is not
    // finished yet. An earlier version treated a mid-sentence command with no
    // URL as someone merely *talking* about the command and stayed silent —
    // which broke the only way anyone actually types one. You write a few
    // words, reach for `/clone`, pick it from the menu, and only then paste
    // the link. At the moment you pick it there is never a URL, so the one
    // state that most needs feedback was the one state that gave none.
    // Talking about the command is rarer than using it, and the chip's own
    // dismiss button is the way out of a false positive.
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

  // Everything the user typed either side of the command, kept: it is usually
  // the actual instruction — "start with the hero", "match the video".
  const rest =
    `${before} ${after.slice(0, match.index)} ${after.slice(match.index + match[0].length)}`
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

/**
 * What the composer should show above the box for a `/clone` in the draft.
 *
 * Picking a skill from the `/` menu produces a chip; picking `/clone` only
 * dropped the word into the textarea, so there was nothing to say it had taken
 * — and "it did not add, look when i add the other its added" is exactly that,
 * reported by someone who had every reason to think the command was dead.
 *
 * Deliberately the same condition the submit path uses: a chip appears only
 * when the command will actually fire, or when it is the start of the message
 * and only the URL is missing. Someone writing *about* the command gets no
 * chip, because nothing is going to happen.
 */
export function cloneChip(draft: string): { host: string } | { needsUrl: true } | null {
  const parsed = parseCloneCommand(draft);
  if (!parsed) return null;
  return "error" in parsed ? { needsUrl: true } : { host: safeHost(parsed.url) };
}

/** The draft with the command taken out, for the chip's dismiss button. */
export function withoutCloneCommand(draft: string): string {
  return draft
    .replace(/(^|\s)\/clone(\s|$)/i, "$1")
    .replace(/\s{2,}/g, " ")
    .trimStart();
}

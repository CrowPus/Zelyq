/**
 * `/motion` — give the project a motion system.
 *
 * `/clone` points at somebody else's site and rebuilds it. `/motion` points at
 * the project that already exists and makes it move. The URL is optional and
 * changes what the command means:
 *
 *   /motion                 a tasteful default pass
 *   /motion <url>           wear that site's motion
 *
 * The second is the interesting one and it is nearly free: `browse_page`
 * already reports a site's timings — `420ms cubic-bezier(…), transform +
 * opacity, staggered 0–326ms` — and those are exactly the numbers
 * `AnimatedGroup` takes.
 */

/** The skill `/motion` always force-weaves. */
export const MOTION_SKILL = "motion-system";

export interface ParsedMotion {
  /** A site to take the motion from, when one was given. */
  url: string | null;
  /** Anything else the user typed alongside the command. */
  rest: string;
}

/**
 * `null` — not a `/motion` command, leave the draft alone.
 * `{url, rest}` — good to go, with or without a reference site.
 *
 * Unlike `/clone` this never returns an error: `/motion` on its own is a
 * complete, meaningful command. There is nothing that can be missing.
 */
export function parseMotionCommand(draft: string): ParsedMotion | null {
  const command = draft.match(/(^|\s)\/motion(\s|$)/i);
  if (!command || command.index === undefined) return null;

  const before = draft.slice(0, command.index);
  const after = draft.slice(command.index + command[0].length);
  const match = after.match(/https?:\/\/[^\s]+/i);

  let url: string | null = null;
  let rest = `${before} ${after}`;
  if (match?.index !== undefined) {
    try {
      const parsed = new URL(match[0]);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        url = parsed.href;
        rest = `${before} ${after.slice(0, match.index)} ${after.slice(match.index + match[0].length)}`;
      }
    } catch {
      // Not a usable URL — treat it as part of the instruction rather than
      // blocking the send. `/motion` works without one.
    }
  }
  return { url, rest: rest.replace(/\s+/g, " ").trim() };
}

/** What the composer shows above the box, on the same rule the submit path uses. */
export function motionChip(draft: string): { host: string } | { plain: true } | null {
  const parsed = parseMotionCommand(draft);
  if (!parsed) return null;
  return parsed.url ? { host: safeHost(parsed.url) } : { plain: true };
}

/** The draft with the command taken out, for the chip's dismiss button. */
export function withoutMotionCommand(draft: string): string {
  return draft
    .replace(/(^|\s)\/motion(\s|$)/i, "$1")
    .replace(/\s{2,}/g, " ")
    .trimStart();
}

/**
 * How a motion message opens. The first line is also what `parseMotionMessage`
 * matches to render the sent bubble compactly.
 */
const MOTION_PREFIX = "Give this project a motion system.";

export function buildMotionDirective(url: string | null, rest: string): string {
  const reference = url
    ? `Take the motion from ${url}: run browse_page against it first and use the durations, ` +
      `easings and staggers it reports. Match the timing, not the layout — this is not a clone.`
    : "No reference site — choose a grammar that suits what this project already is.";

  const directive =
    `${MOTION_PREFIX} ${reference}\n\n` +
    "Follow the motion-system skill exactly: read the project's own sections first, pick ONE " +
    "grammar and hold it, then add motion by WRAPPING existing markup with add_motion's " +
    "components — never by rewriting what is inside. Replacements (text effects, animated " +
    "numbers) are one or two per page, not everywhere. Finish by running start_preview and then " +
    "walk_preview, and report what it measured: if it finds no motion, the pass failed. Do not " +
    "restructure the page — pinning, scroll-scrubbing and canvas hand-offs are cinematic_pass's " +
    "job, not this one.";
  return rest ? `${directive}\n\n${rest}` : directive;
}

/** Renders a sent `/motion` turn compactly, the way a clone message is. */
export function parseMotionMessage(content: string): { url: string | null; rest: string } | null {
  if (!content.startsWith(MOTION_PREFIX)) return null;
  const url = content.match(/Take the motion from (https?:\/\/[^\s:]+)/)?.[1] ?? null;
  const parts = content.split("\n\n");
  return { url, rest: parts.length > 2 ? (parts[parts.length - 1] ?? "") : "" };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

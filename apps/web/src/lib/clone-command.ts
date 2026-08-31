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
 * The message the agent actually receives for a clone turn. Kept in sync with
 * the `complete-replica-engineering` skill's workflow and the `capture_reference`
 * tool.
 */
export function buildCloneDirective(url: string, rest: string): string {
  const host = safeHost(url);
  const directive = [
    "<clone_task>",
    "Rebuild this website in the current project, page for page:",
    `  URL: ${url}`,
    "",
    "This is a complete-replica task — follow the complete-replica-engineering skill.",
    "Work in this exact order; do not skip a step:",
    "",
    `1. Run capture_reference on the URL (mode "site"). It writes a full bundle into`,
    `   clone/${host}/ — screenshots per width, post-JS DOM, geometry, a resource`,
    "   manifest, and every asset it can fetch. Read the files it names; do not re-fetch",
    "   the site yourself.",
    `2. Write clone/${host}/REPLICA.md — the build plan — from the skill's`,
    "   templates/replica-contract.md and templates/reference-inventory.md, filled in",
    "   from the capture: reference environment, every route in scope, per-page section",
    "   inventory, the typography fingerprint, the asset fingerprint + provenance plan,",
    "   the responsive transition widths, and the target acceptance level (A/B/C). Post a",
    "   short version to the chat. Do NOT write any component code before this file exists.",
    "3. Build in THIS project's own framework and router — macro geometry first (skill",
    `   section 13). Copy the assets you use from clone/${host}/assets/ into the project`,
    "   and point at the local copies — never hotlink the origin. For every asset that",
    `   failed to fetch, substitute a dimension-matched equivalent and log it in`,
    `   clone/${host}/asset-gaps.md.`,
    "4. After each build pass: start_preview, then capture_reference with",
    `   mode "single", url = the preview URL, diffAgainst = "clone/${host}/reference/<page>".`,
    "   Read the changed ratio, classify the largest delta (global geometry / local",
    "   geometry / typography / asset / paint / state), fix that, and recapture. Max 4",
    "   passes per page.",
    "5. Finish with the replica audit table (skill section 22): per route and width —",
    "   reference vs replica, the largest remaining delta, and the acceptance level",
    `   reached. List asset provenance (copied / self-hosted / substituted / linked).`,
    '   Never claim "pixel-perfect" without the diff numbers next to it.',
    "",
    "Scope: PUBLIC pages only. If robots.txt disallows a path, the site needs a login, or",
    "it blocks automated access — STOP and ask the user whether they own this site or have",
    "permission to reproduce it. Only clone what the user is allowed to. Do not spend the",
    "turn decoding assets pixel by pixel.",
    "</clone_task>",
  ].join("\n");
  return rest ? `${directive}\n\n${rest}` : directive;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "site";
  }
}

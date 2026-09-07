/**
 * `/video` and `/cinematic` — the two ways moving footage lands in a page,
 * and the reason they are separate commands rather than one.
 *
 *   /video <description>       ambient motion: a muted loop behind the copy
 *   /cinematic <description>   scroll-driven: footage that advances as you scroll
 *
 * These are the two techniques people confuse, and the difference is expensive
 * to get wrong in both directions. A scrub costs an extraction, ~120 images and
 * a canvas; a loop costs a `<video>` tag. The recipe's own rule is that if the
 * motion is not tied to scroll position, the loop is correct and the scrub is
 * waste — and if it is, a loop simply cannot do it.
 *
 * Making them separate commands means the user states which they want, instead
 * of the agent inferring it from adjectives like "cinematic" or "dynamic".
 */

/** The skill `/cinematic` always force-weaves. */
export const CINEMATIC_SKILL = "cinematic-web";

export interface ParsedVideoCommand {
  /** Everything the user typed after the command — the description, and
   *  usually which section they mean. */
  brief: string;
  /** Anything typed before the command, preserved. */
  rest: string;
}

function parse(draft: string, command: "video" | "cinematic"): ParsedVideoCommand | null {
  const match = draft.match(new RegExp(`(^|\\s)/${command}(\\s|$)`, "i"));
  if (!match || match.index === undefined) return null;
  const before = draft.slice(0, match.index);
  const after = draft.slice(match.index + match[0].length);
  return { brief: after.trim(), rest: before.trim() };
}

/** `null` when this is not a `/video`. Never errors: `/video` alone is a
 *  complete instruction — animate the hero — with nothing missing. */
export const parseVideoCommand = (draft: string) => parse(draft, "video");
/** `null` when this is not a `/cinematic`. Also never errors. */
export const parseCinematicCommand = (draft: string) => parse(draft, "cinematic");

/**
 * How each message opens. A FIXED sentence, never one that interpolates what
 * the user typed: `Put ambient video motion into ${brief}` reads as a broken
 * sentence the moment the brief is itself a sentence ("…into i want you to
 * generate a video and add it to the hero"). The user's own words go in their
 * own paragraph at the end, which is also what the transcript shows back.
 */
const VIDEO_PREFIX = "Put ambient looping video motion into this page.";
const CINEMATIC_PREFIX = "Run a cinematic scroll pass on this page.";

/**
 * The user's words go after this marker, and the bubble reads them back from
 * it. Splitting on blank lines is not enough — the instructions contain their
 * own — so the boundary has to be something that appears exactly once.
 */
const ASKED = "What the user asked for:";

function assemble(prefix: string, instructions: string[], brief: string, rest: string): string {
  const typed = [brief, rest].filter(Boolean).join(" ").trim();
  const body = `${prefix}\n\n${instructions.join("\n")}`;
  return typed ? `${body}\n\n${ASKED}\n${typed}` : body;
}

/**
 * `/video` — ambient motion. Deliberately says what NOT to do as well, because
 * the failure mode is an agent reaching for the expensive technique when the
 * cheap one is what was asked for.
 */
export function buildVideoDirective(brief: string, rest: string): string {
  return assemble(
    VIDEO_PREFIX,
    [
      "Do NOT call `cinematic_pass`. That specialist builds the scroll-scrub treatment and will",
      "stop to stage assets; it is the wrong technique here and the user did not ask for it. Words",
      'like "cinematic" in the request describe how it should LOOK, not which technique to use.',
      "",
      "This is the LOOPING treatment, not the scroll-scrub one. Build it as a muted, looping,",
      "playsinline `<video>` behind the copy, with the generated poster as its `poster` attribute,",
      "`pointer-events: none`, and a `prefers-reduced-motion` path that shows the poster alone.",
      "The copy stays real DOM on top — never baked into the footage.",
      "",
      "Call `list_generated_videos` first and reuse a suitable clip if one exists, since reuse is",
      "free and generating is not. Otherwise `generate_video` once, then `place_video` to write the",
      "MP4 and its poster into the project, then wire it up.",
      "",
      "If the section already has a still image that sets the look, pass its path as",
      "`reference_path` to `generate_video`. The clip is then animated FROM that image instead of",
      'an unrelated scene — that is what "use the image we already have" means, and inventing a',
      "similar-looking scene instead is not an acceptable substitute.",
      "",
      "If these tools are absent, video generation is not switched on for this project: tell the",
      "user to click the clapperboard in the chat toolbar and ask again. Do not build a placeholder",
      "and do not ask them to supply a file.",
      "",
      "If what is actually wanted is footage that ADVANCES AS THE USER SCROLLS, stop and say so —",
      "that is `/cinematic`, a different technique.",
      "",
      "A generated clip is not footage of a real place. If this section needs a real location,",
      "person, company or product, say so instead of generating something that only resembles it.",
    ],
    brief,
    rest,
  );
}

/**
 * `/cinematic` — the scroll-driven treatment, routed to the specialist that
 * owns `CINEMATIC.md`.
 */
export function buildCinematicDirective(brief: string, rest: string): string {
  return assemble(
    CINEMATIC_PREFIX,
    [
      "This is the SCROLL-DRIVEN treatment: the footage advances as the user scrolls down and",
      "rewinds as they scroll up. Use `cinematic_pass` — it owns CINEMATIC.md, the Scroll",
      "Storyboard and the asset ledger.",
      "",
      "You can produce the footage yourself instead of stopping to ask for it. If the storyboard",
      "needs a clip that is not already in `cinematic/`, check `list_generated_videos`, then",
      "`generate_video` once, then `place_video_frames` to write the numbered sequence, poster and",
      "manifest into `public/cinematic/<slug>/`. Build the canvas from `manifest.json` — never",
      "hardcode a frame count. Say plainly in the review that the footage is generated.",
      "",
      "If these tools are absent, video generation is not switched on for this project: tell the",
      "user to click the clapperboard in the chat toolbar and ask again.",
      "",
      "If the motion does not actually need to follow scroll position — an ambient loop behind the",
      "copy would do — say so: that is `/video`, and it is far cheaper.",
    ],
    brief,
    rest,
  );
}

/**
 * The sent bubble, read back. A person does not want the workflow directive in
 * their transcript — only the words they typed — so the message renders as a
 * compact chip plus this.
 */
function parseMessage(content: string, prefix: string): { brief: string } | null {
  if (!content.startsWith(prefix)) return null;
  const marker = content.lastIndexOf(`\n\n${ASKED}\n`);
  if (marker === -1) return { brief: "" };
  return { brief: content.slice(marker + ASKED.length + 3).trim() };
}

export const parseVideoMessage = (content: string) => parseMessage(content, VIDEO_PREFIX);
export const parseCinematicMessage = (content: string) => parseMessage(content, CINEMATIC_PREFIX);

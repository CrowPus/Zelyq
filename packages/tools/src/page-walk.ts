import type { Page } from "playwright";

/**
 * Walking a page the way a person does, and writing down what happens.
 *
 * A screenshot of a scroll-driven site records almost nothing about it. Against
 * stripe.com, `document.getAnimations()` at load returns 3 animations; walking
 * the page a screenful at a time returns 96. The other 93 are scroll-triggered
 * and have simply not happened yet, so a capture taken at the top is not a
 * partial view of the page's behaviour — it is close to none of it.
 *
 * The other half of the idea is that raw output is useless. linear.app reports
 * 189 animations, 164 of which are the same 420ms transform+opacity reveal.
 * Grouped, that one line *is* the site's motion system; ungrouped it is 189
 * rows of near-identical JSON in the model's context.
 */

/** One animation as the browser reports it, before grouping. */
export interface RawMotion {
  target: string;
  props: string[];
  durationMs: number;
  delayMs: number;
  easing: string;
  /** `null` for an infinite animation. */
  iterations: number | null;
  firstSeenAtY: number;
}

export interface MotionGroup {
  /** How the same motion, used many times, is named once. */
  signature: string;
  durationMs: number;
  /**
   * A stagger is a delay ladder — linear.app's reveal runs at 160ms, 162ms,
   * 164ms and so on across fifty elements. Grouping on the exact delay turned
   * one reveal into fifty entries and buried it; the spread says the same
   * thing in one line, and the stagger is what the replica skill asks for.
   */
  delayMinMs: number;
  delayMaxMs: number;
  easing: string;
  props: string[];
  /** A loop runs forever — ambient decoration, never a reveal. */
  kind: "loop" | "one-shot";
  count: number;
  /** One real element using it, so the agent can go and look. */
  example: string;
  /** Scroll offset where this was first seen running. 0 means on load. */
  firstSeenAtY: number;
}

export interface StickyNote {
  selector: string;
  position: string;
  heightPx: number;
  background: string;
  /**
   * What changed between the top of the page and further down. Often empty:
   * plenty of real sticky headers change appearance on an inner element or a
   * pseudo-element, so nothing shows on the layer itself. The layer is still
   * worth reporting — that a 57px bar is pinned over the content is the fact a
   * clone needs first, and the state change is the refinement.
   */
  changes: string[];
}

export interface MediaNote {
  kind: "video" | "audio";
  src: string | null;
  poster: string | null;
  durationSec: number | null;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  controls: boolean;
  intrinsic: [number, number] | null;
  rendered: [number, number];
  objectFit: string;
  /** What it is *for*, which is the part that decides how to rebuild it. */
  role: "background" | "feature" | "inline";
}

export interface Checkpoint {
  atY: number;
  /** JPEG bytes, base64. */
  jpeg: string;
}

export interface PageWalk {
  pageHeight: number;
  viewportHeight: number;
  stops: number;
  motions: MotionGroup[];
  sticky: StickyNote[];
  media: MediaNote[];
  checkpoints: Checkpoint[];
}

/** Enough stops to cross a long page, few enough to stay under ~15s. */
export const DEFAULT_STOPS = 8;
export const MAX_STOPS = 16;
/**
 * How long to stand still at each stop. The reveal measured on linear.app runs
 * for 420ms; the existing lazy-load scroll in `capture_reference` moves every
 * 60ms, which is why it has never seen one.
 */
export const DEFAULT_DWELL_MS = 600;

// --- pure helpers, so the shaping is testable without a browser ------------

const NAMED_CURVES: Record<string, string> = {
  "cubic-bezier(0.25, 0.1, 0.25, 1)": "ease",
  "cubic-bezier(0.42, 0, 1, 1)": "ease-in",
  "cubic-bezier(0, 0, 0.58, 1)": "ease-out",
  "cubic-bezier(0.42, 0, 0.58, 1)": "ease-in-out",
  "cubic-bezier(0.4, 0, 0.2, 1)": "standard",
};

/**
 * A spring authored in JS arrives as a `linear()` easing with dozens of stops —
 * linear.app's is a little over 700 characters. Carried verbatim into the
 * model's context it is pure noise repeated once per animation, and it is not
 * even usable: nobody rebuilds a spring by copying its sample points.
 */
export function describeEasing(easing: string): string {
  const trimmed = easing.trim();
  if (trimmed.startsWith("linear(")) {
    const stops = trimmed.split(",").length;
    return `spring-like (linear() with ${stops} stops)`;
  }
  return NAMED_CURVES[trimmed] ?? trimmed;
}

/** `11950.000000000002` is a real value the browser returns. */
export function roundMs(value: number): number {
  return Math.round(value);
}

/**
 * `getKeyframes()` lists every property once per keyframe, so a two-keyframe
 * fade reports `["opacity", "opacity"]`. Order is kept because it is the
 * author's, and a `transform, opacity` reveal reads differently from
 * `opacity, transform`.
 */
export function normaliseProps(props: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of props) {
    const prop = raw.trim();
    if (!prop || seen.has(prop)) continue;
    seen.add(prop);
    out.push(prop);
  }
  return out;
}

export function groupMotions(raw: RawMotion[]): MotionGroup[] {
  const groups = new Map<string, MotionGroup>();
  for (const motion of raw) {
    const props = normaliseProps(motion.props);
    const duration = roundMs(motion.durationMs);
    const delay = roundMs(motion.delayMs);
    const easing = describeEasing(motion.easing);
    const kind: MotionGroup["kind"] = motion.iterations === null ? "loop" : "one-shot";
    const key = `${duration}|${easing}|${props.join("+")}|${kind}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.firstSeenAtY = Math.min(existing.firstSeenAtY, motion.firstSeenAtY);
      existing.delayMinMs = Math.min(existing.delayMinMs, delay);
      existing.delayMaxMs = Math.max(existing.delayMaxMs, delay);
      continue;
    }
    groups.set(key, {
      signature: `${duration}ms ${easing} → ${props.join(" + ") || "(no properties)"}`,
      durationMs: duration,
      delayMinMs: delay,
      delayMaxMs: delay,
      easing,
      props,
      kind,
      count: 1,
      example: motion.target,
      firstSeenAtY: motion.firstSeenAtY,
    });
  }
  // One-shots before loops, then frequency. A page's particle field can be the
  // most-used animation on it and still be the least worth copying; the reveal
  // that fires as you scroll is the system. Within each kind the motion used
  // 164 times is the design system and the one used once is a cookie banner,
  // so reading order has to say so or the agent reproduces the cookie banner.
  const rank = (group: MotionGroup) => (group.kind === "one-shot" ? 0 : 1);
  return [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || b.count - a.count || a.durationMs - b.durationMs,
  );
}

/**
 * How many checkpoint frames reach the model.
 *
 * Each costs roughly 190 tokens at 480px wide, so six is a little over a
 * thousand — set against turns this repo has measured at 1.6 million. The cap
 * is here because a 16-stop walk of a long page would otherwise quietly put
 * sixteen images into every clone.
 */
export const MAX_IMAGES = 6;

/** Keep the first, the last, and an even spread between. */
export function pickCheckpoints(all: Checkpoint[], limit = MAX_IMAGES): Checkpoint[] {
  if (all.length <= limit) return all;
  const picked: Checkpoint[] = [];
  for (let i = 0; i < limit; i++) {
    const index = Math.round((all.length - 1) * (i / (limit - 1)));
    const item = all[index];
    if (item && !picked.includes(item)) picked.push(item);
  }
  return picked;
}

/** How many groups reach the model. The tail is all one-offs. */
export const SUMMARY_GROUPS = 6;
/** Loops get less room: there are rarely many, and they matter less. */
export const SUMMARY_LOOPS = 3;

/** A stagger reads as a range; a plain delay reads as a number. */
export function describeDelay(group: Pick<MotionGroup, "delayMinMs" | "delayMaxMs">): string {
  if (!group.delayMaxMs) return "";
  if (group.delayMinMs === group.delayMaxMs) return `, ${group.delayMinMs}ms delay`;
  return `, staggered ${group.delayMinMs}–${group.delayMaxMs}ms`;
}

export function summarizeWalk(walk: PageWalk): string {
  const lines: string[] = [];
  const screens = walk.viewportHeight
    ? (walk.pageHeight / walk.viewportHeight).toFixed(1)
    : "unknown";
  lines.push(
    `Walked ${walk.pageHeight}px (${screens} screens) in ${walk.stops} stops, pausing at each.`,
  );

  if (walk.motions.length === 0) {
    lines.push("Motion: none observed. The page is static, or its motion needs interaction.");
  } else {
    const total = walk.motions.reduce((sum, group) => sum + group.count, 0);
    lines.push(`Motion: ${total} animations, ${walk.motions.length} distinct.`);
    const reveals = walk.motions.filter((group) => group.kind === "one-shot");
    const loops = walk.motions.filter((group) => group.kind === "loop");
    let shown = 0;
    for (const [label, list, budget] of [
      ["Transitions and reveals — this is the system to reproduce:", reveals, SUMMARY_GROUPS],
      ["Ambient loops — decoration, reproduce last:", loops, SUMMARY_LOOPS],
    ] as const) {
      if (!list.length) continue;
      lines.push(label);
      for (const group of list.slice(0, budget)) {
        lines.push(
          `  ×${group.count}  ${group.signature}${describeDelay(group)} — ${
            group.firstSeenAtY === 0 ? "on load" : `from ${group.firstSeenAtY}px`
          }, e.g. ${group.example}`,
        );
      }
      shown += list.slice(0, budget).length;
    }
    if (walk.motions.length > shown) {
      lines.push(`  …and ${walk.motions.length - shown} more (full record in motion.json).`);
    }
  }

  if (walk.sticky.length) {
    lines.push(`Pinned layers (${walk.sticky.length}):`);
    for (const note of walk.sticky.slice(0, 6)) {
      const reaction = note.changes.length
        ? `changes on scroll: ${note.changes.join("; ")}`
        : "no change on scroll";
      lines.push(
        `  ${note.selector} — ${note.position}, ${note.heightPx}px tall, ${note.background}; ${reaction}`,
      );
    }
  }

  if (walk.media.length) {
    lines.push(`Media (${walk.media.length}):`);
    for (const item of walk.media.slice(0, 6)) {
      const flags = [
        item.autoplay ? "autoplay" : null,
        item.loop ? "loop" : null,
        item.muted ? "muted" : null,
        item.controls ? "controls" : null,
      ]
        .filter(Boolean)
        .join(" ");
      const seconds = item.durationSec === null ? "unknown length" : `${item.durationSec}s`;
      lines.push(
        `  ${item.kind} ${item.role} — ${seconds}, ${item.rendered[0]}×${item.rendered[1]} ` +
          `${item.objectFit}${flags ? `, ${flags}` : ""}${item.src ? `, ${item.src}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

// --- the walk itself -------------------------------------------------------

/**
 * Read every running animation with its real timing.
 *
 * Per-keyframe easing is the trap: an animation whose curve is set on its
 * keyframes reports `linear` at the effect level, so reading only
 * `getTiming().easing` records the wrong curve for exactly the authored,
 * hand-tuned motion that is most worth copying.
 */
const SAMPLE_ANIMATIONS = `(atY) => {
  // Remembered on the page, not in Node: an animation still running when the
  // next stop is sampled is the same animation, and counting it again at every
  // stop turned linear.app's 180 animations into a reported 6,126. A WeakSet
  // keyed on the Animation object itself is the only identity there is.
  if (!window.__zelyqSeenAnimations) window.__zelyqSeenAnimations = new WeakSet();
  const seen = window.__zelyqSeenAnimations;
  const out = [];
  for (const a of document.getAnimations()) {
    if (seen.has(a)) continue;
    seen.add(a);
    const effect = a.effect;
    if (!effect || typeof effect.getTiming !== "function") continue;
    const timing = effect.getTiming();
    const frames = typeof effect.getKeyframes === "function" ? effect.getKeyframes() : [];
    const props = [];
    for (const frame of frames) {
      for (const key of Object.keys(frame)) {
        if (key !== "offset" && key !== "computedOffset" && key !== "easing" && key !== "composite") {
          props.push(key);
        }
      }
    }
    let easing = timing.easing || "linear";
    if (easing === "linear") {
      const authored = frames.map((f) => f.easing).find((e) => e && e !== "linear");
      if (authored) easing = authored;
    }
    const el = effect.target;
    let target = "?";
    if (el && el.tagName) {
      target = el.tagName.toLowerCase();
      if (el.id) target += "#" + el.id;
      else if (typeof el.className === "string" && el.className.trim()) {
        target += "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".");
      }
    }
    const duration = typeof timing.duration === "number" ? timing.duration : 0;
    out.push({
      target,
      props,
      durationMs: duration,
      delayMs: typeof timing.delay === "number" ? timing.delay : 0,
      easing,
      iterations: timing.iterations === Infinity ? null : (timing.iterations ?? 1),
      firstSeenAtY: atY,
    });
  }
  return out;
}`;

/** Sticky and fixed layers, and what they look like right now. */
const SAMPLE_STICKY = `() => {
  const rows = [];
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "sticky" && cs.position !== "fixed") continue;
    const rect = el.getBoundingClientRect();
    // A pinned toast or a scroll-to-top button is not layout. A bar that spans
    // most of the viewport is.
    if (rect.width < window.innerWidth * 0.5) continue;
    let selector = el.tagName.toLowerCase();
    if (el.id) selector += "#" + el.id;
    else if (typeof el.className === "string" && el.className.trim()) {
      selector += "." + el.className.trim().split(/\\s+/)[0];
    }
    rows.push({
      selector,
      position: cs.position,
      background: cs.backgroundColor,
      backdrop: cs.backdropFilter,
      shadow: cs.boxShadow === "none" ? "none" : "set",
      height: Math.round(rect.height),
      transform: cs.transform,
      opacity: cs.opacity,
    });
  }
  return rows;
}`;

const PLAY_MEDIA = `(async () => {
  const videos = Array.from(document.querySelectorAll("video"));
  await Promise.all(videos.map((v) => Promise.resolve(v.play()).catch(() => undefined)));
  await new Promise((resolve) => setTimeout(resolve, 600));
})()`;

const SAMPLE_MEDIA = `() => {
  const out = [];
  for (const el of document.querySelectorAll("video, audio")) {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const rendered = [Math.round(rect.width), Math.round(rect.height)];
    out.push({
      kind: el.tagName.toLowerCase(),
      src: (el.currentSrc || el.src || "") || null,
      poster: el.poster || null,
      durationSec: Number.isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : null,
      autoplay: !!el.autoplay,
      loop: !!el.loop,
      muted: !!el.muted,
      controls: !!el.controls,
      intrinsic: el.videoWidth ? [el.videoWidth, el.videoHeight] : null,
      rendered,
      objectFit: cs.objectFit || "fill",
      viewportWidth: window.innerWidth,
    });
  }
  return out;
}`;

/**
 * What a `<video>` is *for*, which is what decides how to rebuild it. A muted,
 * looping, controls-less video as wide as the viewport is a background; the
 * same file at 600px with controls is content. Today both come back as
 * nothing at all.
 */
export function classifyMedia(raw: {
  kind: string;
  controls: boolean;
  muted: boolean;
  loop: boolean;
  rendered: [number, number];
  viewportWidth: number;
}): MediaNote["role"] {
  if (raw.kind === "audio") return "inline";
  const fillsWidth = raw.rendered[0] >= raw.viewportWidth * 0.9;
  if (fillsWidth && !raw.controls && (raw.muted || raw.loop)) return "background";
  if (fillsWidth || raw.rendered[0] >= 640) return "feature";
  return "inline";
}

function describeStickyChange(
  top: Record<string, unknown>,
  lower: Record<string, unknown>,
): string[] {
  const changes: string[] = [];
  const compare: Array<[string, string]> = [
    ["background", "background"],
    ["backdrop", "backdrop-filter"],
    ["shadow", "shadow"],
    ["height", "height"],
    ["transform", "transform"],
    ["opacity", "opacity"],
  ];
  for (const [key, label] of compare) {
    if (String(top[key]) !== String(lower[key])) {
      changes.push(`${label} ${String(top[key])} → ${String(lower[key])}`);
    }
  }
  return changes;
}

export interface WalkOptions {
  stops?: number;
  dwellMs?: number;
  /** Capture a JPEG at each stop. Off when nobody will look at them. */
  checkpoints?: boolean;
  /** Try to start each `<video>` so its metadata and frames are real. */
  playMedia?: boolean;
  signal?: AbortSignal;
}

/**
 * Walk `page` and report what a person would have seen doing the same thing.
 *
 * The page is left scrolled back to the top, because callers screenshot it
 * afterwards and a capture that silently depended on this having run would be
 * the kind of coupling that breaks quietly.
 */
export async function walkPage(page: Page, options: WalkOptions = {}): Promise<PageWalk> {
  const dwell = options.dwellMs ?? DEFAULT_DWELL_MS;
  const wanted = options.stops ?? DEFAULT_STOPS;

  const metrics = await page.evaluate<{ height: number; viewport: number }>(
    "({ height: document.documentElement.scrollHeight, viewport: window.innerHeight })",
  );
  const height = metrics.height || metrics.viewport;
  const viewport = metrics.viewport || 1;
  // Capped by stop count, not page height: a 40,000px page is not worth four
  // times the time of a 10,000px one to learn the same easing curve.
  const stops = Math.max(
    2,
    Math.min(MAX_STOPS, Math.min(wanted, Math.ceil(height / viewport) + 1)),
  );

  const raw: RawMotion[] = [];
  const checkpoints: Checkpoint[] = [];
  let stickyTop: Array<Record<string, unknown>> = [];
  let stickyLower: Array<Record<string, unknown>> = [];

  const furthest = Math.max(0, height - viewport);
  for (let index = 0; index < stops; index++) {
    if (options.signal?.aborted) break;
    const atY = Math.round(furthest * (index / Math.max(1, stops - 1)));
    // Evaluate bodies are strings throughout this package: it does not
    // compile with the DOM lib, because almost none of it runs in a browser.
    await page.evaluate(`window.scrollTo({ top: ${atY}, behavior: "instant" })`);

    // Sampled twice: once as things start, once as they settle. A reveal that
    // begins and ends inside one dwell would otherwise be missed entirely
    // depending on where the single sample happened to land.
    await page.waitForTimeout(Math.round(dwell * 0.45));
    raw.push(...(await page.evaluate<RawMotion[]>(`(${SAMPLE_ANIMATIONS})(${atY})`)));
    await page.waitForTimeout(Math.round(dwell * 0.55));
    raw.push(...(await page.evaluate<RawMotion[]>(`(${SAMPLE_ANIMATIONS})(${atY})`)));

    const sticky = await page
      .evaluate<Array<Record<string, unknown>>>(`(${SAMPLE_STICKY})()`)
      .catch(() => []);
    if (index === 0) stickyTop = sticky;
    else if (index === 1) stickyLower = sticky;

    if (options.checkpoints) {
      const shot = await page
        .screenshot({ type: "jpeg", quality: 55, animations: "allow" })
        .catch(() => null);
      if (shot) checkpoints.push({ atY, jpeg: shot.toString("base64") });
    }
  }

  await page.evaluate('window.scrollTo({ top: 0, behavior: "instant" })').catch(() => undefined);

  if (options.playMedia) {
    // Best-effort: a video behind DRM or a paywall simply will not start, and
    // the metadata is still worth having.
    await page.evaluate(PLAY_MEDIA).catch(() => undefined);
  }

  const mediaRaw = await page
    .evaluate<
      Array<{
        kind: string;
        src: string | null;
        poster: string | null;
        durationSec: number | null;
        autoplay: boolean;
        loop: boolean;
        muted: boolean;
        controls: boolean;
        intrinsic: [number, number] | null;
        rendered: [number, number];
        objectFit: string;
        viewportWidth: number;
      }>
    >(`(${SAMPLE_MEDIA})()`)
    .catch(() => []);

  const media: MediaNote[] = mediaRaw.map((item) => ({
    kind: item.kind === "audio" ? "audio" : "video",
    src: item.src,
    poster: item.poster,
    durationSec: item.durationSec,
    autoplay: item.autoplay,
    loop: item.loop,
    muted: item.muted,
    controls: item.controls,
    intrinsic: item.intrinsic,
    rendered: item.rendered,
    objectFit: item.objectFit,
    role: classifyMedia(item),
  }));

  const sticky: StickyNote[] = stickyTop.map((top) => {
    const lower = stickyLower.find((row) => row.selector === top.selector);
    return {
      selector: String(top.selector),
      position: String(top.position),
      heightPx: Number(top.height) || 0,
      background: String(top.background),
      changes: lower ? describeStickyChange(top, lower) : [],
    };
  });

  return {
    pageHeight: height,
    viewportHeight: viewport,
    stops,
    motions: groupMotions(raw),
    sticky,
    media,
    checkpoints,
  };
}

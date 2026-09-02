/**
 * Turns the agent's tool stream into a posture.
 *
 * The point is to be readable at a glance, the way a person holding a phone to
 * their ear is readable. That means a small vocabulary held steadily, not a
 * faithful log — a body that changed pose on every event would be a strobe,
 * not a gesture.
 */

export type Posture =
  | "idle"
  | "thinking"
  | "reading"
  | "writing"
  | "running"
  | "inspecting"
  | "browsing"
  | "consulting"
  | "delegating";

/**
 * Ordered, first match wins. Patterns rather than a list of names: an instance
 * can add plugin and MCP tools nobody here has seen, and an unrecognised tool
 * should still land somewhere honest instead of freezing the body.
 */
const FAMILIES: Array<[Posture, RegExp]> = [
  ["delegating", /^(dispatch_task|.*_pass)$/],
  ["consulting", /^(use_skill|use_design_ref|use_ai_provider|fetch_provider_docs)$/],
  ["browsing", /^(capture_reference|http_request|fetch_reference_image|.*_image_asset)$/],
  [
    "inspecting",
    /^(verify|view_preview|inspect_|check_|accessibility_|test_|security_|quality_|.*_report$|.*_audit$)/,
  ],
  ["running", /^(run_command|typecheck_|lint_|build_|start_preview|supabase_|deployment_)/],
  ["writing", /^(write_|edit_|delete_|update_plan|generate_|optimize_)/],
  ["reading", /^(read_|list_|find_|search_|analyze_|discover_|preview_logs|explain_|git_)/],
];

/** The posture a tool call puts the body into. */
export function postureFor(toolName: string): Posture {
  // An MCP tool arrives as `server__tool`; the verb is the half that matters.
  const bare = toolName.includes("__") ? (toolName.split("__")[1] ?? toolName) : toolName;
  for (const [posture, pattern] of FAMILIES) {
    if (pattern.test(bare)) return posture;
  }
  // Unknown tools read as reading: most are inspection of some kind, and a
  // wrong-but-calm posture beats a body that stops moving.
  return "reading";
}

export interface Body {
  posture: Posture;
  /** 0–1. How hard it is working, from the real rate of tool calls. */
  tempo: number;
  /** 0–1. Errors and repeated failures. A body that cannot show strain is decoration. */
  tension: number;
  /** What it is working on — a filename, a URL, a command. */
  focus: string | null;
  /** When the current posture was adopted, for the dwell rule. */
  since: number;
  /**
   * When the last tool call started, for tempo. Separate from `since` because
   * a posture is held across a whole burst: measuring the rate from `since`
   * would make a long run of fast reads look like it was slowing down.
   */
  lastCallAt: number;
}

export const RESTING: Body = {
  posture: "idle",
  tempo: 0,
  tension: 0,
  focus: null,
  since: 0,
  lastCallAt: 0,
};

/**
 * How long a posture must be held before another can replace it.
 *
 * Read and write calls take 3–5 ms and run in the hundreds, and they
 * interleave: read, edit, read, edit. Without a floor the body would flicker
 * between two poses many times a second, which reads as a glitch rather than
 * as work. 600 ms is long enough to see a pose and short enough that a genuine
 * change of activity still feels immediate.
 */
export const MIN_DWELL_MS = 600;

/** Tool calls per second that counts as working flat out. */
const BUSY_RATE = 6;

/** What a tool call is being done to, for the caption under the body. */
function focusOf(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  for (const key of ["path", "file", "url", "command", "query", "name", "task"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      const text = value.trim();
      // A path reads better as its own last two segments than as a long prefix.
      const short =
        text.startsWith("/") || text.includes("/") ? text.split("/").slice(-2).join("/") : text;
      return short.length > 48 ? `${short.slice(0, 47)}…` : short;
    }
  }
  return null;
}

/**
 * Folds one tool call into the body.
 *
 * `now` is passed in rather than read here so the dwell and tempo rules are
 * testable without waiting in real time.
 */
export function onToolStart(
  body: Body,
  call: { name: string; input?: Record<string, unknown> },
  now: number,
): Body {
  const next = postureFor(call.name);
  const focus = focusOf(call.input) ?? body.focus;

  // Rate: how close together calls are arriving, smoothed so one slow tool
  // does not read as the agent stopping.
  const gap = body.lastCallAt ? Math.max(1, now - body.lastCallAt) : 1000;
  const instant = Math.min(1, 1000 / gap / BUSY_RATE);
  const tempo = body.posture === "idle" ? instant : body.tempo * 0.7 + instant * 0.3;

  // The dwell rule. Delegating is exempt: handing work to a specialist is a
  // real change of what is happening, and it lasts a minute — showing it late
  // would be showing it wrong.
  const held = now - body.since;
  if (next !== body.posture && held < MIN_DWELL_MS && next !== "delegating") {
    return { ...body, tempo, focus, lastCallAt: now };
  }

  return {
    posture: next,
    tempo,
    tension: body.tension,
    focus,
    since: next === body.posture ? body.since : now,
    lastCallAt: now,
  };
}

/**
 * A finished call. Failures raise tension; success bleeds it away, so a body
 * that recovers visibly settles rather than staying rigid.
 */
export function onToolEnd(body: Body, call: { isError?: boolean }): Body {
  const tension = call.isError
    ? Math.min(1, body.tension + 0.34)
    : Math.max(0, body.tension - 0.12);
  return { ...body, tension };
}

/**
 * No tool is running. The model is deciding what to do next, which is a real
 * state and not the same as being stuck — the difference the current spinner
 * cannot express.
 */
export function onThinking(body: Body, now: number): Body {
  if (body.posture === "thinking") return body;
  // The same dwell floor as everything else. A model that emits a sentence
  // between two edits should not drop the body out of its working pose and
  // back into it a few milliseconds later.
  if (now - body.since < MIN_DWELL_MS) return body;
  return { ...body, posture: "thinking", since: now, tempo: body.tempo * 0.5 };
}

/** The turn is over. The body settles rather than vanishing. */
export function onRest(body: Body, now: number): Body {
  return { ...RESTING, tension: body.tension * 0.5, since: now };
}

/**
 * The start of a turn. `since` stays at zero so the first real activity is
 * adopted immediately rather than being held off by the dwell floor.
 */
export function onTurnStart(): Body {
  return { ...RESTING, posture: "thinking" };
}

/**
 * Tempo as an animation-duration multiplier: working harder plays the same
 * choreography faster. Shared so the body and the strip it sits in cannot
 * drift apart — two clocks for one agent would read as two agents.
 */
export function pace(tempo: number): number {
  return 1 - Math.min(0.65, tempo * 0.65);
}

/** Plain-language name, for the caption and for screen readers. */
export const POSTURE_LABEL: Record<Posture, string> = {
  idle: "Waiting",
  thinking: "Thinking",
  reading: "Reading",
  writing: "Writing",
  running: "Running",
  inspecting: "Checking",
  browsing: "Looking",
  consulting: "Consulting",
  delegating: "Delegating",
};

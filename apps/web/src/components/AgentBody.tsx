import type { CSSProperties } from "react";
import { type Body, POSTURE_LABEL, type Posture } from "../lib/posture";

/**
 * The agent, as a body rather than a status line.
 *
 * Zelyq's mark is one stroke broken at its own corners into three segments.
 * That is the body: the same three strokes, re-posed into whatever the agent
 * is doing. Nothing is added and nothing is a mascot — the logo picks up a
 * tool, and puts it down again.
 *
 * Every segment is `M x,y L x,y L x,y`, always three points, so the browser
 * interpolates `d` between poses and the change is a movement rather than a
 * swap. A body that teleported between icons would be a slideshow.
 *
 * Three channels run at once, the way real body language does:
 *   posture — what it is holding
 *   tempo   — how fast it is working, from the real rate of tool calls
 *   tension — strain, from real failures
 */

interface Segment {
  d: string;
  /** Per-segment motion for this posture, if it has one. */
  anim?: string;
}

/** The mark at rest: top bar, diagonal, bottom bar. */
const REST: Segment[] = [
  { d: "M22,24 L50,24 L78,24" },
  { d: "M78,24 L50,50 L22,76" },
  { d: "M22,76 L50,76 L78,76" },
];

const POSES: Record<Posture, Segment[]> = {
  // At rest, and breathing. Something alive is never perfectly still.
  idle: REST,

  // Loose and unformed: the strokes drift apart, holding no shape. This is the
  // pause before speaking, and it must not resemble any working pose.
  thinking: [
    { d: "M24,30 L48,26 L74,30", anim: "body-drift-a" },
    { d: "M74,38 L50,50 L26,62", anim: "body-drift-b" },
    { d: "M24,70 L52,74 L76,70", anim: "body-drift-c" },
  ],

  // A page, with the eye sweeping down it. Flat and horizontal — the calmest
  // of the working poses, because it is the one the agent is in most.
  reading: [
    { d: "M26,24 L50,28 L74,24" },
    { d: "M30,46 L50,46 L70,46", anim: "body-scan" },
    { d: "M26,78 L50,74 L74,78" },
  ],

  // Deliberately NOT horizontal. Reading and writing are the two commonest
  // things the agent does, so they have to differ in shape and not only in
  // motion: a page corner, and a nib working diagonally across it.
  writing: [
    { d: "M24,72 L24,30 L66,30" },
    { d: "M34,64 L48,50 L62,36", anim: "body-write" },
    { d: "M44,78 L60,78 L76,78" },
  ],

  // Three spokes, turning. Work being done by a machine rather than by hand.
  running: [
    { d: "M50,50 L50,34 L50,20" },
    { d: "M50,50 L64,58 L78,66" },
    { d: "M50,50 L36,58 L22,66" },
  ],

  // An eye: two arcs meeting at the corners, with the pupil tracking across.
  // Checking its work is looking at it, and an eye is the least ambiguous
  // shape there is.
  inspecting: [
    { d: "M18,50 L50,26 L82,50" },
    { d: "M42,50 L50,50 L58,50", anim: "body-sweep" },
    { d: "M18,50 L50,74 L82,50" },
  ],

  // A window, framed. Closed geometry, so it cannot be confused with the
  // open horizontal lines of a page.
  browsing: [
    { d: "M22,74 L22,26 L78,26" },
    { d: "M28,52 L50,48 L72,52", anim: "body-horizon" },
    { d: "M78,26 L78,74 L22,74" },
  ],

  // A bookmark. Two earlier attempts at an open book read as an arrow and then
  // as `running` upside down; a ribbon with a notched tail collides with
  // nothing else in the set, which matters more than the metaphor being exact.
  consulting: [
    { d: "M34,20 L50,20 L66,20" },
    { d: "M34,20 L34,48 L50,64", anim: "body-leaf-l" },
    { d: "M66,20 L66,48 L50,64", anim: "body-leaf-r" },
  ],

  // The body divides. Two strokes stay and hold the shape of the mark; the
  // third leaves, and works somewhere else. `dispatch_task` runs a real second
  // agent for a minute — one body pretending to multitask would be a lie.
  delegating: [
    { d: "M18,36 L38,36 L18,58" },
    { d: "M18,58 L28,58 L38,58" },
    { d: "M56,46 L70,52 L84,58", anim: "body-handoff" },
  ],
};

export interface AgentBodyProps {
  body: Body;
  size?: number;
  className?: string;
}

export function AgentBody({ body, size = 64, className = "" }: AgentBodyProps) {
  const pose = POSES[body.posture] ?? REST;

  // Tempo drives the clock, not the choreography: the same pose played faster
  // is the same activity done harder, which is what a rate actually means.
  const speed = 1 - Math.min(0.65, body.tempo * 0.65);
  // Tension warms the colour and tightens the stroke. It is deliberately the
  // only thing that changes hue, so strain is never confused with activity.
  const strain = body.tension;

  const style = {
    "--body-speed": `${speed.toFixed(2)}`,
    "--body-strain": strain.toFixed(2),
  } as CSSProperties;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`agent-body ${className}`}
      data-posture={body.posture}
      style={style}
      role="img"
      aria-label={`${POSTURE_LABEL[body.posture]}${body.focus ? `: ${body.focus}` : ""}`}
    >
      <title>
        {POSTURE_LABEL[body.posture]}
        {body.focus ? `: ${body.focus}` : ""}
      </title>
      {pose.map((segment, i) => (
        <path
          // Index-keyed on purpose: these three are a fixed cast, and reusing
          // the same element is what lets `d` interpolate between poses.
          // biome-ignore lint/suspicious/noArrayIndexKey: the three strokes are positional, not a list
          key={i}
          d={segment.d}
          className={segment.anim ? `agent-body__seg ${segment.anim}` : "agent-body__seg"}
        />
      ))}
    </svg>
  );
}
